// 持久化前后镜像；所有正式文件及日志均使用宿主条件写入。
export interface TextRecord { text: string; version: string }
export interface TransactionPort {
  read(path: string): Promise<TextRecord | null>
  put(path: string, text: string, expected: string | null): Promise<void | string>
  remove(path: string, expected: string): Promise<void>
}
export class CommitError extends Error { code: string
  constructor(code: string, message: string) { super(message); this.code = code } }
export interface Mutation { path: string; before: TextRecord | null; after: string | null; afterVersion?: string }
interface Journal { owner: string; operationId: string; request: string; state: 'prepared' | 'committed'; changes: Mutation[]; result: unknown }
const assetPath = (path: string) => /^assets\/[A-Za-z0-9_-]{1,128}\.image\.json$/.test(path)
function journalText(journal: Journal) {
  const text=JSON.stringify(journal)
  if(new TextEncoder().encode(text).length>48*1024*1024)throw new CommitError('resource_too_large','事务记录超过 48 MiB')
  return text
}
const active = '.transactions/active.json'
const receipt = (id: string) => {
  if(!/^[A-Za-z0-9_-]+$/.test(id)) throw new CommitError('invalid_data','操作ID无效')
  return `.transactions/${id}/result.json`
}
function parseJournal(text: string): Journal {
  const j = JSON.parse(text)
  const validPath = (path: unknown) => typeof path === 'string' && !path.includes('\\') && !path.startsWith('/') && !path.split('/').some(p => !p || p === '.' || p === '..' || p === '.transactions' || p === 'exports' || p.includes(':')) && (path === 'map.json' || path === 'layout.json' || path.endsWith('.md') || /^assets\/[A-Za-z0-9_-]{1,128}\.image\.json$/.test(path))
  if(!j || typeof j.owner !== 'string' || typeof j.request !== 'string' || !['prepared','committed'].includes(j.state) || !Array.isArray(j.changes) || j.changes.some((c: any) => !c || !validPath(c.path) || (c.afterVersion !== undefined && typeof c.afterVersion !== 'string') || (assetPath(c.path) && (c.before !== null || typeof c.after !== 'string')) || (c.after !== null && typeof c.after !== 'string') || (c.before !== null && (!c.before || typeof c.before.text !== 'string' || typeof c.before.version !== 'string'))) || new Set(j.changes.map((c: any)=>c.path)).size !== j.changes.length) throw new CommitError('recovery_required','恢复记录无效；未修改文件，保留资料')
  receipt(j.operationId)
  return j
}
export class Transactions {
  private port: TransactionPort
  private owner: string
  constructor(port: TransactionPort, owner: string) { this.port = port; this.owner = owner }
  async replay(id: string, request: string) {
    if(await this.port.read(active)) throw new CommitError('recovery_required','活动提交尚未结束，不能重放成功结果')
    const record = await this.port.read(receipt(id))
    if(!record) return undefined
    const data = JSON.parse(record.text)
    if(data.request !== request) throw new CommitError('operation_conflict','同一operationId不能用于不同请求')
    return data.result
  }
  async recover() {
    const record = await this.port.read(active)
    if(!record) return
    const journal = parseJournal(record.text)
    if(journal.state === 'committed') {
      for(const c of journal.changes) if((await this.port.read(c.path))?.text !== (c.after ?? undefined)) throw new CommitError('recovery_required',`已提交文件发生外部变化：${c.path}`)
      await this.finish(journal)
    } else {
      for(const c of [...journal.changes].reverse()) {
        const now = await this.port.read(c.path)
        if((now?.text ?? null) === (c.before?.text ?? null)) continue
        if((now?.text ?? null) !== c.after) throw new CommitError('recovery_required',`外部冲突，保留恢复资料：${c.path}`)
        if(assetPath(c.path) && now && (!c.afterVersion || now.version!==c.afterVersion))throw new CommitError('recovery_required',`资源写入版本无法证明，保留文件：${c.path}`)
        if(c.before) await this.port.put(c.path,c.before.text,now?.version ?? null)
        else if(now) await this.port.remove(c.path,now.version)
      }
    }
    const current = await this.port.read(active)
    if(current?.text !== record.text) throw new CommitError('recovery_required','活动记录发生变化')
    await this.port.remove(active,current.version)
  }
  private async finish(journal: Journal) {
    const path = receipt(journal.operationId)
    const text = JSON.stringify({ request: journal.request, result: journal.result })
    const prior = await this.port.read(path)
    if(prior && prior.text !== text) throw new CommitError('recovery_required','操作结果记录冲突')
    if(!prior) await this.port.put(path,text,null)
  }
  async commit(operationId: string, request: string, changes: Mutation[], result: unknown, verify: () => Promise<void>, finalize?: () => Promise<unknown>) {
    const prior = await this.replay(operationId,request)
    if(prior !== undefined) return prior
    const journal: Journal = {owner:this.owner,operationId,request,state:'prepared',changes,result}
    if (new TextEncoder().encode(JSON.stringify(journal)).length + 4096 + changes.filter(c=>assetPath(c.path)).length*512 > 48 * 1024 * 1024) throw new CommitError('resource_too_large','事务记录超过 48 MiB，未写入')
    parseJournal(JSON.stringify(journal))
    if(await this.port.read(active)) throw new CommitError('recovery_required','已有活动操作；原操作结束后再恢复')
    let committed = false
    let claimed = false
    try {
      await this.port.put(active,journalText(journal),null)
      claimed = true
      await verify()
      for(const c of changes) {
        const now = await this.port.read(c.path)
        if((now?.version ?? null) !== (c.before?.version ?? null)) throw new CommitError('version_conflict',`文件变化：${c.path}`)
        if(c.after === null) { if(now) await this.port.remove(c.path,now.version) }
        else {
          const writtenVersion=await this.port.put(c.path,c.after,now?.version ?? null)
          if(assetPath(c.path)) {
            if(!writtenVersion || writtenVersion.length>256)throw new CommitError('recovery_required','宿主未返回资源写入版本，保留恢复资料')
            c.afterVersion=writtenVersion
            const lock=await this.port.read(active)
            if(!lock || JSON.parse(lock.text).owner!==this.owner)throw new CommitError('recovery_required','资源提交期间认领变化')
            await this.port.put(active,journalText(journal),lock.version)
          }
        }
      }
      for(const c of changes) {
        const written=await this.port.read(c.path)
        if(written?.text !== (c.after ?? undefined) || (c.afterVersion && written?.version!==c.afterVersion))
          throw new CommitError('version_conflict',`提交复读失败：${c.path}`)
      }
      if(finalize) journal.result = await finalize()
      const lock = await this.port.read(active)
      if(!lock || JSON.parse(lock.text).owner !== this.owner) throw new CommitError('recovery_required','操作记录变化')
      journal.state = 'committed'
      await this.port.put(active,journalText(journal),lock.version)
      committed = true
      await this.finish(journal)
      const done = await this.port.read(active)
      if(done) await this.port.remove(active,done.version)
      return journal.result
    } catch(e) {
      // 标记写入也可能已生效后抛错，恢复始终以实际持久化记录为准。
      try {
        const lock = await this.port.read(active)
        if(!lock && committed && (await this.replay(operationId,request)) !== undefined) return journal.result
        if(!lock && !claimed) throw e
        if(!lock || JSON.parse(lock.text).owner !== this.owner) throw new Error('活动操作属于其他所有者或记录丢失')
        committed ||= JSON.parse(lock.text).state === 'committed'
        await this.recover()
      } catch(recovery) { throw new CommitError('recovery_required',`保留操作资料：${String(e)}；${String(recovery)}`) }
      if(committed) return journal.result
      throw new CommitError('failed_rolled_back',`提交失败，已回退：${String(e)}`)
    }
  }
}
