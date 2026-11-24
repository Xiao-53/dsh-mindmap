import {
  ARCH_LANE_STEP,
  BIDIR_SLOPE_ENTER,
  BIDIR_SLOPE_EXIT,
  PARALLEL_BIAS_MAX,
  PARALLEL_BIAS_MIN_PERP,
  PILL_PORT_MARGIN,
  PORT_INSET_X,
  PORT_INSET_Y,
  SINGLE_SIDE_TOP_OFFSET,
  buildEdgeCurve,
  computePortEndpoints,
  evalCurvePoint,
  pickPillAnchor,
  selectInlineBlockedSides,
} from './edge-routing.ts'
import type {
  Box,
  EdgeRouteHint,
  InlineArchSpec,
  PillPlacement,
  PlacedPillBox,
  Point,
  RoutedSegment,
  RoutingOptions,
} from './edge-routing.ts'

// 圆点与连线共用画布坐标和尺寸；箭头尖端停在输入圆外沿。
export const PORT_RADIUS = 3.5
export const INPUT_PORT_STROKE = 1
export const OUTPUT_PORT_STROKE = 2
export const ARROW_LENGTH = 8
export const ARROW_HALF_WIDTH = 3.5
export { ARCH_LANE_STEP, BIDIR_SLOPE_ENTER, BIDIR_SLOPE_EXIT }

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Port {
  nodeId: string
  side: 'left' | 'right' | 'top' | 'bottom'
  other: string
  edgeIndex: number
  role: 'in' | 'out'
  x: number
  y: number
}

export type {
  Point,
  Box,
  Cubic,
  EdgeCurve,
  PortEndpoints,
  InlineArchSpec,
  EdgeRouteHint,
  RoutingOptions,
  PlacedPillBox,
  PillPlacement,
  PillPlacementOptions,
  BuildEdgeCurveOptions,
  RoutedSegment,
} from './edge-routing.ts'

const INPUT_PORT_OUTER_RADIUS = 4

function isFacingSides(a: Port['side'], b: Port['side']): boolean {
  return (
    (a === 'left' && b === 'right') ||
    (a === 'right' && b === 'left') ||
    (a === 'top' && b === 'bottom') ||
    (a === 'bottom' && b === 'top')
  )
}

function buildPortBoxes(source: Port, target: Port, ut: Point): [Box, Box] {
  const outBox: Box = {
    x0: source.x - PILL_PORT_MARGIN,
    y0: source.y - PILL_PORT_MARGIN,
    x1: source.x + PILL_PORT_MARGIN,
    y1: source.y + PILL_PORT_MARGIN,
  }
  const ex = target.x + ut.x * INPUT_PORT_OUTER_RADIUS
  const ey = target.y + ut.y * INPUT_PORT_OUTER_RADIUS
  const bx = ex + ut.x * ARROW_LENGTH
  const by = ey + ut.y * ARROW_LENGTH
  const c1x = bx - ut.y * ARROW_HALF_WIDTH
  const c1y = by + ut.x * ARROW_HALF_WIDTH
  const c2x = bx + ut.y * ARROW_HALF_WIDTH
  const c2y = by - ut.x * ARROW_HALF_WIDTH
  const inBox: Box = {
    x0: Math.min(target.x - INPUT_PORT_OUTER_RADIUS, ex, c1x, c2x) - PILL_PORT_MARGIN,
    y0: Math.min(target.y - INPUT_PORT_OUTER_RADIUS, ey, c1y, c2y) - PILL_PORT_MARGIN,
    x1: Math.max(target.x + INPUT_PORT_OUTER_RADIUS, ex, c1x, c2x) + PILL_PORT_MARGIN,
    y1: Math.max(target.y + INPUT_PORT_OUTER_RADIUS, ey, c1y, c2y) + PILL_PORT_MARGIN,
  }
  return [outBox, inBox]
}

// 两趟 O(E) 批量路由：第一趟生成全图曲线、3 段闭式弦与全端口/箭头保护盒；第二趟做四维胶囊防遮盖与短边特化定位。
export function routeSegments(
  segments: readonly {
    relation: RoutedSegment['relation']
    source: Port
    target: Port
    vertical: boolean
    self: boolean
    archClearance?: number
    archLane?: number
    hsBias?: number
    heBias?: number
    bidirFlipped?: boolean
  }[],
  nodes?: Record<string, Rect>,
  options?: RoutingOptions,
): { segments: RoutedSegment[]; hints: Map<string, EdgeRouteHint> } {
  const hints = new Map<string, EdgeRouteHint>()
  const rects = nodes ? Object.values(nodes) : []
  const placed: PlacedPillBox[] = []

  const firstPass = segments.map(segment => {
    const { curve, straightDir } = buildEdgeCurve(segment.source, segment.target, segment.self, segment.archClearance, {
      archLane: segment.archLane,
      hsBias: segment.hsBias,
      heBias: segment.heBias,
      groups: options?.groups,
      sourceRect: nodes?.[segment.relation.fromNodeId],
      targetRect: nodes?.[segment.relation.toNodeId],
    })
    const endpoints = computePortEndpoints(segment.source, segment.target, straightDir)
    hints.set(segment.relation.id, {
      sourceSide: segment.source.side,
      targetSide: segment.target.side,
      ...(segment.archClearance !== undefined ? { archActive: true } : {}),
      ...(segment.bidirFlipped ? { bidirFlipped: true } : {}),
    })
    const chord = [
      evalCurvePoint(curve, 0),
      evalCurvePoint(curve, 1 / 3),
      evalCurvePoint(curve, 2 / 3),
      evalCurvePoint(curve, 1),
    ] as const
    const portBoxes = buildPortBoxes(segment.source, segment.target, endpoints.ut)
    return { segment, curve, endpoints, chord, portBoxes }
  })

  const allPortBoxes: Box[] = []
  for (const item of firstPass) {
    allPortBoxes.push(item.portBoxes[0], item.portBoxes[1])
  }

  const routed: RoutedSegment[] = firstPass.map((item, idx) => {
    const { segment, curve, endpoints } = item
    let label: PillPlacement
    if (!segment.relation.label?.trim()) {
      label = curve.defaultLabel
    } else {
      const otherChords: (readonly [Point, Point, Point, Point])[] = []
      for (let j = 0; j < firstPass.length; j++) {
        if (j !== idx) otherChords.push(firstPass[j].chord)
      }
      label = pickPillAnchor(curve, segment.relation.label, rects, placed, {
        otherChords,
        portBoxes: allPortBoxes,
        sourcePort: segment.source,
        targetPort: segment.target,
        edgeId: segment.relation.id,
      })
    }
    return {
      ...segment,
      d: curve.d,
      arrow: endpoints.arrow,
      stem: endpoints.stem,
      label,
    }
  })

  if (options?.outHints) {
    options.outHints.clear()
    for (const [k, v] of hints) options.outHints.set(k, v)
  }
  return { segments: routed, hints }
}

// 先按边分配端口（仅正面直挡时允许同侧拱桥换边），再分散同侧端口（含双向斜率配对与拱桥 LIFO 排序），最后批量路由曲线。
export function createConnections(
  nodes: Record<string, Rect>,
  edges: { id: string; fromNodeId: string; toNodeId: string; type: string; label?: string }[],
  order?: readonly Port[],
  options?: RoutingOptions,
): { ports: Port[]; segments: RoutedSegment[]; hints: Map<string, EdgeRouteHint> } {
  const plan = new Map(order?.map((port, index) => [`${port.edgeIndex}:${port.role}`, { side: port.side, index }]))
  const specs: InlineArchSpec[] = []
  edges.forEach((relation, index) => {
    const a = nodes[relation.fromNodeId]
    const b = nodes[relation.toNodeId]
    if (!a || !b) return
    const dx = b.x + b.width / 2 - a.x - a.width / 2
    const dy = b.y + b.height / 2 - a.y - a.height / 2
    const vertical = Math.abs(dy) > Math.abs(dx) * 0.55
    const self = relation.fromNodeId === relation.toNodeId
    const defaultSource: Port['side'] = self
      ? 'right'
      : vertical
        ? dy >= 0
          ? 'bottom'
          : 'top'
        : dx >= 0
          ? 'right'
          : 'left'
    const defaultTarget: Port['side'] = self
      ? 'right'
      : vertical
        ? dy >= 0
          ? 'top'
          : 'bottom'
        : dx >= 0
          ? 'left'
          : 'right'
    specs.push({
      relation,
      fromNodeId: relation.fromNodeId,
      toNodeId: relation.toNodeId,
      sourceSide: plan.get(`${index}:out`)?.side ?? defaultSource,
      targetSide: plan.get(`${index}:in`)?.side ?? defaultTarget,
      vertical,
      self,
      edgeIndex: index,
    })
  })

  if (!order) {
    selectInlineBlockedSides(specs, nodes, options)
  }

  const groups = new Map<string, Port[]>()
  const register = (nodeId: string, side: Port['side'], other: string, edgeIndex: number, role: Port['role']) => {
    const key = `${nodeId}:${side}`
    const port: Port = { nodeId, side, other, edgeIndex, role, x: 0, y: 0 }
    const group = groups.get(key)
    if (group) group.push(port)
    else groups.set(key, [port])
    return port
  }

  interface WorkingSegment {
    relation: RoutedSegment['relation']
    source: Port
    target: Port
    vertical: boolean
    self: boolean
    archClearance?: number
    archLane?: number
    hsBias?: number
    heBias?: number
    bidirFlipped?: boolean
  }

  const segments: WorkingSegment[] = specs.map(spec => ({
    relation: spec.relation,
    source: register(spec.fromNodeId, spec.sourceSide, spec.toNodeId, spec.edgeIndex, 'out'),
    target: register(spec.toNodeId, spec.targetSide, spec.fromNodeId, spec.edgeIndex, 'in'),
    vertical: spec.vertical,
    self: spec.self,
    ...(spec.archClearance !== undefined ? { archClearance: spec.archClearance } : {}),
    ...(spec.archLane !== undefined ? { archLane: spec.archLane } : {}),
  }))

  // 1) 斜率感知双向端口配对（FR-005）：对面对面双向边按跨轴偏移与拖拽滞回分配确定性 bidirRank，消除 15px 退缩引发的中段双交叉。
  const bidirPortRank = new Map<Port, { pairKey: string; rank: number }>()
  if (!order) {
    const dragging = Boolean(options?.dragging)
    const hints = options?.hints
    const pairBuckets = new Map<string, { axis: 'h' | 'v'; list: WorkingSegment[] }>()
    for (const seg of segments) {
      if (seg.self || !isFacingSides(seg.source.side, seg.target.side)) continue
      const horiz = seg.source.side === 'left' || seg.source.side === 'right'
      const axis: 'h' | 'v' = horiz ? 'h' : 'v'
      const u = seg.relation.fromNodeId
      const v = seg.relation.toNodeId
      const pairKey = u < v ? `${u}\0${v}\0${axis}` : `${v}\0${u}\0${axis}`
      const bucket = pairBuckets.get(pairKey)
      if (bucket) bucket.list.push(seg)
      else pairBuckets.set(pairKey, { axis, list: [seg] })
    }
    for (const [pairKey, { axis, list }] of pairBuckets) {
      if (list.length < 2) continue
      const u = list[0].relation.fromNodeId
      const v = list[0].relation.toNodeId
      const ru = nodes[u]
      const rv = nodes[v]
      if (!ru || !rv) continue
      const uCenter = axis === 'h' ? ru.x + ru.width / 2 : ru.y + ru.height / 2
      const vCenter = axis === 'h' ? rv.x + rv.width / 2 : rv.y + rv.height / 2
      const firstId = uCenter <= vCenter ? u : v
      const secondId = firstId === u ? v : u
      const fwd = list.filter(s => s.relation.fromNodeId === firstId && s.relation.toNodeId === secondId)
      const rev = list.filter(s => s.relation.fromNodeId === secondId && s.relation.toNodeId === firstId)
      if (!fwd.length || !rev.length) continue

      const rFirst = nodes[firstId]
      const rSecond = nodes[secondId]
      const delta =
        axis === 'h'
          ? rSecond.y + rSecond.height / 2 - (rFirst.y + rFirst.height / 2)
          : rSecond.x + rSecond.width / 2 - (rFirst.x + rFirst.width / 2)

      // 判定默认 tie 序谁在前，确保跨临界平滑拖拽全程至多翻转 1 次并保留 [12, 24] 滞回带。
      const minFwdId = fwd.reduce((m, s) => (s.relation.id < m ? s.relation.id : m), fwd[0].relation.id)
      const minRevId = rev.reduce((m, s) => (s.relation.id < m ? s.relation.id : m), rev[0].relation.id)
      const tiePutsRevFirst = minRevId < minFwdId
      const flipSign = tiePutsRevFirst ? -1 : 1
      const signedDelta = delta * flipSign
      const prevFlipped = list.some(s => hints?.get(s.relation.id)?.bidirFlipped === true)

      let flipped: boolean
      if (dragging && prevFlipped) {
        flipped = signedDelta >= BIDIR_SLOPE_EXIT
      } else {
        flipped = signedDelta >= BIDIR_SLOPE_ENTER
      }

      const revFirst = flipped ? !tiePutsRevFirst : tiePutsRevFirst
      const enforce = flipped || Math.abs(delta) >= BIDIR_SLOPE_ENTER
      if (flipped) {
        for (const s of list) s.bidirFlipped = true
      }
      if (enforce) {
        const revRank = revFirst ? 0 : 1
        const fwdRank = revFirst ? 1 : 0
        for (const s of rev) {
          bidirPortRank.set(s.source, { pairKey, rank: revRank })
          bidirPortRank.set(s.target, { pairKey, rank: revRank })
        }
        for (const s of fwd) {
          bidirPortRank.set(s.source, { pairKey, rank: fwdRank })
          bidirPortRank.set(s.target, { pairKey, rank: fwdRank })
        }
      }
    }
  }

  // 2) 记录活跃拱桥端口，用于 LIFO 嵌套反号投影排序（长拱外端口、短拱内端口）。
  const archPortInfo = new Map<Port, { archLane: number }>()
  for (const segment of segments) {
    if (segment.archClearance !== undefined) {
      const info = { archLane: segment.archLane ?? 0 }
      archPortInfo.set(segment.source, info)
      archPortInfo.set(segment.target, info)
    }
  }

  const opposite = new Map<Port, Port>()
  for (const segment of segments) {
    opposite.set(segment.source, segment.target)
    opposite.set(segment.target, segment.source)
  }
  const axis = (port: Port, point: { x: number; y: number }) =>
    port.side === 'left' || port.side === 'right' ? point.y : point.x
  const projectedOrder = (port: Port, point: { x: number; y: number }) => {
    const node = nodes[port.nodeId]
    const center =
      port.side === 'left' || port.side === 'right' ? node.y + node.height / 2 : node.x + node.width / 2
    const arch = archPortInfo.get(port)
    if (arch) {
      const offset = axis(port, point) - center
      const dir = offset === 0 ? 0 : Math.sign(offset)
      return -offset / 24 - dir * arch.archLane * 1e-3
    }
    const distance =
      port.side === 'left'
        ? node.x - point.x
        : port.side === 'right'
          ? point.x - node.x - node.width
          : port.side === 'top'
            ? node.y - point.y
            : point.y - node.y - node.height
    // 将对端方向投到同一侧外的参考平面，消除远近不同导致的上下/左右错序。
    return (axis(port, point) - center) / Math.max(24, distance)
  }
  const tie = (a: Port, b: Port) =>
    edges[a.edgeIndex].id < edges[b.edgeIndex].id
      ? -1
      : edges[a.edgeIndex].id > edges[b.edgeIndex].id
        ? 1
        : a.role === b.role
          ? 0
          : a.role === 'out'
            ? -1
            : 1
  const comparePortPair = (a: Port, b: Port, pa: { x: number; y: number }, pb: { x: number; y: number }) => {
    const ra = bidirPortRank.get(a)
    const rb = bidirPortRank.get(b)
    if (ra && rb && ra.pairKey === rb.pairKey && ra.rank !== rb.rank) {
      return ra.rank - rb.rank
    }
    const diff = projectedOrder(a, pa) - projectedOrder(b, pb)
    if (Math.abs(diff) > 1e-6) return diff
    return tie(a, b)
  }
  const place = (group: Port[]) => {
    const side = group[0].side
    const verticalSide = side === 'left' || side === 'right'
    const node = nodes[group[0].nodeId]
    const length = verticalSide ? node.height : node.width
    const inset = Math.min(length / 4, verticalSide ? 14 : 20)
    const preferredStep = verticalSide ? 17 : 24
    const step = group.length > 1 ? Math.min(preferredStep, Math.max(0, length - 2 * inset) / (group.length - 1)) : 0
    // 左右侧单端口默认取距顶固定基准，使高矮不一的同排串联卡片落在同一水平主干线。
    const singleInset = Math.min(length / 4, PORT_INSET_Y)
    const start =
      verticalSide && group.length === 1
        ? Math.min(Math.max(SINGLE_SIDE_TOP_OFFSET, singleInset), length - singleInset)
        : length / 2 - (step * (group.length - 1)) / 2
    group.forEach((port, index) => {
      const point = start + step * index
      port.x = node.x + (side === 'left' ? 0 : side === 'right' ? node.width : point)
      port.y = node.y + (side === 'top' ? 0 : side === 'bottom' ? node.height : point)
    })
  }

  // 面对面连线中的单端口沿自由轴投影到对端坐标；越出安全区时保持默认位置，不吸入卡片角落。
  const alignSinglePorts = () => {
    const safe = (port: Port, value: number) => {
      const node = nodes[port.nodeId]
      const horizontal = port.side === 'left' || port.side === 'right'
      const min = horizontal ? node.y : node.x
      const max = min + (horizontal ? node.height : node.width)
      const inset = Math.min((max - min) / 4, horizontal ? PORT_INSET_Y : PORT_INSET_X)
      return value >= min + inset && value <= max - inset
    }
    const isSingle = (port: Port) => groups.get(`${port.nodeId}:${port.side}`)?.length === 1
    const free = (port: Port) => (port.side === 'left' || port.side === 'right' ? port.y : port.x)
    const set = (port: Port, value: number) => {
      if (port.side === 'left' || port.side === 'right') port.y = value
      else port.x = value
    }
    for (const { source, target, self } of segments) {
      if (self) continue
      if (!isFacingSides(source.side, target.side)) continue
      const sourceSingle = isSingle(source)
      const targetSingle = isSingle(target)
      if (targetSingle && safe(target, free(source))) set(target, free(source))
      else if (sourceSingle && safe(source, free(target))) set(source, free(target))
    }
  }

  if (order) {
    for (const group of groups.values()) {
      group.sort(
        (a, b) =>
          (plan.get(`${a.edgeIndex}:${a.role}`)?.index ?? 0) - (plan.get(`${b.edgeIndex}:${b.role}`)?.index ?? 0),
      )
      place(group)
    }
  } else {
    // 四边共用同一规则：左右看对端Y，上下看对端X；叠加双向斜率配对与拱桥 LIFO 序。
    for (const group of groups.values()) {
      group.sort((a, b) => {
        const ca = nodes[a.other]
        const cb = nodes[b.other]
        return comparePortPair(
          a,
          b,
          { x: ca.x + ca.width / 2, y: ca.y + ca.height / 2 },
          { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 },
        )
      })
      place(group)
    }
    let best = [...groups.values()].map(group => [...group])
    let bestScore = Infinity
    const seen = new Set<string>()
    for (let pass = 0; pass < 6; pass++) {
      let inversions = 0
      for (const group of groups.values()) {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const ra = bidirPortRank.get(group[i])
            const rb = bidirPortRank.get(group[j])
            if (ra && rb && ra.pairKey === rb.pairKey && ra.rank !== rb.rank) {
              if (ra.rank > rb.rank) inversions++
            } else if (
              projectedOrder(group[i], opposite.get(group[i])!) >
              projectedOrder(group[j], opposite.get(group[j])!) + 1e-6
            ) {
              inversions++
            }
          }
        }
      }
      if (inversions < bestScore) {
        bestScore = inversions
        best = [...groups.values()].map(group => [...group])
      }
      const signature = [...groups.values()]
        .map(group => group.map(port => `${edges[port.edgeIndex].id}:${port.role}`).join(','))
        .join('|')
      if (!inversions || seen.has(signature)) break
      seen.add(signature)
      const positions = new Map([...opposite.keys()].map(port => [port, { x: port.x, y: port.y }]))
      for (const group of groups.values()) {
        group.sort((a, b) => comparePortPair(a, b, positions.get(opposite.get(a)!)!, positions.get(opposite.get(b)!)!))
      }
      for (const group of groups.values()) place(group)
    }
    let groupIndex = 0
    for (const group of groups.values()) {
      group.splice(0, group.length, ...best[groupIndex++])
      place(group)
    }
    alignSinglePorts()
  }

  // 3) 同向平行斜线反相偏置（FR-006）：按 place() 一致正轴差向两侧展开中段间距。
  const parallelBuckets = new Map<string, WorkingSegment[]>()
  for (const seg of segments) {
    if (seg.self || !isFacingSides(seg.source.side, seg.target.side)) continue
    const key = `${seg.relation.fromNodeId}\0${seg.relation.toNodeId}\0${seg.source.side}\0${seg.target.side}`
    const bucket = parallelBuckets.get(key)
    if (bucket) bucket.push(seg)
    else parallelBuckets.set(key, [seg])
  }
  for (const list of parallelBuckets.values()) {
    if (list.length < 2) continue
    const verticalSide = list[0].source.side === 'left' || list[0].source.side === 'right'
    list.sort(
      (a, b) =>
        (verticalSide ? a.source.y - b.source.y : a.source.x - b.source.x) ||
        (a.relation.id < b.relation.id ? -1 : a.relation.id > b.relation.id ? 1 : 0),
    )
    const k = list.length
    for (let i = 0; i < k; i++) {
      const seg = list[i]
      const axisDelta = verticalSide ? seg.target.y - seg.source.y : seg.target.x - seg.source.x
      const absAxis = Math.abs(axisDelta)
      if (absAxis < PARALLEL_BIAS_MIN_PERP) continue
      const mag = Math.min(PARALLEL_BIAS_MAX, 0.08 * absAxis)
      const rank = k === 2 ? (i === 0 ? -1 : 1) : i - (k - 1) / 2
      const delta = Math.max(-PARALLEL_BIAS_MAX * 1.25, Math.min(PARALLEL_BIAS_MAX * 1.25, mag * rank)) * Math.sign(axisDelta)
      if (Math.abs(delta) > 1e-6) {
        seg.hsBias = -delta
        seg.heBias = delta
      }
    }
  }

  const routed = routeSegments(segments, nodes, options)
  return {
    ports: [...groups.values()].flat(),
    segments: routed.segments,
    hints: routed.hints,
  }
}

// 插值后的端点与静态端点共用路由，圆点、线条和箭头不会各自跳到目标位置。
export function connectionGeometry(
  a: Port,
  b: Port,
  self = false,
  _nodes?: Record<string, Rect>,
  _options?: RoutingOptions,
) {
  const { curve, straightDir } = buildEdgeCurve(a, b, self)
  const endpoints = computePortEndpoints(a, b, straightDir)
  return {
    d: curve.d,
    arrow: endpoints.arrow,
    stem: endpoints.stem,
    label: curve.defaultLabel,
  }
}

export function edgeGeometry(from: Rect, to: Rect, self = false) {
  if (self) {
    const start = { x: from.x + from.width, y: from.y + from.height * 0.35 }
    const end = { x: from.x + from.width, y: from.y + from.height * 0.7 }
    return {
      start,
      end,
      d: `M ${start.x} ${start.y} C ${start.x + 90} ${start.y - 60}, ${end.x + 90} ${end.y + 60}, ${end.x} ${end.y}`,
    }
  }
  const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const b = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  const dx = b.x - a.x
  const dy = b.y - a.y
  const point = (r: Rect, cx: number, cy: number, vx: number, vy: number) => {
    const t = Math.min(
      vx === 0 ? Infinity : r.width / 2 / Math.abs(vx),
      vy === 0 ? Infinity : r.height / 2 / Math.abs(vy),
    )
    return { x: cx + vx * t, y: cy + vy * t }
  }
  const start = point(from, a.x, a.y, dx || 0.01, dy)
  const end = point(to, b.x, b.y, -dx || -0.01, -dy)
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  const bend = Math.max(45, Math.hypot(end.x - start.x, end.y - start.y) * 0.4)
  const sx = horizontal ? Math.sign(dx) * bend : 0
  const sy = horizontal ? 0 : Math.sign(dy) * bend
  return {
    start,
    end,
    d: `M ${start.x} ${start.y} C ${start.x + sx} ${start.y + sy}, ${end.x - sx} ${end.y - sy}, ${end.x} ${end.y}`,
  }
}
