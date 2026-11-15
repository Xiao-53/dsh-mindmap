import { serializeMap } from '../map-queue.ts'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution, ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { createHostFiles, listMaps, readSnapshot, mapPath, AtlasError, errorCode } from '../map-files.ts'
import { libraryFiles } from '../library-files.ts'
import { digest } from '../../shared/fingerprint.ts'
import { fillLayout } from '../../shared/layout.ts'
import { validateMap } from '../../shared/validate-map.ts'
import { candidate } from './candidate.ts'
import { transactionPort } from './storage.ts'
import { Transactions } from '../transaction.ts'
import { createSchema, readSchema, previewSchema, applySchema } from './schemas.ts'
import type { MapFilePort } from '../map-files.ts'
import type { MapSnapshot } from '../../shared/map-types.ts'
const text = (value: unknown) => JSON.stringify(value,null,2)+'\n'
const hash = (value: unknown) => digest(new TextEncoder().encode(JSON.stringify(value)))
function parameters(schema: z.ZodType): ParameterSchemaSpec {
  function convert(s: any): any {
    if(s.anyOf) return {oneOf:s.anyOf.map(convert)}
    const out: any = {type:s.type ?? 'json'}
    if(s.enum) out.enum=s.enum
    if(s.const !== undefined) out.const=s.const
    if(s.type === 'object') { out.additionalProperties = s.additionalProperties !== false; out.properties = Object.fromEntries(Object.entries(s.properties ?? {}).map(([k,v]) => [k,{...convert(v),...(s.required?.includes(k)?{required:true}:{})}])) }
    if(s.items) out.items=convert(s.items)
    return out
  }
  return convert(z.toJSONSchema(schema)).properties
}
export function registerTools(ctx: Context) {
  const owner = randomUUID()
  const previews = new Map<string,{workspace:string;mapId:string;fingerprint:string;request:string;removals:string[];approved:boolean}>()
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
      const listing = await listMaps(port)
      const library = (await libraryFiles(ctx,scope,exec.signal).read()).data
      const deleted = [...(library.deletedMapIds ?? []), ...(library.purgedMapIds ?? [])]
      return {status:'success',maps:listing.maps.filter(m => !deleted.includes(m.id)),diagnostics:listing.diagnostics.filter(d => !(library.purgedMapIds ?? []).includes(d.path.split('/')[1]))}
    }
    const args: any = (name === 'atlas_read' ? readSchema : name === 'atlas_create' ? createSchema : name === 'atlas_preview' ? previewSchema : applySchema).parse(raw)
    const request = await hash(args)
    const mapId = name === 'atlas_create' ? 'map-'+(await hash({operationId:args.operationId})).slice(0,32) : args.mapId
    const libraryState = (await libraryFiles(ctx,scope,exec.signal).read()).data
    if(libraryState.deletedMapIds?.includes(mapId) || libraryState.purgedMapIds?.includes(mapId)) throw new AtlasError('map_deleted','导图已在回收站')
    const txPort = transactionPort(ctx,scope,mapId,policy)
    const tx = new Transactions(txPort,owner)
    if(name === 'atlas_create' || name === 'atlas_apply') { const replay = await tx.replay(args.operationId,request); if(replay !== undefined) return replay }
    if(name === 'atlas_create') {
      if(policy.mode === 'read-only') throw new AtlasError('permission_denied','当前会话为只读')
      const reservationPath = `.transactions/${args.operationId}/reservation.json`
      const reservation = await txPort.read(reservationPath)
      if(reservation && reservation.text !== request) throw new AtlasError('operation_conflict','创建请求ID已用于其他内容')
      if(!reservation) {
        if((await port.list()).includes(mapId)) throw new AtlasError('unknown_directory','不接管已有未知目录')
        await txPort.put(reservationPath,request,null)
      }
    }
    let snapshot: MapSnapshot | undefined
    if(name !== 'atlas_create') snapshot = await readSnapshot(port,mapId)
    if(name === 'atlas_read') {
      // 每页含相同的完整结构，笔记分页；过滤仍返回结构依赖，禁止静默省略。
      const selected = snapshot!.map.nodes.filter(n => (!args.nodeIds || args.nodeIds.includes(n.id)) && (!args.viewIds || snapshot!.map.views.some(v => args.viewIds.includes(v.id) && (v.centerNodeId === n.id || v.occurrences.some(o => o.nodeId === n.id)))) && (!args.query || [n.title,n.summary,snapshot!.notes[n.id]].join(' ').toLowerCase().includes(args.query.toLowerCase())))
      const selector = await hash({nodeIds:args.nodeIds,viewIds:args.viewIds,query:args.query})
      let offset=0
      if(args.cursor) { let cursor; try {cursor=JSON.parse(Buffer.from(args.cursor,'base64url').toString())} catch {throw new AtlasError('invalid_cursor','分页游标无效')}; if(cursor.version!==snapshot!.fingerprint || cursor.selector!==selector || cursor.mapId!==mapId || cursor.workspace!==scope.workspaceRoot) throw new AtlasError('cursor_expired','地图或筛选变化，请重新读取'); offset=cursor.offset; if(!Number.isSafeInteger(offset)||offset<0||offset>selected.length) throw new AtlasError('invalid_cursor','分页位置无效') }
      const page=selected.slice(offset,offset+10)
      return {status:'success',map:snapshot!.map,notes:Object.fromEntries(page.map(n=>[n.id,snapshot!.notes[n.id]])),fingerprint:snapshot!.fingerprint,notesTotal:selected.length,nextCursor:offset+10<selected.length ? Buffer.from(JSON.stringify({version:snapshot!.fingerprint,selector,mapId,workspace:scope.workspaceRoot,offset:offset+10})).toString('base64url') : null}
    }
    if(snapshot && snapshot.fingerprint !== args.expectedFingerprint) throw new AtlasError('version_conflict','地图变化，请重新读取')
    let proposal
    if(name === 'atlas_create') {
      const map = {...args.content,id:mapId,schemaVersion:1}
      for(const nodeId of Object.keys(args.notes)) if(!map.nodes.some((n:any)=>n.id===nodeId)) throw new AtlasError('invalid_data',`笔记节点不存在：${nodeId}`)
      for(const n of map.nodes) if(args.notes[n.id]) n.notePath=`notes/${n.id}.md`
      const checked=validateMap(map,mapId); if(!checked.ok) throw new AtlasError('invalid_data','创建结构无效',checked.diagnostics)
      proposal={map:checked.value,notes:args.notes,affectedIds:map.nodes.map((n:any)=>n.id),removals:[] as string[]}
    } else proposal=candidate(snapshot!,args.changes)
    const files = new Map<string,string|null>()
    if(!snapshot || JSON.stringify(snapshot.map)!==JSON.stringify(proposal.map)) files.set('map.json',text(proposal.map))
    for(const n of proposal.map.nodes) if(n.notePath) files.set(n.notePath,proposal.notes[n.id] ?? '')
    for(const n of snapshot?.map.nodes ?? []) if(n.notePath && !proposal.map.nodes.some(next=>next.notePath===n.notePath)) files.set(n.notePath,null)
    const membership = (map: MapSnapshot['map']) => map.views.map(v=>({id:v.id,groups:v.groups.map(g=>g.id),occurrences:v.occurrences}))
    if(snapshot?.layout && JSON.stringify(membership(snapshot.map))!==JSON.stringify(membership(proposal.map))) files.set('layout.json',text(fillLayout(proposal.map,snapshot.layout,{})))
    const overlay: MapFilePort = {...port,
      absent: async path => { if(path===mapPath(mapId,'.transactions/active.json')) return true; const relative=path.slice(('dsh-knowledge-maps/'+mapId+'/').length); return files.has(relative) ? files.get(relative)===null : port.absent(path) },
      read: async (path,id,assetsOnly) => { const relative=path.slice(('dsh-knowledge-maps/'+mapId+'/').length); if(files.has(relative)) {const content=files.get(relative); if(content===null) throw new AtlasError('invalid_data','候选引用已删除文件'); return {bytes:new TextEncoder().encode(content!),version:'candidate',identity:path} }; return port.read(path,id,assetsOnly) },
    }
    // 候选包含笔记资源解析与布局校验，正式写入前完成。
    await readSnapshot(overlay,mapId)
    if(name === 'atlas_preview') {
      const token=randomUUID()
      previews.set(token,{workspace:scope.workspaceRoot,mapId,fingerprint:snapshot!.fingerprint,request:await hash(args.changes),removals:proposal.removals,approved:false})
      return {status:'preview',previewToken:token,affectedIds:proposal.affectedIds,removals:proposal.removals,summary:'候选已校验，尚未保存'}
    }
    if(policy.mode === 'read-only') throw new AtlasError('permission_denied','当前会话为只读')
    if(proposal.removals.length) {
      const preview=previews.get(args.previewToken)
      if(!preview || preview.workspace!==scope.workspaceRoot || preview.mapId!==mapId || preview.fingerprint!==snapshot!.fingerprint || preview.request!==await hash(args.changes)) throw new AtlasError('preview_required','删除须先预览当前版本影响')
      if(!preview.approved) {
        const outcome=await ctx.approval.request({agent:exec.agent!,toolName:name,callId:exec.callId,reason:'删除影响：'+proposal.removals.join('、'),signal:exec.signal})
        if(outcome!=='allowed-once') throw new AtlasError('approval_required','删除未获宿主授权')
        preview.approved=true
      }
    }

    const mutations=[]
    for(const [path,after] of files) { const before=await txPort.read(path); if((before?.text ?? null)!==after) mutations.push({path,before,after}) }
    const result={status:'success',operationId:args.operationId,mapId,affectedIds:proposal.affectedIds,summary:name==='atlas_create'?'思维导图已创建':'变更已保存'}
    const saved=await tx.commit(args.operationId,request,mutations,result,async()=>{
      exec.signal.throwIfAborted()
      if(snapshot) { const live=await readSnapshot({...port,absent:async path=>path===mapPath(mapId,'.transactions/active.json')?true:port.absent(path)},mapId); if(live.fingerprint!==snapshot.fingerprint) throw new AtlasError('version_conflict','提交前版本变化') }
      else if(!await port.absent(mapPath(mapId,'map.json'))) throw new AtlasError('version_conflict','创建目标已存在')
    },async()=>({...result,fingerprint:(await readSnapshot({...port,absent:async path=>path===mapPath(mapId,'.transactions/active.json')?true:port.absent(path)},mapId)).fingerprint}))
    return saved
  }
  for(const [name,schema,description] of [
    ['atlas_list',z.strictObject({}),'列出当前工作区有效思维导图。'],
    ['atlas_read',readSchema,'读取完整结构及分页笔记、稳定ID和版本；沿nextCursor读取剩余笔记。'],
    ['atlas_create',createSchema,'创建通用思维导图：架构设计、知识整理等。只提供内容和Markdown，不提供路径、布局或界面代码。'],
    ['atlas_preview',previewSchema,'预览有序变更及删除影响，不保存。'],
    ['atlas_apply',applySchema,'条件提交最小变更；删除须当前版本预览与宿主授权。相同请求重试复用operationId。'],
  ] as const) ctx.tools.register(defineTool({name,description,parameters:parameters(schema),output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(args,exec) { try{
      const {scope} = await binding(exec)
      const parsed = args as any
      const id = name === 'atlas_create' ? 'map-'+(await hash({operationId:parsed.operationId})).slice(0,32) : parsed.mapId ?? ''
      return await serializeMap(`${scope.workspaceRoot}\0${id}`,()=>invoke(name,args,exec))
    }catch(e){return {status:errorCode(e),message:String(e),diagnostics:e instanceof AtlasError?e.diagnostics:[]}} }}))
}
