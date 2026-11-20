import { z } from 'zod'
import { idSchema } from '../shared/validate-map.ts'
import { layoutSchema } from '../shared/validate-layout.ts'
import { imageAssetSchema, validateImage } from '../shared/image-resource.ts'
import { digest, canonicalJson } from '../shared/fingerprint.ts'
import { manualPlotDelta } from '../shared/note-markdown.ts'
import { workspaceComparisonKey, normalizeNotePathKey } from '../shared/workspace-path.ts'
import type { MapSnapshot } from '../shared/map-types.ts'
import { candidate } from './tools/candidate.ts'
import { transactionPort } from './tools/storage.ts'
import { Transactions, type TransactionPort, type Mutation } from './transaction.ts'
import { AtlasError, createHostFiles, mapPath, readSnapshot, type MapFilePort } from './map-files.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceFileScope } from '@deepseek-ai/dsh-api-workspace-files'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'

export const editSchema = z.discriminatedUnion('kind', [
  z.strictObject({kind:z.literal('details'),nodeId:idSchema,title:z.string().trim().min(1),summary:z.string(),markdown:z.string(),images:z.array(imageAssetSchema)}),
  z.strictObject({kind:z.literal('layout'),viewId:idSchema,layout:layoutSchema.shape.views.element}),
])
export type Edit = z.infer<typeof editSchema>
export const commitEditSchema = z.strictObject({op:z.literal('commitEdit'),mapId:idSchema,expectedWorkspaceKey:z.string().min(1),expectedFingerprint:z.string().min(1),operationId:idSchema,removedPlots:z.array(idSchema).max(256).optional(),omitResources:z.boolean().optional(),edit:editSchema})
export type EditRequest = z.infer<typeof commitEditSchema>
export const editStatusSchema = z.strictObject({op:z.literal('editStatus'),mapId:idSchema,expectedWorkspaceKey:z.string().min(1),operationId:idSchema,requestDigest:z.string().regex(/^[a-f0-9]{64}$/),omitResources:z.boolean().optional()})
export type EditStatusRequest = z.infer<typeof editStatusSchema>
export type EditStatusResult = {state:'committed'|'absent';snapshot:MapSnapshot;committedFingerprint?:string}
// 仅本宿主会话中保留从完整快照读出的原路径，UI 不接收任意写入路径。
type PlotChanges = { operationId: string; request: string; removed: [string, string][]; restored: string[] }
type EditMemory = { fingerprint: string; paths: Map<string, string>; plots: Map<string, string>; pending?: PlotChanges }
const MAX_NOTE_PATHS = 128
const notePaths = new Map<string, EditMemory>()

function touchEditMemory(key: string, memory: EditMemory) {
  notePaths.delete(key)
  notePaths.set(key, memory)
  while (notePaths.size > MAX_NOTE_PATHS) notePaths.delete(notePaths.keys().next().value!)
}

export function evictEditMemory(workspaceRoot: string, mapId: string) {
  const targetWs = workspaceComparisonKey(workspaceRoot)
  for (const key of [...notePaths.keys()]) {
    try {
      const [wsKey, id] = JSON.parse(key) as [string, string]
      if (wsKey === targetWs && id === mapId) notePaths.delete(key)
    } catch { /* ignore malformed key */ }
  }
}

function acceptEditMemory(memory: EditMemory | undefined, operationId: string, request: string, fingerprint: string) {
  const pending = memory?.pending
  if (!memory || !pending || pending.operationId !== operationId || pending.request !== request) return
  for (const key of pending.restored) memory.plots.delete(key)
  for (const [key, hash] of pending.removed) {
    memory.plots.delete(key)
    memory.plots.set(key, hash)
  }
  while (memory.plots.size > 256) memory.plots.delete(memory.plots.keys().next().value!)
  memory.pending = undefined
  memory.fingerprint = fingerprint
}
const noteKey=(scope:WorkspaceFileScope,mapId:string)=>JSON.stringify([workspaceComparisonKey(scope.workspaceRoot),mapId,scope.sessionId])
export async function editStatus(ctx:Context,scope:WorkspaceFileScope,req:EditStatusRequest,signal:AbortSignal):Promise<EditStatusResult> {
  const port=createHostFiles(ctx,scope,signal)
  const readOnly:TransactionPort={
    read:async path=>{const full=mapPath(req.mapId,path);if(await port.absent(full))return null;const record=await port.read(full,req.mapId);return {text:new TextDecoder('utf-8',{fatal:true}).decode(record.bytes),version:record.version}},
    put:async()=>{throw new AtlasError('permission_denied','回执查询不写入')},
    remove:async()=>{throw new AtlasError('permission_denied','回执查询不删除')},
  }
  const receipt=await new Transactions(readOnly,crypto.randomUUID()).replay(req.operationId,req.requestDigest) as {committedFingerprint?:string}|undefined
  const snapshot=await readSnapshot(port,req.mapId,false,{omitResources:req.omitResources})
  if(receipt && snapshot.fingerprint!==receipt.committedFingerprint)throw new AtlasError('version_conflict','该操作已提交，但磁盘已有后续版本；本地副本保留')
  const memory=notePaths.get(noteKey(scope,req.mapId))
  if (memory) touchEditMemory(noteKey(scope, req.mapId), memory)
  if (receipt) acceptEditMemory(memory, req.operationId, req.requestDigest, snapshot.fingerprint)
  return {state:receipt?'committed':'absent',snapshot,committedFingerprint:receipt?.committedFingerprint}
}
export function overlayFiles(port: MapFilePort, mapId: string, files: Map<string,string|null>): MapFilePort {
  const relative=(path:string)=>path.slice(mapPath(mapId,'map.json').length-'map.json'.length)
  return {...port, verify: undefined, absent:async path=>path===mapPath(mapId,'.transactions/active.json') ? true : files.has(relative(path)) ? files.get(relative(path))===null : port.absent(path),
    read:async(path,id,assetsOnly)=>{
      const key=relative(path)
      if (!files.has(key)) return port.read(path,id,assetsOnly)
      const text=files.get(key)
      if(text===null) throw new AtlasError('invalid_data','候选引用已删除文件')
      return {bytes:new TextEncoder().encode(text!),version:'candidate',identity:path}
    },
  }
}
export async function fileMutations(port: TransactionPort, files: Map<string,string|null>): Promise<Mutation[]> {
  const result:Mutation[]=[]
  for(const [path,after] of files) {const before=await port.read(path);if((before?.text??null)!==after)result.push({path,before,after})}
  return result
}
export async function commitEdit(ctx:Context,scope:WorkspaceFileScope,req:EditRequest,policy:SandboxExecutionPolicy,signal:AbortSignal) {
  if(new TextEncoder().encode(JSON.stringify(req)).length>24*1024*1024)throw new AtlasError('resource_too_large','请求超过 24 MiB')
  const { omitResources, ...canonicalReq } = req
  const port=createHostFiles(ctx,scope,signal,policy), txPort=transactionPort(ctx,scope,req.mapId,policy)
  const tx=new Transactions(txPort,crypto.randomUUID()), request=await digest(canonicalJson(canonicalReq))
  const replay=await tx.replay(req.operationId,request) as {committedFingerprint:string}|undefined
  if(replay) {
    const snapshot=await readSnapshot(port,req.mapId,false,{omitResources})
    if(snapshot.fingerprint!==replay.committedFingerprint)throw new AtlasError('version_conflict','该操作已保存，但随后出现外部修改，请重新读取')
    acceptEditMemory(notePaths.get(noteKey(scope, req.mapId)), req.operationId, request, snapshot.fingerprint)
    return {...replay,snapshot}
  }
  const snapshot=await readSnapshot(port,req.mapId,false,{omitResources:true})
  if(snapshot.fingerprint!==req.expectedFingerprint)throw new AtlasError('version_conflict','地图已变化，保留本地修改')
  const memoryKey=noteKey(scope,req.mapId)
  let memory=notePaths.get(memoryKey)
  if(!memory || memory.fingerprint!==snapshot.fingerprint){memory={fingerprint:snapshot.fingerprint,paths:new Map(),plots:new Map()}}
  touchEditMemory(memoryKey, memory)
  for(const n of snapshot.map.nodes)if(n.notePath)memory.paths.set(n.id,n.notePath)
  const plotChanges: PlotChanges = { operationId: req.operationId, request, removed: [], restored: [] }
  const files=new Map<string,string|null>(), json=(v:unknown)=>JSON.stringify(v,null,2)+'\n'
  if(req.edit.kind==='details') {
    const e=req.edit, node=snapshot.map.nodes.find(n=>n.id===e.nodeId)
    if(!node) throw new AtlasError('invalid_data','节点不存在')
    const delta = manualPlotDelta(snapshot.notes[e.nodeId] ?? '', e.markdown)
    const removals = new Set(req.removedPlots ?? [])
    if (!delta || removals.size !== delta.removed.length || delta.removed.some(([id]) => !removals.has(id)))
      throw new AtlasError('invalid_data', '手动编辑只能移动或显式删除已存在的图表')
    const key = (id: string) => JSON.stringify([e.nodeId, id])
    for (const [id, raw] of delta.restored) {
      if (memory.plots.get(key(id)) !== await digest(raw))
        throw new AtlasError('invalid_data', '只能撤销当前会话已保存的整图删除')
      plotChanges.restored.push(key(id))
    }
    for (const [id, raw] of delta.removed) plotChanges.removed.push([key(id), await digest(raw)])
    const proposal=candidate(snapshot,[{op:'update_node',nodeId:e.nodeId,fields:{title:e.title,summary:e.summary}},e.markdown?{op:'set_note',nodeId:e.nodeId,markdown:e.markdown}:{op:'remove_note',nodeId:e.nodeId}])
    const note=proposal.map.nodes.find(n=>n.id===e.nodeId)!
    if(e.markdown && !node.notePath && memory.paths.has(e.nodeId))note.notePath=memory.paths.get(e.nodeId)
    if(note.notePath && snapshot.map.nodes.some(n=>n.id!==e.nodeId && n.notePath && normalizeNotePathKey(n.notePath)===normalizeNotePathKey(note.notePath!)))throw new AtlasError('invalid_data','原笔记路径已被其他节点占用')
    if(JSON.stringify(proposal.map)!==JSON.stringify(snapshot.map))files.set('map.json',json(proposal.map))
    if(note.notePath) {
      // 恢复旧路径或首次创建时不接管磁盘上的未知文件。
      if(!node.notePath && await txPort.read(note.notePath))throw new AtlasError('version_conflict','笔记目标已有文件，保留本地内容')
      files.set(note.notePath,e.markdown)
    } else if(node.notePath) files.set(node.notePath,null)
    let total=0
    const seen=new Set<string>()
    for(const raw of e.images) {
      const asset=await validateImage(raw)
      if(seen.has(asset.id))throw new AtlasError('invalid_data','重复图片 ID')
      seen.add(asset.id)
      const path=`assets/${asset.id}.image.json`
      if(!e.markdown.includes(asset.id+'.image.json'))throw new AtlasError('invalid_data','不保存正文未使用的新增图片')
      const existing=await txPort.read(path), content=json(asset)
      if(existing) {const prior=await validateImage(JSON.parse(existing.text));if(JSON.stringify(prior)!==JSON.stringify(asset))throw new AtlasError('operation_conflict','图片 ID 已被其他内容占用')}
      if(!existing) {
        total+=asset.byteLength
        if(total>16*1024*1024)throw new AtlasError('resource_too_large','单次新增图片超过 16 MiB')
        files.set(path,content)
      }
    }
  } else {
    if (req.removedPlots?.length) throw new AtlasError('invalid_data', '布局请求不能包含图表删除')
    const e=req.edit,view=snapshot.map.views.find(v=>v.id===e.viewId)
    if(!view || e.layout.viewId!==e.viewId || e.layout.nodes.some(n=>!view.occurrences.some(o=>o.nodeId===n.nodeId)) || e.layout.groups.some(g=>!view.groups.some(x=>x.id===g.groupId)))throw new AtlasError('invalid_data','布局目标越界')
    if(!e.layout.mode || e.layout.nodes.length!==view.occurrences.length || e.layout.groups.length!==view.groups.length)throw new AtlasError('invalid_data','布局必须包含完整目标视图')
    const others=(snapshot.layout?.views??[]).filter(v=>v.viewId!==e.viewId).map(v=>({...v,mode:v.mode??'vertical'}))
    files.set('layout.json',json({schemaVersion:2,mapId:snapshot.map.id,views:[...others,e.layout]}))
  }
  const proposal=await readSnapshot(overlayFiles(port,req.mapId,files),req.mapId,false,{omitResources:true})
  for(const relative of files.keys()) {
    if(relative.endsWith('.image.json')&&!proposal.files.some(f=>f.path===mapPath(req.mapId,relative)))
      throw new AtlasError('invalid_data','新增图片未被正文引用')
  }
  // 先创建资源，再发布引用这份资源的正文。
  const ordered=new Map([...files].sort(([a],[b])=>Number(b.endsWith('.image.json'))-Number(a.endsWith('.image.json'))))
  const mutations=await fileMutations(txPort,ordered)
  for(const change of mutations)if(change.before && !snapshot.files.some(f=>f.path===mapPath(req.mapId,change.path)))throw new AtlasError('version_conflict','新文件目标已被外部占用')
  if(!mutations.length) {
    const cleanSnapshot = omitResources ? snapshot : await readSnapshot(port,req.mapId)
    return {operationId:req.operationId,committedFingerprint:cleanSnapshot.fingerprint,snapshot:cleanSnapshot,noChange:true}
  }
  const livePort=overlayFiles(port,req.mapId,new Map())
  memory.pending = plotChanges
  const result=await tx.commit(req.operationId,request,mutations,{operationId:req.operationId,noChange:false},async()=>{
    signal.throwIfAborted()
    if((await readSnapshot(livePort,req.mapId,false,{omitResources:true})).fingerprint!==req.expectedFingerprint)throw new AtlasError('version_conflict','提交前地图变化')
  },async()=>{
    signal.throwIfAborted()
    const after=await readSnapshot(livePort,req.mapId,false,{omitResources:true})
    const changes=new Set(mutations.map(change=>mapPath(req.mapId,change.path)))
    if(after.files.length!==proposal.files.length || proposal.files.some(expected=>{
      const actual=after.files.find(f=>f.path===expected.path)
      return !actual || actual.digest!==expected.digest || (!changes.has(expected.path) && actual.version!==expected.version && expected.version!=='candidate')
    }))throw new AtlasError('version_conflict','候选以外文件在保存期间变化')
    return {operationId:req.operationId,noChange:false,committedFingerprint:after.fingerprint}
  }) as {committedFingerprint:string}
  acceptEditMemory(memory, req.operationId, request, result.committedFingerprint)
  const saved=await readSnapshot(port,req.mapId,false,{omitResources})
  if(saved.fingerprint!==result.committedFingerprint)throw new AtlasError('version_conflict','保存后出现外部修改')
  return {...result,snapshot:saved}
}
