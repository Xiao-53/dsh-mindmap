import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectionGeometry, createConnections, routeSegments } from '../../src/shared/edge-geometry.ts'
import type { Port, Rect } from '../../src/shared/edge-geometry.ts'
import {
  HEAD_ON_ENTER_DEPTH,
  PILL_CANDIDATE_T,
  buildEdgeCurve,
  computePortEndpoints,
  evalCurvePoint,
  pickPillAnchor,
  sideNormal,
} from '../../src/shared/edge-routing.ts'
import type { EdgeRouteHint, Point } from '../../src/shared/edge-routing.ts'

const numbers = (d: string) => d.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
const angleDeg = (a: Point, b: Point) => {
  const la = Math.hypot(a.x, a.y)
  const lb = Math.hypot(b.x, b.y)
  assert.ok(la > 1e-6 && lb > 1e-6, '零向量')
  return (Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (la * lb)))) * 180) / Math.PI
}
const port = (side: Port['side'], x: number, y: number, role: Port['role'] = 'out'): Port => ({
  nodeId: role === 'out' ? 'a' : 'b',
  side,
  other: role === 'out' ? 'b' : 'a',
  edgeIndex: 0,
  role,
  x,
  y,
})
const card = (x: number, y: number, width = 236, height = 88): Rect => ({ x, y, width, height })
const edge = (id: string, fromNodeId: string, toNodeId: string, extra: { type?: string; label?: string } = {}) => ({
  id,
  fromNodeId,
  toNodeId,
  type: extra.type ?? 'dependency',
  ...(extra.label ? { label: extra.label } : {}),
})
const finiteText = (text: string) => !/NaN|Infinity/.test(text)

function assertStraight(a: Port, b: Port, context: string) {
  const geom = connectionGeometry(a, b)
  assert.match(geom.d, /^M-?\d+(?:\.\d+)? -?\d+(?:\.\d+)? L-?\d+(?:\.\d+)? -?\d+(?:\.\d+)?$/, `${context}: 非纯直线 ${geom.d}`)
  const [sx, sy, ex, ey] = numbers(geom.d)
  const arrow = numbers(geom.arrow)
  const stem = numbers(geom.stem)
  // 箭头尖端、短接段与线条共线。
  const line = { x: ex - sx, y: ey - sy }
  assert.ok(angleDeg(line, { x: arrow[0] - ex, y: arrow[1] - ey }) < 0.01, `${context}: 箭头偏离直线`)
  assert.ok(angleDeg(line, { x: stem[2] - stem[0], y: stem[3] - stem[1] }) < 0.01, `${context}: 短接段偏离直线`)
}

test('SC-001 同排高度不一串联、多端口对单端口与 16px 内小错位均为纯直线且箭头共线', () => {
  const cases: [number, number, number][] = [
    [100, 100, 200],
    [100, 100, 60],
    [100, 120, 300],
    [100, 140, 100],
    [400, 90, 150],
    [400, 105, 80],
    [50, 60, 500],
    [300, 316, 90],
    [300, 284, 90],
    [250, 250, 24],
    [250, 258, 40],
    [800, 790, 120],
  ]
  cases.forEach(([x, y, gap], i) => {
    const dy = ((i % 5) - 2) * 6 // [-12, 12] 范围内的小错位
    assertStraight(port('right', x, y), port('left', x + gap, y + dy, 'in'), `水平 #${i}`)
    assertStraight(port('bottom', y, x), port('top', y + dy, x + gap, 'in'), `垂直 #${i}`)
  })
  assertStraight(port('right', 100, 100), port('left', 224, 116, 'in'), '边界 16px')
})

test('SC-001 同排高矮不一的串联卡片与多端口对单端口经批量路由落在同一水平主干线', () => {
  const nodes = { a: card(0, 0, 236, 88), b: card(400, 0, 236, 130), c: card(800, 0, 236, 70) }
  const result = createConnections(nodes, [edge('ab', 'a', 'b'), edge('bc', 'b', 'c')])
  for (const segment of result.segments) {
    assert.ok(segment.d.includes(' L') && !segment.d.includes(' C'), segment.d)
    assert.equal(segment.source.y, 43)
    assert.equal(segment.target.y, 43)
  }

  // 一侧双端口对接对侧单端口：单端口沿安全区投影对齐；越出安全区时保持顶距基准，不吸入角落。
  const fan = createConnections(
    { a: card(0, 0), b: card(400, 0), c: card(600, 150) },
    [edge('ab', 'a', 'b'), edge('ac', 'a', 'c')],
  )
  const bPort = fan.ports.find(p => p.nodeId === 'b' && p.side === 'left')!
  const aOut = fan.ports.find(p => p.nodeId === 'a' && p.edgeIndex === 0 && p.role === 'out')!
  assert.equal(bPort.y, aOut.y)
  assert.ok(fan.segments[0].d.includes(' L') && !fan.segments[0].d.includes(' C'))
  const cPort = fan.ports.find(p => p.nodeId === 'c' && p.side === 'left')!
  assert.equal(cPort.y, 150 + 43)
})

test('SC-002 非自环严格单段、端切向与端口法线一致、正向控制臂封顶', () => {
  const cases: [Port['side'], number, number, Port['side'], number, number][] = [
    ['right', 100, 100, 'left', 500, 300],
    ['right', 100, 100, 'left', 900, 500],
    ['right', 100, 300, 'left', 500, 100],
    ['bottom', 200, 100, 'top', 300, 500],
    ['bottom', 200, 100, 'top', 700, 400],
    ['top', 400, 500, 'bottom', 300, 100],
    ['right', 500, 100, 'left', 100, 200],
    ['right', 500, 100, 'left', 300, 110],
    ['right', 100, 100, 'top', 400, 300],
    ['bottom', 100, 100, 'left', 400, 300],
    ['right', 100, 100, 'right', 300, 300],
    ['left', 300, 100, 'left', 100, 300],
    ['top', 100, 300, 'top', 400, 100],
    ['bottom', 100, 100, 'bottom', 300, 500],
    ['left', 500, 200, 'right', 100, 400],
    ['right', 100, 100, 'left', 130, 500],
    ['right', 100, 100, 'left', 300, 117],
  ]
  assert.ok(cases.length >= 15)
  cases.forEach(([sa, ax, ay, sb, bx, by], i) => {
    const a = port(sa, ax, ay)
    const b = port(sb, bx, by, 'in')
    const { curve, straightDir } = buildEdgeCurve(a, b)
    const context = `#${i} ${sa}->${sb}`
    assert.equal(straightDir, undefined, context)
    assert.equal(curve.kind, 'cubic', context)
    assert.equal(curve.segments.length, 1, context)
    assert.ok(finiteText(curve.d), context)
    assert.equal((curve.d.match(/C/g) ?? []).length, 1, context)
    assert.ok(!curve.d.includes('L'), context)
    const [p0, p1, p2, p3] = curve.segments[0]
    const us = sideNormal(sa)
    const ut = sideNormal(sb)
    assert.ok(angleDeg({ x: p1.x - p0.x, y: p1.y - p0.y }, us) < 0.01, `${context} 起点切向`)
    assert.ok(angleDeg({ x: p3.x - p2.x, y: p3.y - p2.y }, { x: -ut.x, y: -ut.y }) < 0.01, `${context} 终点切向`)
    const dotN = us.x * ut.x + us.y * ut.y
    if (dotN <= 0.5) {
      assert.ok(Math.hypot(p1.x - p0.x, p1.y - p0.y) <= 120 + 1e-6, `${context} 起点控制臂`)
      assert.ok(Math.hypot(p3.x - p2.x, p3.y - p2.y) <= 120 + 1e-6, `${context} 终点控制臂`)
    }
    if (dotN < -0.5) {
      const dParallel = (p3.x - p0.x) * us.x + (p3.y - p0.y) * us.y
      if (dParallel >= 24) assert.ok(Math.hypot(p1.x - p0.x, p1.y - p0.y) <= 110 + 1e-6, `${context} 正向控制臂`)
    }
  })

  // 自环保持卡片外侧两段平滑回环。
  const loop = createConnections({ a: card(0, 0) }, [edge('loop', 'a', 'a')])
  assert.equal((loop.segments[0].d.match(/C/g) ?? []).length, 2)
  assert.ok(finiteText(loop.segments[0].d))
})

test('SC-002 穿过无关卡片的斜连线保持单段、不换边，也不为避让绕行', () => {
  const nodes = { a: card(0, 0), b: card(900, 400), m: card(400, 150) }
  const result = createConnections(nodes, [edge('ab', 'a', 'b')])
  const segment = result.segments[0]
  assert.equal(segment.source.side, 'right')
  assert.equal(segment.target.side, 'left')
  assert.equal((segment.d.match(/C/g) ?? []).length, 1)
  assert.equal(result.hints.get('ab')?.archActive, undefined)
})

test('SC-003 同排/同列正面直挡转同侧单段拱桥，斜向与擦边不换边', () => {
  const row = { a: card(0, 0), m: card(400, 0), b: card(800, 0) }
  const rowEdges = [edge('am', 'a', 'm'), edge('mb', 'm', 'b'), edge('ab', 'a', 'b')]
  const rowResult = createConnections(row, rowEdges)
  const [am, mb, ab] = rowResult.segments
  assert.equal(am.source.side, 'right')
  assert.equal(mb.target.side, 'left')
  assert.equal(ab.source.side, 'top')
  assert.equal(ab.target.side, 'top')
  assert.equal((ab.d.match(/C/g) ?? []).length, 1)
  assert.equal(rowResult.hints.get('ab')?.archActive, true)
  const nums = numbers(ab.d)
  const ys = nums.filter((_, i) => i % 2 === 1)
  assert.ok(Math.min(...ys) < 0, '拱桥应抬升到卡片顶部之上')

  const column = { a: card(0, 0), m: card(0, 200), b: card(0, 400) }
  const colResult = createConnections(column, [edge('ab', 'a', 'b')])
  assert.equal(colResult.segments[0].source.side, 'left')
  assert.equal(colResult.segments[0].target.side, 'left')

  // 擦边：中间卡仅侵入直连走廊不足门槛深度。
  const grazing = { a: card(0, 0), b: card(800, 0), m: card(400, 30) }
  const grazeResult = createConnections(grazing, [edge('ab', 'a', 'b')])
  assert.ok(43 - 30 < HEAD_ON_ENTER_DEPTH)
  assert.equal(grazeResult.segments[0].source.side, 'right')
  assert.equal(grazeResult.segments[0].target.side, 'left')
})

test('SC-003 仅导图外侧边缘且外侧无卡片时允许同侧拱桥，内部列/行一律穿底直连', () => {
  // 模拟三列结构：左列有卡片、中列有「民族主义 -> 三国同盟 -> 巴尔干火药桶」、右列有「帝国主义 -> 摩洛哥危机」与中间三卡。
  const atlas = {
    l1: card(40, 0),
    l2: card(40, 220),
    l3: card(40, 440),
    m1: card(360, 110, 220, 88),
    m2: card(360, 220, 220, 88),
    m3: card(370, 440, 220, 88),
    r1: card(630, 0, 225, 88),
    r2: card(660, 110, 235, 88),
    r3: card(660, 220, 235, 88),
    r4: card(660, 440, 235, 88),
    r5: card(670, 560, 210, 88),
  }
  const result = createConnections(atlas, [edge('mid', 'm1', 'm3'), edge('outer', 'r1', 'r5')])
  const [mid, outer] = result.segments
  // 内部列（左右两侧都有卡片）不得向左右绕拱桥，保持 bottom -> top 穿底直连。
  assert.equal(mid.source.side, 'bottom')
  assert.equal(mid.target.side, 'top')
  assert.equal(result.hints.get('mid')?.archActive, undefined)
  // 最右外侧列（右侧外部无卡片，尽管中间卡略宽于端点卡）允许走右侧外沿单段拱桥。
  assert.equal(outer.source.side, 'right')
  assert.equal(outer.target.side, 'right')
  assert.equal((outer.d.match(/C/g) ?? []).length, 1)
  assert.equal(result.hints.get('outer')?.archActive, true)

  // 内部行（上下两侧均有其他卡片）同样不绕拱桥，保持 right -> left 穿底直连。
  const innerRow = {
    top: card(400, 0),
    a: card(0, 200),
    m: card(400, 200),
    b: card(800, 200),
    bottom: card(400, 400),
  }
  const rowRes = createConnections(innerRow, [edge('ab', 'a', 'b')])
  assert.equal(rowRes.segments[0].source.side, 'right')
  assert.equal(rowRes.segments[0].target.side, 'left')
  assert.ok(rowRes.segments[0].d.includes(' L') && !rowRes.segments[0].d.includes(' C'))

  // 仅底行外侧（上方有卡片、下方无卡片）只允许走 bottom -> bottom，不走 top。
  const bottomRow = {
    top: card(400, 0),
    a: card(0, 200),
    m: card(400, 200),
    b: card(800, 200),
  }
  const bottomRes = createConnections(bottomRow, [edge('ab', 'a', 'b')])
  assert.equal(bottomRes.segments[0].source.side, 'bottom')
  assert.equal(bottomRes.segments[0].target.side, 'bottom')
})

test('SC-005 拖拽进出临界线的滞回切换每个方向至多一次', () => {
  const edges = [edge('ab', 'a', 'b')]
  let hints: ReadonlyMap<string, EdgeRouteHint> | undefined
  const frame = (oy: number) => {
    const result = createConnections({ a: card(0, 0), b: card(800, 0), m: card(400, oy) }, edges, undefined, {
      hints,
      dragging: true,
    })
    hints = result.hints
    return result.hints.get('ab')?.archActive === true
  }
  const sweep = (from: number, to: number) => {
    const step = from < to ? 1 : -1
    let switches = 0
    let flipAt = Number.NaN
    let previous = frame(from)
    for (let oy = from + step; oy !== to + step; oy += step) {
      const now = frame(oy)
      if (now !== previous) {
        switches++
        flipAt = oy
      }
      previous = now
    }
    return { switches, flipAt }
  }
  const away = sweep(0, 60)
  assert.equal(away.switches, 1)
  const back = sweep(60, 0)
  assert.equal(back.switches, 1)
  assert.ok(away.flipAt > back.flipAt, `退出点 ${away.flipAt} 应晚于进入点 ${back.flipAt}`)
})

test('SC-004 关系胶囊沿线避开卡片与已放胶囊，极短边居中回退', () => {
  const a = port('right', 236, 43)
  const b = port('left', 800, 43, 'in')
  const { curve } = buildEdgeCurve(a, b)
  const cards = [card(0, 0), card(800, 0)]
  const overlaps = (p: Point, rects: Rect[], halfW = 20, halfH = 11) =>
    rects.some(r => p.x + halfW > r.x - 4 && p.x - halfW < r.x + r.width + 4 && p.y + halfH > r.y - 4 && p.y - halfH < r.y + r.height + 4)

  const mid = pickPillAnchor(curve, '依赖', cards)
  assert.deepEqual(mid, evalCurvePoint(curve, PILL_CANDIDATE_T[0]))

  const obstacle = card(440, 20, 156, 50)
  const avoided = pickPillAnchor(curve, '依赖', [...cards, obstacle])
  assert.equal(overlaps(avoided, [...cards, obstacle]), false)
  assert.ok(Math.abs(avoided.y - 43) < 1e-9)

  const placed: Parameters<typeof pickPillAnchor>[3] = []
  const first = pickPillAnchor(curve, '依赖', cards, placed)
  const second = pickPillAnchor(curve, '依赖', cards, placed)
  assert.notDeepEqual(first, second)
  assert.equal(placed.length, 2)

  const none = pickPillAnchor(curve, '  ', cards, placed)
  assert.deepEqual(none, curve.defaultLabel)
  assert.equal(placed.length, 2)

  const shortCurve = buildEdgeCurve(port('right', 236, 43), port('left', 260, 43, 'in')).curve
  const fallback = pickPillAnchor(shortCurve, '依赖', [card(0, 0), card(260, 0)])
  assert.deepEqual(fallback, evalCurvePoint(shortCurve, 0.5))

  const labelled = createConnections({ a: card(0, 0), b: card(800, 0) }, [edge('ab', 'a', 'b', { label: '推出' })])
  assert.ok(Number.isFinite(labelled.segments[0].label.x) && Number.isFinite(labelled.segments[0].label.y))
})

test('SC-006 零尺寸与重叠卡片零 NaN，40 节点 60+ 边批量耗时远低于帧预算且不改写输入', () => {
  const degenerate = Object.fromEntries(['a', 'b', 'c'].map(id => [id, card(10, 10, 0, 0)]))
  const loops = [edge('ab', 'a', 'b'), edge('ba', 'b', 'a'), edge('bc', 'b', 'c'), edge('aa', 'a', 'a')]
  const bad = createConnections(degenerate, loops)
  for (const segment of bad.segments) {
    assert.ok(finiteText(`${segment.d} ${segment.arrow} ${segment.stem}`), segment.d)
    assert.ok(Number.isFinite(segment.label.x) && Number.isFinite(segment.label.y))
  }
  assert.ok(bad.ports.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))

  const nodes: Record<string, Rect> = {}
  for (let i = 0; i < 40; i++) nodes[`n${i}`] = card((i % 8) * 300, Math.floor(i / 8) * 180, 236, 88 + (i % 3) * 20)
  const edges = []
  for (let i = 0; i < 65; i++) edges.push(edge(`e${i}`, `n${i % 40}`, `n${(i * 7 + 3) % 40}`, i % 4 === 0 ? { label: `关系${i}` } : {}))
  const snapshot = JSON.stringify(nodes)
  const started = performance.now()
  const result = createConnections(nodes, edges)
  const elapsed = performance.now() - started
  assert.equal(JSON.stringify(nodes), snapshot)
  assert.equal(result.segments.length, edges.length)
  assert.ok(result.segments.every(s => finiteText(s.d)))
  assert.ok(elapsed < 100, `耗时 ${elapsed}ms`)
  const again = routeSegments(result.segments, nodes)
  assert.equal(again.segments.length, edges.length)
})

test('computePortEndpoints 默认沿目标法线对接，直线模式沿线方向对接输入圆外沿', () => {
  const a = port('right', 100, 100)
  const b = port('left', 300, 100, 'in')
  const normal = computePortEndpoints(a, b)
  assert.deepEqual(normal.pe, { x: 285, y: 100 })
  const dir = { x: Math.SQRT1_2, y: Math.SQRT1_2 }
  const slanted = computePortEndpoints(a, { ...b, x: 300, y: 300 }, dir)
  assert.ok(Math.abs(Math.hypot(slanted.pe.x - 300, slanted.pe.y - 300) - 15) < 1e-9)
})
