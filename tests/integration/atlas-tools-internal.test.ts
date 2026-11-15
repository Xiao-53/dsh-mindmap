import {posix} from 'node:path'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {registerTools} from '../../src/server/tools/index.ts'
function harness() {
 const files=new Map<string,{text:string;version:string}>();let revision=0
 const tools=new Map<string,any>();let failPath='';let approve='allowed-once';let approvals=0
 const missing=()=>Object.assign(new Error('not found'),{code:'FS_NOT_FOUND'})
 const ctx:any={tools:{register:(d:any)=>tools.set(d.name,d)},sandboxPolicy:{resolve:({session}:any)=>({mode:session.mode??'workspace-write',workspaceRoot:session.header.cwd})},approval:{request:async()=>{approvals++;return approve}},
 fs:{resolve:async(path:string,options:any)=>({targetKey:posix.normalize(path.startsWith('/')?path:options.cwd+'/'+path)}),contains:(a:any,b:any)=>b.targetKey.startsWith(a.targetKey+'/'),lstat:async(path:string,o:any)=>files.has(o.cwd+'/'+path)?{type:'file'}:undefined,
 stat:async(t:any)=>files.has(t.targetKey)?{type:'file',version:files.get(t.targetKey)!.version}:undefined,
 readText:async(t:any)=>{if(!files.has(t.targetKey))throw missing();return files.get(t.targetKey)!.text},
 writeText:async(t:any,text:string,intent:any)=>{if(t.targetKey.endsWith(failPath)&&failPath){failPath='';throw new Error('模拟正式笔记写入失败')};const old=files.get(t.targetKey);if(intent.kind==='createIfAbsent'?!!old:old?.version!==intent.version)throw new Error('guard conflict');files.set(t.targetKey,{text,version:String(++revision)})},
 deleteFile:async(t:any,g:any)=>{assert.equal(files.get(t.targetKey)?.version,g.version);files.delete(t.targetKey)}},
 workspaceFiles:{stat:async(s:any,p:string)=>{const f=files.get(s.workspaceRoot+'/'+p);if(!f)throw missing();return {version:f.version}},
 readBytes:async(s:any,p:string,o:any)=>{const f=files.get(s.workspaceRoot+'/'+p);if(!f)throw missing();const all=new TextEncoder().encode(f.text);return {data:all.slice(o.range.offset,o.range.offset+o.range.length),version:f.version,eof:o.range.offset+o.range.length>=all.length}},
 list:async(s:any)=>({entries:[...new Set([...files.keys()].filter(k=>k.startsWith(s.workspaceRoot+'/dsh-knowledge-maps/')).map(k=>k.split('/')[3]))].map(name=>({name,type:'directory'})),truncated:false})}}
 registerTools(ctx)
 const call=async(name:string,args:any,workspace='/one',mode='workspace-write')=>tools.get(name).execute(args,{agent:{id:'session-'+workspace,session:{header:{cwd:workspace},mode}},signal:new AbortController().signal,callId:'call'})
 return {files,tools,call,fail:(path:string)=>{failPath=path},deny:()=>{approve='rejected'},approvals:()=>approvals}
}
const content={title:'系统架构',rootViewId:'root',nodes:[{id:'api',title:'接口',summary:'请求入口',category:'blue',icon:'layers'}],views:[{id:'root',title:'架构',parentViewId:null,groups:[],occurrences:[{nodeId:'api'}],relationIds:[]}],relations:[]}
test('注册真实工具schema；创建、读取、最小修改、重复请求与同名跨工作区隔离',async()=>{
 const h=harness();assert.equal(h.tools.size,5)
 const request={operationId:'create-a',content,notes:{api:'## 接口约束\n原始笔记'}}
 const a=await h.call('atlas_create',request);assert.equal(a.status,'success',JSON.stringify(a))
 assert.deepEqual(await h.call('atlas_create',request),a)
 const b=await h.call('atlas_create',request,'/two');assert.equal(b.status,'success')
 const read=await h.call('atlas_read',{mapId:a.mapId});assert.equal(read.notes.api,request.notes.api)
 const op={mapId:a.mapId,operationId:'modify',expectedFingerprint:read.fingerprint,changes:[{op:'set_note',nodeId:'api',markdown:'更新'}]}
 const mapPath='/one/dsh-knowledge-maps/'+a.mapId+'/map.json';const mapBefore=h.files.get(mapPath)!.version
 const update=await h.call('atlas_apply',op);assert.equal(update.status,'success',JSON.stringify(update));assert.equal(h.files.get(mapPath)!.version,mapBefore)
 assert.deepEqual(await h.call('atlas_apply',op),update)
 assert.equal((await h.call('atlas_read',{mapId:b.mapId},'/two')).notes.api,request.notes.api)
 const conflict=await h.call('atlas_apply',{...op,operationId:'stale'});assert.equal(conflict.status,'version_conflict')
 await assert.rejects(h.call('atlas_create',{...request,operationId:'bad',content:{...content,layout:{}}}))
})
test('实际内容写入故障完整回退，活动锁清除，路径和未涉及文件保持',async()=>{
 const h=harness();const a=await h.call('atlas_create',{operationId:'new',content,notes:{api:'old'}})
 const before=await h.call('atlas_read',{mapId:a.mapId});h.fail('notes/api.md')
 const result=await h.call('atlas_apply',{mapId:a.mapId,operationId:'failed',expectedFingerprint:before.fingerprint,changes:[{op:'set_map_title',title:'不能留下半更新'},{op:'set_note',nodeId:'api',markdown:'new'}]})
 assert.equal(result.status,'failed_rolled_back',JSON.stringify(result))
 const after=await h.call('atlas_read',{mapId:a.mapId});assert.equal(after.map.title,content.title);assert.equal(after.notes.api,'old')
 assert.equal([...h.files.keys()].some(p=>p.endsWith('active.json')),false)
})
test('删除预览绑定版本与请求；宿主拒绝、只读权限及缺失资源均不保存',async()=>{
 const h=harness();assert.equal((await h.call('atlas_create',{operationId:'readonly-create',content,notes:{}},'/one','read-only')).status,'permission_denied');assert.equal(h.files.size,0);const a=await h.call('atlas_create',{operationId:'new',content,notes:{api:'old'}});const before=await h.call('atlas_read',{mapId:a.mapId})
 const args={mapId:a.mapId,expectedFingerprint:before.fingerprint,changes:[{op:'delete_node',nodeId:'api'}]}
 assert.equal((await h.call('atlas_apply',{...args,operationId:'no-preview'})).status,'preview_required')
 const preview=await h.call('atlas_preview',args);assert.equal(preview.status,'preview')
 h.deny();const denied=await h.call('atlas_apply',{...args,operationId:'delete',previewToken:preview.previewToken});assert.equal(denied.status,'approval_required');assert.equal(h.approvals(),1)
 assert.equal((await h.call('atlas_apply',{...args,operationId:'readonly',previewToken:preview.previewToken},'/one','read-only')).status,'permission_denied')
 const invalid=await h.call('atlas_apply',{mapId:a.mapId,expectedFingerprint:before.fingerprint,operationId:'asset',changes:[{op:'set_note',nodeId:'api',markdown:'![missing](../assets/no.png)'}]});assert.notEqual(invalid.status,'success')
 assert.equal((await h.call('atlas_read',{mapId:a.mapId})).notes.api,'old')
})
