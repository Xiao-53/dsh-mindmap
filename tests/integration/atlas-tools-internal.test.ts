import {posix} from 'node:path'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {commitEdit, editStatus, type EditRequest} from '../../src/server/edit-service.ts'
import {createHostFiles, readSnapshot} from '../../src/server/map-files.ts'
import {digest, canonicalJson} from '../../src/shared/fingerprint.ts'
import {EditSession} from '../../src/client/edit-session.ts'
import type {HostAdapter} from '../../src/client/host-adapter.ts'
import {registerTools} from '../../src/server/tools/index.ts'
function harness() {
 const files=new Map<string,{text:string;version:string}>();let revision=0
 const tools=new Map<string,any>();let failPath='';let approve='allowed-once';let approvals=0
 const missing=()=>Object.assign(new Error('not found'),{code:'FS_NOT_FOUND'})
 const ctx:any={tools:{register:(d:any)=>tools.set(d.name,d)},sandboxPolicy:{resolve:({session}:any)=>({mode:session.mode??'workspace-write',workspaceRoot:session.header.cwd})},approval:{request:async()=>{approvals++;return approve}},
 fs:{resolve:async(path:string,options:any)=>({targetKey:posix.normalize(path.startsWith('/')?path:options.cwd+'/'+path)}),contains:(a:any,b:any)=>b.targetKey.startsWith(a.targetKey+'/'),lstat:async(path:string,o:any)=>files.has(o.cwd+'/'+path)?{type:'file'}:undefined,
 stat:async(t:any)=>files.has(t.targetKey)?{type:'file',version:files.get(t.targetKey)!.version}:undefined,
 readText:async(t:any)=>{if(!files.has(t.targetKey))throw missing();return files.get(t.targetKey)!.text},
 writeText:async(t:any,text:string,intent:any)=>{if(t.targetKey.endsWith(failPath)&&failPath){failPath='';throw new Error('模拟正式笔记写入失败')};const old=files.get(t.targetKey);if(intent.kind==='createIfAbsent'?!!old:old?.version!==intent.version)throw new Error('guard conflict');const version=String(++revision);files.set(t.targetKey,{text,version});return {version}},
 deleteFile:async(t:any,g:any)=>{assert.equal(files.get(t.targetKey)?.version,g.version);files.delete(t.targetKey)}},
 workspaceFiles:{stat:async(s:any,p:string)=>{const f=files.get(s.workspaceRoot+'/'+p);if(!f)throw missing();return {version:f.version}},
 readBytes:async(s:any,p:string,o:any)=>{const f=files.get(s.workspaceRoot+'/'+p);if(!f)throw missing();const all=new TextEncoder().encode(f.text);return {data:all.slice(o.range.offset,o.range.offset+o.range.length),version:f.version,eof:o.range.offset+o.range.length>=all.length}},
 list:async(s:any)=>({entries:[...new Set([...files.keys()].filter(k=>k.startsWith(s.workspaceRoot+'/dsh-knowledge-maps/')).map(k=>k.split('/')[3]))].map(name=>({name,type:'directory'})),truncated:false})}}
 registerTools(ctx)
 const call=async(name:string,args:any,workspace='/one',mode='workspace-write')=>tools.get(name).execute(args,{agent:{id:'session-'+workspace,session:{header:{cwd:workspace},mode}},signal:new AbortController().signal,callId:'call'})
 return {ctx,files,tools,call,fail:(path:string)=>{failPath=path},deny:()=>{approve='rejected'},approvals:()=>approvals}
}
const content={title:'系统架构',rootViewId:'root',nodes:[{id:'api',title:'接口',summary:'请求入口',category:'blue',icon:'layers'}],views:[{id:'root',title:'架构',parentViewId:null,groups:[],occurrences:[{nodeId:'api'}],relationIds:[]}],relations:[]}
test('注册真实工具schema；创建、读取、最小修改、重复请求与同名跨工作区隔离',async()=>{
 const h=harness();assert.deepEqual([...h.tools.keys()].sort(),['atlas_apply','atlas_cleanup_create','atlas_create','atlas_list','atlas_preview','atlas_read'])
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

async function editHarness() {
  const h=harness()
  const created=await h.call('atlas_create',{operationId:'edit-fixture',content,notes:{api:'原始正文'}})
  assert.equal(created.status,'success',JSON.stringify(created))
  const scope={workspaceRoot:'/one',sessionId:'edit-session'} as Parameters<typeof commitEdit>[1]
  const policy={mode:'workspace-write',workspaceRoot:'/one'} as Parameters<typeof commitEdit>[3]
  const signal=new AbortController().signal
  const read=(allowMissing=false)=>readSnapshot(createHostFiles(h.ctx,scope,signal),created.mapId,allowMissing)
  const baseline=await read()
  const request=(operationId:string,edit:EditRequest['edit'],expectedFingerprint=baseline.fingerprint):EditRequest=>({
    op:'commitEdit',mapId:created.mapId,expectedWorkspaceKey:scope.workspaceRoot,expectedFingerprint,operationId,edit,
  })
  const commit=(req:EditRequest)=>commitEdit(h.ctx,scope,req,policy,signal)
  const status=async(req:EditRequest)=>editStatus(h.ctx,scope,{
    op:'editStatus',mapId:req.mapId,expectedWorkspaceKey:req.expectedWorkspaceKey,
    operationId:req.operationId,requestDigest:await digest(canonicalJson(req)),
  },signal)
  return {...h,scope,policy,read,baseline,request,commit,status}
}

test('手动详情和排版保存，回执查询只读，外部更新后拒绝重放',async()=>{
  const h=await editHarness()
  const req=h.request('manual-details',{kind:'details',nodeId:'api',title:'新标题',summary:'新摘要',markdown:'新正文',images:[]})
  const saved=await h.commit(req)
  assert.equal(saved.snapshot.map.nodes[0].title,'新标题')
  assert.equal((await h.read()).notes.api,'新正文')
  const versions=[...h.files.entries()]
  assert.equal((await h.status(req)).state,'committed')
  await assert.rejects(h.status({...req,edit:{...req.edit,markdown:'不同请求'} } as EditRequest),{code:'operation_conflict'})
  assert.deepEqual([...h.files.entries()],versions)
  const moved=await h.commit(h.request('manual-position',{kind:'layout',viewId:'root',layout:{
    viewId:'root',mode:'vertical',nodes:[{nodeId:'api',x:30,y:40,width:236,manual:true}],groups:[],
  }},saved.committedFingerprint))
  assert.equal(moved.snapshot.layout?.schemaVersion,2)
  assert.equal((await h.read()).layout?.views[0].nodes[0].x,30)
  await assert.rejects(h.status(req),{code:'version_conflict'})
})

test('正文写入失败回退已创建的图片，重试后图片可读且丢失资源只读降级',async()=>{
  const h=await editHarness()
  const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV2QAAAAASUVORK5CYII='
  const bytes=Buffer.from(data,'base64')
  const image={schemaVersion:1,kind:'image',id:'pixel',mimeType:'image/png',encoding:'base64',byteLength:bytes.length,sha256:await digest(bytes),data} as const
  const req=h.request('add-image',{kind:'details',nodeId:'api',title:'接口',summary:'请求入口',markdown:'![图](../assets/pixel.image.json)',images:[image]})
  h.fail('notes/api.md')
  await assert.rejects(h.commit(req),{code:'failed_rolled_back'})
  assert.equal((await h.read()).notes.api,'原始正文')
  assert.equal([...h.files.keys()].some(path=>path.endsWith('pixel.image.json')),false)
  // 回退可能改变版本，使用重新读出的基线发起下一次操作。
  const retried=h.request('retry-image',req.edit,(await h.read()).fingerprint)
  const saved=await h.commit(retried)
  assert.equal(saved.snapshot.resources['api:../assets/pixel.image.json'],'data:image/png;base64,'+data)
  h.files.delete([...h.files.keys()].find(path=>path.endsWith('pixel.image.json'))!)
  assert.equal((await h.read(true)).writable,false)
  await assert.rejects(h.read())
})

test('保存响应丢失后撤销，先查回执再写当前净差异',async()=>{
  const h=await editHarness()
  const events:string[]=[]
  let lost=true
  const host={
    commitEdit:async(req:EditRequest)=>{
      events.push('write')
      const result=await h.commit(req)
      if(lost){lost=false;throw new Error('响应丢失')}
      return result
    },
    editStatus:async(req:Parameters<NonNullable<HostAdapter['editStatus']>>[0])=>{
      events.push('receipt')
      return editStatus(h.ctx,{workspaceRoot:'/one',sessionId:'edit-session'} as Parameters<typeof editStatus>[1],req,new AbortController().signal)
    },
  } as HostAdapter
  const session=new EditSession(host,h.baseline)
  try{
    session.input({...session.details('api'),markdown:'新正文'},'root')
    await session.save()
    assert.equal(session.status,'failed')
    assert.equal((await h.read()).notes.api,'新正文')
    assert.ok(session.travel())
    assert.equal(session.working.notes.api,'原始正文')
    assert.equal(await session.flush(),true)
    assert.deepEqual(events,['write','receipt','write'])
    assert.equal((await h.read()).notes.api,'原始正文')
  }finally{session.dispose()}
})

test('确定回退后保留编辑，复核恢复后的文件版本并重试保存',async()=>{
  const h=await editHarness()
  const session=new EditSession({read:()=>h.read(),commitEdit:h.commit} as HostAdapter,h.baseline)
  try {
    h.fail('notes/api.md')
    session.input({...session.details('api'),title:'新标题',markdown:'新正文'},'root')
    await session.save()
    assert.equal(session.status,'failed')
    assert.equal((await h.read()).map.nodes[0].title,'接口')
    assert.equal(session.working.map.nodes[0].title,'新标题')
    assert.equal(await session.flush(),true)
    assert.equal((await h.read()).notes.api,'新正文')
  } finally { session.dispose() }
})

test('输入法组字期间不写入，输入结束后停顿触发自动保存',async()=>{
  const h=await editHarness()
  let publish!:()=>void
  const committed=new Promise<void>(resolve=>{publish=resolve})
  const session=new EditSession({read:()=>h.read(),commitEdit:async(req:EditRequest)=>{
    const result=await h.commit(req)
    publish()
    return result
  }} as HostAdapter,h.baseline)
  try {
    session.input({...session.details('api'),markdown:'组字中'},'root',true)
    await session.save()
    assert.equal((await h.read()).notes.api,'原始正文')
    session.input({...session.details('api'),markdown:'组字完成'},'root')
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('800ms 批次未触发保存')),4000)
      void committed.then(()=>{clearTimeout(timer);resolve()})
    })
    assert.equal((await h.read()).notes.api,'组字完成')
  } finally { session.dispose() }
})

test('认领后取消多文件保存，回退已写入的正文和结构',async()=>{
  const h=await editHarness()
  const cancel=new AbortController()
  const write=h.ctx.fs.writeText
  h.ctx.fs.writeText=async(target:any,...args:any[])=>{
    const outcome=await write(target,...args)
    if(target.targetKey.endsWith('notes/api.md')) cancel.abort()
    return outcome
  }
  const req=h.request('cancel-edit',{kind:'details',nodeId:'api',title:'新标题',summary:'请求入口',markdown:'新正文',images:[]})
  await assert.rejects(commitEdit(h.ctx,h.scope,req,h.policy,cancel.signal),{code:'failed_rolled_back'})
  const restored=await h.read()
  assert.equal(restored.map.nodes[0].title,'接口')
  assert.equal(restored.notes.api,'原始正文')
  assert.equal((await h.status(req)).state,'absent')
})
