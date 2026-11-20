import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { createConnections, connectionGeometry } from '../../src/shared/edge-geometry.ts'
import { loadPrototype } from '../support/prototype.ts'
import { validateMap } from '../../src/shared/validate-map.ts'

test('v17 的全部视图：端口方向、边界分布与外移箭头几何保持对齐', async () => {
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
      assert.equal(actual.ports.length, view.edges.length * 2)
      actual.segments.forEach((s, i) => {
        const old = expected.segments[i]
        assert.equal(s.source.side, old.source.side)
        assert.equal(s.target.side, old.target.side)
        const geom = connectionGeometry(s.source, s.target, s.self)
        assert.equal(s.d, geom.d)
        assert.equal(s.arrow, geom.arrow)
        assert.equal(s.stem, geom.stem)
      })
      const coords = new Set(actual.ports.map(p => `${p.nodeId}:${p.side}:${p.x.toFixed(3)},${p.y.toFixed(3)}`))
      assert.equal(coords.size, actual.ports.length)
    }
  }
})

test('合法自环也分配独立的输出和输入端口', () => {
  const result = createConnections({ a:{x:0,y:0,width:236,height:88} }, [{ id:'loop',fromNodeId:'a',toNodeId:'a',type:'dependency' }])
  assert.equal(result.ports.length,2)
  assert.notEqual(result.ports[0].y,result.ports[1].y)
  assert.ok(!result.segments[0].d.includes('NaN'))
})
