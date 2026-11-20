import { insertAnchoredNote } from '../../shared/note-position.ts'
import { overlayFiles, fileMutations } from '../edit-service.ts'
import { serializeMap } from '../map-queue.ts'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution, ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { createHostFiles, inspectCreatePlaceholder, listMaps, readSnapshot, mapPath, AtlasError, errorCode } from '../map-files.ts'
import { libraryFiles } from '../library-files.ts'
import { digest } from '../../shared/fingerprint.ts'
import { fillLayout } from '../../shared/layout.ts'
import { validateMap } from '../../shared/validate-map.ts'
import { workspaceComparisonKey, sameWorkspaceKey, normalizeNotePathKey } from '../../shared/workspace-path.ts'
import type { Diagnostic, MapSnapshot } from '../../shared/map-types.ts'
import { candidate, validateCandidatePlots } from './candidate.ts'
import { transactionPort, releaseFailedCreate } from './storage.ts'
import { Transactions } from '../transaction.ts'
import { cleanupCreate } from '../cleanup-create.ts'
import { createSchema, readSchema, previewSchema, applySchema, cleanupCreateSchema } from './schemas.ts'
import type { MapFilePort } from '../map-files.ts'

export class AtlasToolError extends Error {
  status: string
  code: string
  diagnostics: Diagnostic[]
  constructor(status: string, message: string, diagnostics: Diagnostic[] = []) {
    super(JSON.stringify({ status, message, diagnostics }))
    this.name = 'AtlasToolError'
    this.status = status
    this.code = status
    this.diagnostics = diagnostics
  }
}

const text = (value: unknown) => JSON.stringify(value,null,2)+'\n'
const hash = (value: unknown) => digest(new TextEncoder().encode(JSON.stringify(value)))
function parameters(schema: z.ZodType): ParameterSchemaSpec {
  const root = z.toJSONSchema(schema) as Record<string, any>
  const defs: Record<string, any> = root.$defs ?? root.definitions ?? {}
  function convert(s: any, seen = new Set<string>()): any {
    if (!s || typeof s !== 'object') return { type: 'json' }
    if (typeof s.$ref === 'string') {
      if (seen.has(s.$ref)) return { type: 'json' }
      const refName = s.$ref.replace(/^#\/(?:\$defs|definitions)\//, '')
      if (defs[refName]) {
        const resolved = convert(defs[refName], new Set([...seen, s.$ref]))
        return typeof s.description === 'string' && !resolved.description
          ? { ...resolved, description: s.description }
          : resolved
      }
      return { type: 'json' }
    }
    if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf)) {
      const list = (s.anyOf ?? s.oneOf).map((item: any) => convert(item, seen))
      if (list.length === 1) return list[0]
      if (list.length >= 2) {
        return {
          ...(typeof s.description === 'string' ? { description: s.description } : {}),
          oneOf: list,
        }
      }
      return { type: 'json' }
    }
    if (Array.isArray(s.type)) {
      if (s.type.length === 1) return convert({ ...s, type: s.type[0] }, seen)
      if (s.type.length >= 2) {
        return {
          ...(typeof s.description === 'string' ? { description: s.description } : {}),
          oneOf: s.type.map((t: string) => convert({ ...s, type: t }, seen)),
        }
      }
      return { type: 'json' }
    }
    const out: any = { type: typeof s.type === 'string' ? s.type : 'json' }
    if (typeof s.description === 'string') out.description = s.description
    if (s.enum) out.enum = s.enum
    if (s.const !== undefined) out.const = s.const
    if (out.type === 'object') {
      out.additionalProperties = Boolean(s.additionalProperties)
      const required = Array.isArray(s.required) ? s.required : []
      out.properties = Object.fromEntries(
        Object.entries(s.properties ?? {}).map(([k, v]) => [
          k,
          { ...convert(v, seen), ...(required.includes(k) ? { required: true } : {}) },
        ]),
      )
    }
    if (out.type === 'array' && s.items && !Array.isArray(s.items)) out.items = convert(s.items, seen)
    return out
  }
  return convert(root).properties ?? {}
}
const PREVIEW_TTL_MS = 15 * 60 * 1000
const MAX_PREVIEWS = 128

export function registerTools(ctx: Context) {
  const owner = randomUUID()
  const previews = new Map<string,{workspace:string;mapId:string;fingerprint:string;request:string;removals:string[];approved:boolean;createdAt:number}>()
  const prunePreviews = () => {
    const now = Date.now()
    for (const [k, v] of previews) if (now - v.createdAt > PREVIEW_TTL_MS) previews.delete(k)
    while (previews.size >= MAX_PREVIEWS) previews.delete(previews.keys().next().value!)
  }
  async function binding(exec: ToolExecution) {
    if(!exec.agent) throw new AtlasError('session_unavailable','地图工具需要来源会话')
    const policy = ctx.sandboxPolicy.resolve({session:exec.agent.session})
    const workspaceRoot = policy.workspaceRoot
    const scope = {sessionId:exec.agent.id,workspaceRoot}
    return {scope,policy,port:createHostFiles(ctx,scope,exec.signal,policy)}
  }
  async function invoke(name: string, raw: unknown, exec: ToolExecution): Promise<any> {
    const {scope,policy,port} = await binding(exec)
    if(name === 'atlas_list') {
      z.strictObject({}).parse(raw)
      const library = (await libraryFiles(ctx,scope,exec.signal).read()).data
      const retired = new Set([...(library.purgedMapIds ?? []), ...(library.retiredCreateIds ?? [])])
      const listing = await listMaps(port, retired)
      const deleted = [...(library.deletedMapIds ?? []), ...(library.purgedMapIds ?? [])]
      return {status:'success',maps:listing.maps.filter(m => !deleted.includes(m.id)),diagnostics:listing.diagnostics.filter(d => !retired.has(d.path.split('/')[1])),incompleteCreates:listing.incompleteCreates}
    }
    if(name === 'atlas_cleanup_create') {
      const args = cleanupCreateSchema.parse(raw)
      if(policy.mode === 'read-only') throw new AtlasError('permission_denied','只读会话不能清理创建记录')
      const outcome = await ctx.approval.request({agent:exec.agent!,toolName:name,callId:exec.callId,reason:`清理未完成创建 ${args.mapId}，作废原请求 ${args.operationId}；不会删除完整地图。`,signal:exec.signal})
      if(outcome !== 'allowed-once') throw new AtlasError('approval_required','清理未获宿主授权')
      return cleanupCreate(ctx,scope,args.mapId,args.operationId,policy,exec.signal)
    }
    const args: any = (name === 'atlas_read' ? readSchema : name === 'atlas_create' ? createSchema : name === 'atlas_preview' ? previewSchema : applySchema).parse(raw)
    const request = await hash(args)
    const mapId = name === 'atlas_create' ? 'map-'+(await hash({operationId:args.operationId})).slice(0,32) : args.mapId
    const libraryState = (await libraryFiles(ctx,scope,exec.signal).read()).data
    if(libraryState.deletedMapIds?.includes(mapId) || libraryState.purgedMapIds?.includes(mapId)) throw new AtlasError('map_deleted','导图已在回收站')
    if(name === 'atlas_create' && libraryState.retiredCreateIds?.includes(mapId)) throw new AtlasError('create_discarded','此创建请求已被清理并作废；如需重新创建，请使用新的operationId')
    const txPort = transactionPort(ctx,scope,mapId,policy)
    const tx = new Transactions(txPort,owner)
    if(await txPort.read('.transactions/discarded-create.json')) throw new AtlasError('create_discarded','此创建请求已被清理并作废；如需重新创建，请使用新的operationId')
    if(name === 'atlas_create' || name === 'atlas_apply') { const replay = await tx.replay(args.operationId,request); if(replay !== undefined) return replay }
    if(name === 'atlas_create') {
      if(policy.mode === 'read-only') throw new AtlasError('permission_denied','当前会话为只读')
      const reservationPath = `.transactions/${args.operationId}/reservation.json`
      const reservation = await txPort.read(reservationPath)
      if(reservation && reservation.text !== request) throw new AtlasError('operation_conflict','创建请求ID已用于其他内容')
      const failed = await txPort.read(`.transactions/${args.operationId}/failed.json`)
      if(failed) {
        const record = JSON.parse(failed.text)
        if(!record || record.kind !== 'failed_create' || record.operationId !== args.operationId || record.request !== request) throw new AtlasError('operation_conflict','失败创建请求ID已用于其他内容或记录无效')
      }
    }
    let snapshot: MapSnapshot | undefined
    if(name !== 'atlas_create') snapshot = await readSnapshot(port,mapId)
    if(name === 'atlas_read') {
      // 每页含相同的完整结构，笔记分页；过滤仍返回结构依赖，禁止静默省略。
      const selected = snapshot!.map.nodes.filter(n => (!args.nodeIds || args.nodeIds.includes(n.id)) && (!args.viewIds || snapshot!.map.views.some(v => args.viewIds.includes(v.id) && (v.centerNodeId === n.id || v.occurrences.some(o => o.nodeId === n.id)))) && (!args.query || [n.title,n.summary,snapshot!.notes[n.id]].join(' ').toLowerCase().includes(args.query.toLowerCase())))
      const selector = await hash({nodeIds:args.nodeIds,viewIds:args.viewIds,query:args.query})
      let offset=0
      if(args.cursor) { let cursor; try {cursor=JSON.parse(Buffer.from(args.cursor,'base64url').toString())} catch {throw new AtlasError('invalid_cursor','分页游标无效')}; if(cursor.version!==snapshot!.fingerprint || cursor.selector!==selector || cursor.mapId!==mapId || !sameWorkspaceKey(cursor.workspace,scope.workspaceRoot)) throw new AtlasError('cursor_expired','地图或筛选变化，请重新读取'); offset=cursor.offset; if(!Number.isSafeInteger(offset)||offset<0||offset>selected.length) throw new AtlasError('invalid_cursor','分页位置无效') }
      const page=selected.slice(offset,offset+10)
      return {status:'success',map:snapshot!.map,notes:Object.fromEntries(page.map(n=>[n.id,snapshot!.notes[n.id]])),fingerprint:snapshot!.fingerprint,notesTotal:selected.length,nextCursor:offset+10<selected.length ? Buffer.from(JSON.stringify({version:snapshot!.fingerprint,selector,mapId,workspace:scope.workspaceRoot,offset:offset+10})).toString('base64url') : null}
    }
    if(snapshot && snapshot.fingerprint !== args.expectedFingerprint) throw new AtlasError('version_conflict','地图变化，请重新读取')
    let proposal
    let newAnchoredPath: string | undefined
    if(name === 'atlas_create') {
      const map = {...args.content,id:mapId,schemaVersion:1}
      for(const nodeId of Object.keys(args.notes)) if(!map.nodes.some((n:any)=>n.id===nodeId)) throw new AtlasError('invalid_data',`笔记节点不存在：${nodeId}`)
      for(const n of map.nodes) if(args.notes[n.id]) n.notePath=`notes/${n.id}.md`
      const checked=validateMap(map,mapId); if(!checked.ok) throw new AtlasError('invalid_data','创建结构无效',checked.diagnostics)
      proposal={map:checked.value,notes:args.notes,affectedIds:map.nodes.map((n:any)=>n.id),removals:[] as string[]}
    } else {
      const change = args.changes[0]
      if (change.op === 'insert_note_content') {
        const node = snapshot!.map.nodes.find(item => item.id === change.nodeId)
        if (!node || change.anchor.mapId !== mapId || change.anchor.nodeId !== node.id)
          throw new AtlasError('invalid_data', '正文位置引用与目标地图或节点不一致')
        let markdown: string
        try { markdown = await insertAnchoredNote(snapshot!.notes[node.id] ?? '', change.anchor, change.kind, change.markdown) }
        catch (error) { throw new AtlasError('invalid_data', (error as Error).message) }
        proposal = candidate(snapshot!, [{ op: 'set_note', nodeId: node.id, markdown }])
        if (!node.notePath) {
          newAnchoredPath = proposal.map.nodes.find(item => item.id === node.id)?.notePath
          if (newAnchoredPath && await txPort.read(newAnchoredPath))
            throw new AtlasError('version_conflict', '笔记目标已被占用，原文件已保留')
        }
      } else proposal = candidate(snapshot!, args.changes)
    }
    proposal.removals.push(...validateCandidatePlots(snapshot?.notes ?? {}, proposal.notes, proposal.map))
    const files = new Map<string,string|null>()
    if(!snapshot || JSON.stringify(snapshot.map)!==JSON.stringify(proposal.map)) files.set('map.json',text(proposal.map))
    for(const n of proposal.map.nodes) if(n.notePath) files.set(n.notePath,proposal.notes[n.id] ?? '')
    for(const n of snapshot?.map.nodes ?? []) if(n.notePath && !proposal.map.nodes.some(next=>next.notePath && normalizeNotePathKey(next.notePath)===normalizeNotePathKey(n.notePath!))) files.set(n.notePath,null)
    const membership = (map: MapSnapshot['map']) => map.views.map(v=>({id:v.id,groups:v.groups.map(g=>g.id),occurrences:v.occurrences}))
    if(snapshot?.layout && JSON.stringify(membership(snapshot.map))!==JSON.stringify(membership(proposal.map))) files.set('layout.json',text(fillLayout(proposal.map,snapshot.layout,{})))
    const overlay = overlayFiles(port,mapId,files)
    // 候选包含笔记资源解析与布局校验，正式写入前完成。
    await readSnapshot(overlay,mapId)
    if(name === 'atlas_preview') {
      prunePreviews()
      const token=randomUUID()
      previews.set(token,{workspace:scope.workspaceRoot,mapId,fingerprint:snapshot!.fingerprint,request:await hash(args.changes),removals:proposal.removals,approved:false,createdAt:Date.now()})
      return {status:'preview',previewToken:token,affectedIds:proposal.affectedIds,removals:proposal.removals,summary:'候选已校验，尚未保存'}
    }
    if(policy.mode === 'read-only') throw new AtlasError('permission_denied','当前会话为只读')
    if(proposal.removals.length) {
      const preview=previews.get(args.previewToken)
      if(!preview || Date.now()-preview.createdAt > PREVIEW_TTL_MS || !sameWorkspaceKey(preview.workspace,scope.workspaceRoot) || preview.mapId!==mapId || preview.fingerprint!==snapshot!.fingerprint || preview.request!==await hash(args.changes)) throw new AtlasError('preview_required','删除须先预览当前版本影响')
      if(!preview.approved) {
        const outcome=await ctx.approval.request({agent:exec.agent!,toolName:name,callId:exec.callId,reason:'删除影响：'+proposal.removals.join('、'),signal:exec.signal})
        if(outcome!=='allowed-once') throw new AtlasError('approval_required','删除未获宿主授权')
        preview.approved=true
      }
    }

    // 完整候选（含正文资源）校验通过后才占目录；无效参数不产生新目录。
    let reservationReady = false
    try {
    if(name === 'atlas_create') {
      exec.signal.throwIfAborted()
      if(await txPort.read('.transactions/discarded-create.json')) throw new AtlasError('create_discarded','创建请求已被清理并作废，停止占位')
      const path = `.transactions/${args.operationId}/reservation.json`
      const reservation = await txPort.read(path)
      if(reservation && reservation.text !== request) throw new AtlasError('operation_conflict','创建请求ID已用于其他内容')
      if((await port.list()).includes(mapId)) {
        const placeholder = await inspectCreatePlaceholder(port, mapId)
        if(!placeholder || placeholder.state === 'discarded' || placeholder.state === 'cleanup_pending' || placeholder.operationId !== args.operationId || placeholder.request !== request) throw new AtlasError('unknown_directory','不接管已有未知目录、已清理或非空创建目录')
      }
      reservationReady = true
      if(!reservation) await txPort.put(path,request,null)
    }
    const mutations=await fileMutations(txPort,files)
    if (newAnchoredPath && !mutations.some(item => item.path === newAnchoredPath && item.before === null))
      throw new AtlasError('version_conflict', '笔记目标已被占用，原文件已保留')
    const result={status:'success',operationId:args.operationId,mapId,affectedIds:proposal.affectedIds,summary:name==='atlas_create'?'思维导图已创建':'变更已保存'}
    const saved=await tx.commit(args.operationId,request,mutations,result,async()=>{
      exec.signal.throwIfAborted()
      if(await txPort.read('.transactions/discarded-create.json')) throw new AtlasError('create_discarded','创建请求已被清理并作废，停止提交')
      if(snapshot) { const live=await readSnapshot({...port,absent:async path=>path===mapPath(mapId,'.transactions/active.json')?true:port.absent(path)},mapId); if(live.fingerprint!==snapshot.fingerprint) throw new AtlasError('version_conflict','提交前版本变化') }
      else if(!await port.absent(mapPath(mapId,'map.json'))) throw new AtlasError('version_conflict','创建目标已存在')
    },async()=>({...result,fingerprint:(await readSnapshot({...port,absent:async path=>path===mapPath(mapId,'.transactions/active.json')?true:port.absent(path)},mapId)).fingerprint}))
    if(name === 'atlas_apply' && args.previewToken) previews.delete(args.previewToken)
    return saved
    } catch(e) {
      if(reservationReady && errorCode(e) !== 'recovery_required') {
        try {
          if(!await releaseFailedCreate(ctx,scope,mapId,args.operationId,request,policy,errorCode(e))) {
            throw new Error('发现未知内容或活动状态，保留创建资料')
          }
        } catch(cleanup) {
          throw new AtlasError(errorCode(e),String(e),[
            ...(e instanceof AtlasError ? e.diagnostics : []),
            {path:mapPath(mapId,'.'),code:'cleanup_incomplete',message:`创建清理未完成，原资料保留：${String(cleanup)}`},
          ])
        }
      }
      throw e
    }
  }
  for(const [name,schema,description] of [
    ['atlas_list',z.strictObject({}),'列出当前工作区有效思维导图。'],
    ['atlas_read',readSchema,'读取完整结构及分页笔记、稳定ID和版本；沿nextCursor读取剩余笔记。'],
    ['atlas_create',createSchema,'创建通用思维导图：架构设计、知识整理等。只提供内容和Markdown，不提供路径、布局或界面代码。'],
    ['atlas_preview',previewSchema,'预览有序变更及删除影响，不保存。'],
    ['atlas_apply',applySchema,'条件提交最小变更；正文位置引用使用单项 insert_note_content。删除须当前版本预览与宿主授权。相同请求重试复用operationId。'],
    ['atlas_cleanup_create',cleanupCreateSchema,'用户要求清理时，清理atlas_list.incompleteCreates中的指定记录并作废原创建请求；须宿主授权。拒绝完整地图、未知内容与活动事务，不接受任意路径。'],
  ] as const) ctx.tools.register(defineTool({name,description,parameters:parameters(schema),output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(args,exec) { try{
      const {scope} = await binding(exec)
      const parsed = args as any
      const id = name === 'atlas_create' ? 'map-'+(await hash({operationId:parsed.operationId})).slice(0,32) : parsed.mapId ?? ''
      return await serializeMap(`${workspaceComparisonKey(scope.workspaceRoot)}\0${id}`,()=>invoke(name,args,exec))
    }catch(e){throw new AtlasToolError(errorCode(e), e instanceof Error ? e.message : String(e), e instanceof AtlasError ? e.diagnostics : [])} }}))
}
