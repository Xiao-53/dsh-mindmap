import type { Port, Rect } from './edge-geometry.ts'

// 精简连线路由：局部 O(E) 几何，不做全局采样避让；一般斜向连线允许从无关卡片下层穿过。
export const SINGLE_SIDE_TOP_OFFSET = 43
export const PORT_INSET_Y = 18
export const PORT_INSET_X = 20
export const STRAIGHT_DEADZONE = 16
export const MIN_STRAIGHT_SPAN = 24
export const MAX_BEZIER_HANDLE = 110
export const MAX_ARCH_HANDLE = 148
export const HEAD_ON_ENTER_DEPTH = 18
export const HEAD_ON_EXIT_DEPTH = 6
export const ARCH_HYSTERESIS = 24
export const PILL_MAX_WIDTH = 132
export const PILL_HEIGHT = 22
export const PILL_CARD_MARGIN = 4
export const PILL_CANDIDATE_T: readonly number[] = [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8]

const INPUT_PORT_OUTER_RADIUS = 4
const ARROW_LENGTH = 8
const ARROW_HALF_WIDTH = 3.5
const STEM_LENGTH = 3
const ARCH_NEIGHBOR_COST = 16

export interface Point {
  x: number
  y: number
}

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export type Cubic = readonly [Point, Point, Point, Point]

export interface EdgeCurve {
  kind: 'straight' | 'cubic' | 'self'
  segments: readonly Cubic[]
  d: string
  defaultLabel: Point
}

export interface PortEndpoints {
  ps: Point
  pe: Point
  us: Point
  ut: Point
  arrow: string
  stem: string
}

export interface EdgeRouteHint {
  sourceSide: Port['side']
  targetSide: Port['side']
  archActive?: boolean
}

export interface RoutingOptions {
  hints?: ReadonlyMap<string, EdgeRouteHint>
  dragging?: boolean
  outHints?: Map<string, EdgeRouteHint>
}

export interface RoutedSegment {
  relation: { id: string; fromNodeId: string; toNodeId: string; type: string; label?: string }
  source: Port
  target: Port
  vertical: boolean
  self: boolean
  archClearance?: number
  d: string
  arrow: string
  stem: string
  label: Point
}

export interface InlineArchSpec {
  relation: RoutedSegment['relation']
  fromNodeId: string
  toNodeId: string
  sourceSide: Port['side']
  targetSide: Port['side']
  vertical: boolean
  self: boolean
  edgeIndex: number
  archClearance?: number
}

export type PlacedPillBox = Box

function finite(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback
  if (Math.abs(value) < 1e-9) return 0
  return value
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (min > max) return min
  return Math.max(min, Math.min(max, value))
}

function sanitizePoint(p: Point): Point {
  return { x: finite(p.x), y: finite(p.y) }
}

export function sideNormal(side: Port['side']): Point {
  switch (side) {
    case 'left':
      return { x: -1, y: 0 }
    case 'right':
      return { x: 1, y: 0 }
    case 'top':
      return { x: 0, y: -1 }
    case 'bottom':
      return { x: 0, y: 1 }
  }
}

// 默认沿目标端口外法线对接输入圆外沿；直线模式沿 straightDir 顺线对接，箭头、短接段与线条共线。
export function computePortEndpoints(a: Port, b: Port, straightDir?: Point): PortEndpoints {
  const us = sideNormal(a.side)
  const ut = straightDir ? { x: finite(-straightDir.x), y: finite(-straightDir.y) } : sideNormal(b.side)
  const ps = sanitizePoint(a)
  const ex = finite(finite(b.x) + ut.x * INPUT_PORT_OUTER_RADIUS)
  const ey = finite(finite(b.y) + ut.y * INPUT_PORT_OUTER_RADIUS)
  const bx = finite(ex + ut.x * ARROW_LENGTH)
  const by = finite(ey + ut.y * ARROW_LENGTH)
  const pe = { x: finite(bx + ut.x * STEM_LENGTH), y: finite(by + ut.y * STEM_LENGTH) }
  const arrow = `M${ex} ${ey} L${finite(bx - ut.y * ARROW_HALF_WIDTH)} ${finite(by + ut.x * ARROW_HALF_WIDTH)} L${finite(bx + ut.y * ARROW_HALF_WIDTH)} ${finite(by - ut.x * ARROW_HALF_WIDTH)} Z`
  const stem = `M${pe.x} ${pe.y} L${bx} ${by}`
  return { ps, pe, us, ut, arrow, stem }
}

function evalCubicPoint([p0, p1, p2, p3]: Cubic, t: number): Point {
  const u = 1 - t
  return {
    x: finite(u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x),
    y: finite(u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y),
  }
}

// 直线、单段曲线与自环共用的 O(1) 求值；t 按段数均分。
export function evalCurvePoint(curve: Pick<EdgeCurve, 'segments'>, t: number): Point {
  const n = curve.segments.length
  if (!n) return { x: 0, y: 0 }
  const scaled = clamp(finite(t), 0, 1) * n
  const index = Math.min(n - 1, Math.floor(scaled))
  return evalCubicPoint(curve.segments[index], scaled - index)
}

function formatCubics(segments: readonly Cubic[]): string {
  const first = segments[0][0]
  let out = `M${finite(first.x)} ${finite(first.y)}`
  for (const [, p1, p2, p3] of segments) {
    out += ` C${finite(p1.x)} ${finite(p1.y)} ${finite(p2.x)} ${finite(p2.y)} ${finite(p3.x)} ${finite(p3.y)}`
  }
  return out
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: finite(a.x + (b.x - a.x) * t), y: finite(a.y + (b.y - a.y) * t) }
}

function straightCurve(ps: Point, pe: Point): EdgeCurve {
  const segment: Cubic = [ps, lerp(ps, pe, 1 / 3), lerp(ps, pe, 2 / 3), pe]
  return { kind: 'straight', segments: [segment], d: `M${ps.x} ${ps.y} L${pe.x} ${pe.y}`, defaultLabel: lerp(ps, pe, 0.5) }
}

function selfCurve(ps: Point, pe: Point, us: Point, ut: Point): EdgeCurve {
  const perp = { x: -us.y, y: us.x }
  const dPerp = (pe.x - ps.x) * perp.x + (pe.y - ps.y) * perp.y
  const sign = dPerp >= 0 ? 1 : -1
  const loopOut = Math.max(46, Math.abs(dPerp) * 0.9 + 34)
  const archHalfH = Math.max(26, Math.abs(dPerp) * 0.5 + 18)
  const outS = ps.x * us.x + ps.y * us.y
  const outE = pe.x * us.x + pe.y * us.y
  const baseOut = Math.max(outS, outE)
  const midPerp = (ps.x * perp.x + ps.y * perp.y + (pe.x * perp.x + pe.y * perp.y)) / 2
  const apex: Point = {
    x: finite((baseOut + loopOut) * us.x + midPerp * perp.x),
    y: finite((baseOut + loopOut) * us.y + midPerp * perp.y),
  }
  const hs = Math.max(24, (baseOut + loopOut - outS) * 0.85)
  const he = Math.max(24, (baseOut + loopOut - outE) * 0.85)
  const first: Cubic = [
    ps,
    { x: finite(ps.x + hs * us.x), y: finite(ps.y + hs * us.y) },
    { x: finite(apex.x - sign * archHalfH * perp.x), y: finite(apex.y - sign * archHalfH * perp.y) },
    apex,
  ]
  const second: Cubic = [
    apex,
    { x: finite(apex.x + sign * archHalfH * perp.x), y: finite(apex.y + sign * archHalfH * perp.y) },
    { x: finite(pe.x + he * ut.x), y: finite(pe.y + he * ut.y) },
    pe,
  ]
  const segments: readonly Cubic[] = [first, second]
  return { kind: 'self', segments, d: formatCubics(segments), defaultLabel: apex }
}

// 非自环严格至多一段：面对面小错位拉直，其余为首末锁定端口外法线的限幅三次贝塞尔。
export function buildEdgeCurve(
  a: Port,
  b: Port,
  self = false,
  archClearance?: number,
): { curve: EdgeCurve; straightDir?: Point } {
  const base = computePortEndpoints(a, b)
  const { ps, pe, us, ut } = base
  if (self) return { curve: selfCurve(ps, pe, us, ut) }

  const dotN = us.x * ut.x + us.y * ut.y
  if (dotN < -0.5) {
    const abx = finite(b.x) - finite(a.x)
    const aby = finite(b.y) - finite(a.y)
    const length = Math.hypot(abx, aby)
    const along = abx * us.x + aby * us.y
    const across = Math.abs(abx * -us.y + aby * us.x)
    if (length > 1e-6 && along >= MIN_STRAIGHT_SPAN && across <= STRAIGHT_DEADZONE) {
      const straightDir = { x: abx / length, y: aby / length }
      const line = computePortEndpoints(a, b, straightDir)
      return { curve: straightCurve(line.ps, line.pe), straightDir }
    }
  }

  const dx = pe.x - ps.x
  const dy = pe.y - ps.y
  const perp = { x: -us.y, y: us.x }
  let hs: number
  let he: number
  if (dotN < -0.5) {
    const dParallel = dx * us.x + dy * us.y
    const dPerp = Math.abs(dx * perp.x + dy * perp.y)
    hs = he =
      dParallel >= MIN_STRAIGHT_SPAN
        ? clamp(dParallel * 0.42, 24, MAX_BEZIER_HANDLE)
        : clamp(32 + Math.sqrt(Math.abs(dParallel) * 18) + dPerp * 0.15, 42, 120)
  } else if (dotN > 0.5) {
    const dOut = dx * us.x + dy * us.y
    const lPerp = Math.abs(dx * perp.x + dy * perp.y)
    const a0 = clamp(0.18 * lPerp + 26, 36, 92)
    const baseH =
      archClearance === undefined ? a0 : Math.min(MAX_ARCH_HANDLE, Math.max(a0, (4 / 3) * (archClearance + 14)))
    hs = baseH + Math.max(0, dOut)
    he = baseH + Math.max(0, -dOut)
  } else {
    const length = Math.hypot(dx, dy)
    const pS = Math.max(0, dx * us.x + dy * us.y)
    const pT = Math.max(0, -(dx * ut.x + dy * ut.y))
    hs = clamp(Math.max(0.55 * pS, 0.25 * length), 22, MAX_BEZIER_HANDLE)
    he = clamp(Math.max(0.55 * pT, 0.25 * length), 22, MAX_BEZIER_HANDLE)
  }
  const segment: Cubic = [
    ps,
    { x: finite(ps.x + hs * us.x), y: finite(ps.y + hs * us.y) },
    { x: finite(pe.x + he * ut.x), y: finite(pe.y + he * ut.y) },
    pe,
  ]
  return {
    curve: { kind: 'cubic', segments: [segment], d: formatCubics([segment]), defaultLabel: evalCubicPoint(segment, 0.5) },
  }
}

interface AxisSpan {
  m0: number
  m1: number
  c0: number
  c1: number
}

const axisSpan = (r: Rect, horizontal: boolean): AxisSpan =>
  horizontal
    ? { m0: r.x, m1: r.x + r.width, c0: r.y, c1: r.y + r.height }
    : { m0: r.y, m1: r.y + r.height, c0: r.x, c1: r.x + r.width }

// 估算该卡片面对面端口的横截轴位置：左右侧沿用距顶基准，上下侧取中线。
const estimatedCross = (r: Rect, horizontal: boolean): number => {
  if (!horizontal) return r.x + r.width / 2
  const inset = Math.min(r.height / 4, PORT_INSET_Y)
  return r.y + clamp(SINGLE_SIDE_TOP_OFFSET, inset, r.height - inset)
}

// 仅在同排/同列面对面直连被中间卡正面深度直挡时换为同侧拱桥；全程纯矩形区间比较，不做曲线采样。
export function selectInlineBlockedSides(
  specs: InlineArchSpec[],
  nodes: Record<string, Rect>,
  options?: RoutingOptions,
): void {
  const dragging = Boolean(options?.dragging)
  const hints = options?.hints
  const entries = Object.entries(nodes)

  for (const spec of specs) {
    if (spec.self) continue
    const horizontal =
      (spec.sourceSide === 'right' && spec.targetSide === 'left') ||
      (spec.sourceSide === 'left' && spec.targetSide === 'right')
    const vertical =
      (spec.sourceSide === 'bottom' && spec.targetSide === 'top') ||
      (spec.sourceSide === 'top' && spec.targetSide === 'bottom')
    if (!horizontal && !vertical) continue
    const rectA = nodes[spec.fromNodeId]
    const rectB = nodes[spec.toNodeId]
    if (!rectA || !rectB) continue

    const a = axisSpan(rectA, horizontal)
    const b = axisSpan(rectB, horizontal)
    const crossOverlap = Math.min(a.c1, b.c1) - Math.max(a.c0, b.c0)
    const crossDiff = Math.abs((a.c0 + a.c1) / 2 - (b.c0 + b.c1) / 2)
    if (crossOverlap < 0 && crossDiff > 0.5 * Math.min(a.c1 - a.c0, b.c1 - b.c0)) continue

    const aFirst = a.m0 <= b.m0
    const first = aFirst ? a : b
    const second = aFirst ? b : a
    const lo = first.m1
    const hi = second.m0
    if (hi <= lo) continue
    const crossFirst = estimatedCross(aFirst ? rectA : rectB, horizontal)
    const crossSecond = estimatedCross(aFirst ? rectB : rectA, horizontal)
    const lineAt = (m: number) => crossFirst + ((crossSecond - crossFirst) * (clamp(m, lo, hi) - lo)) / (hi - lo)

    const prev = hints?.get(spec.relation.id)
    const relaxed = dragging && prev?.archActive === true
    const between: AxisSpan[] = []
    let blocked = false
    for (const [id, rect] of entries) {
      if (id === spec.fromNodeId || id === spec.toNodeId) continue
      const o = axisSpan(rect, horizontal)
      const center = (o.m0 + o.m1) / 2
      if (center <= lo || center >= hi) continue
      between.push(o)
      let depth = 0
      for (const m of [o.m0, center, o.m1]) {
        const y = lineAt(m)
        depth = Math.max(depth, Math.min(y - o.c0, o.c1 - y))
      }
      const enter = Math.min(HEAD_ON_ENTER_DEPTH, 0.25 * (o.c1 - o.c0))
      if (depth >= (relaxed ? Math.min(HEAD_ON_EXIT_DEPTH, enter) : enter)) blocked = true
    }
    if (!blocked) continue

    const corridorMin = Math.min(a.c0, b.c0)
    const corridorMax = Math.max(a.c1, b.c1)
    const sides: readonly Port['side'][] = horizontal ? ['top', 'bottom'] : ['left', 'right']
    let best: { side: Port['side']; clearance: number; score: number } | undefined
    for (const side of sides) {
      const low = side === 'top' || side === 'left'
      // 仅允许在导图外侧边缘且拱桥那一侧外部没有任何其他卡片时走同侧拱桥，防止内部列/行绕行引发多余交叉。
      const hasOuterCard = entries.some(([id, rect]) => {
        if (id === spec.fromNodeId || id === spec.toNodeId) return false
        const o = axisSpan(rect, horizontal)
        const center = (o.c0 + o.c1) / 2
        return low ? center < corridorMin : center > corridorMax
      })
      if (hasOuterCard) continue
      const portLevel = low ? corridorMin : corridorMax
      const protruding = between.filter(o => (low ? o.c0 < portLevel : o.c1 > portLevel))
      const clearance = protruding.reduce((max, o) => Math.max(max, low ? portLevel - o.c0 : o.c1 - portLevel), 0)
      const hysteresis = dragging && prev?.archActive === true && prev.sourceSide !== side ? ARCH_HYSTERESIS : 0
      const score = clearance + ARCH_NEIGHBOR_COST * protruding.length + hysteresis
      if (!best || score < best.score) best = { side, clearance, score }
    }
    if (!best) continue
    spec.sourceSide = best.side
    spec.targetSide = best.side
    spec.archClearance = best.clearance
  }
}

function overlapArea(a: Box, b: Box): number {
  const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return ox > 0 && oy > 0 ? ox * oy : 0
}

// 沿线 7 点探测首个避开卡片与已放胶囊的位置；全部压卡（极短边）时回退居中。
export function pickPillAnchor(
  curve: Pick<EdgeCurve, 'segments' | 'defaultLabel'>,
  labelText: string | undefined,
  rects: readonly Rect[],
  placedPills?: PlacedPillBox[],
): Point {
  const text = labelText?.trim()
  if (!text || !curve.segments.length) return curve.defaultLabel
  let estWidth = 0
  for (const ch of text) estWidth += (ch.codePointAt(0) ?? 0) > 0xff ? 11 : 6.5
  const halfW = clamp(estWidth + 18, 36, PILL_MAX_WIDTH) / 2
  const halfH = PILL_HEIGHT / 2
  const cards: Box[] = rects.map(r => ({
    x0: r.x - PILL_CARD_MARGIN,
    y0: r.y - PILL_CARD_MARGIN,
    x1: r.x + r.width + PILL_CARD_MARGIN,
    y1: r.y + r.height + PILL_CARD_MARGIN,
  }))
  const boxAt = (p: Point): Box => ({ x0: p.x - halfW, y0: p.y - halfH, x1: p.x + halfW, y1: p.y + halfH })

  let pick: { point: Point; box: Box } | undefined
  let bestArea = Infinity
  for (const t of PILL_CANDIDATE_T) {
    const point = evalCurvePoint(curve, t)
    const box = boxAt(point)
    if (cards.some(card => overlapArea(box, card) > 0)) continue
    const area = placedPills ? placedPills.reduce((sum, placed) => sum + overlapArea(box, placed), 0) : 0
    if (area < bestArea) {
      bestArea = area
      pick = { point, box }
    }
    if (area === 0) break
  }
  if (!pick) {
    const point = evalCurvePoint(curve, 0.5)
    pick = { point, box: boxAt(point) }
  }
  placedPills?.push(pick.box)
  return sanitizePoint(pick.point)
}
