import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { createConnections, connectionGeometry } from '../../src/shared/edge-geometry.ts'
import { sideNormal } from '../../src/shared/edge-routing.ts'
import { loadPrototype } from '../support/prototype.ts'
import { validateMap } from '../../src/shared/validate-map.ts'

const numbers = (d: string) => d.match(/-?\d+(?:\.\d+)?/g)!.map(Number)

function vectorAngleDeg(ax: number, ay: number, bx: number, by: number): number {
  const la = Math.hypot(ax, ay)
  const lb = Math.hypot(bx, by)
  assert.ok(la > 1e-4 && lb > 1e-4)
  const dot = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))
  return (Math.acos(dot) * 180) / Math.PI
}

test('v17 的全部视图：端口选边唯一、无折角单段曲线或纯直线，同侧拱桥仅用于隔卡直挡', async () => {
  const { html, data, snapshot } = await loadPrototype()
  assert.ok(validateMap(snapshot.map).ok)
  const fn = html.slice(html.indexOf('function createConnections(edges)'), html.indexOf('function syncConnections()'))
  for (const view of Object.values(data.VIEW) as any[]) {
    for (const height of [88, 149]) {
      const nodes = Object.fromEntries(view.nodes.map(([id, x, y, width]: any) => [id, { x, y, width, height }]))
      const sceneNodes = Object.fromEntries(Object.entries(nodes).map(([id, n]: [string, any]) => [id, { ...n, w: n.width, h: n.height }]))
      const expected = runInNewContext(`${fn};createConnections(edges)`, { sceneNodes, edges: view.edges, WIDTH: 1140, HEIGHT: 800, esc: (x: string) => x })
      const actual = createConnections(
        nodes,
        Array.from(view.edges, ([fromNodeId, toNodeId, type, label]: any, i: number) => ({
          id: `r${i}`,
          fromNodeId,
          toNodeId,
          type,
          label,
        })),
      )
      assert.equal(actual.segments.length, view.edges.length)
      assert.equal(actual.ports.length, view.edges.length * 2)
      actual.segments.forEach((s, i) => {
        const old = expected.segments[i]
        assert.ok(!/NaN|Infinity/.test(`${s.d} ${s.arrow} ${s.stem}`))
        assert.ok(s.arrow.length > 0 && s.stem.length > 0)
        assert.ok(Number.isFinite(s.label.x) && Number.isFinite(s.label.y))
        if (s.self) return

        const isArch = s.source.side === s.target.side
        if (isArch) {
          // 同侧拱桥只可能由同排/同列隔卡直挡触发，且为单段。
          assert.equal(s.archClearance !== undefined, true)
        } else {
          assert.equal(s.source.side, old.source.side)
          assert.equal(s.target.side, old.target.side)
        }

        const us = sideNormal(s.source.side)
        const ut = sideNormal(s.target.side)
        if (s.d.includes(' L')) {
          // 纯直线：箭头与短接段共线。
          assert.ok(!s.d.includes(' C'))
          const [sx, sy, ex, ey] = numbers(s.d)
          const arrow = numbers(s.arrow)
          assert.ok(vectorAngleDeg(ex - sx, ey - sy, arrow[0] - ex, arrow[1] - ey) < 0.01)
        } else {
          assert.equal((s.d.match(/C/g) ?? []).length, 1)
          const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] = numbers(s.d)
          assert.ok(vectorAngleDeg(c1x - x0, c1y - y0, us.x, us.y) < 0.01)
          assert.ok(vectorAngleDeg(x1 - c2x, y1 - c2y, -ut.x, -ut.y) < 0.01)
          if (!isArch) {
            const geom = connectionGeometry(s.source, s.target, s.self)
            assert.equal(s.d, geom.d)
            assert.equal(s.arrow, geom.arrow)
            assert.equal(s.stem, geom.stem)
          }
        }
      })
      const coords = new Set(actual.ports.map(p => `${p.nodeId}:${p.side}:${p.x.toFixed(3)},${p.y.toFixed(3)}`))
      assert.equal(coords.size, actual.ports.length)
    }
  }
})

test('合法自环也分配独立的输出和输入端口', () => {
  const result = createConnections({ a: { x: 0, y: 0, width: 236, height: 88 } }, [{ id: 'loop', fromNodeId: 'a', toNodeId: 'a', type: 'dependency' }])
  assert.equal(result.ports.length, 2)
  assert.notEqual(result.ports[0].y, result.ports[1].y)
  assert.ok(!result.segments[0].d.includes('NaN'))
})

test('连线几何只依赖两端端口：无卡片上下文时与批量路由一致，自环保持独立两段回环', () => {
  const a = { nodeId: 'a', side: 'right' as const, other: 'b', edgeIndex: 0, role: 'out' as const, x: 236, y: 65 }
  const b = { nodeId: 'b', side: 'left' as const, other: 'a', edgeIndex: 0, role: 'in' as const, x: 890, y: 120 }
  const single = connectionGeometry(a, b)
  assert.equal((single.d.match(/C/g) ?? []).length, 1)
  assert.deepEqual(connectionGeometry(a, b, false, { ghost: { x: 445, y: 0, width: 236, height: 130 } }), single)
  const straight = connectionGeometry(a, { ...b, y: 70 })
  assert.match(straight.d, / L/)
  assert.equal((connectionGeometry(a, a, true).d.match(/C/g) ?? []).length, 2)
})
