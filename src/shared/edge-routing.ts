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
export const PILL_CANDIDATE_T: readonly number[] = [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8, 0.14, 0.86]

// 014 局部路由精修常量：双向斜线滞回、彩虹拱桥分层、跨度感知外卡、平行偏置、顶/左护栏与短边胶囊。
export const BIDIR_SLOPE_ENTER = 24
export const BIDIR_SLOPE_EXIT = 12
export const ARCH_LANE_STEP = 24
export const MAX_ARCH_LANE_HANDLE = 180
export const ARCH_LANE_SPAN_MARGIN = 8
export const OUTER_SPAN_MARGIN = 16
export const PARALLEL_BIAS_MIN_PERP = 32
export const PARALLEL_BIAS_MAX = 18
export const TOP_ARCH_GROUP_PROXIMITY = 80
export const TOP_ARCH_GROUP_PENALTY = 60
export const TOP_ARCH_TITLE_CLEARANCE = 36
export const CANVAS_TOP_ARCH_MARGIN = 14
export const CANVAS_LEFT_ARCH_MARGIN = 10
export const PILL_PORT_MARGIN = 5
export const SHORT_HORIZ_MIN_SPAN = 40
export const SHORT_HORIZ_MAX_SPAN = 120
export const SHORT_VERT_MAX_SPAN = 60
export const SIDE_SADDLE_GAP = 10

const INPUT_PORT_OUTER_RADIUS = 4
const ARROW_LENGTH = 8
const ARROW_HALF_WIDTH = 3.5
const STEM_LENGTH = 3
const ARCH_NEIGHBOR_COST = 16
const ARCH_RAIL_PROXIMITY = 120

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
  bidirFlipped?: boolean
}

export interface RoutingOptions {
  hints?: ReadonlyMap<string, EdgeRouteHint>
  dragging?: boolean
  outHints?: Map<string, EdgeRouteHint>
  groups?: readonly Rect[]
}

export interface PillPlacement extends Point {
  maxWidth?: number
}

export interface PillPlacementOptions {
  otherChords?: readonly (readonly [Point, Point, Point, Point])[]
  portBoxes?: readonly Box[]
  sourcePort?: Port
  targetPort?: Port
  edgeId?: string
}

export interface BuildEdgeCurveOptions {
  archLane?: number
  hsBias?: number
  heBias?: number
  groups?: readonly Rect[]
  sourceRect?: Rect
  targetRect?: Rect
}

export interface RoutedSegment {
  relation: { id: string; fromNodeId: string; toNodeId: string; type: string; label?: string }
  source: Port
  target: Port
  vertical: boolean
  self: boolean
  archClearance?: number
  archLane?: number
  hsBias?: number
  heBias?: number
  bidirFlipped?: boolean
  d: string
  arrow: string
  stem: string
  label: PillPlacement
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
  archLane?: number
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

function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height
}

function findContainingGroup(rect: Rect, groups?: readonly Rect[]): Rect | undefined {
  if (!groups?.length) return undefined
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  return groups.find(g => pointInRect(cx, cy, g))
}

// 对 top/left 外拱桥反解最大允许 baseH，并用三次贝塞尔真实极值精校，确保整条曲线严格不越过安全护栏 ceil。
function clampArchBaseH(pS: number, pE: number, baseH: number, ceil: number): number {
  const minP = Math.min(pS, pE)
  let hMax = Math.max(18, (pS + pE + 6 * minP - 8 * ceil) / 6)
  if (baseH < hMax) hMax = baseH
  for (let iter = 0; iter < 3; iter++) {
    const c = minP - hMax
    const a1 = pS - c
    const b1 = pE - c
    const denom = Math.sqrt(Math.max(0, a1)) + Math.sqrt(Math.max(0, b1))
    const exactMin = denom > 1e-9 ? c + (a1 * b1) / (denom * denom) : minP
    if (exactMin >= ceil || hMax <= 18) break
    hMax = Math.max(18, hMax - (ceil - exactMin) * 1.4)
  }
  return Math.min(baseH, hMax)
}

function resolveTopArchCeil(a: Port, b: Port, ps: Point, pe: Point, options: BuildEdgeCurveOptions): number | undefined {
  const minY = Math.min(ps.y, pe.y)
  const groups = options.groups
  if (groups?.length) {
    let matchedTop: number | undefined
    const check = (rect?: Rect, fallback?: Point) => {
      const g = rect
        ? findContainingGroup(rect, groups)
        : fallback
          ? groups.find(item => pointInRect(fallback.x, fallback.y + 1, item))
          : undefined
      if (g && g.y < minY) {
        matchedTop = matchedTop === undefined ? g.y : Math.max(matchedTop, g.y)
      }
    }
    check(options.sourceRect, a)
    check(options.targetRect, b)
    if (matchedTop !== undefined) return matchedTop + TOP_ARCH_TITLE_CLEARANCE
  }
  return minY > CANVAS_TOP_ARCH_MARGIN ? CANVAS_TOP_ARCH_MARGIN : undefined
}

function resolveLeftArchCeil(ps: Point, pe: Point, options: BuildEdgeCurveOptions): number | undefined {
  const minX = Math.min(ps.x, pe.x)
  const spanY0 = Math.min(
    ps.y,
    pe.y,
    options.sourceRect?.y ?? ps.y,
    options.targetRect?.y ?? pe.y,
  )
  const spanY1 = Math.max(
    ps.y,
    pe.y,
    options.sourceRect ? options.sourceRect.y + options.sourceRect.height : ps.y,
    options.targetRect ? options.targetRect.y + options.targetRect.height : pe.y,
  )
  let adjLeftRight = -Infinity
  if (options.groups?.length) {
    for (const g of options.groups) {
      const right = g.x + g.width
      if (right <= minX && g.y <= spanY1 + 20 && g.y + g.height >= spanY0 - 20) {
        if (right > adjLeftRight) adjLeftRight = right
      }
    }
  }
  if (adjLeftRight > -Infinity) return Math.max(CANVAS_LEFT_ARCH_MARGIN, adjLeftRight + 6)
  return minX > CANVAS_LEFT_ARCH_MARGIN ? CANVAS_LEFT_ARCH_MARGIN : undefined
}

// 非自环严格至多一段：面对面小错位拉直，其余为首末锁定端口外法线的限幅三次贝塞尔。
export function buildEdgeCurve(
  a: Port,
  b: Port,
  self = false,
  archClearance?: number,
  options?: BuildEdgeCurveOptions,
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
    const hBase =
      dParallel >= MIN_STRAIGHT_SPAN
        ? clamp(dParallel * 0.42, 24, MAX_BEZIER_HANDLE)
        : clamp(32 + Math.sqrt(Math.abs(dParallel) * 18) + dPerp * 0.15, 42, 120)
    const hsBias = options?.hsBias ?? 0
    const heBias = options?.heBias ?? 0
    hs = hsBias !== 0 ? clamp(hBase + hsBias, 18, MAX_BEZIER_HANDLE) : hBase
    he = heBias !== 0 ? clamp(hBase + heBias, 18, MAX_BEZIER_HANDLE) : hBase
  } else if (dotN > 0.5) {
    const dOut = dx * us.x + dy * us.y
    const lPerp = Math.abs(dx * perp.x + dy * perp.y)
    const a0 = clamp(0.18 * lPerp + 26, 36, 92)
    let baseH =
      archClearance === undefined ? a0 : Math.min(MAX_ARCH_HANDLE, Math.max(a0, (4 / 3) * (archClearance + 14)))
    if (options?.archLane && options.archLane > 0) {
      baseH = Math.min(MAX_ARCH_LANE_HANDLE, baseH + options.archLane * ARCH_LANE_STEP)
    }
    if (options) {
      if (a.side === 'top' && b.side === 'top') {
        const yCeil = resolveTopArchCeil(a, b, ps, pe, options)
        if (yCeil !== undefined) baseH = clampArchBaseH(ps.y, pe.y, baseH, yCeil)
      } else if (a.side === 'left' && b.side === 'left') {
        const xCeil = resolveLeftArchCeil(ps, pe, options)
        if (xCeil !== undefined) baseH = clampArchBaseH(ps.x, pe.x, baseH, xCeil)
      }
    }
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

// 仅在同排/同列面对面直连被中间卡正面深度直挡时换为同侧拱桥；跨度感知外卡、顶栏让道并分配彩虹轨道 archLane。
export function selectInlineBlockedSides(
  specs: InlineArchSpec[],
  nodes: Record<string, Rect>,
  options?: RoutingOptions,
): void {
  const dragging = Boolean(options?.dragging)
  const hints = options?.hints
  const groups = options?.groups
  const entries = Object.entries(nodes)
  const activeArches: {
    spec: InlineArchSpec
    side: Port['side']
    spanLo: number
    spanHi: number
    portLevel: number
  }[] = []

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
    const spanLo = Math.min(a.m0, b.m0)
    const spanHi = Math.max(a.m1, b.m1)
    const outerLo = spanLo - OUTER_SPAN_MARGIN
    const outerHi = spanHi + OUTER_SPAN_MARGIN
    const sides: readonly Port['side'][] = horizontal ? ['top', 'bottom'] : ['left', 'right']
    const groupA = horizontal ? findContainingGroup(rectA, groups) : undefined
    const groupB = horizontal ? findContainingGroup(rectB, groups) : undefined

    let best: { side: Port['side']; clearance: number; score: number; portLevel: number } | undefined
    for (const side of sides) {
      const low = side === 'top' || side === 'left'
      // 跨度感知外卡检测：仅检测主轴与拱桥外包跨度重叠的卡片，释放下方窄分组外侧净空同时严禁内部列/行向内绕行。
      const hasOuterCard = entries.some(([id, rect]) => {
        if (id === spec.fromNodeId || id === spec.toNodeId) return false
        const o = axisSpan(rect, horizontal)
        if (o.m1 < outerLo || o.m0 > outerHi) return false
        const center = (o.c0 + o.c1) / 2
        return low ? center < corridorMin : center > corridorMax
      })
      if (hasOuterCard) continue
      const portLevel = low ? corridorMin : corridorMax
      const protruding = between.filter(o => (low ? o.c0 < portLevel : o.c1 > portLevel))
      const clearance = protruding.reduce((max, o) => Math.max(max, low ? portLevel - o.c0 : o.c1 - portLevel), 0)
      const hysteresis = dragging && prev?.archActive === true && prev.sourceSide !== side ? ARCH_HYSTERESIS : 0
      const topGroupPenalty =
        side === 'top' &&
        ((groupA && rectA.y - groupA.y <= TOP_ARCH_GROUP_PROXIMITY) ||
          (groupB && rectB.y - groupB.y <= TOP_ARCH_GROUP_PROXIMITY))
          ? TOP_ARCH_GROUP_PENALTY
          : 0
      const score = clearance + ARCH_NEIGHBOR_COST * protruding.length + hysteresis + topGroupPenalty
      if (!best || score < best.score) best = { side, clearance, score, portLevel }
    }
    if (!best) continue
    spec.sourceSide = best.side
    spec.targetSide = best.side
    spec.archClearance = best.clearance
    activeArches.push({ spec, side: best.side, spanLo, spanHi, portLevel: best.portLevel })
  }

  // 对活跃拱桥按同侧跨度升序贪心区间着色，分配彩虹通道 archLane（短拱在内、长拱在外）。
  const bySide = new Map<Port['side'], typeof activeArches>()
  for (const item of activeArches) {
    const list = bySide.get(item.side)
    if (list) list.push(item)
    else bySide.set(item.side, [item])
  }
  for (const list of bySide.values()) {
    list.sort(
      (a, b) =>
        a.spanHi - a.spanLo - (b.spanHi - b.spanLo) ||
        a.spanLo - b.spanLo ||
        (a.spec.relation.id < b.spec.relation.id ? -1 : a.spec.relation.id > b.spec.relation.id ? 1 : 0),
    )
    const lanes: { spanLo: number; spanHi: number; portLevel: number }[][] = []
    for (const item of list) {
      let lane = 0
      while (lane < lanes.length) {
        const conflict = lanes[lane].some(
          other =>
            Math.abs(other.portLevel - item.portLevel) <= ARCH_RAIL_PROXIMITY &&
            item.spanLo < other.spanHi + ARCH_LANE_SPAN_MARGIN &&
            other.spanLo < item.spanHi + ARCH_LANE_SPAN_MARGIN,
        )
        if (!conflict) break
        lane++
      }
      if (lane === lanes.length) lanes.push([])
      lanes[lane].push({ spanLo: item.spanLo, spanHi: item.spanHi, portLevel: item.portLevel })
      item.spec.archLane = lane
    }
  }
}

function overlapArea(a: Box, b: Box): number {
  const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return ox > 0 && oy > 0 ? ox * oy : 0
}

function segmentHitsBox(a: Point, b: Point, box: Box): boolean {
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
  return (
    clip(-dx, a.x - box.x0) &&
    clip(dx, box.x1 - a.x) &&
    clip(-dy, a.y - box.y0) &&
    clip(dy, box.y1 - a.y) &&
    t0 <= t1
  )
}

// 沿线 9 点（含短边特化候选）分级避让卡片、已放胶囊、端口/箭头与其他连线；未传 options 时严格保持既有 3/4 参行为。
export function pickPillAnchor(
  curve: Pick<EdgeCurve, 'segments' | 'defaultLabel'>,
  labelText: string | undefined,
  rects: readonly Rect[],
  placedPills?: PlacedPillBox[],
  options?: PillPlacementOptions,
): PillPlacement {
  const text = labelText?.trim()
  if (!text || !curve.segments.length) return sanitizePoint(curve.defaultLabel)
  let estWidth = 0
  for (const ch of text) estWidth += (ch.codePointAt(0) ?? 0) > 0xff ? 11 : 6.5
  const cards: Box[] = rects.map(r => ({
    x0: r.x - PILL_CARD_MARGIN,
    y0: r.y - PILL_CARD_MARGIN,
    x1: r.x + r.width + PILL_CARD_MARGIN,
    y1: r.y + r.height + PILL_CARD_MARGIN,
  }))
  const halfH = PILL_HEIGHT / 2

  if (!options) {
    const halfW = clamp(estWidth + 18, 36, PILL_MAX_WIDTH) / 2
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

  const sp = options.sourcePort ?? curve.segments[0][0]
  const tp = options.targetPort ?? curve.segments[curve.segments.length - 1][3]
  const facingHoriz = options.sourcePort && options.targetPort
    ? (options.sourcePort.side === 'right' && options.targetPort.side === 'left') ||
      (options.sourcePort.side === 'left' && options.targetPort.side === 'right')
    : true
  const facingVert = options.sourcePort && options.targetPort
    ? (options.sourcePort.side === 'bottom' && options.targetPort.side === 'top') ||
      (options.sourcePort.side === 'top' && options.targetPort.side === 'bottom')
    : true
  const spanX = Math.abs(tp.x - sp.x)
  const spanY = Math.abs(tp.y - sp.y)
  const isShortHoriz = facingHoriz && spanX >= SHORT_HORIZ_MIN_SPAN && spanX < SHORT_HORIZ_MAX_SPAN && spanY < 20
  const isShortVert = facingVert && spanY > 0 && spanY < SHORT_VERT_MAX_SPAN && spanX < 20

  const maxWidth = isShortHoriz ? clamp(spanX - 18, 54, PILL_MAX_WIDTH) : undefined
  const pillW = Math.min(clamp(estWidth + 18, 36, PILL_MAX_WIDTH), maxWidth ?? PILL_MAX_WIDTH)
  const halfW = pillW / 2
  const boxAt = (p: Point): Box => ({ x0: p.x - halfW, y0: p.y - halfH, x1: p.x + halfW, y1: p.y + halfH })

  const candidates: Point[] = []
  if (isShortHoriz) {
    candidates.push({ x: finite((sp.x + tp.x) / 2), y: finite((sp.y + tp.y) / 2) })
  }
  for (const t of PILL_CANDIDATE_T) {
    candidates.push(evalCurvePoint(curve, t))
  }
  if (isShortVert) {
    const shaftX = finite((sp.x + tp.x) / 2)
    const gapMidY = finite((sp.y + tp.y) / 2)
    candidates.push({ x: finite(shaftX + halfW + SIDE_SADDLE_GAP), y: gapMidY })
    candidates.push({ x: finite(shaftX - halfW - SIDE_SADDLE_GAP), y: gapMidY })
  }

  const otherChords = options.otherChords
  const portBoxes = options.portBoxes
  let best:
    | { point: Point; box: Box; cardArea: number; conflictScore: number; conflictArea: number; rank: number }
    | undefined

  for (let rank = 0; rank < candidates.length; rank++) {
    const point = candidates[rank]
    const box = boxAt(point)
    let cardArea = 0
    for (const card of cards) cardArea += overlapArea(box, card)

    let placedHits = 0
    let placedArea = 0
    if (placedPills) {
      for (const placed of placedPills) {
        const a = overlapArea(box, placed)
        if (a > 0) {
          placedHits++
          placedArea += a
        }
      }
    }

    let portHits = 0
    let portArea = 0
    if (portBoxes) {
      for (const pb of portBoxes) {
        const a = overlapArea(box, pb)
        if (a > 0) {
          portHits++
          portArea += a
        }
      }
    }

    let chordHits = 0
    if (otherChords) {
      for (const chord of otherChords) {
        if (
          segmentHitsBox(chord[0], chord[1], box) ||
          segmentHitsBox(chord[1], chord[2], box) ||
          segmentHitsBox(chord[2], chord[3], box)
        ) {
          chordHits++
        }
      }
    }

    const conflictScore = 4 * placedHits + 3 * portHits + 2 * chordHits
    const conflictArea = 4 * placedArea + 3 * portArea
    const better =
      !best ||
      cardArea < best.cardArea - 1e-6 ||
      (Math.abs(cardArea - best.cardArea) <= 1e-6 &&
        (conflictScore < best.conflictScore ||
          (conflictScore === best.conflictScore &&
            (conflictArea < best.conflictArea - 1e-6 ||
              (Math.abs(conflictArea - best.conflictArea) <= 1e-6 && rank < best.rank)))))
    if (better) {
      best = { point, box, cardArea, conflictScore, conflictArea, rank }
      if (cardArea === 0 && conflictScore === 0) break
    }
  }

  const chosen = best ?? { point: evalCurvePoint(curve, 0.5), box: boxAt(evalCurvePoint(curve, 0.5)) }
  placedPills?.push(chosen.box)
  const out = sanitizePoint(chosen.point)
  return maxWidth !== undefined ? { x: out.x, y: out.y, maxWidth } : out
}
