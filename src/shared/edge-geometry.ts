import {
  PORT_INSET_X,
  PORT_INSET_Y,
  SINGLE_SIDE_TOP_OFFSET,
  buildEdgeCurve,
  computePortEndpoints,
  pickPillAnchor,
  selectInlineBlockedSides,
} from './edge-routing.ts'
import type {
  EdgeRouteHint,
  InlineArchSpec,
  PlacedPillBox,
  RoutedSegment,
  RoutingOptions,
} from './edge-routing.ts'

// 圆点与连线共用画布坐标和尺寸；箭头尖端停在输入圆外沿。
export const PORT_RADIUS = 3.5
export const INPUT_PORT_STROKE = 1
export const OUTPUT_PORT_STROKE = 2
export const ARROW_LENGTH = 8
export const ARROW_HALF_WIDTH = 3.5

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
  RoutedSegment,
} from './edge-routing.ts'

// 批量路由：每条边仅做局部几何；关系胶囊沿线避开卡片并彼此错位。
export function routeSegments(
  segments: readonly {
    relation: RoutedSegment['relation']
    source: Port
    target: Port
    vertical: boolean
    self: boolean
    archClearance?: number
  }[],
  nodes?: Record<string, Rect>,
  options?: RoutingOptions,
): { segments: RoutedSegment[]; hints: Map<string, EdgeRouteHint> } {
  const hints = new Map<string, EdgeRouteHint>()
  const rects = nodes ? Object.values(nodes) : []
  const placed: PlacedPillBox[] = []
  const routed: RoutedSegment[] = segments.map(segment => {
    const { curve, straightDir } = buildEdgeCurve(segment.source, segment.target, segment.self, segment.archClearance)
    const endpoints = computePortEndpoints(segment.source, segment.target, straightDir)
    hints.set(segment.relation.id, {
      sourceSide: segment.source.side,
      targetSide: segment.target.side,
      ...(segment.archClearance !== undefined ? { archActive: true } : {}),
    })
    return {
      ...segment,
      d: curve.d,
      arrow: endpoints.arrow,
      stem: endpoints.stem,
      label: pickPillAnchor(curve, segment.relation.label, rects, placed),
    }
  })
  if (options?.outHints) {
    options.outHints.clear()
    for (const [k, v] of hints) options.outHints.set(k, v)
  }
  return { segments: routed, hints }
}

// 先按边分配端口（仅正面直挡时允许同侧拱桥换边），再分散同侧端口，最后批量路由曲线。
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

  const segments = specs.map(spec => ({
    relation: spec.relation,
    source: register(spec.fromNodeId, spec.sourceSide, spec.toNodeId, spec.edgeIndex, 'out'),
    target: register(spec.toNodeId, spec.targetSide, spec.fromNodeId, spec.edgeIndex, 'in'),
    vertical: spec.vertical,
    self: spec.self,
    ...(spec.archClearance !== undefined ? { archClearance: spec.archClearance } : {}),
  }))

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
      const facing =
        (source.side === 'left' && target.side === 'right') ||
        (source.side === 'right' && target.side === 'left') ||
        (source.side === 'top' && target.side === 'bottom') ||
        (source.side === 'bottom' && target.side === 'top')
      if (!facing) continue
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
    // 四边共用同一规则：左右看对端Y，上下看对端X；与输入/输出角色无关。
    // 对端中心初排后按实际端口投影作有界校正，不做曲线交叉检测或相邻交换搜索。
    for (const group of groups.values()) {
      group.sort((a, b) => {
        const ca = nodes[a.other]
        const cb = nodes[b.other]
        return (
          projectedOrder(a, { x: ca.x + ca.width / 2, y: ca.y + ca.height / 2 }) -
            projectedOrder(b, { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 }) || tie(a, b)
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
            if (projectedOrder(group[i], opposite.get(group[i])!) > projectedOrder(group[j], opposite.get(group[j])!) + 1e-6) {
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
        group.sort(
          (a, b) =>
            projectedOrder(a, positions.get(opposite.get(a)!)!) - projectedOrder(b, positions.get(opposite.get(b)!)!) ||
            tie(a, b),
        )
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
