import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Transactions } from '../../src/server/transaction.ts'
import type { TransactionPort, TextRecord, Mutation } from '../../src/server/transaction.ts'
class Memory implements TransactionPort {
  files = new Map<string,TextRecord>()
  step=0; failAt=0; after=false; persistent=false; version=0
  hook?: (path:string)=>void
  boundary() { if(++this.step===this.failAt || (this.persistent && this.step>=this.failAt && this.failAt>0)) throw new Error('模拟磁盘满/权限撤销/进程停止') }
  async read(path:string) { this.boundary(); return this.files.get(path) ?? null }
  async put(path:string,text:string,expected:string|null) {
    this.hook?.(path)
    this.boundary()
    assert.equal(this.files.get(path)?.version ?? null,expected,'条件写入不覆盖外部版本')
    this.files.set(path,{text,version:String(++this.version)})
    if(this.after) this.boundary()
  }
  async remove(path:string,expected:string) {
    this.boundary(); assert.equal(this.files.get(path)?.version,expected)
    this.files.delete(path); if(this.after) this.boundary()
  }
}
function setup() {
  const port=new Memory()
  port.files.set('map.json',{text:'before',version:'0'})
  port.files.set('notes/removed.md',{text:'old note',version:'0'})
  const changes:Mutation[]=[{path:'map.json',before:port.files.get('map.json')!,after:'after'},
    {path:'notes/new.md',before:null,after:'new note'},
    {path:'notes/removed.md',before:port.files.get('notes/removed.md')!,after:null}]
  return {port,changes}
}
const result={status:'success',fingerprint:'final-version'}
const verify=async()=>{}
test('成功、重复请求、同ID不同请求与提交结果重放',async()=>{
  const {port,changes}=setup(); const tx=new Transactions(port,'owner')
  assert.deepEqual(await tx.commit('op','request',changes,result,verify),result)
  assert.deepEqual(await tx.commit('op','request',changes,result,verify),result)
  await assert.rejects(tx.commit('op','different',changes,result,verify),{code:'operation_conflict'})
  assert.equal(port.files.has('.transactions/active.json'),false)
})
for(const after of [false,true]) for(const persistent of [false,true]) {
 test(`每个读写删除标记边界失败：写后=${after}，持续中断=${persistent}`,async()=>{
  // 每一注入点在独立存储执行，恢复用全新协调器模拟重启。
  let reached=0
  for(let failAt=1;failAt<=90;failAt++) {
    const {port,changes}=setup();port.after=after;port.persistent=persistent;port.failAt=failAt
    let success=false
    try { await new Transactions(port,'owner').commit('op','request',changes,result,verify);success=true } catch {}
    if(port.step>=failAt) reached++
    port.failAt=0;port.persistent=false;port.after=false
    await new Transactions(port,'new-owner').recover()
    const state=port.files.get('map.json')?.text
    assert.ok(state==='before'||state==='after')
    assert.equal(port.files.has('notes/new.md'),state==='after')
    assert.equal(port.files.has('notes/removed.md'),state==='before')
    if(success) assert.equal(state,'after')
    const replay=await new Transactions(port,'new-owner').replay('op','request')
    if(replay) {assert.deepEqual(replay,result);assert.equal(state,'after')}
    assert.equal(port.files.has('.transactions/active.json'),false)
  }
  assert.ok(reached>15)
 })
}
test('回退遇外部冲突保留恢复资料，禁止覆盖',async()=>{
 const {port,changes}=setup();let changed=false
 port.hook=path=>{if(path==='notes/new.md'&&!changed){changed=true;port.files.set('map.json',{text:'external',version:'outside'});throw new Error('并发变化')}}
 await assert.rejects(new Transactions(port,'owner').commit('op','request',changes,result,verify),{code:'recovery_required'})
 assert.equal(port.files.get('map.json')?.text,'external')
 assert.ok(port.files.has('.transactions/active.json'))
 port.hook=undefined
 await assert.rejects(new Transactions(port,'restart').recover(),{code:'recovery_required'})
 assert.equal(port.files.get('map.json')?.text,'external')
})
test('提交前校验失败完整回退，不覆盖未知文件',async()=>{
 const {port,changes}=setup();port.files.set('unknown.txt',{text:'keep',version:'unknown'})
 await assert.rejects(new Transactions(port,'owner').commit('op','request',changes,result,async()=>{throw new Error('版本冲突')}),{code:'failed_rolled_back'})
 assert.equal(port.files.get('map.json')?.text,'before');assert.equal(port.files.get('unknown.txt')?.text,'keep')
})
