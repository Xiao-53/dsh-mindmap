import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ARROW_HALF_WIDTH,
  ARROW_LENGTH,
  connectionGeometry,
  createConnections,
  routeSegments,
} from '../../src/shared/edge-geometry.ts'
import type { Port, Rect } from '../../src/shared/edge-geometry.ts'
import {
  HEAD_ON_ENTER_DEPTH,
  PILL_CANDIDATE_T,
  PILL_CARD_MARGIN,
  PILL_MAX_WIDTH,
  PILL_PORT_MARGIN,
  SIDE_SADDLE_GAP,
  buildEdgeCurve,
  computePortEndpoints,
  evalCurvePoint,
  pickPillAnchor,
  sideNormal,
} from '../../src/shared/edge-routing.ts'
import type { Box, EdgeRouteHint, Point } from '../../src/shared/edge-routing.ts'

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

function samplePathPoints(d: string, steps = 40): Point[] {
  const nums = numbers(d)
  const pts: Point[] = []
  if (d.includes(' C')) {
    const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] = nums
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const u = 1 - t
      pts.push({
        x: u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1,
        y: u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1,
      })
    }
  } else {
    const [x0, y0, x1, y1] = nums
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t })
    }
  }
  return pts
}

function segmentsCrossStrict(a: Point, b: Point, c: Point, d: Point): boolean {
  if (
    Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
    Math.min(a.x, b.x) > Math.max(c.x, d.x) ||
    Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
    Math.min(a.y, b.y) > Math.max(c.y, d.y)
  ) {
    return false
  }
  const d1 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const d2 = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x)
  if (d1 * d2 >= -1e-6) return false
  const d3 = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x)
  const d4 = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x)
  return d3 * d4 < -1e-6
}

function polylinesCross(a: readonly Point[], b: readonly Point[]): boolean {
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) {
      if (segmentsCrossStrict(a[i], a[i + 1], b[j], b[j + 1])) return true
    }
  }
  return false
}

function pointToSegDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

function minPolylineDistance(a: readonly Point[], b: readonly Point[]): number {
  let min = Infinity
  for (const p of a) {
    for (let j = 0; j + 1 < b.length; j++) {
      const d = pointToSegDist(p, b[j], b[j + 1])
      if (d < min) min = d
    }
  }
  for (const p of b) {
    for (let i = 0; i + 1 < a.length; i++) {
      const d = pointToSegDist(p, a[i], a[i + 1])
      if (d < min) min = d
    }
  }
  return min
}

function segmentHitsBoxTest(a: Point, b: Point, box: Box): boolean {
  if (
    Math.max(a.x, b.x) < box.x0 ||
    Math.min(a.x, b.x) > box.x1 ||
    Math.max(a.y, b.y) < box.y0 ||
    Math.min(a.y, b.y) > box.y1
  ) {
    return false
  }
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  return clip(-dx, a.x - box.x0) && clip(dx, box.x1 - a.x) && clip(-dy, a.y - box.y0) && clip(dy, box.y1 - a.y) && t0 <= t1
}

function boxesOverlapTest(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
}

function approxPillBox(label: string, x: number, y: number, maxWidth?: number): Box {
  let width = 16
  for (const ch of label.trim()) width += ch.charCodeAt(0) > 127 ? 11.2 : 6.4
  const w = Math.max(40, Math.min(maxWidth ?? PILL_MAX_WIDTH, width))
  return { x0: x - w / 2, y0: y - 11, x1: x + w / 2, y1: y + 11 }
}

test('014 SC-003 双向斜线（水平与垂直）0 交叉且净空 >= 16px，慢速拖拽跨临界翻转 <= 1 次', () => {
  // 水平双向斜线：标准 91px 列距（327 - 236 = 91）下 dy ∈ [24, 162]
  for (const dy of [24, 48, 60, 120, 162]) {
    for (const sign of [1, -1]) {
      const nodes = { a: card(66, 260, 236, 130), b: card(393, 260 + sign * dy, 236, 130) }
      const res = createConnections(nodes, [edge('ab', 'a', 'b'), edge('ba', 'b', 'a')])
      const p0 = samplePathPoints(res.segments[0].d, 40)
      const p1 = samplePathPoints(res.segments[1].d, 40)
      assert.equal(polylinesCross(p0, p1), false, `水平双向 dy=${sign * dy} 不应交叉`)
      const dist = minPolylineDistance(p0, p1)
      assert.ok(dist >= 16, `水平双向 dy=${sign * dy} 最小间距 ${dist.toFixed(2)} < 16`)
    }
  }

  // 垂直双向斜线：dx = +200（及对称 -200）
  for (const dx of [200, -200]) {
    const nodes = { a: card(300, 110, 236, 88), b: card(300 + dx, 300, 236, 88) }
    const res = createConnections(nodes, [edge('ab', 'a', 'b'), edge('ba', 'b', 'a')])
    const p0 = samplePathPoints(res.segments[0].d, 40)
    const p1 = samplePathPoints(res.segments[1].d, 40)
    assert.equal(polylinesCross(p0, p1), false, `垂直双向 dx=${dx} 不应交叉`)
    const dist = minPolylineDistance(p0, p1)
    assert.ok(dist >= 16, `垂直双向 dx=${dx} 最小间距 ${dist.toFixed(2)} < 16`)
  }

  // 慢速拖拽跨越 dy = 0 临界区：正反向各最多翻转 1 次且具备滞回区间
  const bidirEdges = [edge('ab', 'a', 'b'), edge('ba', 'b', 'a')]
  const runSweep = (from: number, to: number) => {
    const step = from < to ? 2 : -2
    let hints: ReadonlyMap<string, EdgeRouteHint> | undefined
    let switches = 0
    let prev: boolean | undefined
    for (let dy = from; step > 0 ? dy <= to : dy >= to; dy += step) {
      const res = createConnections({ a: card(66, 260, 236, 130), b: card(393, 260 + dy, 236, 130) }, bidirEdges, undefined, {
        hints,
        dragging: true,
      })
      hints = res.hints
      const abPortY = res.segments[0].source.y
      const baPortY = res.segments[1].target.y
      const state = abPortY > baPortY
      if (prev !== undefined && state !== prev) switches++
      prev = state
    }
    return switches
  }
  assert.ok(runSweep(60, -60) <= 1)
  assert.ok(runSweep(-60, 60) <= 1)
})

test('014 SC-003 同向面对面平行斜线（四向）中段分离净空 >= 14px 且 0 交叉', () => {
  const cases: { name: string; nodes: Record<string, Rect> }[] = [
    { name: '左到右斜下', nodes: { a: card(66, 110, 236, 130), b: card(393, 272, 236, 130) } },
    { name: '右到左斜上', nodes: { a: card(393, 272, 236, 130), b: card(66, 110, 236, 130) } },
    { name: '上到下斜右', nodes: { a: card(66, 110, 236, 88), b: card(266, 300, 236, 88) } },
    { name: '下到上斜左', nodes: { a: card(266, 300, 236, 88), b: card(66, 110, 236, 88) } },
  ]
  for (const item of cases) {
    const res = createConnections(item.nodes, [
      edge('e1', 'a', 'b', { type: 'dependency' }),
      edge('e2', 'a', 'b', { type: 'supplement' }),
    ])
    const p0 = samplePathPoints(res.segments[0].d, 40)
    const p1 = samplePathPoints(res.segments[1].d, 40)
    assert.equal(polylinesCross(p0, p1), false, `${item.name} 平行斜线不应交叉`)
    const dist = minPolylineDistance(p0, p1)
    assert.ok(dist >= 14, `${item.name} 最小间距 ${dist.toFixed(2)} < 14`)
  }
})

test('014 SC-003 同端嵌套外侧拱桥 0 交叉分层且外层高于内层，阶梯窄分组外侧拱桥不被远处宽组误杀', () => {
  const nestedNodes = {
    l1: card(66, 110),
    l2: card(66, 272),
    r1: card(393, 110),
    r2: card(393, 272),
    r3: card(393, 434),
    r4: card(393, 596),
    r5: card(393, 758),
  }
  const nested = createConnections(nestedNodes, [edge('short', 'r1', 'r3'), edge('long', 'r1', 'r5')])
  const [innerSeg, outerSeg] = nested.segments
  assert.equal(innerSeg.source.side, 'right')
  assert.equal(outerSeg.source.side, 'right')
  assert.ok((outerSeg.archLane ?? 0) > (innerSeg.archLane ?? 0), '外层长拱桥应分配更高轨道')
  const innerPts = samplePathPoints(innerSeg.d, 40)
  const outerPts = samplePathPoints(outerSeg.d, 40)
  assert.equal(polylinesCross(innerPts, outerPts), false, '同端嵌套拱桥不得交叉')
  const dist = minPolylineDistance(innerPts, outerPts)
  assert.ok(dist >= 6, `嵌套拱桥净空 ${dist.toFixed(2)} < 6`)
  assert.ok(
    Math.max(...outerPts.map(p => p.x)) > Math.max(...innerPts.map(p => p.x)),
    '外层拱桥拱顶应严格高于内层',
  )

  // 阶梯窄分组场景：上方宽组占 col 0/1/2，下方窄组仅占 col 0/1，下方 col 1 外侧拱桥不应被上方远处 col 2 误杀
  const staircase = {
    w1: card(66, 110),
    w2: card(393, 110),
    w3: card(720, 110),
    n1: card(66, 360),
    n2: card(393, 360),
    n3: card(393, 520),
    n4: card(393, 680),
  }
  const stairRes = createConnections(staircase, [edge('skip', 'n2', 'n4')])
  assert.equal(stairRes.segments[0].source.side, 'right')
  assert.equal(stairRes.segments[0].target.side, 'right')
  assert.equal(stairRes.hints.get('skip')?.archActive, true)
})

test('014 SC-003 顶拱标题护栏 min_y > group.y + 34、左拱画布左缘 >= 10 且田字右列左拱不侵入左列分组', () => {
  // 1) 首行单行分组下方空旷时优先下拱，避免压顶标题
  const singleGroup: Rect[] = [{ x: 42, y: 48, width: 938, height: 178 }]
  const singleRow = { a: card(66, 110), m: card(393, 110), b: card(720, 110) }
  const preferBottom = createConnections(singleRow, [edge('ab', 'a', 'b')], undefined, { groups: singleGroup })
  assert.equal(preferBottom.segments[0].source.side, 'bottom')

  // 2) 下方存在第二行卡片迫使走顶拱时，全曲线采样 min_y > group.y + 34
  const twoRowGroup: Rect[] = [{ x: 42, y: 48, width: 938, height: 340 }]
  const twoRows = {
    a: card(66, 110),
    m: card(393, 110),
    b: card(720, 110),
    d1: card(66, 272),
    d2: card(393, 272),
    d3: card(720, 272),
  }
  const topArchRes = createConnections(twoRows, [edge('ab', 'a', 'b')], undefined, { groups: twoRowGroup })
  assert.equal(topArchRes.segments[0].source.side, 'top')
  const topPts = samplePathPoints(topArchRes.segments[0].d, 40)
  const minY = Math.min(...topPts.map(p => p.y))
  assert.ok(minY > twoRowGroup[0].y + 34, `顶拱 min_y=${minY.toFixed(2)} 压近分组标题`)

  // 3) 视图最左列左拱不越出画布左缘（min_x >= 10）
  const leftEdgeNodes = {
    a: card(66, 110),
    m: card(66, 272),
    b: card(66, 434),
    r: card(393, 272),
  }
  const leftArchRes = createConnections(leftEdgeNodes, [edge('ab', 'a', 'b')], undefined, {
    groups: [{ x: 42, y: 48, width: 611, height: 500 }],
  })
  assert.equal(leftArchRes.segments[0].source.side, 'left')
  const leftPts = samplePathPoints(leftArchRes.segments[0].d, 40)
  const minX = Math.min(...leftPts.map(p => p.x))
  assert.ok(minX >= 10 - 1e-6, `左拱 min_x=${minX.toFixed(2)} < 10`)

  // 4) 田字双列右列左拱不侵入左侧相邻分组框/标题（min_x >= leftGroupRight + 6）
  const gridGroups: Rect[] = [
    { x: 42, y: 48, width: 611, height: 500 },
    { x: 701, y: 48, width: 611, height: 500 },
  ]
  const gridRightNodes = {
    a: card(725, 110),
    m: card(725, 272),
    b: card(725, 434),
    r: card(1052, 272),
  }
  const gridLeftArch = createConnections(gridRightNodes, [edge('ab', 'a', 'b')], undefined, { groups: gridGroups })
  assert.equal(gridLeftArch.segments[0].source.side, 'left')
  const gridPts = samplePathPoints(gridLeftArch.segments[0].d, 40)
  const gridMinX = Math.min(...gridPts.map(p => p.x))
  const leftGroupRight = gridGroups[0].x + gridGroups[0].width
  assert.ok(gridMinX >= leftGroupRight + 6 - 1e-6, `右列左拱 min_x=${gridMinX.toFixed(2)} 侵入左列组右界 ${leftGroupRight}`)
})

test('014 SC-004 8 边多组标注场景（交叉斜线 + 91px 短横边 + 32px 短竖边）胶囊四维零冲突', () => {
  const nodes: Record<string, Rect> = {
    u1: card(66, 110, 236, 130),
    u2: card(393, 110, 236, 130),
    u3: card(720, 110, 236, 130),
    u1b: card(66, 272, 236, 130), // 与 u1 形成精确 32px 竖向短边
    d1: card(66, 520, 236, 130),
    d2: card(393, 520, 236, 130),
    d3: card(720, 520, 236, 130),
  }
  const edges = [
    // 4 条交叉跨组斜线
    edge('diag1', 'u1b', 'd2', { label: '驱动' }),
    edge('diag2', 'u2', 'd1', { label: '约束' }),
    edge('diag3', 'u2', 'd3', { label: '演化' }),
    edge('diag4', 'u3', 'd2', { label: '反馈' }),
    // 3 条 91px 水平短边
    edge('sh1', 'u1', 'u2', { label: '前置条件链' }),
    edge('sh2', 'u2', 'u3', { label: '直接推导链' }),
    edge('sh3', 'd1', 'd2', { label: '结论延续链' }),
    // 1 条 32px 竖向短边
    edge('sv1', 'u1', 'u1b', { label: '细分' }),
  ]
  const res = createConnections(nodes, edges)
  const cardList = Object.values(nodes)

  // 构造每条边的 3 段弦与全部端口/箭头保护盒
  const chords = res.segments.map(seg => {
    const pts = samplePathPoints(seg.d, 3)
    return [
      [pts[0], pts[1]],
      [pts[1], pts[2]],
      [pts[2], pts[3]],
    ] as [Point, Point][]
  })
  const portBoxes: Box[] = []
  for (const seg of res.segments) {
    portBoxes.push({
      x0: seg.source.x - PILL_PORT_MARGIN,
      y0: seg.source.y - PILL_PORT_MARGIN,
      x1: seg.source.x + PILL_PORT_MARGIN,
      y1: seg.source.y + PILL_PORT_MARGIN,
    })
    const ut = sideNormal(seg.target.side)
    const ex = seg.target.x + ut.x * 4
    const ey = seg.target.y + ut.y * 4
    const bx = ex + ut.x * ARROW_LENGTH
    const by = ey + ut.y * ARROW_LENGTH
    const c1x = bx - ut.y * ARROW_HALF_WIDTH
    const c1y = by + ut.x * ARROW_HALF_WIDTH
    const c2x = bx + ut.y * ARROW_HALF_WIDTH
    const c2y = by - ut.x * ARROW_HALF_WIDTH
    portBoxes.push({
      x0: Math.min(seg.target.x - 4, ex, c1x, c2x) - PILL_PORT_MARGIN,
      y0: Math.min(seg.target.y - 4, ey, c1y, c2y) - PILL_PORT_MARGIN,
      x1: Math.max(seg.target.x + 4, ex, c1x, c2x) + PILL_PORT_MARGIN,
      y1: Math.max(seg.target.y + 4, ey, c1y, c2y) + PILL_PORT_MARGIN,
    })
  }

  const pillBoxes = res.segments.map(seg =>
    approxPillBox(seg.relation.label!, seg.label.x, seg.label.y, seg.label.maxWidth),
  )

  for (let i = 0; i < res.segments.length; i++) {
    const seg = res.segments[i]
    const box = pillBoxes[i]
    // 1) 不压任意外扩 4px 卡片
    for (const c of cardList) {
      const exp: Box = {
        x0: c.x - PILL_CARD_MARGIN,
        y0: c.y - PILL_CARD_MARGIN,
        x1: c.x + c.width + PILL_CARD_MARGIN,
        y1: c.y + c.height + PILL_CARD_MARGIN,
      }
      assert.equal(boxesOverlapTest(box, exp), false, `胶囊 ${seg.relation.id} 压卡`)
    }
    // 2) 不压其他已放胶囊
    for (let j = i + 1; j < pillBoxes.length; j++) {
      assert.equal(boxesOverlapTest(box, pillBoxes[j]), false, `胶囊 ${seg.relation.id} 与 ${res.segments[j].relation.id} 重叠`)
    }
    // 3) 不压其他连线弦
    for (let j = 0; j < chords.length; j++) {
      if (j === i) continue
      for (const [a, b] of chords[j]) {
        assert.equal(segmentHitsBoxTest(a, b, box), false, `胶囊 ${seg.relation.id} 压他线 ${res.segments[j].relation.id}`)
      }
    }
    // 4) 不压全部端口与箭头保护盒
    for (const pb of portBoxes) {
      assert.equal(boxesOverlapTest(box, pb), false, `胶囊 ${seg.relation.id} 压端口/箭头`)
    }
  }

  // 3 条 91px 水平短边输出自适应收窄 maxWidth 且居中于边框净空
  for (const id of ['sh1', 'sh2', 'sh3']) {
    const seg = res.segments.find(s => s.relation.id === id)!
    assert.equal(seg.label.maxWidth, 73)
    const gapMid = (seg.source.x + seg.target.x) / 2
    assert.ok(Math.abs(seg.label.x - gapMid) < 1e-6)
  }

  // 32px 竖向短边停靠走廊侧鞍
  const sv = res.segments.find(s => s.relation.id === 'sv1')!
  const shaftX = (sv.source.x + sv.target.x) / 2
  assert.ok(Math.abs(sv.label.x - shaftX) >= SIDE_SADDLE_GAP, '竖向短边胶囊应停靠侧鞍走廊')
})

test('014 SC-006 40 节点 / 65 边单次 createConnections 耗时远低于 16ms 帧预算', () => {
  const nodes: Record<string, Rect> = {}
  for (let i = 0; i < 40; i++) nodes[`n${i}`] = card((i % 8) * 327, Math.floor(i / 8) * 180, 236, 88 + (i % 4) * 30)
  const edges = Array.from({ length: 65 }, (_, i) =>
    edge(`e${i}`, `n${i % 40}`, `n${(i * 7 + 3) % 40}`, i % 3 === 0 ? { label: `关系${i}` } : {}),
  )
  // 预热消除首次 JIT 编译噪声后测量单次拖拽帧调用
  createConnections(nodes, edges)
  const started = performance.now()
  const res = createConnections(nodes, edges)
  const elapsed = performance.now() - started
  assert.equal(res.segments.length, 65)
  assert.ok(elapsed < 16, `单次 createConnections 耗时 ${elapsed.toFixed(2)}ms >= 16ms`)
})
