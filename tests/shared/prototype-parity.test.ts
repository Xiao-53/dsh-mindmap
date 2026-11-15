import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { createConnections } from '../../src/shared/edge-geometry.ts'
import { loadPrototype } from '../support/prototype.ts'
import { validateMap } from '../../src/shared/validate-map.ts'

test('v17 的全部视图：端口方向、同侧排列与曲线路径逐条等同原型', async () => {
  const { html, data, snapshot } = await loadPrototype()
  assert.ok(validateMap(snapshot.map).ok)
  const fn = html.slice(html.indexOf('function createConnections(edges)'), html.indexOf('function syncConnections()'))
  for (const view of Object.values(data.VIEW) as any[]) {
    for (const height of [88, 149]) {
      const nodes = Object.fromEntries(view.nodes.map(([id,x,y,width]: any) => [id, { x,y,width,height }]))
      const sceneNodes = Object.fromEntries(Object.entries(nodes).map(([id,n]) => [id, { ...n, w:n.width, h:n.height }]))
      const expected = runInNewContext(`${fn};createConnections(edges)`, { sceneNodes, edges:view.edges, WIDTH:1140, HEIGHT:800, esc: (x:string) => x })
      const actual = createConnections(nodes, Array.from(view.edges, ([fromNodeId,toNodeId,type,label]: any,i:number) => ({ id:`r${i}`,fromNodeId,toNodeId,type,label })))
      assert.equal(actual.segments.length, view.edges.length)
      const paths = [...expected.svg.matchAll(/<path class="edge [^"]*" d="([^"]+)"/g)].map((m:any) => m[1])
      assert.deepEqual(actual.segments.map(s => s.d), paths)
      actual.segments.forEach((s,i) => {
        const old = expected.segments[i]
        for (const side of ['source','target'] as const)
          assert.deepEqual(JSON.parse(JSON.stringify(s[side])), JSON.parse(JSON.stringify(old[side], (key,value) => key === 'type' ? undefined : value)))
      })
      assert.equal(actual.ports.length, view.edges.length*2)
    }
  }
})

test('合法自环也分配独立的输出和输入端口', () => {
  const result = createConnections({ a:{x:0,y:0,width:236,height:88} }, [{ id:'loop',fromNodeId:'a',toNodeId:'a',type:'dependency' }])
  assert.equal(result.ports.length,2)
  assert.notEqual(result.ports[0].y,result.ports[1].y)
  assert.ok(!result.segments[0].d.includes('NaN'))
})
