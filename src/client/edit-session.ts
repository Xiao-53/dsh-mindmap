import type { MapSnapshot, ViewLayout } from '../shared/map-types.ts'
import type { Edit, EditRequest } from '../server/edit-service.ts'
import type { ImageAsset } from '../shared/image-resource.ts'
import { imageUrl } from '../shared/image-resource.ts'
import { digest, canonicalJson } from '../shared/fingerprint.ts'
import { manualPlotDelta } from '../shared/note-markdown.ts'
import { fillLayout } from '../shared/layout.ts'
import type { HostAdapter } from './host-adapter.ts'
import { EditHistory, type HistoryValue } from './edit-history.ts'

const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
const normalized = (v: ViewLayout): ViewLayout => ({ viewId:v.viewId, mode:v.mode??'vertical', nodes:v.nodes, groups:v.groups })
const sameFileContents = (a:MapSnapshot,b:MapSnapshot) =>
  a.files.length===b.files.length && a.files.every(file=>b.files.some(other=>file.path===other.path&&file.digest===other.digest))
const paused = (status: string) => ['readonly', 'conflict', 'recovery_required'].includes(status)
export class EditSession {
  baseline: MapSnapshot
  working: MapSnapshot
  history = new EditHistory()
  localRevision = 0
  persistedRevision = 0
  inFlightRevision?: number
  status: 'clean' | 'dirty' | 'saving' | 'failed' | 'conflict' | 'recovery_required' | 'readonly' = 'clean'
  message = ''
  draft?: { edit: Extract<Edit, { kind: 'details' }>; viewId: string; composition: boolean }
  private timer?: ReturnType<typeof setTimeout>
  private composing = false
  private listeners = new Set<() => void>()
  private flight?: Promise<void>
  private pending?: EditRequest
  private pool = new Map<string, ImageAsset>()
  private notePaths = new Map<string,string>()
  private origins = new Map<string, ViewLayout>()
  private touched = new Set<string>()
  private refreshAfterSave = false
  private disposed = false
  private detached = false

  host: HostAdapter

  constructor(host: HostAdapter, snapshot: MapSnapshot) {
    this.host = host
    this.baseline = snapshot
    this.working = snapshot
    this.notePaths.clear()
    for(const node of snapshot.map.nodes)if(node.notePath)this.notePaths.set(node.id,node.notePath)
    if (snapshot.writable === false) {
      this.status = 'readonly'
      this.message = '部分资源缺失或损坏，当前只读；修复后重新读取'
    }
  }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private emit() { if (!this.disposed) for (const fn of this.listeners) fn() }
  get dirty() { return !!this.draft || !!this.next() }
  get uncertain() { return !!this.pending || !!this.flight }
  details(nodeId: string): Extract<Edit, { kind: 'details' }> {
    const node = this.working.map.nodes.find(n => n.id === nodeId)!
    return { kind: 'details', nodeId, title: node.title, summary: node.summary, markdown: this.working.notes[nodeId] ?? '', images: [] }
  }
  input(edit: Extract<Edit, { kind: 'details' }>, viewId: string, composition = false, immediate = false) {
    if (paused(this.status) || this.disposed) return
    if (this.draft && this.draft.edit.nodeId !== edit.nodeId && !this.finishInput()) return
    for (const a of edit.images) this.pool.set(a.id, a)
    this.draft = { edit: { ...edit, images: [] }, viewId, composition }
    this.scheduleInput(immediate)
    this.emit()
  }
  composition(active: boolean) {
    if (this.composing === active) return
    this.composing = active
    if (this.draft) this.draft.composition = active
    this.scheduleInput()
  }
  private scheduleInput(immediate = false) {
    clearTimeout(this.timer)
    if (this.draft && !this.draft.composition && !this.composing) this.timer = setTimeout(() => {
      if (this.finishInput()) void this.save(this.status === 'failed' && !this.pending)
    }, immediate ? 0 : 800)
  }
  finishInput() {
    clearTimeout(this.timer)
    if (this.composing) return false
    if (!this.draft) return true
    if (this.draft.composition || !this.draft.edit.title.trim()) {
      this.message = '标题不能为空，或输入尚未结束；草稿已保留'
      this.emit()
      return false
    }
    const { edit, viewId } = this.draft
    this.draft = undefined
    edit.title = edit.title.trim()
    this.record(edit, viewId)
    return true
  }
  notePath(nodeId: string) { return this.working.map.nodes.find(n=>n.id===nodeId)?.notePath ?? this.notePaths.get(nodeId) ?? `notes/${nodeId}.md` }
  previewResources(nodeId: string) {
    const resources = { ...this.working.resources }
    const node = this.working.map.nodes.find(n => n.id === nodeId)!
    const dirs = this.notePath(nodeId).split('/').length - 1
    for (const asset of this.pool.values()) resources[`${node.id}:${'../'.repeat(dirs)}assets/${asset.id}.image.json`] = imageUrl(asset)
    return resources
  }
  private apply(edit: HistoryValue) {
    if(edit.kind==='move') {
      const view=this.working.layout?.views.find(v=>v.viewId===edit.viewId)??fillLayout(this.working.map,this.working.layout,{}).views.find(v=>v.viewId===edit.viewId)!
      this.apply({kind:'layout',viewId:edit.viewId,layout:{...view,nodes:view.nodes.map(n=>n.nodeId===edit.node.nodeId?edit.node:n)}})
      return
    }
    if (edit.kind === 'layout') {
      this.touched.add(edit.viewId)
      const others = (this.working.layout?.views ?? []).filter(v => v.viewId !== edit.viewId).map(normalized)
      this.working = { ...this.working, layout: { schemaVersion: 2, mapId: this.working.map.id, views: [...others, normalized(edit.layout)] } }
    } else {
      this.working = {
        ...this.working,
        map: { ...this.working.map, nodes: this.working.map.nodes.map(n => n.id === edit.nodeId ? { ...n, title: edit.title, summary: edit.summary } : n) },
        notes: { ...this.working.notes, [edit.nodeId]: edit.markdown }, resources: this.previewResources(edit.nodeId),
      }
    }
  }
  record(edit: Edit, viewId: string, layoutBefore?: ViewLayout, kind?: 'move') {
    if (paused(this.status)) return
    const before: Edit = edit.kind === 'details' ? this.details(edit.nodeId) : {
      kind: 'layout', viewId: edit.viewId,
      layout: normalized(layoutBefore ?? fillLayout(this.working.map, this.working.layout, {}).views.find(v => v.viewId === edit.viewId)!),
    }
    if (equal(before, edit)) return
    if (before.kind === 'layout' && !this.origins.has(viewId)) this.origins.set(viewId, structuredClone(before.layout))
    this.localRevision++
    let historyBefore:HistoryValue=before, historyAfter:HistoryValue=edit
    if(kind==='move' && before.kind==='layout' && edit.kind==='layout') {
      const moved=edit.layout.nodes.find(n=>!equal(n,before.layout.nodes.find(b=>b.nodeId===n.nodeId)))
      const old=moved&&before.layout.nodes.find(n=>n.nodeId===moved.nodeId)
      if(!moved||!old)return
      historyBefore={kind:'move',viewId,node:old};historyAfter={kind:'move',viewId,node:moved}
    }
    this.history.record({ before:historyBefore, after:historyAfter, viewId, entryId: crypto.randomUUID(), kind: kind ?? edit.kind, localRevision: this.localRevision })
    this.apply(edit)
    if (this.status !== 'saving' && this.status !== 'failed') this.status = 'dirty'
    this.emit()
  }
  setLayout(layout: ViewLayout, before?: ViewLayout, kind?: 'move') {
    this.record({ kind: 'layout', viewId: layout.viewId, layout: normalized(layout) }, layout.viewId, before, kind)
    void this.save()
  }
  travel(redo = false) {
    if (paused(this.status) || !this.finishInput()) return
    const entry = redo ? this.history.redo() : this.history.undo()
    if (!entry) return
    this.apply(redo ? entry.after : entry.before)
    this.localRevision++
    if (this.status !== 'saving' && this.status !== 'failed') this.status = this.dirty ? 'dirty' : 'clean'
    this.emit()
    if (this.status !== 'failed') void this.save()
    return entry
  }
  accept(snapshot: MapSnapshot) {
    if (this.flight) { this.refreshAfterSave = true; return }
    if (snapshot.fingerprint && snapshot.fingerprint === this.baseline.fingerprint && snapshot.writable === this.baseline.writable) return
    if (this.dirty || this.pending || this.composing) {
      this.status = 'conflict'
      this.message = '导图被外部修改；本地副本已保留，请放弃副本并载入磁盘版本，或保留并取消离开'
      this.emit()
      return
    }
    this.baseline = snapshot
    this.working = snapshot
    this.notePaths.clear()
    for(const node of snapshot.map.nodes)if(node.notePath)this.notePaths.set(node.id,node.notePath)
    this.history.clear()
    this.origins.clear()
    this.touched.clear()
    this.pool.clear()
    this.status = snapshot.writable === false ? 'readonly' : 'clean'
    this.message = snapshot.writable === false ? '资源不完整，当前只读' : '导图已被外部更新，撤销记录已清空'
    this.emit()
  }
  attach(snapshot: MapSnapshot) {
    this.accept(snapshot)
    if (this.detached && this.dirty && !paused(this.status)) this.message = '已找回本会话未保存的修改；可以重试保存，或放弃并重载'
    this.detached = false
  }
  async discardLatest() {
    if (this.flight) await this.flight
    // 不明提交结果先只读查询，明确状态后才允许丢弃本地副本。
    if (this.pending) {
      try { await this.resolvePending() }
      catch(e) {if((e as {code?:string}).code==='version_conflict')this.pending=undefined;else throw e}
    }
    const snapshot = await this.host.read(this.baseline.map.id, new AbortController().signal, this.baseline.workspaceKey)
    return this.discard(snapshot)
  }
  discard(snapshot = this.baseline) {
    if (this.flight || this.pending) return false
    clearTimeout(this.timer)
    this.draft = undefined
    this.baseline = snapshot
    this.working = snapshot
    this.notePaths.clear()
    for(const node of snapshot.map.nodes)if(node.notePath)this.notePaths.set(node.id,node.notePath)
    this.pool.clear()
    this.origins.clear()
    this.touched.clear()
    this.history.clear()
    this.status = snapshot.writable === false ? 'readonly' : 'clean'
    this.message = ''
    this.emit()
    return true
  }
  private next(): Edit | undefined {
    for (const n of this.working.map.nodes) {
      const b = this.baseline.map.nodes.find(x => x.id === n.id)
      if (!b) continue
      if (n.title !== b.title || n.summary !== b.summary || (this.working.notes[n.id] ?? '') !== (this.baseline.notes[n.id] ?? '')) {
        const edit = this.details(n.id)
        edit.images = [...this.pool.values()].filter(a => edit.markdown.includes(a.id + '.image.json'))
        return edit
      }
    }
    for (const id of this.touched) {
      const v = this.working.layout?.views.find(x => x.viewId === id)
      const b = this.baseline.layout?.views.find(x => x.viewId === id) ?? this.origins.get(id)
      if (v && !equal(normalized(v), b && normalized(b))) return { kind: 'layout', viewId: id, layout: normalized(v) }
    }
  }
  private acceptReceipt(snapshot: MapSnapshot) {
    this.baseline = snapshot
    for(const node of snapshot.map.nodes)if(node.notePath)this.notePaths.set(node.id,node.notePath)
    this.working = {
      ...this.working, files: snapshot.files, fingerprint: snapshot.fingerprint,
      resources: { ...snapshot.resources, ...this.working.resources },
      map: { ...this.working.map, nodes: this.working.map.nodes.map(n => ({ ...n, notePath: snapshot.map.nodes.find(b => b.id === n.id)?.notePath })) },
    }
    this.persistedRevision = this.inFlightRevision ?? this.persistedRevision
  }
  private async resolvePending() {
    const req = this.pending
    if (!req) return
    if (!this.host.editStatus) throw new Error('无法查询上次保存回执；保留草稿')
    const result = await this.host.editStatus({ op: 'editStatus', mapId: req.mapId, expectedWorkspaceKey: req.expectedWorkspaceKey, operationId: req.operationId, requestDigest: await digest(canonicalJson(req)) }, new AbortController().signal)
    if (result.state === 'committed') this.acceptReceipt(result.snapshot)
    else if (result.snapshot.fingerprint !== req.expectedFingerprint) throw Object.assign(new Error('上次操作未提交，磁盘已有外部版本'), { code: 'version_conflict' })
    this.pending = undefined
  }
  async save(retry = false): Promise<void> {
    if (this.flight) return this.flight
    if (this.disposed || !this.finishInput() || paused(this.status) || this.status === 'failed' && !retry) return
    // 先保存 Promise，再执行；无写入的同步分支也能正确解除 in-flight。
    this.flight = Promise.resolve().then(async () => {
      try {
        await this.resolvePending()
        while (true) {
          const edit = this.next()
          if (!edit) {
            this.status = this.draft ? 'dirty' : 'clean'
            this.message = ''
            if (!this.draft) this.working = this.baseline
            break
          }
          this.status = 'saving'
          this.inFlightRevision = this.localRevision
          this.emit()
          const req: EditRequest = { op: 'commitEdit', mapId: this.baseline.map.id, expectedWorkspaceKey: this.baseline.workspaceKey, expectedFingerprint: this.baseline.fingerprint, operationId: crypto.randomUUID(), edit }
          if (edit.kind === 'details') {
            const delta = manualPlotDelta(this.baseline.notes[edit.nodeId] ?? '', edit.markdown)
            if (delta?.removed.length) req.removedPlots = delta.removed.map(([id]) => id)
          }
          this.pending = req
          if (!this.host.commitEdit) throw Object.assign(new Error('当前宿主不支持编辑保存'), { code: 'verification_required' })
          const result = await this.host.commitEdit(req, new AbortController().signal)
          this.pending = undefined
          this.acceptReceipt(result.snapshot)
        }
      } catch (e) {
        let code = (e as { code?: string }).code
        if (['verification_required', 'permission_denied', 'failed_rolled_back', 'invalid_data', 'invalid_image', 'resource_too_large', 'workspace_changed', 'session_unavailable', 'map_deleted'].includes(code ?? '')) this.pending = undefined
        if (code==='failed_rolled_back') {
          try {
            const restored=await this.host.read(this.baseline.map.id,new AbortController().signal,this.baseline.workspaceKey)
            // 回退可能分配新文件版本，只有完整读集的内容完全恢复才更新基线。
            if(restored.fingerprint && restored.writable!==false && sameFileContents(this.baseline,restored)) this.acceptReceipt(restored)
            else code='version_conflict'
          } catch { /* 保留原草稿，重试仍需通过 Host 指纹检查。 */ }
        }
        this.status = ['version_conflict', 'operation_conflict', 'workspace_changed', 'map_deleted'].includes(code ?? '') ? 'conflict' : code === 'recovery_required' ? 'recovery_required' : 'failed'
        this.message = `未保存：${e instanceof Error ? e.message : String(e)}`
      } finally {
        this.flight = undefined
        this.inFlightRevision = undefined
        this.emit()
        if (this.refreshAfterSave && !this.disposed) {
          this.refreshAfterSave = false
          try { this.accept(await this.host.read(this.baseline.map.id, new AbortController().signal, this.baseline.workspaceKey)) }
          catch { /* 保留保存结果；观察器或用户刷新继续复核。 */ }
        }
      }
    })
    return this.flight
  }
  async flush() {
    if (!this.finishInput()) return false
    await this.save(true)
    if (this.dirty && !['failed', 'conflict', 'recovery_required', 'readonly'].includes(this.status)) await this.save()
    return !this.dirty && !this.pending && !['conflict', 'recovery_required'].includes(this.status)
  }
  detach() {
    this.finishInput()
    this.history.clear()
    this.detached = true
    void this.save()
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.listeners.clear(); this.history.clear() }
}
const sessions = new Map<string, EditSession>()
export function closeEditSessions(sessionId:string) { for(const [key,s] of sessions)if(JSON.parse(key)[0]===sessionId)s.detach() }
export function disposeEditSessions() { for (const s of sessions.values()) s.dispose(); sessions.clear() }
export function editSession(sessionId: string, host: HostAdapter, snapshot: MapSnapshot) {
  const key = JSON.stringify([sessionId, snapshot.workspaceKey, snapshot.map.id])
  let s = sessions.get(key)
  if (!s) { s = new EditSession(host, snapshot); sessions.set(key, s) }
  else { s.host = host; s.attach(snapshot) }
  return s
}
