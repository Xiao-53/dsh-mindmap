import type {
  KnowledgeMap,
  LayoutMode,
  MapLayout,
  View,
  ViewLayout,
  GroupLayout,
  NodeLayout,
  Relation,
} from './map-types.ts'
import {
  HEAD_ON_ENTER_DEPTH,
  MAX_ARCH_HANDLE,
  MAX_BEZIER_HANDLE,
  MIN_STRAIGHT_SPAN,
  OUTER_SPAN_MARGIN,
  PORT_INSET_X,
  PORT_INSET_Y,
  SINGLE_SIDE_TOP_OFFSET,
  STRAIGHT_DEADZONE,
} from './edge-routing.ts'

export type Heights = Record<string, number>

export const CARD_WIDTH = 236
export const COL_STEP = 327
export const ROW_GAP = 32
export const GROUP_PAD_X = 24
export const GROUP_PAD_TOP = 62
export const GROUP_PAD_BOTTOM = 24
export const MIN_ROW_CARD_GAP = 60
export const MIN_ROW_STEP = CARD_WIDTH + MIN_ROW_CARD_GAP
export const DEPENDENCY_WEIGHT = 1.0
export const SUPPLEMENT_WEIGHT = 0.6
export const SNAP_STRAIGHT_THRESHOLD = 48

// 014 全局实高评分、回路牵引与局部整理常量
export const OUTER_FEEDBACK_BONUS = -75
export const INTRA_SCC_COHESION_WEIGHT = 18
export const BOUNDARY_PROXIMITY_WEIGHT = 14
export const PIERCE_INNER_VERT_PENALTY = 750
export const PIERCE_HORIZ_PENALTY = 620
export const PIERCE_DIAG_PENALTY = 520
export const LEGAL_OUTER_ARCH_PENALTY = 115
export const STRAIGHT_PROXY_BONUS = -42
export const PROXY_CROSS_PENALTY = 260
export const SAME_COL_VERT_OVERLAP_PENALTY = 800
export const SAME_ROW_HORIZ_OVERLAP_PENALTY = 600
export const SAME_SIDE_ARCH_OVERLAP_PENALTY = 140
export const OUT_OF_GROUP_PENALTY = 420
export const PINNED_OVERLAP_PENALTY = 5000
export const DIRTY_BBOX_EXPAND = 24

const CARD_PIERCE_INSET = 4
const ARROW_RETRACT = 15
const DEFAULT_CARD_HEIGHT = 130
const GRID_GROUP_GAP = 48

/** 跨分组或同视图已定位节点的参考锚点。 */
export interface AnchorPoint {
  x: number
  y: number
  width: number
  height: number
}

/** 分桶排布的可选上下文：支持跨分组连线距离感知。 */
export interface BucketPlacementOptions {
  anchors?: ReadonlyMap<string, AnchorPoint>
  allRelations?: readonly Relation[]
}

/** 局部整理选项：保留手动拖动节点或仅整理指定分组。 */
export interface PartialRelayoutOptions {
  scope: 'unlocked' | { groupId: string }
  /** 单组整理时是否按新卡片紧凑重建该组外框（默认 false，保持组外框稳定） */
  refitTargetGroup?: boolean
}

export const heightKey = (viewId: string, nodeId: string) =>
  `${viewId}/${nodeId}`

export const nodeHeight = (h: Heights, viewId: string, nodeId: string) =>
  h[heightKey(viewId, nodeId)] ?? DEFAULT_CARD_HEIGHT

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

interface Point {
  x: number
  y: number
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface IntraEdge {
  from: number
  to: number
  dependency: boolean
  weight: number
}

interface CycleDecomposition {
  degree: number[]
  indegree: number[]
  outdegree: number[]
  order: number[]
  layer: number[]
  isAcyclic: boolean
  sccId: number[]
  /** 所有需切断的回边标记集合（含双向逆边 + 组内 GreedyFAS 非冗余回边） */
  backEdgeIndices: Set<number>
  /** 非双向逆边的组内回边标记（免除逆流惩罚） */
  intraFeedbackIndices: Set<number>
}

interface ProxyEdgeGeometry {
  isStraight: boolean
  isArch: boolean
  archSide?: 'left' | 'right' | 'top' | 'bottom'
  /** [P0, Q0.25, Q0.75, P3] 或直线段三等/四分点折线 */
  points: [Point, Point, Point, Point]
  bbox: { x0: number; y0: number; x1: number; y1: number }
  blockedCards: number
  pierceCost: number
  straightBonus: number
  vertColX: number
  vertY0: number
  vertY1: number
  isVertAxis: boolean
  horizRowY: number
  horizX0: number
  horizX1: number
  isHorizAxis: boolean
}

interface IncrementalEvalCache {
  rects: Rect[]
  groupTops: number[]
  groupBottoms: number[]
  proxyEdges: ProxyEdgeGeometry[]
  /** 对称 M×M 扁平矩阵（Float64Array），存放边对交叉与共线重叠代价 */
  pairCostMat: Float64Array
  edgeSelfCosts: Float64Array
  nodeCosts: Float64Array
  minSceneX: number
  maxSceneX: number
  totalNodeCost: number
  totalSelfCost: number
  totalPairCost: number
}

// ---------- Tarjan SCC 与加权边界感知 GreedyFAS 环路拆解（T354） ----------

function tarjanScc(count: number, adj: readonly (readonly number[])[]): number[][] {
  let index = 0
  const indices = new Int32Array(count).fill(-1)
  const lowlink = new Int32Array(count)
  const onStack = new Uint8Array(count)
  const stack: number[] = []
  const sccs: number[][] = []

  const strongConnect = (v: number) => {
    indices[v] = index
    lowlink[v] = index
    index++
    stack.push(v)
    onStack[v] = 1
    for (const w of adj[v]) {
      if (indices[w] === -1) {
        strongConnect(w)
        if (lowlink[w] < lowlink[v]) lowlink[v] = lowlink[w]
      } else if (onStack[w]) {
        if (indices[w] < lowlink[v]) lowlink[v] = indices[w]
      }
    }
    if (lowlink[v] === indices[v]) {
      const comp: number[] = []
      while (true) {
        const w = stack.pop()!
        onStack[w] = 0
        comp.push(w)
        if (w === v) break
      }
      sccs.push(comp)
    }
  }

  for (let v = 0; v < count; v++) {
    if (indices[v] === -1) strongConnect(v)
  }
  return sccs
}

function isReachable(count: number, adj: readonly (readonly number[])[], start: number, target: number): boolean {
  if (start === target) return true
  const visited = new Uint8Array(count)
  const queue: number[] = [start]
  visited[start] = 1
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]
    for (const nxt of adj[cur]) {
      if (nxt === target) return true
      if (!visited[nxt]) {
        visited[nxt] = 1
        queue.push(nxt)
      }
    }
  }
  return false
}

function decomposeCyclesWeighted(
  count: number,
  edges: readonly IntraEdge[],
  extInBias?: readonly number[],
  extOutBias?: readonly number[],
): CycleDecomposition {
  const degree = Array<number>(count).fill(0)
  const indegree = Array<number>(count).fill(0)
  const outdegree = Array<number>(count).fill(0)
  for (const e of edges) {
    degree[e.from]++
    degree[e.to]++
    if (e.dependency) {
      indegree[e.to]++
      outdegree[e.from]++
    }
  }

  const backEdgeIndices = new Set<number>()
  const twoCycleBackIndices = new Set<number>()
  const intraFeedbackIndices = new Set<number>()

  // 1) 双向边（2-Cycle）预分离：保留高权边（dependency > supplement），平局保留叙事下标 u < v。
  const pairEdges = new Map<string, number[]>()
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    const key = `${e.from}:${e.to}`
    const list = pairEdges.get(key)
    if (list) list.push(i)
    else pairEdges.set(key, [i])
  }
  for (let u = 0; u < count; u++) {
    for (let v = u + 1; v < count; v++) {
      const fwd = pairEdges.get(`${u}:${v}`)
      const rev = pairEdges.get(`${v}:${u}`)
      if (!fwd || !rev) continue
      let maxFwd = 0
      for (const idx of fwd) if (edges[idx].weight > maxFwd) maxFwd = edges[idx].weight
      let maxRev = 0
      for (const idx of rev) if (edges[idx].weight > maxRev) maxRev = edges[idx].weight
      const cutList = maxFwd >= maxRev ? rev : fwd
      for (const idx of cutList) {
        backEdgeIndices.add(idx)
        twoCycleBackIndices.add(idx)
      }
    }
  }

  // 2) Tarjan SCC 分解（扣除双向逆边后的有向子图）
  const adjAll: number[][] = Array.from({ length: count }, () => [])
  for (let i = 0; i < edges.length; i++) {
    if (twoCycleBackIndices.has(i)) continue
    adjAll[edges[i].from].push(edges[i].to)
  }
  const sccs = tarjanScc(count, adjAll)
  const sccId = Array<number>(count).fill(-1)
  const sccPos = new Int32Array(count).fill(-1)
  let nextSccId = 0

  // 3) 加权边界感知 GreedyFAS：对每个非平凡分量剥离汇/源点并按 Phi(u) 确定性选点。
  for (const comp of sccs) {
    if (comp.length < 2) continue
    const cid = nextSccId++
    comp.sort((a, b) => a - b)
    const compSet = new Set(comp)
    for (const u of comp) sccId[u] = cid

    const compEdges: { idx: number; from: number; to: number; fasW: number }[] = []
    for (let i = 0; i < edges.length; i++) {
      if (twoCycleBackIndices.has(i)) continue
      const e = edges[i]
      if (compSet.has(e.from) && compSet.has(e.to)) {
        compEdges.push({ idx: i, from: e.from, to: e.to, fasW: e.dependency ? 2.0 : 0.5 })
      }
    }

    const active = new Set<number>(comp)
    const s1: number[] = []
    const s2: number[] = []

    const computeDegs = (u: number) => {
      let inCnt = 0
      let outCnt = 0
      let wIn = 0
      let wOut = 0
      for (const ce of compEdges) {
        if (!active.has(ce.from) || !active.has(ce.to)) continue
        if (ce.from === u) {
          outCnt++
          wOut += ce.fasW
        } else if (ce.to === u) {
          inCnt++
          wIn += ce.fasW
        }
      }
      return { inCnt, outCnt, wIn, wOut }
    }

    while (active.size > 0) {
      let peeled = true
      while (peeled && active.size > 0) {
        peeled = false
        for (const u of comp) {
          if (!active.has(u)) continue
          if (computeDegs(u).outCnt === 0) {
            active.delete(u)
            s2.push(u)
            peeled = true
            break
          }
        }
      }
      peeled = true
      while (peeled && active.size > 0) {
        peeled = false
        for (const u of comp) {
          if (!active.has(u)) continue
          if (computeDegs(u).inCnt === 0) {
            active.delete(u)
            s1.push(u)
            peeled = true
            break
          }
        }
      }
      if (active.size > 0) {
        let bestU = -1
        let bestPhi = -Infinity
        for (const u of comp) {
          if (!active.has(u)) continue
          const { wIn, wOut } = computeDegs(u)
          const extIn = extInBias ? extInBias[u] : 0
          const extOut = extOutBias ? extOutBias[u] : 0
          const phi = wOut - wIn + 0.35 * (extIn - extOut)
          if (phi > bestPhi + 1e-9 || (Math.abs(phi - bestPhi) <= 1e-9 && (bestU === -1 || u < bestU))) {
            bestPhi = phi
            bestU = u
          }
        }
        active.delete(bestU)
        s1.push(bestU)
      }
    }

    const seq = [...s1, ...s2.reverse()]
    seq.forEach((u, rank) => {
      sccPos[u] = rank
    })
    for (const ce of compEdges) {
      if (sccPos[ce.from] > sccPos[ce.to]) {
        backEdgeIndices.add(ce.idx)
        intraFeedbackIndices.add(ce.idx)
      }
    }
  }

  // 4) 极小 FAS 清洗：按边权降序复核非双向回边，若当前 DAG 无 v -> u 路径则恢复为正向边。
  if (intraFeedbackIndices.size > 0) {
    const dagAdj: number[][] = Array.from({ length: count }, () => [])
    for (let i = 0; i < edges.length; i++) {
      if (!backEdgeIndices.has(i)) dagAdj[edges[i].from].push(edges[i].to)
    }
    const candidates = [...intraFeedbackIndices].sort(
      (a, b) => edges[b].weight - edges[a].weight || a - b,
    )
    for (const idx of candidates) {
      const e = edges[idx]
      if (!isReachable(count, dagAdj, e.to, e.from)) {
        backEdgeIndices.delete(idx)
        intraFeedbackIndices.delete(idx)
        dagAdj[e.from].push(e.to)
      }
    }
  }

  // 基于清洗后无环子图执行 Kahn 拓扑序与依赖分层；纯无环图保持与既有逻辑完全一致的排序。
  const depHasBackEdge = [...backEdgeIndices].some((idx) => edges[idx].dependency)
  const isAcyclic = !depHasBackEdge

  const workingIn = Array<number>(count).fill(0)
  const kahnEdges: IntraEdge[] = []
  for (let i = 0; i < edges.length; i++) {
    if (backEdgeIndices.has(i)) continue
    const e = edges[i]
    if (isAcyclic ? e.dependency : true) {
      kahnEdges.push(e)
      workingIn[e.to]++
    }
  }
  const order: number[] = []
  const remaining = new Set(Array.from({ length: count }, (_, i) => i))
  while (remaining.size) {
    const ready = [...remaining]
      .filter((i) => workingIn[i] === 0)
      .sort((a, b) => {
        if (sccId[a] >= 0 && sccId[a] === sccId[b] && sccPos[a] !== sccPos[b]) {
          return sccPos[a] - sccPos[b]
        }
        return degree[b] - degree[a] || a - b
      })
    const next =
      ready[0] ??
      [...remaining].sort((a, b) => workingIn[a] - workingIn[b] || degree[b] - degree[a] || a - b)[0]!
    remaining.delete(next)
    order.push(next)
    for (const e of kahnEdges) {
      if (e.from === next) workingIn[e.to]--
    }
  }

  const layer = Array<number>(count).fill(0)
  if (isAcyclic) {
    for (const u of order) {
      for (let i = 0; i < edges.length; i++) {
        if (backEdgeIndices.has(i)) continue
        const e = edges[i]
        if (e.dependency && e.from === u) {
          layer[e.to] = Math.max(layer[e.to], layer[u] + 1)
        }
      }
    }
  }

  return {
    degree,
    indegree,
    outdegree,
    order,
    layer,
    isAcyclic,
    sccId,
    backEdgeIndices,
    intraFeedbackIndices,
  }
}

// ---------- O(1) 解析几何工具：Liang-Barsky 线段穿卡与 AABB 剪枝交叉检测（T350） ----------

function segmentHitsInsetRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  inset = CARD_PIERCE_INSET,
): boolean {
  const ix = rw > inset * 2 ? inset : 0
  const iy = rh > inset * 2 ? inset : 0
  const x0 = rx + ix
  const y0 = ry + iy
  const x1 = rx + rw - ix
  const y1 = ry + rh - iy
  if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) {
    return false
  }
  let t0 = 0
  let t1 = 1
  const dx = bx - ax
  const dy = by - ay
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
  return clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay) && t0 <= t1
}

function segmentsProperlyCross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  if (
    Math.max(ax, bx) < Math.min(cx, dx) ||
    Math.min(ax, bx) > Math.max(cx, dx) ||
    Math.max(ay, by) < Math.min(cy, dy) ||
    Math.min(ay, by) > Math.max(cy, dy)
  ) {
    return false
  }
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax)
  if (d1 * d2 >= -1e-6) return false
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx)
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx)
  return d3 * d4 < -1e-6
}

function rectsOverlapWithMargin(a: Rect, b: Rect, margin: number): boolean {
  return (
    a.x < b.x + b.width + margin &&
    a.x + a.width + margin > b.x &&
    a.y < b.y + b.height + margin &&
    a.y + a.height + margin > b.y
  )
}

// ---------- 闭式四分位曲线代理 evalProxyQ25Q75（T351） ----------

function sideNormalVec(side: 'left' | 'right' | 'top' | 'bottom'): [number, number] {
  switch (side) {
    case 'left':
      return [-1, 0]
    case 'right':
      return [1, 0]
    case 'top':
      return [0, -1]
    case 'bottom':
      return [0, 1]
  }
}

function estimatedCrossAxis(r: Rect, horizontal: boolean): number {
  if (!horizontal) return r.x + r.width / 2
  const inset = Math.min(r.height / 4, PORT_INSET_Y)
  return r.y + clamp(SINGLE_SIDE_TOP_OFFSET, inset, r.height - inset)
}

function evalProxyQ25Q75(
  fromIdx: number,
  toIdx: number,
  weight: number,
  rects: readonly Rect[],
  allCount: number,
): ProxyEdgeGeometry {
  const rA = rects[fromIdx]
  const rB = rects[toIdx]
  const axC = rA.x + rA.width / 2
  const ayC = rA.y + rA.height / 2
  const bxC = rB.x + rB.width / 2
  const byC = rB.y + rB.height / 2
  const cdx = bxC - axC
  const cdy = byC - ayC
  const vertical = Math.abs(cdy) > Math.abs(cdx) * 0.55

  let sourceSide: 'left' | 'right' | 'top' | 'bottom' = vertical
    ? cdy >= 0
      ? 'bottom'
      : 'top'
    : cdx >= 0
      ? 'right'
      : 'left'
  let targetSide: 'left' | 'right' | 'top' | 'bottom' = vertical
    ? cdy >= 0
      ? 'top'
      : 'bottom'
    : cdx >= 0
      ? 'left'
      : 'right'

  // 1) 与 edge-routing.ts 数学同构的单趟跨度感知直挡拱桥检测
  let isArch = false
  let archSide: 'left' | 'right' | 'top' | 'bottom' | undefined
  let archClearance = 0
  let blockedCards = 0

  const horizFacing = sourceSide === 'left' || sourceSide === 'right'
  const aM0 = horizFacing ? rA.x : rA.y
  const aM1 = horizFacing ? rA.x + rA.width : rA.y + rA.height
  const aC0 = horizFacing ? rA.y : rA.x
  const aC1 = horizFacing ? rA.y + rA.height : rA.x + rA.width
  const bM0 = horizFacing ? rB.x : rB.y
  const bM1 = horizFacing ? rB.x + rB.width : rB.y + rB.height
  const bC0 = horizFacing ? rB.y : rB.x
  const bC1 = horizFacing ? rB.y + rB.height : rB.x + rB.width

  const crossOverlap = Math.min(aC1, bC1) - Math.max(aC0, bC0)
  const crossDiff = Math.abs((aC0 + aC1) / 2 - (bC0 + bC1) / 2)
  if (crossOverlap >= 0 || crossDiff <= 0.5 * Math.min(aC1 - aC0, bC1 - bC0)) {
    const aFirst = aM0 <= bM0
    const lo = aFirst ? aM1 : bM1
    const hi = aFirst ? bM0 : aM0
    if (hi > lo) {
      const cFirst = estimatedCrossAxis(aFirst ? rA : rB, horizFacing)
      const cSecond = estimatedCrossAxis(aFirst ? rB : rA, horizFacing)
      const lineAt = (m: number) => cFirst + ((cSecond - cFirst) * (clamp(m, lo, hi) - lo)) / (hi - lo)
      const betweenC0: number[] = []
      const betweenC1: number[] = []
      let blocked = false
      for (let k = 0; k < allCount; k++) {
        if (k === fromIdx || k === toIdx) continue
        const rk = rects[k]
        const om0 = horizFacing ? rk.x : rk.y
        const om1 = horizFacing ? rk.x + rk.width : rk.y + rk.height
        const center = (om0 + om1) / 2
        if (center <= lo || center >= hi) continue
        const oc0 = horizFacing ? rk.y : rk.x
        const oc1 = horizFacing ? rk.y + rk.height : rk.x + rk.width
        betweenC0.push(oc0)
        betweenC1.push(oc1)
        let depth = 0
        for (const m of [om0, center, om1]) {
          const y = lineAt(m)
          const d = Math.min(y - oc0, oc1 - y)
          if (d > depth) depth = d
        }
        const enter = Math.min(HEAD_ON_ENTER_DEPTH, 0.25 * (oc1 - oc0))
        if (depth >= enter) {
          blocked = true
          blockedCards++
        }
      }
      if (blocked) {
        const corridorMin = Math.min(aC0, bC0)
        const corridorMax = Math.max(aC1, bC1)
        const outerLo = Math.min(aM0, bM0) - OUTER_SPAN_MARGIN
        const outerHi = Math.max(aM1, bM1) + OUTER_SPAN_MARGIN
        const sides: readonly ('left' | 'right' | 'top' | 'bottom')[] = horizFacing
          ? ['top', 'bottom']
          : ['left', 'right']
        let bestSide: 'left' | 'right' | 'top' | 'bottom' | undefined
        let bestClear = 0
        let bestScore = Infinity
        for (const side of sides) {
          const low = side === 'top' || side === 'left'
          let hasOuter = false
          for (let k = 0; k < allCount; k++) {
            if (k === fromIdx || k === toIdx) continue
            const rk = rects[k]
            const om0 = horizFacing ? rk.x : rk.y
            const om1 = horizFacing ? rk.x + rk.width : rk.y + rk.height
            if (om1 < outerLo || om0 > outerHi) continue
            const oc0 = horizFacing ? rk.y : rk.x
            const oc1 = horizFacing ? rk.y + rk.height : rk.x + rk.width
            const cMid = (oc0 + oc1) / 2
            if (low ? cMid < corridorMin : cMid > corridorMax) {
              hasOuter = true
              break
            }
          }
          if (hasOuter) continue
          const portLevel = low ? corridorMin : corridorMax
          let clear = 0
          let protruding = 0
          for (let i = 0; i < betweenC0.length; i++) {
            if (low ? betweenC0[i] < portLevel : betweenC1[i] > portLevel) {
              protruding++
              const diff = low ? portLevel - betweenC0[i] : betweenC1[i] - portLevel
              if (diff > clear) clear = diff
            }
          }
          const score = clear + 16 * protruding
          if (score < bestScore) {
            bestScore = score
            bestSide = side
            bestClear = clear
          }
        }
        if (bestSide) {
          isArch = true
          archSide = bestSide
          archClearance = bestClear
          sourceSide = bestSide
          targetSide = bestSide
        }
      }
    }
  }

  // 2) 端口锚点估算（同步 SINGLE_SIDE_TOP_OFFSET = 43 与单端口安全投影对齐）
  let sx: number
  let sy: number
  let tx: number
  let ty: number
  if (!isArch) {
    if (horizFacing) {
      sx = sourceSide === 'right' ? rA.x + rA.width : rA.x
      tx = targetSide === 'right' ? rB.x + rB.width : rB.x
      const insetA = Math.min(rA.height / 4, PORT_INSET_Y)
      const insetB = Math.min(rB.height / 4, PORT_INSET_Y)
      sy = rA.y + clamp(SINGLE_SIDE_TOP_OFFSET, insetA, rA.height - insetA)
      ty = rB.y + clamp(SINGLE_SIDE_TOP_OFFSET, insetB, rB.height - insetB)
      if (sy >= rB.y + insetB && sy <= rB.y + rB.height - insetB) ty = sy
      else if (ty >= rA.y + insetA && ty <= rA.y + rA.height - insetA) sy = ty
    } else {
      sy = sourceSide === 'bottom' ? rA.y + rA.height : rA.y
      ty = targetSide === 'bottom' ? rB.y + rB.height : rB.y
      const insetA = Math.min(rA.width / 4, PORT_INSET_X)
      const insetB = Math.min(rB.width / 4, PORT_INSET_X)
      sx = axC
      tx = bxC
      if (sx >= rB.x + insetB && sx <= rB.x + rB.width - insetB) tx = sx
      else if (tx >= rA.x + insetA && tx <= rA.x + rA.width - insetA) sx = tx
    }
  } else {
    if (sourceSide === 'left' || sourceSide === 'right') {
      sx = sourceSide === 'right' ? rA.x + rA.width : rA.x
      tx = targetSide === 'right' ? rB.x + rB.width : rB.x
      const insetA = Math.min(rA.height / 4, PORT_INSET_Y)
      const insetB = Math.min(rB.height / 4, PORT_INSET_Y)
      sy = rA.y + clamp(SINGLE_SIDE_TOP_OFFSET, insetA, rA.height - insetA)
      ty = rB.y + clamp(SINGLE_SIDE_TOP_OFFSET, insetB, rB.height - insetB)
    } else {
      sy = sourceSide === 'bottom' ? rA.y + rA.height : rA.y
      ty = targetSide === 'bottom' ? rB.y + rB.height : rB.y
      sx = axC
      tx = bxC
    }
  }

  const [usx, usy] = sideNormalVec(sourceSide)
  const [utx, uty] = sideNormalVec(targetSide)

  // 3) 直线拉直判定与闭式四分位折线生成
  let isStraight = false
  let p0: Point
  let q25: Point
  let q75: Point
  let p3: Point
  if (!isArch) {
    const abx = tx - sx
    const aby = ty - sy
    const len = Math.hypot(abx, aby)
    const along = abx * usx + aby * usy
    const across = Math.abs(abx * -usy + aby * usx)
    if (len > 1e-6 && along >= MIN_STRAIGHT_SPAN && across <= STRAIGHT_DEADZONE) {
      isStraight = true
      const dirX = abx / len
      const dirY = aby / len
      p0 = { x: sx, y: sy }
      p3 = { x: tx - dirX * ARROW_RETRACT, y: ty - dirY * ARROW_RETRACT }
      q25 = { x: p0.x + (p3.x - p0.x) * 0.25, y: p0.y + (p3.y - p0.y) * 0.25 }
      q75 = { x: p0.x + (p3.x - p0.x) * 0.75, y: p0.y + (p3.y - p0.y) * 0.75 }
    } else {
      p0 = { x: sx, y: sy }
      p3 = { x: tx + utx * ARROW_RETRACT, y: ty + uty * ARROW_RETRACT }
      const dx = p3.x - p0.x
      const dy = p3.y - p0.y
      const dParallel = dx * usx + dy * usy
      const dPerp = Math.abs(dx * -usy + dy * usx)
      const h =
        dParallel >= MIN_STRAIGHT_SPAN
          ? clamp(dParallel * 0.42, 24, MAX_BEZIER_HANDLE)
          : clamp(32 + Math.sqrt(Math.abs(dParallel) * 18) + dPerp * 0.15, 42, 120)
      const c1x = p0.x + h * usx
      const c1y = p0.y + h * usy
      const c2x = p3.x + h * utx
      const c2y = p3.y + h * uty
      q25 = {
        x: (27 * p0.x + 27 * c1x + 9 * c2x + p3.x) / 64,
        y: (27 * p0.y + 27 * c1y + 9 * c2y + p3.y) / 64,
      }
      q75 = {
        x: (p0.x + 9 * c1x + 27 * c2x + 27 * p3.x) / 64,
        y: (p0.y + 9 * c1y + 27 * c2y + 27 * p3.y) / 64,
      }
    }
  } else {
    p0 = { x: sx, y: sy }
    p3 = { x: tx + utx * ARROW_RETRACT, y: ty + uty * ARROW_RETRACT }
    const dx = p3.x - p0.x
    const dy = p3.y - p0.y
    const dOut = dx * usx + dy * usy
    const lPerp = Math.abs(dx * -usy + dy * usx)
    const a0 = clamp(0.18 * lPerp + 26, 36, 92)
    const baseH = Math.min(MAX_ARCH_HANDLE, Math.max(a0, (4 / 3) * (archClearance + 14)))
    const hs = baseH + Math.max(0, dOut)
    const he = baseH + Math.max(0, -dOut)
    const c1x = p0.x + hs * usx
    const c1y = p0.y + hs * usy
    const c2x = p3.x + he * utx
    const c2y = p3.y + he * uty
    q25 = {
      x: (27 * p0.x + 27 * c1x + 9 * c2x + p3.x) / 64,
      y: (27 * p0.y + 27 * c1y + 9 * c2y + p3.y) / 64,
    }
    q75 = {
      x: (p0.x + 9 * c1x + 27 * c2x + 27 * p3.x) / 64,
      y: (p0.y + 9 * c1y + 27 * c2y + 27 * p3.y) / 64,
    }
  }

  const points: [Point, Point, Point, Point] = [p0, q25, q75, p3]
  const bbox = {
    x0: Math.min(p0.x, q25.x, q75.x, p3.x),
    y0: Math.min(p0.y, q25.y, q75.y, p3.y),
    x1: Math.max(p0.x, q25.x, q75.x, p3.x),
    y1: Math.max(p0.y, q25.y, q75.y, p3.y),
  }

  // 4) 解析穿卡惩罚与直线拉直奖励
  const isVertAxis = Math.abs(rA.x - rB.x) <= SNAP_STRAIGHT_THRESHOLD
  const isHorizAxis = Math.abs(rA.y - rB.y) <= SNAP_STRAIGHT_THRESHOLD
  let pierceCost = 0
  if (isArch) {
    pierceCost = LEGAL_OUTER_ARCH_PENALTY * Math.max(1, blockedCards)
  } else {
    const unitPenalty = isVertAxis
      ? PIERCE_INNER_VERT_PENALTY
      : isHorizAxis
        ? PIERCE_HORIZ_PENALTY
        : PIERCE_DIAG_PENALTY
    for (let k = 0; k < allCount; k++) {
      if (k === fromIdx || k === toIdx) continue
      const rk = rects[k]
      if (
        rk.x + rk.width < bbox.x0 ||
        rk.x > bbox.x1 ||
        rk.y + rk.height < bbox.y0 ||
        rk.y > bbox.y1
      ) {
        continue
      }
      if (
        segmentHitsInsetRect(p0.x, p0.y, q25.x, q25.y, rk.x, rk.y, rk.width, rk.height) ||
        segmentHitsInsetRect(q25.x, q25.y, q75.x, q75.y, rk.x, rk.y, rk.width, rk.height) ||
        segmentHitsInsetRect(q75.x, q75.y, p3.x, p3.y, rk.x, rk.y, rk.width, rk.height)
      ) {
        pierceCost += unitPenalty
      }
    }
  }

  const straightBonus = isStraight ? STRAIGHT_PROXY_BONUS * weight : 0
  const vertY0 = Math.min(rA.y + rA.height, rB.y + rB.height)
  const vertY1 = Math.max(rA.y, rB.y)
  const horizX0 = Math.min(rA.x + rA.width, rB.x + rB.width)
  const horizX1 = Math.max(rA.x, rB.x)

  return {
    isStraight,
    isArch,
    archSide,
    points,
    bbox,
    blockedCards,
    pierceCost,
    straightBonus,
    vertColX: (rA.x + rB.x) / 2,
    vertY0,
    vertY1,
    isVertAxis: isVertAxis && vertY1 > vertY0 + 10,
    horizRowY: (rA.y + rB.y) / 2,
    horizX0,
    horizX1,
    isHorizAxis: isHorizAxis && horizX1 > horizX0 + 10,
  }
}

function computePairEdgeCost(
  a: ProxyEdgeGeometry,
  b: ProxyEdgeGeometry,
  sharesEndpoint: boolean,
): number {
  let cost = 0
  // 1) 非共端点代理折线真实交叉检测
  if (
    !sharesEndpoint &&
    a.bbox.x1 >= b.bbox.x0 &&
    a.bbox.x0 <= b.bbox.x1 &&
    a.bbox.y1 >= b.bbox.y0 &&
    a.bbox.y0 <= b.bbox.y1
  ) {
    let crossed = false
    for (let i = 0; i < 3 && !crossed; i++) {
      const p1 = a.points[i]
      const p2 = a.points[i + 1]
      for (let j = 0; j < 3; j++) {
        const q1 = b.points[j]
        const q2 = b.points[j + 1]
        if (segmentsProperlyCross(p1.x, p1.y, p2.x, p2.y, q1.x, q1.y, q2.x, q2.y)) {
          crossed = true
          break
        }
      }
    }
    if (crossed) cost += PROXY_CROSS_PENALTY
  }

  // 2) 同列竖段 / 同行横段 / 同侧外拱桥重叠检测
  if (a.isVertAxis && b.isVertAxis && Math.abs(a.vertColX - b.vertColX) <= SNAP_STRAIGHT_THRESHOLD) {
    if (Math.min(a.vertY1, b.vertY1) - Math.max(a.vertY0, b.vertY0) > 10) {
      if (!a.isArch && !b.isArch) {
        cost += SAME_COL_VERT_OVERLAP_PENALTY
      } else if (a.isArch && b.isArch && a.archSide === b.archSide) {
        cost += SAME_SIDE_ARCH_OVERLAP_PENALTY
      }
    }
  }
  if (a.isHorizAxis && b.isHorizAxis && Math.abs(a.horizRowY - b.horizRowY) <= SNAP_STRAIGHT_THRESHOLD) {
    if (Math.min(a.horizX1, b.horizX1) - Math.max(a.horizX0, b.horizX0) > 10) {
      if (!a.isArch && !b.isArch) {
        cost += SAME_ROW_HORIZ_OVERLAP_PENALTY
      } else if (a.isArch && b.isArch && a.archSide === b.archSide) {
        cost += SAME_SIDE_ARCH_OVERLAP_PENALTY
      }
    }
  }
  return cost
}

// ---------- 四阶段全视图实高联合求解器（T350 / T351 / T352 / T355） ----------

interface GlobalEdge {
  from: number
  to: number
  dependency: boolean
  weight: number
  intraBucket: number // >= 0 表示同桶边，-1 表示跨桶边
  intraFeedback: boolean
  sameScc: boolean
}

interface GlobalBucket {
  groupId: string | undefined
  nodeIndices: number[]
  gridCols: number
  rows: number
  useLayeredSeed: boolean
  isPinnedBucket: boolean
  fixedBox?: Rect
  baseXOverride?: number
  baseYOverride?: number
}

interface GlobalSolverInput {
  mode: 'vertical' | 'grid'
  verticalGap: number
  nodeIds: string[]
  nodeH: Float64Array
  nodeBucket: Int32Array
  buckets: GlobalBucket[]
  edges: GlobalEdge[]
  isPinned: Uint8Array
  pinnedX: Float64Array
  pinnedY: Float64Array
  pinnedW: Float64Array
  /** 单桶外部参考锚点（仅 placeBucketNodes 带 anchors 时使用） */
  externalRects?: Rect[]
  /** 单桶模式下的局部锚点外部边（指向 externalRects 的节点下标，从 nodeIds.length 起算） */
  externalEdgeExtraCount?: number
  singleBucketOrigin?: { baseX: number; baseY: number }
}

interface GlobalSolverState {
  input: GlobalSolverInput
  totalNodes: number // 视图内节点数
  allRectCount: number // 含外部锚点的总矩形数
  nodeRow: Int32Array
  nodeCol: Int32Array
  layer: Int32Array
  intraDeg: Int32Array
  totalDeg: Int32Array
  bucketMaxRow: Int32Array
  colLefts: [number, number]
  colWidths: [number, number]
}

// 依据真实卡片高度实时重建全视图卡片矩形与分组边界（T350），支持候选试探期冻结非活动桶原点。
function computeViewGeometry(
  state: GlobalSolverState,
  rects: Rect[],
  groupTops: number[],
  groupBottoms: number[],
  frozenActiveBi = -1,
): void {
  const { input, nodeRow, nodeCol } = state
  const { buckets, nodeH, isPinned, pinnedX, pinnedY, pinnedW, mode, verticalGap, singleBucketOrigin } = input

  // 辅助：计算单桶内每个离散行的真实 y 偏移（压缩空行，累加各行最大实测卡片高度 + ROW_GAP）。
  const placeBucketRects = (bi: number, cardBaseX: number, cardBaseY: number): number => {
    const bucket = buckets[bi]
    const members = bucket.nodeIndices
    if (bucket.isPinnedBucket) {
      let maxBottom = cardBaseY - GROUP_PAD_TOP + 178
      for (const idx of members) {
        const r = rects[idx]
        r.x = pinnedX[idx]
        r.y = pinnedY[idx]
        r.width = pinnedW[idx]
        r.height = nodeH[idx]
        const b = r.y + r.height + GROUP_PAD_BOTTOM
        if (b > maxBottom) maxBottom = b
      }
      return bucket.fixedBox ? bucket.fixedBox.y + bucket.fixedBox.height : maxBottom
    }

    let maxRow = 0
    for (const idx of members) {
      if (!isPinned[idx] && nodeRow[idx] > maxRow) maxRow = nodeRow[idx]
    }
    const rowMaxH = new Float64Array(maxRow + 1)
    for (const idx of members) {
      if (isPinned[idx]) continue
      const r = nodeRow[idx]
      if (nodeH[idx] > rowMaxH[r]) rowMaxH[r] = nodeH[idx]
    }
    const rowY = new Float64Array(maxRow + 1)
    let curY = cardBaseY
    for (let r = 0; r <= maxRow; r++) {
      rowY[r] = curY
      if (rowMaxH[r] > 0) curY += rowMaxH[r] + ROW_GAP
    }

    let maxBottom = cardBaseY - GROUP_PAD_TOP + 178
    for (const idx of members) {
      const rect = rects[idx]
      if (isPinned[idx]) {
        rect.x = pinnedX[idx]
        rect.y = pinnedY[idx]
        rect.width = pinnedW[idx]
        rect.height = nodeH[idx]
      } else {
        rect.x = cardBaseX + nodeCol[idx] * COL_STEP
        rect.y = rowY[nodeRow[idx]]
        rect.width = CARD_WIDTH
        rect.height = nodeH[idx]
      }
      const b = rect.y + rect.height + GROUP_PAD_BOTTOM
      if (b > maxBottom) maxBottom = b
    }
    return bucket.fixedBox ? bucket.fixedBox.y + bucket.fixedBox.height : maxBottom
  }

  if (singleBucketOrigin) {
    const bi = 0
    groupTops[0] = singleBucketOrigin.baseY - GROUP_PAD_TOP
    groupBottoms[0] = placeBucketRects(bi, singleBucketOrigin.baseX, singleBucketOrigin.baseY)
    return
  }

  if (frozenActiveBi >= 0) {
    const b = buckets[frozenActiveBi]
    const cardBaseX = b.fixedBox
      ? b.fixedBox.x + GROUP_PAD_X
      : mode === 'grid'
        ? state.colLefts[frozenActiveBi % 2] + GROUP_PAD_X
        : 42 + GROUP_PAD_X
    const cardBaseY = b.fixedBox ? b.fixedBox.y + GROUP_PAD_TOP : groupTops[frozenActiveBi] + GROUP_PAD_TOP
    groupBottoms[frozenActiveBi] = placeBucketRects(frozenActiveBi, cardBaseX, cardBaseY)
    return
  }

  if (mode === 'vertical') {
    let curTop = 48
    for (let bi = 0; bi < buckets.length; bi++) {
      const b = buckets[bi]
      const gTop = b.fixedBox ? b.fixedBox.y : curTop
      const cardBaseX = b.fixedBox ? b.fixedBox.x + GROUP_PAD_X : 42 + GROUP_PAD_X
      groupTops[bi] = gTop
      const gBottom = placeBucketRects(bi, cardBaseX, gTop + GROUP_PAD_TOP)
      groupBottoms[bi] = gBottom
      curTop = gBottom + verticalGap
    }
    return
  }

  // 'grid' 双列实高实宽几何重建：先按各列最大真实列宽计算 colWidths 与 colLefts，再按同行最大真实高累加 rowTops。
  const colWidths: [number, number] = [0, 0]
  for (let bi = 0; bi < buckets.length; bi++) {
    const b = buckets[bi]
    const col = bi % 2
    let w: number
    if (b.fixedBox) {
      w = b.fixedBox.width
    } else if (b.nodeIndices.length === 0) {
      w = 320
    } else {
      let maxCol = 0
      for (const idx of b.nodeIndices) {
        if (!isPinned[idx] && nodeCol[idx] > maxCol) maxCol = nodeCol[idx]
      }
      w = maxCol * COL_STEP + CARD_WIDTH + GROUP_PAD_X * 2
    }
    if (w > colWidths[col]) colWidths[col] = w
  }
  if (colWidths[0] <= 0) colWidths[0] = 320
  if (colWidths[1] <= 0) colWidths[1] = 320
  state.colWidths = colWidths
  state.colLefts = [42, 42 + colWidths[0] + GRID_GROUP_GAP]

  let rowTop = 48
  for (let i = 0; i < buckets.length; i += 2) {
    const rowEnd = Math.min(buckets.length, i + 2)
    let rowMaxH = 0
    for (let bi = i; bi < rowEnd; bi++) {
      const b = buckets[bi]
      const gTop = b.fixedBox ? b.fixedBox.y : rowTop
      const cardBaseX = b.fixedBox ? b.fixedBox.x + GROUP_PAD_X : state.colLefts[bi % 2] + GROUP_PAD_X
      groupTops[bi] = gTop
      const gBottom = placeBucketRects(bi, cardBaseX, gTop + GROUP_PAD_TOP)
      groupBottoms[bi] = gBottom
      const h = gBottom - gTop
      if (h > rowMaxH) rowMaxH = h
    }
    rowTop += rowMaxH + GRID_GROUP_GAP
  }
}

function updateBucketMaxRows(state: GlobalSolverState): void {
  const { buckets, isPinned } = state.input
  for (let bi = 0; bi < buckets.length; bi++) {
    let maxR = 0
    for (const idx of buckets[bi].nodeIndices) {
      if (!isPinned[idx] && state.nodeRow[idx] > maxR) maxR = state.nodeRow[idx]
    }
    state.bucketMaxRow[bi] = maxR
  }
}

function computeSingleNodeCost(state: GlobalSolverState, idx: number, rects: readonly Rect[]): number {
  const { input, nodeRow, nodeCol, layer, intraDeg } = state
  if (input.isPinned[idx]) return 0
  const bi = input.nodeBucket[idx]
  const bucket = input.buckets[bi]
  let cost = 28 * nodeRow[idx]
  if (bucket.useLayeredSeed && intraDeg[idx] > 0) {
    cost += 220 * Math.abs(nodeRow[idx] - layer[idx])
  }
  if (intraDeg[idx] >= 3) {
    if (bucket.gridCols === 3 && nodeCol[idx] === 1) cost -= 35 * intraDeg[idx]
    if (bucket.rows >= 3 && nodeRow[idx] > 0 && nodeRow[idx] < bucket.rows - 1) cost -= 20 * intraDeg[idx]
  }
  // 局部整理模式下对所有钉死卡片保持 24px 净空硬隔离。
  const ri = rects[idx]
  for (let p = 0; p < state.totalNodes; p++) {
    if (!input.isPinned[p] || p === idx) continue
    if (rectsOverlapWithMargin(ri, rects[p], GROUP_PAD_X)) {
      cost += PINNED_OVERLAP_PENALTY
    }
  }
  return cost
}

function computeSingleEdgeSelfCost(
  state: GlobalSolverState,
  edge: GlobalEdge,
  proxy: ProxyEdgeGeometry,
  rects: readonly Rect[],
  minSceneX: number,
  maxSceneX: number,
): number {
  const { input, nodeRow, nodeCol, bucketMaxRow } = state
  const u = edge.from
  const v = edge.to
  let cost = proxy.pierceCost + proxy.straightBonus

  const isInteriorX = (x: number) =>
    minSceneX < x - SNAP_STRAIGHT_THRESHOLD && maxSceneX > x + SNAP_STRAIGHT_THRESHOLD

  if (edge.intraBucket >= 0) {
    const ru = nodeRow[u]
    const cu = nodeCol[u]
    const rv = nodeRow[v]
    const cv = nodeCol[v]
    const dr = Math.abs(ru - rv)
    const dc = Math.abs(cu - cv)
    cost += edge.weight * (40 * (dr + dc - 1) ** 2 + 25 * dr * dc)
    if (edge.dependency && !edge.intraFeedback) {
      if (ru > rv) cost += 45
      if (ru === rv && ru % 2 === 0 && cu > cv) cost += 15
    }
    if (edge.sameScc && dr + dc > 1) {
      cost += INTRA_SCC_COHESION_WEIGHT * (dr + dc - 1)
    }
    return cost
  }

  // 跨分组边（含单桶外部锚点边）
  const rU = rects[u]
  const rV = rects[v]
  const dx = Math.abs(rU.x + rU.width / 2 - (rV.x + rV.width / 2))
  const dy = Math.abs(rU.y + rU.height / 2 - (rV.y + rV.height / 2))
  const bu = u < state.totalNodes ? input.nodeBucket[u] : -1
  const bv = v < state.totalNodes ? input.nodeBucket[v] : -1

  if (input.mode === 'grid' && bu >= 0 && bv >= 0) {
    const grU = Math.floor(bu / 2)
    const grV = Math.floor(bv / 2)
    const gcU = bu % 2
    const gcV = bv % 2
    if (grU === grV) {
      cost += edge.weight * (0.55 * dy + 0.35 * dx)
    } else if (gcU === gcV) {
      cost += edge.weight * (0.55 * dx + 0.15 * dy)
    } else {
      cost += edge.weight * (0.4 * dx + 0.4 * dy)
    }
    if (grU < grV) {
      const distU = input.isPinned[u] ? 0 : Math.max(0, bucketMaxRow[bu] - nodeRow[u])
      const distV = input.isPinned[v] ? 0 : nodeRow[v]
      cost += BOUNDARY_PROXIMITY_WEIGHT * edge.weight * (distU + distV)
    }
    const isFeedbackOrSkip = grU > grV || Math.abs(grU - grV) >= 2
    if (
      isFeedbackOrSkip &&
      Math.abs(rU.x - rV.x) <= SNAP_STRAIGHT_THRESHOLD &&
      !isInteriorX(rU.x)
    ) {
      cost += OUTER_FEEDBACK_BONUS * edge.weight
    }
  } else {
    cost += edge.weight * (0.45 * dx + 0.08 * dy)
    if (bu >= 0 && bv >= 0) {
      if (bu < bv) {
        const distU = input.isPinned[u] ? 0 : Math.max(0, bucketMaxRow[bu] - nodeRow[u])
        const distV = input.isPinned[v] ? 0 : nodeRow[v]
        cost += BOUNDARY_PROXIMITY_WEIGHT * edge.weight * (distU + distV)
      }
      const isFeedbackOrSkip = bu > bv || Math.abs(bu - bv) >= 2
      if (
        isFeedbackOrSkip &&
        Math.abs(rU.x - rV.x) <= SNAP_STRAIGHT_THRESHOLD &&
        !isInteriorX(rU.x)
      ) {
        cost += OUTER_FEEDBACK_BONUS * edge.weight
      }
    }
  }
  return cost
}

function createEvalCache(state: GlobalSolverState): IncrementalEvalCache {
  const { allRectCount, totalNodes, input } = state
  const rects: Rect[] = Array.from({ length: allRectCount }, (_, i) => {
    if (i < totalNodes) return { x: 0, y: 0, width: CARD_WIDTH, height: input.nodeH[i] }
    const ext = input.externalRects![i - totalNodes]
    return { x: ext.x, y: ext.y, width: ext.width, height: ext.height }
  })
  const groupTops = Array<number>(input.buckets.length).fill(0)
  const groupBottoms = Array<number>(input.buckets.length).fill(0)
  const M = input.edges.length
  const cache: IncrementalEvalCache = {
    rects,
    groupTops,
    groupBottoms,
    proxyEdges: Array<ProxyEdgeGeometry>(M),
    pairCostMat: new Float64Array(M * M),
    edgeSelfCosts: new Float64Array(M),
    nodeCosts: new Float64Array(totalNodes),
    minSceneX: Infinity,
    maxSceneX: -Infinity,
    totalNodeCost: 0,
    totalSelfCost: 0,
    totalPairCost: 0,
  }
  refreshCacheFull(state, cache)
  return cache
}

function refreshCacheFull(state: GlobalSolverState, cache: IncrementalEvalCache): number {
  const { input, totalNodes, allRectCount } = state
  const { edges } = input
  const M = edges.length
  updateBucketMaxRows(state)
  computeViewGeometry(state, cache.rects, cache.groupTops, cache.groupBottoms, -1)

  let minX = Infinity
  let maxX = -Infinity
  for (let i = 0; i < allRectCount; i++) {
    const rx = cache.rects[i].x
    if (rx < minX) minX = rx
    if (rx > maxX) maxX = rx
  }
  cache.minSceneX = minX
  cache.maxSceneX = maxX

  let totalNodeCost = 0
  for (let i = 0; i < totalNodes; i++) {
    const c = computeSingleNodeCost(state, i, cache.rects)
    cache.nodeCosts[i] = c
    totalNodeCost += c
  }
  cache.totalNodeCost = totalNodeCost

  let totalSelfCost = 0
  for (let e = 0; e < M; e++) {
    const edge = edges[e]
    const proxy = evalProxyQ25Q75(edge.from, edge.to, edge.weight, cache.rects, allRectCount)
    cache.proxyEdges[e] = proxy
    const selfCost = computeSingleEdgeSelfCost(state, edge, proxy, cache.rects, minX, maxX)
    cache.edgeSelfCosts[e] = selfCost
    totalSelfCost += selfCost
  }
  cache.totalSelfCost = totalSelfCost

  cache.pairCostMat.fill(0)
  let totalPairCost = 0
  for (let i = 0; i < M; i++) {
    const ei = edges[i]
    const pi = cache.proxyEdges[i]
    for (let j = i + 1; j < M; j++) {
      const ej = edges[j]
      const shares =
        ei.from === ej.from || ei.from === ej.to || ei.to === ej.from || ei.to === ej.to
      const pc = computePairEdgeCost(pi, cache.proxyEdges[j], shares)
      cache.pairCostMat[i * M + j] = pc
      cache.pairCostMat[j * M + i] = pc
      totalPairCost += pc
    }
  }
  cache.totalPairCost = totalPairCost
  return totalNodeCost + totalSelfCost + totalPairCost
}

// 增量脏边评估：候选探索期冻结非活动桶原点，仅重算受 dirtyBox（外扩 24px）影响的边与对称矩阵差量。
function evaluateCandidateDelta(
  state: GlobalSolverState,
  cache: IncrementalEvalCache,
  activeBi: number,
  nodeEdges: readonly (readonly number[])[],
): number {
  const { input, totalNodes, allRectCount } = state
  const { buckets, edges } = input
  const bucket = buckets[activeBi]
  const members = bucket.nodeIndices
  const M = edges.length

  // 保存活动桶旧矩形并收集旧范围
  const savedRects = members.map((idx) => ({ ...cache.rects[idx] }))
  const savedBottom = cache.groupBottoms[activeBi]
  const savedMaxRow = state.bucketMaxRow[activeBi]

  let maxR = 0
  for (const idx of members) {
    if (!input.isPinned[idx] && state.nodeRow[idx] > maxR) maxR = state.nodeRow[idx]
  }
  state.bucketMaxRow[activeBi] = maxR
  computeViewGeometry(state, cache.rects, cache.groupTops, cache.groupBottoms, activeBi)

  let dirtyX0 = Infinity
  let dirtyY0 = Infinity
  let dirtyX1 = -Infinity
  let dirtyY1 = -Infinity
  const changedSet = new Set<number>()
  for (let m = 0; m < members.length; m++) {
    const idx = members[m]
    const oldR = savedRects[m]
    const newR = cache.rects[idx]
    if (
      Math.abs(oldR.x - newR.x) > 1e-6 ||
      Math.abs(oldR.y - newR.y) > 1e-6 ||
      Math.abs(oldR.height - newR.height) > 1e-6
    ) {
      changedSet.add(idx)
      dirtyX0 = Math.min(dirtyX0, oldR.x, newR.x)
      dirtyY0 = Math.min(dirtyY0, oldR.y, newR.y)
      dirtyX1 = Math.max(dirtyX1, oldR.x + oldR.width, newR.x + newR.width)
      dirtyY1 = Math.max(dirtyY1, oldR.y + oldR.height, newR.y + newR.height)
    }
  }

  let newMinX = Infinity
  let newMaxX = -Infinity
  for (let i = 0; i < allRectCount; i++) {
    const rx = cache.rects[i].x
    if (rx < newMinX) newMinX = rx
    if (rx > newMaxX) newMaxX = rx
  }
  const sceneBoundsChanged =
    Math.abs(newMinX - cache.minSceneX) > 1e-6 || Math.abs(newMaxX - cache.maxSceneX) > 1e-6

  // 增量节点代价（活动桶内节点）
  let deltaNode = 0
  for (const idx of members) {
    const newC = computeSingleNodeCost(state, idx, cache.rects)
    deltaNode += newC - cache.nodeCosts[idx]
  }

  const isDirty = new Uint8Array(M)
  const dirtyList: number[] = []
  const markDirty = (e: number) => {
    if (!isDirty[e]) {
      isDirty[e] = 1
      dirtyList.push(e)
    }
  }

  if (sceneBoundsChanged || savedMaxRow !== maxR) {
    // 场景外边界列或活动桶最大行号变更时，标记受影响边确保与全量评分 100% 一致
    if (sceneBoundsChanged) {
      for (let e = 0; e < M; e++) markDirty(e)
    } else {
      for (const idx of members) {
        for (const e of nodeEdges[idx]) markDirty(e)
      }
    }
  }

  if (dirtyX0 <= dirtyX1) {
    const ex0 = dirtyX0 - DIRTY_BBOX_EXPAND
    const ey0 = dirtyY0 - DIRTY_BBOX_EXPAND
    const ex1 = dirtyX1 + DIRTY_BBOX_EXPAND
    const ey1 = dirtyY1 + DIRTY_BBOX_EXPAND
    for (const idx of changedSet) {
      for (const e of nodeEdges[idx]) markDirty(e)
    }
    for (let e = 0; e < M; e++) {
      if (isDirty[e]) continue
      const p = cache.proxyEdges[e]
      const b = p.bbox
      // 既检测代理包围盒交集，也检测轴向跨度重叠以防跨度感知外卡检测状态变更漏算
      if (
        (b.x1 >= ex0 && b.x0 <= ex1 && b.y1 >= ey0 && b.y0 <= ey1) ||
        (p.isVertAxis && p.vertY1 >= ey0 && p.vertY0 <= ey1) ||
        (p.isHorizAxis && p.horizX1 >= ex0 && p.horizX0 <= ex1)
      ) {
        markDirty(e)
      }
    }
  }

  const newProxies = new Map<number, ProxyEdgeGeometry>()
  let deltaSelf = 0
  for (const e of dirtyList) {
    const edge = edges[e]
    const proxy = evalProxyQ25Q75(edge.from, edge.to, edge.weight, cache.rects, allRectCount)
    newProxies.set(e, proxy)
    const selfC = computeSingleEdgeSelfCost(state, edge, proxy, cache.rects, newMinX, newMaxX)
    deltaSelf += selfC - cache.edgeSelfCosts[e]
  }

  let deltaPair = 0
  for (const e of dirtyList) {
    const pe = newProxies.get(e)!
    const edgeA = edges[e]
    for (let other = 0; other < M; other++) {
      if (other === e) continue
      if (isDirty[other] && other < e) continue
      const po = isDirty[other] ? newProxies.get(other)! : cache.proxyEdges[other]
      const edgeB = edges[other]
      const shares =
        edgeA.from === edgeB.from ||
        edgeA.from === edgeB.to ||
        edgeA.to === edgeB.from ||
        edgeA.to === edgeB.to
      const newPC = computePairEdgeCost(pe, po, shares)
      deltaPair += newPC - cache.pairCostMat[e * M + other]
    }
  }

  // 还原冻结试探期的活动桶矩形与元信息（不脏写缓存）
  for (let m = 0; m < members.length; m++) {
    const idx = members[m]
    const dst = cache.rects[idx]
    const src = savedRects[m]
    dst.x = src.x
    dst.y = src.y
    dst.width = src.width
    dst.height = src.height
  }
  cache.groupBottoms[activeBi] = savedBottom
  state.bucketMaxRow[activeBi] = savedMaxRow

  // 若局部整理有钉死卡片且非活动桶内节点不会移动，deltaNode 已涵盖活动桶内所有移动节点
  void totalNodes
  return cache.totalNodeCost + cache.totalSelfCost + cache.totalPairCost + deltaNode + deltaSelf + deltaPair
}

const COL_PERMS_3: readonly (readonly [number, number, number])[] = [
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]

function solveGlobalViewLayout(
  input: GlobalSolverInput,
): { nodeRow: Int32Array; nodeCol: Int32Array; rects: Rect[]; groupTops: number[]; groupBottoms: number[]; colLefts: [number, number]; colWidths: [number, number] } {
  const totalNodes = input.nodeIds.length
  const extCount = input.externalRects?.length ?? 0
  const allRectCount = totalNodes + extCount
  const nodeRow = new Int32Array(totalNodes)
  const nodeCol = new Int32Array(totalNodes)
  const layer = new Int32Array(totalNodes)
  const intraDeg = new Int32Array(totalNodes)
  const totalDeg = new Int32Array(totalNodes)
  const bucketMaxRow = new Int32Array(input.buckets.length)

  const nodeEdges: number[][] = Array.from({ length: totalNodes }, () => [])
  for (let ei = 0; ei < input.edges.length; ei++) {
    const e = input.edges[ei]
    if (e.from < totalNodes) {
      totalDeg[e.from]++
      nodeEdges[e.from].push(ei)
      if (e.intraBucket >= 0) intraDeg[e.from]++
    }
    if (e.to < totalNodes) {
      totalDeg[e.to]++
      nodeEdges[e.to].push(ei)
      if (e.intraBucket >= 0) intraDeg[e.to]++
    }
  }

  // ---------- 阶段一：桶内初始种子（孤立平铺 / useLayeredSeed / 加权 FAS 蛇形） ----------
  for (let bi = 0; bi < input.buckets.length; bi++) {
    const bucket = input.buckets[bi]
    const members = bucket.nodeIndices
    const unpinned = members.filter((idx) => !input.isPinned[idx])
    if (bucket.isPinnedBucket || unpinned.length === 0) continue

    const localMap = new Map<number, number>()
    members.forEach((gIdx, li) => localMap.set(gIdx, li))
    const localIntra: IntraEdge[] = []
    const localEdgeGlobalIds: number[] = []
    const extInBias = Array<number>(members.length).fill(0)
    const extOutBias = Array<number>(members.length).fill(0)
    let hasExtEdge = false

    for (let ei = 0; ei < input.edges.length; ei++) {
      const e = input.edges[ei]
      if (e.intraBucket === bi) {
        const lf = localMap.get(e.from)
        const lt = localMap.get(e.to)
        if (lf !== undefined && lt !== undefined) {
          localIntra.push({ from: lf, to: lt, dependency: e.dependency, weight: e.weight })
          localEdgeGlobalIds.push(ei)
        }
      } else {
        const lf = localMap.get(e.from)
        const lt = localMap.get(e.to)
        if (lf !== undefined && lt === undefined) {
          hasExtEdge = true
          const otherB = e.to < totalNodes ? input.nodeBucket[e.to] : -1
          if (otherB > bi) extOutBias[lf] += e.weight
          else if (otherB >= 0 && otherB < bi) extInBias[lf] += e.weight
        } else if (lt !== undefined && lf === undefined) {
          hasExtEdge = true
          const otherB = e.from < totalNodes ? input.nodeBucket[e.from] : -1
          if (otherB >= 0 && otherB < bi) extInBias[lt] += e.weight
          else if (otherB > bi) extOutBias[lt] += e.weight
        }
      }
    }

    const decomp = decomposeCyclesWeighted(members.length, localIntra, extInBias, extOutBias)
    for (let li = 0; li < localEdgeGlobalIds.length; li++) {
      const ge = input.edges[localEdgeGlobalIds[li]]
      ge.intraFeedback = decomp.intraFeedbackIndices.has(li)
      const sU = decomp.sccId[localIntra[li].from]
      const sV = decomp.sccId[localIntra[li].to]
      ge.sameScc = sU >= 0 && sU === sV
    }
    for (let li = 0; li < members.length; li++) {
      layer[members[li]] = decomp.layer[li]
    }

    const count = unpinned.length
    const hasPinnedInside = unpinned.length < members.length
    const intraConnectedCount = decomp.degree.filter((d) => d > 0).length
    const maxFixedCols = bucket.fixedBox
      ? Math.max(1, Math.min(3, Math.floor((bucket.fixedBox.width - GROUP_PAD_X * 2 - CARD_WIDTH) / COL_STEP) + 1))
      : 3
    const baseCols = Math.min(maxFixedCols, hasExtEdge || hasPinnedInside ? maxFixedCols : count)
    const baseRows = Math.ceil(count / Math.max(1, baseCols))
    const hasForkOrJoin = decomp.outdegree.some((d) => d >= 2) || decomp.indegree.some((d) => d >= 2)
    const maxLayer = decomp.isAcyclic ? Math.max(0, ...decomp.layer) : 0
    const layerCount = maxLayer + 1
    const layerCounts = Array<number>(layerCount).fill(0)
    for (const l of decomp.layer) layerCounts[l]++
    const maxLayerSize = Math.max(1, ...layerCounts)

    const useLayered =
      !hasPinnedInside &&
      !hasExtEdge &&
      intraConnectedCount === members.length &&
      decomp.isAcyclic &&
      hasForkOrJoin &&
      layerCount >= 2 &&
      maxLayerSize <= 3 &&
      layerCount <= baseRows + 1

    bucket.useLayeredSeed = useLayered
    bucket.gridCols = useLayered
      ? Math.min(3, Math.max(2, maxLayerSize === 2 && count >= 4 ? 3 : maxLayerSize))
      : Math.max(1, baseCols)
    bucket.rows = useLayered ? layerCount : Math.max(1, hasPinnedInside ? baseRows + 1 : baseRows)

    const used = new Uint8Array(bucket.rows * bucket.gridCols)
    const claim = (gIdx: number, r: number, c: number) => {
      nodeRow[gIdx] = r
      nodeCol[gIdx] = c
      used[r * bucket.gridCols + c] = 1
    }

    if (useLayered) {
      const orderRank = new Map(decomp.order.map((li, rk) => [li, rk]))
      for (let r = 0; r < bucket.rows; r++) {
        const rowLocal = Array.from({ length: members.length }, (_, li) => li)
          .filter((li) => decomp.layer[li] === r)
          .sort((a, b) => (orderRank.get(a) ?? a) - (orderRank.get(b) ?? b))
        const preferredCols =
          rowLocal.length === 1 && bucket.gridCols === 3
            ? [1]
            : rowLocal.length === 2 && bucket.gridCols === 3
              ? [0, 2]
              : rowLocal.map((_, i) => i % bucket.gridCols)
        rowLocal.forEach((li, i) => {
          const c = preferredCols[i]
          const slot = r * bucket.gridCols + c
          if (slot < used.length && !used[slot]) {
            claim(members[li], r, c)
          } else {
            const free = used.indexOf(0)
            if (free >= 0) claim(members[li], Math.floor(free / bucket.gridCols), free % bucket.gridCols)
          }
        })
      }
    } else if (localIntra.length === 0 && !hasExtEdge && !hasPinnedInside) {
      // 纯孤立无边分桶严格按输入顺序从左到右、从上到下平铺
      for (let i = 0; i < count; i++) {
        claim(unpinned[i], Math.floor(i / bucket.gridCols), i % bucket.gridCols)
      }
    } else {
      // 按加权 FAS 拓扑序 S 型蛇形填充（局部整理时仅分配未锁定节点）
      const orderedUnpinned = decomp.order
        .map((li) => members[li])
        .filter((gIdx) => !input.isPinned[gIdx])
      for (let idx = 0; idx < orderedUnpinned.length; idx++) {
        const r = Math.floor(idx / bucket.gridCols)
        const c = r % 2 ? bucket.gridCols - 1 - (idx % bucket.gridCols) : idx % bucket.gridCols
        claim(orderedUnpinned[idx], r, c)
      }
    }
  }

  const state: GlobalSolverState = {
    input,
    totalNodes,
    allRectCount,
    nodeRow,
    nodeCol,
    layer,
    intraDeg,
    totalDeg,
    bucketMaxRow,
    colLefts: [42, 42 + 938 + GRID_GROUP_GAP],
    colWidths: [938, 938],
  }

  const cache = createEvalCache(state)
  let bestScore = cache.totalNodeCost + cache.totalSelfCost + cache.totalPairCost

  // 纯孤立无边视图直接返回阶段一平铺结果
  if (input.edges.length === 0 && !input.isPinned.some((p) => p === 1)) {
    return {
      nodeRow,
      nodeCol,
      rects: cache.rects,
      groupTops: cache.groupTops,
      groupBottoms: cache.groupBottoms,
      colLefts: state.colLefts,
      colWidths: state.colWidths,
    }
  }

  const hasCrossBucketEdge = input.edges.some((e) => e.intraBucket === -1)

  // ---------- 阶段二：跨组双向重心初排（3 趟下 → 上 → 下；grid 同排左右 1.5x 内侧列引力） ----------
  if ((input.buckets.length >= 2 || extCount > 0) && hasCrossBucketEdge) {
    const savedRow = new Int32Array(nodeRow)
    const savedCol = new Int32Array(nodeCol)
    const sweepOrders = [
      Array.from({ length: input.buckets.length }, (_, i) => i),
      Array.from({ length: input.buckets.length }, (_, i) => input.buckets.length - 1 - i),
      Array.from({ length: input.buckets.length }, (_, i) => i),
    ]
    for (const order of sweepOrders) {
      for (const bi of order) {
        const bucket = input.buckets[bi]
        if (bucket.isPinnedBucket || bucket.useLayeredSeed) continue
        const unpinned = bucket.nodeIndices.filter((idx) => !input.isPinned[idx])
        if (unpinned.length === 0) continue

        // 计算每个未锁定节点的跨组加权目标列
        const bary = new Map<number, { has: boolean; col: number }>()
        for (const u of unpinned) {
          let sum = 0
          let sumW = 0
          for (const ei of nodeEdges[u]) {
            const e = input.edges[ei]
            if (e.intraBucket >= 0) continue
            const other = e.from === u ? e.to : e.from
            let targetCol: number
            let pullW = e.weight
            if (other < totalNodes) {
              const ob = input.nodeBucket[other]
              if (input.mode === 'grid' && Math.floor(ob / 2) === Math.floor(bi / 2) && ob !== bi) {
                // 双列同排左右相邻分组：施加 1.5x 朝向内侧边界列引力（左组靠右 cols-1、右组靠左 0）
                targetCol = bi % 2 === 0 ? bucket.gridCols - 1 : 0
                pullW *= 1.5
              } else {
                const otherRect = cache.rects[other]
                const baseX = bucket.fixedBox
                  ? bucket.fixedBox.x + GROUP_PAD_X
                  : input.mode === 'grid'
                    ? state.colLefts[bi % 2] + GROUP_PAD_X
                    : input.singleBucketOrigin?.baseX ?? 42 + GROUP_PAD_X
                targetCol = input.isPinned[other]
                  ? clamp((otherRect.x - baseX) / COL_STEP, 0, bucket.gridCols - 1)
                  : clamp(nodeCol[other], 0, bucket.gridCols - 1)
              }
            } else {
              const extRect = cache.rects[other]
              const baseX = input.singleBucketOrigin?.baseX ?? 42 + GROUP_PAD_X
              targetCol = clamp((extRect.x - baseX) / COL_STEP, 0, bucket.gridCols - 1)
            }
            sum += targetCol * pullW
            sumW += pullW
          }
          bary.set(u, sumW > 0 ? { has: true, col: sum / sumW } : { has: false, col: nodeCol[u] })
        }

        const hasBucketIntra = input.edges.some((e) => e.intraBucket === bi)
        if (!hasBucketIntra) {
          // 桶内无边仅跨组边：按重心列由近到远直接落入最匹配列与最高空闲行
          const used = new Uint8Array(bucket.rows * bucket.gridCols)
          const ranked = [...unpinned].sort((a, b) => {
            const ba = bary.get(a)!
            const bb = bary.get(b)!
            if (ba.has !== bb.has) return ba.has ? -1 : 1
            if (ba.has && Math.abs(ba.col - bb.col) > 1e-6) return ba.col - bb.col
            return a - b
          })
          for (const u of ranked) {
            const bu = bary.get(u)!
            const prefCol = bu.has ? clamp(Math.round(bu.col), 0, bucket.gridCols - 1) : 0
            let chosen = -1
            let bestDist = Infinity
            for (let s = 0; s < used.length; s++) {
              if (used[s]) continue
              const sr = Math.floor(s / bucket.gridCols)
              const sc = s % bucket.gridCols
              const d = bu.has ? Math.abs(sc - prefCol) * 100 + sr * 10 : sr * 100 + sc
              if (d < bestDist) {
                bestDist = d
                chosen = s
              }
            }
            if (chosen >= 0) {
              used[chosen] = 1
              nodeRow[u] = Math.floor(chosen / bucket.gridCols)
              nodeCol[u] = chosen % bucket.gridCols
            }
          }
        } else {
          // 桶内有边：保持行分配，按跨组重心重排各行内列次序
          for (let r = 0; r < bucket.rows; r++) {
            const rowNodes = unpinned.filter((u) => nodeRow[u] === r)
            if (rowNodes.length <= 1) continue
            const cols = rowNodes.map((u) => nodeCol[u]).sort((a, b) => a - b)
            rowNodes.sort((a, b) => {
              const ba = bary.get(a)!
              const bb = bary.get(b)!
              const diff = ba.col - bb.col
              return Math.abs(diff) > 1e-6 ? diff : nodeCol[a] - nodeCol[b]
            })
            rowNodes.forEach((u, idx) => {
              nodeCol[u] = cols[idx]
            })
          }
        }
      }
      refreshCacheFull(state, cache)
    }

    const stage2Score = cache.totalNodeCost + cache.totalSelfCost + cache.totalPairCost
    if (stage2Score < bestScore - 1e-6) {
      bestScore = stage2Score
    } else {
      nodeRow.set(savedRow)
      nodeCol.set(savedCol)
      bestScore = refreshCacheFull(state, cache)
    }
  }

  // ---------- 阶段三：纵向 3! 列置换脱困（最多 2 轮上下交替扫掠） ----------
  if (input.mode === 'vertical' && input.buckets.length >= 2 && hasCrossBucketEdge) {
    for (let sweep = 0; sweep < 2; sweep++) {
      let sweepImproved = false
      const order =
        sweep % 2 === 0
          ? Array.from({ length: input.buckets.length }, (_, i) => i)
          : Array.from({ length: input.buckets.length }, (_, i) => input.buckets.length - 1 - i)
      for (const bi of order) {
        const bucket = input.buckets[bi]
        if (bucket.isPinnedBucket || bucket.gridCols !== 3) continue
        const members = bucket.nodeIndices
        if (members.length === 0 || members.some((idx) => input.isPinned[idx])) continue

        const origCols = members.map((idx) => nodeCol[idx])
        let bestPerm: readonly [number, number, number] | undefined
        let bestPermScore = bestScore
        for (const perm of COL_PERMS_3) {
          for (let m = 0; m < members.length; m++) {
            nodeCol[members[m]] = perm[origCols[m]]
          }
          const cand = evaluateCandidateDelta(state, cache, bi, nodeEdges)
          if (cand < bestPermScore - 1e-6) {
            bestPermScore = cand
            bestPerm = perm
          }
        }
        if (bestPerm) {
          for (let m = 0; m < members.length; m++) {
            nodeCol[members[m]] = bestPerm[origCols[m]]
          }
          bestScore = refreshCacheFull(state, cache)
          sweepImproved = true
        } else {
          for (let m = 0; m < members.length; m++) {
            nodeCol[members[m]] = origCols[m]
          }
        }
      }
      if (!sweepImproved) break
    }
  }

  // ---------- 阶段四：全局交替度数降序 Sifting + 跨桶耦合列交换（自适应收敛预算） ----------
  const maxGlobalRounds = totalNodes <= 25 ? 4 : 2
  const maxSiftPasses = totalNodes <= 25 ? 2 : 1

  for (let round = 0; round < maxGlobalRounds; round++) {
    let roundImproved = false
    const bucketOrder =
      round % 2 === 0
        ? Array.from({ length: input.buckets.length }, (_, i) => i)
        : Array.from({ length: input.buckets.length }, (_, i) => input.buckets.length - 1 - i)

    for (const bi of bucketOrder) {
      const bucket = input.buckets[bi]
      if (bucket.isPinnedBucket) continue
      const unpinned = bucket.nodeIndices.filter((idx) => !input.isPinned[idx])
      if (unpinned.length === 0) continue

      // 度数降序排列（平局按节点下标升序确定性破平局）
      const sortedNodes = [...unpinned].sort((a, b) => totalDeg[b] - totalDeg[a] || a - b)

      for (let siftPass = 0; siftPass < maxSiftPasses; siftPass++) {
        let passImproved = false
        for (const u of sortedNodes) {
          const origR = nodeRow[u]
          const origC = nodeCol[u]
          let localBest = bestScore
          let bestAction:
            | { kind: 'swap'; other: number }
            | { kind: 'move'; r: number; c: number }
            | undefined

          // 建立当前桶内槽位占用表
          const occ = new Int32Array(bucket.rows * bucket.gridCols).fill(-1)
          for (const idx of unpinned) {
            const slot = nodeRow[idx] * bucket.gridCols + nodeCol[idx]
            if (slot >= 0 && slot < occ.length) occ[slot] = idx
          }

          // 1) 与同桶内其他未锁定节点交换
          for (const v of unpinned) {
            if (v === u) continue
            const vr = nodeRow[v]
            const vc = nodeCol[v]
            nodeRow[u] = vr
            nodeCol[u] = vc
            nodeRow[v] = origR
            nodeCol[v] = origC
            const cand = evaluateCandidateDelta(state, cache, bi, nodeEdges)
            if (cand < localBest - 1e-6) {
              localBest = cand
              bestAction = { kind: 'swap', other: v }
            }
            nodeRow[u] = origR
            nodeCol[u] = origC
            nodeRow[v] = vr
            nodeCol[v] = vc
          }

          // 2) 迁往同桶内任意空槽位
          for (let r = 0; r < bucket.rows; r++) {
            for (let c = 0; c < bucket.gridCols; c++) {
              if (occ[r * bucket.gridCols + c] !== -1) continue
              nodeRow[u] = r
              nodeCol[u] = c
              const cand = evaluateCandidateDelta(state, cache, bi, nodeEdges)
              if (cand < localBest - 1e-6) {
                localBest = cand
                bestAction = { kind: 'move', r, c }
              }
              nodeRow[u] = origR
              nodeCol[u] = origC
            }
          }

          if (bestAction) {
            if (bestAction.kind === 'swap') {
              const v = bestAction.other
              const vr = nodeRow[v]
              const vc = nodeCol[v]
              nodeRow[u] = vr
              nodeCol[u] = vc
              nodeRow[v] = origR
              nodeCol[v] = origC
            } else {
              nodeRow[u] = bestAction.r
              nodeCol[u] = bestAction.c
            }
            bestScore = refreshCacheFull(state, cache)
            passImproved = true
            roundImproved = true
          }
        }
        if (!passImproved) break
      }
    }

    // 跨桶耦合列交换：打破相邻分组对 (k, k+1) 及 grid 纵向相邻对 (k, k+2) 的双组对称死锁
    if (input.buckets.length >= 2 && hasCrossBucketEdge) {
      const pairs: [number, number][] = []
      for (let k = 0; k + 1 < input.buckets.length; k++) pairs.push([k, k + 1])
      if (input.mode === 'grid') {
        for (let k = 0; k + 2 < input.buckets.length; k++) pairs.push([k, k + 2])
      }
      for (const [b1, b2] of pairs) {
        const bk1 = input.buckets[b1]
        const bk2 = input.buckets[b2]
        if (bk1.isPinnedBucket || bk2.isPinnedBucket) continue
        if (bk1.nodeIndices.some((i) => input.isPinned[i]) || bk2.nodeIndices.some((i) => input.isPinned[i])) {
          continue
        }
        const cols = Math.min(bk1.gridCols, bk2.gridCols)
        if (cols < 2) continue
        for (let c1 = 0; c1 < cols; c1++) {
          for (let c2 = c1 + 1; c2 < cols; c2++) {
            const toggle = (indices: readonly number[]) => {
              for (const idx of indices) {
                if (nodeCol[idx] === c1) nodeCol[idx] = c2
                else if (nodeCol[idx] === c2) nodeCol[idx] = c1
              }
            }
            toggle(bk1.nodeIndices)
            toggle(bk2.nodeIndices)
            const cand = refreshCacheFull(state, cache)
            if (cand < bestScore - 1e-6) {
              bestScore = cand
              roundImproved = true
            } else {
              toggle(bk1.nodeIndices)
              toggle(bk2.nodeIndices)
              bestScore = refreshCacheFull(state, cache)
            }
          }
        }
      }
    }

    if (!roundImproved) break
  }

  // 压缩每个非钉死桶内的全空中间行并做最终全量实高几何刷新
  for (const bucket of input.buckets) {
    if (bucket.isPinnedBucket) continue
    const unpinned = bucket.nodeIndices.filter((idx) => !input.isPinned[idx])
    if (unpinned.length === 0) continue
    const usedRows = [...new Set(unpinned.map((idx) => nodeRow[idx]))].sort((a, b) => a - b)
    const remap = new Map(usedRows.map((r, compact) => [r, compact]))
    for (const idx of unpinned) nodeRow[idx] = remap.get(nodeRow[idx])!
  }
  refreshCacheFull(state, cache)

  return {
    nodeRow,
    nodeCol,
    rects: cache.rects,
    groupTops: cache.groupTops,
    groupBottoms: cache.groupBottoms,
    colLefts: state.colLefts,
    colWidths: state.colWidths,
  }
}

// ---------- 对外导出与场景组装（T353 / T361） ----------

/**
 * 计算单个分组（或无分组区域）内节点的初始布局。
 * 保留纯孤立节点旧序直铺；有组内或跨组连线时，采用新版 SCC/FAS 与实高闭式代理求解。
 */
export function placeBucketNodes(
  memberIds: readonly string[],
  relations: readonly Relation[],
  heights: Heights,
  viewId: string,
  baseX: number,
  baseY: number,
  options?: BucketPlacementOptions,
): NodeLayout[] {
  const count = memberIds.length
  if (!count) return []

  const indices = new Map(memberIds.map((id, i) => [id, i]))
  const anchors = options?.anchors
  const allRels = options?.allRelations ?? relations

  const externalIds: string[] = []
  const externalIndex = new Map<string, number>()
  const externalRects: Rect[] = []
  const ensureExternal = (id: string): number => {
    const existing = externalIndex.get(id)
    if (existing !== undefined) return existing
    const pt = anchors?.get(id)
    if (!pt) return -1
    const idx = count + externalIds.length
    externalIds.push(id)
    externalIndex.set(id, idx)
    externalRects.push({ x: pt.x, y: pt.y, width: pt.width, height: pt.height })
    return idx
  }

  const edges: GlobalEdge[] = []
  for (const r of relations) {
    if (r.fromNodeId === r.toNodeId) continue
    const from = indices.get(r.fromNodeId)
    const to = indices.get(r.toNodeId)
    if (from === undefined || to === undefined) continue
    const dependency = r.type === 'dependency'
    edges.push({
      from,
      to,
      dependency,
      weight: dependency ? DEPENDENCY_WEIGHT : SUPPLEMENT_WEIGHT,
      intraBucket: 0,
      intraFeedback: false,
      sameScc: false,
    })
  }

  if (anchors && anchors.size > 0) {
    for (const [id] of anchors) {
      if (!indices.has(id)) ensureExternal(id)
    }
    for (const r of allRels) {
      if (r.fromNodeId === r.toNodeId) continue
      const fromLocal = indices.get(r.fromNodeId)
      const toLocal = indices.get(r.toNodeId)
      if (fromLocal !== undefined && toLocal !== undefined) continue
      const fromIdx = fromLocal !== undefined ? fromLocal : ensureExternal(r.fromNodeId)
      const toIdx = toLocal !== undefined ? toLocal : ensureExternal(r.toNodeId)
      if (fromIdx < 0 || toIdx < 0) continue
      const dependency = r.type === 'dependency'
      edges.push({
        from: fromIdx,
        to: toIdx,
        dependency,
        weight: dependency ? DEPENDENCY_WEIGHT : SUPPLEMENT_WEIGHT,
        intraBucket: -1,
        intraFeedback: false,
        sameScc: false,
      })
    }
  }

  // 无组内连线且无跨组连线时，严格保持按输入顺序从左到右、从上到下的规整网格。
  if (edges.length === 0) {
    const columns = Math.min(3, count)
    const rows = Math.ceil(count / columns)
    const rowHeights = Array<number>(rows).fill(0)
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / columns)
      rowHeights[row] = Math.max(rowHeights[row], nodeHeight(heights, viewId, memberIds[i]))
    }
    const rowY = [baseY]
    for (let r = 1; r < rows; r++) rowY[r] = rowY[r - 1] + rowHeights[r - 1] + ROW_GAP
    return memberIds.map((nodeId, i) => ({
      nodeId,
      x: baseX + (i % columns) * COL_STEP,
      y: rowY[Math.floor(i / columns)],
      width: CARD_WIDTH,
      manual: false,
    }))
  }

  const nodeH = Float64Array.from(memberIds, (id) => nodeHeight(heights, viewId, id))
  const nodeBucket = new Int32Array(count)
  const isPinned = new Uint8Array(count)
  const pinnedX = new Float64Array(count)
  const pinnedY = new Float64Array(count)
  const pinnedW = new Float64Array(count)

  const solved = solveGlobalViewLayout({
    mode: 'vertical',
    verticalGap: 19,
    nodeIds: [...memberIds],
    nodeH,
    nodeBucket,
    buckets: [
      {
        groupId: undefined,
        nodeIndices: Array.from({ length: count }, (_, i) => i),
        gridCols: Math.min(3, count),
        rows: Math.ceil(count / Math.min(3, count)),
        useLayeredSeed: false,
        isPinnedBucket: false,
      },
    ],
    edges,
    isPinned,
    pinnedX,
    pinnedY,
    pinnedW,
    externalRects,
    singleBucketOrigin: { baseX, baseY },
  })

  return memberIds.map((nodeId, i) => ({
    nodeId,
    x: solved.rects[i].x,
    y: solved.rects[i].y,
    width: CARD_WIDTH,
    manual: false,
  }))
}

function buildViewSolverInput(
  view: View,
  relations: readonly Relation[],
  heights: Heights,
  mode: 'vertical' | 'grid',
  verticalGap: number,
  pinConfig?: {
    pinnedNodes?: ReadonlyMap<string, NodeLayout>
    pinnedBucketIds?: ReadonlySet<string | undefined>
    fixedGroups?: ReadonlyMap<string, GroupLayout>
  },
): GlobalSolverInput {
  const bucketIds: (string | undefined)[] = [
    ...view.groups.map((g) => g.id),
    ...(view.occurrences.some((o) => !o.groupId) ? [undefined] : []),
  ]
  const nodeIds: string[] = []
  const nodeIndex = new Map<string, number>()
  const nodeBucketList: number[] = []
  const buckets: GlobalBucket[] = []

  bucketIds.forEach((groupId, bi) => {
    const members = view.occurrences.filter((o) => o.groupId === groupId).map((o) => o.nodeId)
    const memberIndices: number[] = []
    for (const id of members) {
      if (nodeIndex.has(id)) continue
      const idx = nodeIds.length
      nodeIds.push(id)
      nodeIndex.set(id, idx)
      nodeBucketList.push(bi)
      memberIndices.push(idx)
    }
    const fixedG = groupId ? pinConfig?.fixedGroups?.get(groupId) : undefined
    const isPinnedBucket = Boolean(pinConfig?.pinnedBucketIds?.has(groupId))
    buckets.push({
      groupId,
      nodeIndices: memberIndices,
      gridCols: Math.min(3, Math.max(1, memberIndices.length)),
      rows: Math.max(1, Math.ceil(memberIndices.length / Math.min(3, Math.max(1, memberIndices.length)))),
      useLayeredSeed: false,
      isPinnedBucket,
      fixedBox: fixedG ? { x: fixedG.x, y: fixedG.y, width: fixedG.width, height: fixedG.height } : undefined,
    })
  })

  const total = nodeIds.length
  const nodeH = Float64Array.from(nodeIds, (id) => nodeHeight(heights, view.id, id))
  const nodeBucket = Int32Array.from(nodeBucketList)
  const isPinned = new Uint8Array(total)
  const pinnedX = new Float64Array(total)
  const pinnedY = new Float64Array(total)
  const pinnedW = new Float64Array(total)

  if (pinConfig?.pinnedNodes) {
    for (let i = 0; i < total; i++) {
      const saved = pinConfig.pinnedNodes.get(nodeIds[i])
      if (saved) {
        isPinned[i] = 1
        pinnedX[i] = saved.x
        pinnedY[i] = saved.y
        pinnedW[i] = saved.width
      }
    }
  }

  const edges: GlobalEdge[] = []
  for (const r of relations) {
    if (r.fromNodeId === r.toNodeId) continue
    const from = nodeIndex.get(r.fromNodeId)
    const to = nodeIndex.get(r.toNodeId)
    if (from === undefined || to === undefined) continue
    const dependency = r.type === 'dependency'
    const bf = nodeBucket[from]
    const bt = nodeBucket[to]
    edges.push({
      from,
      to,
      dependency,
      weight: dependency ? DEPENDENCY_WEIGHT : SUPPLEMENT_WEIGHT,
      intraBucket: bf === bt ? bf : -1,
      intraFeedback: false,
      sameScc: false,
    })
  }

  return {
    mode,
    verticalGap,
    nodeIds,
    nodeH,
    nodeBucket,
    buckets,
    edges,
    isPinned,
    pinnedX,
    pinnedY,
    pinnedW,
  }
}

function placeFreshBuckets(
  view: View,
  relations: readonly Relation[],
  heights: Heights,
  verticalGap: number,
): { nodes: NodeLayout[]; groups: GroupLayout[] } {
  const input = buildViewSolverInput(view, relations, heights, 'vertical', verticalGap)
  if (input.nodeIds.length === 0) {
    let top = 48
    const groups: GroupLayout[] = view.groups.map((g) => {
      const box = { groupId: g.id, x: 42, y: top, width: 320, height: 178 }
      top += 178 + verticalGap
      return box
    })
    return { nodes: [], groups }
  }

  const solved = solveGlobalViewLayout(input)

  // 计算每个分桶的自然紧凑框，并统一所有非空分组的左边界与宽度（1 卡 284 / 2 卡 611 / 3 卡 938）。
  const boxes = input.buckets.map((bucket, bi) => {
    const placed: NodeLayout[] = bucket.nodeIndices.map((idx) => ({
      nodeId: input.nodeIds[idx],
      x: solved.rects[idx].x,
      y: solved.rects[idx].y,
      width: CARD_WIDTH,
      manual: false,
    }))
    const left = placed.length ? Math.min(...placed.map((n) => n.x - GROUP_PAD_X)) : 42
    const top = solved.groupTops[bi]
    const right = placed.length ? Math.max(...placed.map((n) => n.x + n.width + GROUP_PAD_X)) : left + 320
    const bottom = solved.groupBottoms[bi]
    return { groupId: bucket.groupId, nodes: placed, left, top, width: right - left, height: bottom - top }
  })

  const nonEmptyBoxes = boxes.filter((b) => b.nodes.length > 0)
  const unifiedLeft = nonEmptyBoxes.length ? Math.min(...nonEmptyBoxes.map((b) => b.left)) : undefined
  const unifiedRight = nonEmptyBoxes.length
    ? Math.max(...nonEmptyBoxes.map((b) => b.left + b.width))
    : undefined
  const unifiedWidth =
    unifiedLeft !== undefined && unifiedRight !== undefined ? unifiedRight - unifiedLeft : undefined

  // 若全部节点未占 col 0（unifiedLeft > 42），整体左移对齐至 42 保持标准左起点 (x - 66) % 327 === 0
  const shiftX = unifiedLeft !== undefined && unifiedLeft > 42 ? unifiedLeft - 42 : 0
  const finalLeft = unifiedLeft !== undefined ? unifiedLeft - shiftX : undefined

  const nodes: NodeLayout[] = []
  const groups: GroupLayout[] = []
  for (const box of boxes) {
    for (const n of box.nodes) {
      nodes.push(shiftX ? { ...n, x: n.x - shiftX } : n)
    }
    if (box.groupId) {
      groups.push({
        groupId: box.groupId,
        x: finalLeft ?? box.left,
        y: box.top,
        width: unifiedWidth ?? box.width,
        height: box.height,
      })
    }
  }
  return { nodes, groups }
}

function hasOverlap(
  x: number,
  y: number,
  width: number,
  height: number,
  others: readonly NodeLayout[],
  heights: Heights,
  viewId: string,
): boolean {
  return others.some(
    (other) =>
      x < other.x + other.width + GROUP_PAD_X &&
      x + width + GROUP_PAD_X > other.x &&
      y < other.y + nodeHeight(heights, viewId, other.nodeId) + GROUP_PAD_X &&
      y + height + GROUP_PAD_X > other.y,
  )
}

function placeNearNeighbors(
  nodeId: string,
  oldGroup: GroupLayout | undefined,
  existingNodes: readonly NodeLayout[],
  relations: readonly Relation[],
  heights: Heights,
  viewId: string,
): NodeLayout | undefined {
  const existingMap = new Map(existingNodes.map((n) => [n.nodeId, n]))
  const neighbors: { node: NodeLayout; height: number; dir: 'down' | 'up' | 'sup'; weight: number }[] = []
  for (const r of relations) {
    if (r.fromNodeId === r.toNodeId) continue
    const dep = r.type === 'dependency'
    const weight = dep ? DEPENDENCY_WEIGHT : SUPPLEMENT_WEIGHT
    if (r.fromNodeId === nodeId && existingMap.has(r.toNodeId)) {
      const nb = existingMap.get(r.toNodeId)!
      neighbors.push({ node: nb, height: nodeHeight(heights, viewId, nb.nodeId), dir: dep ? 'up' : 'sup', weight })
    } else if (r.toNodeId === nodeId && existingMap.has(r.fromNodeId)) {
      const nb = existingMap.get(r.fromNodeId)!
      neighbors.push({ node: nb, height: nodeHeight(heights, viewId, nb.nodeId), dir: dep ? 'down' : 'sup', weight })
    }
  }
  if (!neighbors.length) return undefined

  const selfHeight = nodeHeight(heights, viewId, nodeId)
  const candidates: { x: number; y: number; rank: number }[] = []
  for (const { node: nb, height: nbH, dir } of neighbors) {
    const stepX = nb.width + 91
    const stepY = nbH + ROW_GAP
    const upY = selfHeight + ROW_GAP
    const slots =
      dir === 'down'
        ? [
            [nb.x + stepX, nb.y],
            [nb.x, nb.y + stepY],
            [nb.x + stepX, nb.y + stepY],
            [nb.x - COL_STEP, nb.y + stepY],
            [nb.x + stepX * 2, nb.y],
            [nb.x, nb.y + stepY * 2],
            [nb.x - COL_STEP, nb.y],
            [nb.x, nb.y - upY],
          ]
        : dir === 'up'
          ? [
              [nb.x - COL_STEP, nb.y],
              [nb.x, nb.y - upY],
              [nb.x - COL_STEP, nb.y - upY],
              [nb.x + stepX, nb.y - upY],
              [nb.x + stepX, nb.y],
              [nb.x, nb.y + stepY],
              [nb.x - COL_STEP * 2, nb.y],
              [nb.x, nb.y - upY * 2],
            ]
          : [
              [nb.x + stepX, nb.y],
              [nb.x, nb.y + stepY],
              [nb.x - COL_STEP, nb.y],
              [nb.x, nb.y - upY],
              [nb.x + stepX, nb.y + stepY],
              [nb.x - COL_STEP, nb.y + stepY],
            ]
    slots.forEach(([x, y], rank) => candidates.push({ x, y, rank }))
  }

  // 014 框内优先补位（FR-011）：当 oldGroup 存在时同步枚举框内全部标准网格槽位，防止脱框邻居把新卡带出分组框。
  if (oldGroup) {
    const startX = oldGroup.x + GROUP_PAD_X
    const startY = oldGroup.y + GROUP_PAD_TOP
    const maxCols = Math.max(1, Math.min(3, Math.floor((oldGroup.width - GROUP_PAD_X * 2 - CARD_WIDTH) / COL_STEP) + 1))
    const insideNodes = existingNodes.filter(
      (n) =>
        n.x >= oldGroup.x - 4 &&
        n.x + n.width <= oldGroup.x + oldGroup.width + 4 &&
        n.y >= oldGroup.y - 4 &&
        n.y <= oldGroup.y + oldGroup.height + 4,
    )
    const rowYList: number[] = [startY]
    const bandSorted = [...insideNodes].sort((a, b) => a.y - b.y)
    for (const n of bandSorted) {
      if (rowYList.every((ry) => Math.abs(ry - n.y) > 20)) rowYList.push(n.y)
    }
    rowYList.sort((a, b) => a - b)
    // 追加下方标准行（只要仍落在 oldGroup 垂直范围内）
    while (rowYList.length < 6) {
      const lastY = rowYList[rowYList.length - 1]
      let rowH = selfHeight
      for (const n of insideNodes) {
        if (Math.abs(n.y - lastY) <= 20) {
          rowH = Math.max(rowH, nodeHeight(heights, viewId, n.nodeId))
        }
      }
      const nextY = lastY + rowH + ROW_GAP
      if (nextY + selfHeight > oldGroup.y + oldGroup.height - GROUP_PAD_BOTTOM + 4) break
      rowYList.push(nextY)
    }
    for (const ry of rowYList) {
      for (let c = 0; c < maxCols; c++) {
        const cx = startX + c * COL_STEP
        if (cx + CARD_WIDTH <= oldGroup.x + oldGroup.width - GROUP_PAD_X + 4) {
          candidates.push({ x: cx, y: ry, rank: 0 })
        }
      }
    }
  }

  let best: { x: number; y: number; score: number } | undefined
  for (const cand of candidates) {
    if (hasOverlap(cand.x, cand.y, CARD_WIDTH, selfHeight, existingNodes, heights, viewId)) continue
    const cx = cand.x + CARD_WIDTH / 2
    const cy = cand.y + selfHeight / 2
    let distScore = 0
    for (const nb of neighbors) {
      const ncx = nb.node.x + nb.node.width / 2
      const ncy = nb.node.y + nb.height / 2
      distScore += nb.weight * Math.hypot(cx - ncx, cy - ncy)
    }
    const offCanvasPenalty = cand.x < 42 || cand.y < 48 ? 220 : 0
    const outOfGroupPenalty =
      oldGroup &&
      (cand.x < oldGroup.x ||
        cand.x + CARD_WIDTH > oldGroup.x + oldGroup.width ||
        cand.y < oldGroup.y ||
        cand.y + selfHeight > oldGroup.y + oldGroup.height)
        ? OUT_OF_GROUP_PENALTY
        : 0
    const total = cand.rank * 40 + 0.5 * distScore + offCanvasPenalty + outOfGroupPenalty
    if (!best || total < best.score - 1e-6) {
      best = { x: cand.x, y: cand.y, score: total }
    }
  }
  if (best) return { nodeId, x: best.x, y: best.y, width: CARD_WIDTH, manual: false }

  const fallback = { nodeId, x: candidates[0].x, y: candidates[0].y, width: CARD_WIDTH, manual: false }
  while (hasOverlap(fallback.x, fallback.y, fallback.width, selfHeight, existingNodes, heights, viewId)) {
    fallback.y += selfHeight + ROW_GAP
  }
  return fallback
}

/**
 * 为整张地图补齐缺失视图或新增节点布局，严格保留已有节点与分组坐标不变。
 */
export function fillLayout(
  map: KnowledgeMap,
  previous: MapLayout | undefined,
  heights: Heights,
): MapLayout {
  return {
    schemaVersion: previous?.schemaVersion ?? 1,
    mapId: map.id,
    views: map.views.map((view) => {
      const old = previous?.views.find((v) => v.viewId === view.id)
      const relations = map.relations.filter((r) => view.relationIds.includes(r.id))
      const savedNodes = (old?.nodes ?? [])
        .filter((n) => view.occurrences.some((o) => o.nodeId === n.nodeId))
        .map((n) => ({ ...n }))

      if (savedNodes.length === 0 && !(old?.groups.length)) {
        const fresh = placeFreshBuckets(view, relations, heights, 19)
        return {
          viewId: view.id,
          nodes: fresh.nodes,
          groups: fresh.groups,
          ...(previous?.schemaVersion === 2 ? { mode: old?.mode ?? 'vertical' } : {}),
        }
      }

      const nodes: NodeLayout[] = [...savedNodes]
      let groupY = 48
      const groups: GroupLayout[] = []
      const buckets = [...view.groups.map((g) => g.id), undefined]
      for (const groupId of buckets) {
        const members = view.occurrences.filter((o) => o.groupId === groupId)
        const oldGroup = old?.groups.find((g) => g.groupId === groupId)
        const x = oldGroup?.x ?? 42
        const y = oldGroup?.y ?? groupY
        const missingMembers = members.filter((o) => !nodes.some((n) => n.nodeId === o.nodeId))

        if (missingMembers.length > 0) {
          const allBucketUnpositioned = missingMembers.length === members.length && !oldGroup
          if (allBucketUnpositioned) {
            const anchors = new Map<string, AnchorPoint>(
              nodes.map((n) => [n.nodeId, { ...n, height: nodeHeight(heights, view.id, n.nodeId) }]),
            )
            const placements = placeBucketNodes(
              missingMembers.map((o) => o.nodeId),
              relations,
              heights,
              view.id,
              x + GROUP_PAD_X,
              y + GROUP_PAD_TOP,
              { anchors, allRelations: relations },
            )
            for (const n of placements) {
              const height = nodeHeight(heights, view.id, n.nodeId)
              while (hasOverlap(n.x, n.y, n.width, height, nodes, heights, view.id)) {
                n.y += height + ROW_GAP
              }
              nodes.push(n)
            }
          } else {
            const unanchored: string[] = []
            for (const item of missingMembers) {
              const near = placeNearNeighbors(item.nodeId, oldGroup, nodes, relations, heights, view.id)
              if (near) nodes.push(near)
              else unanchored.push(item.nodeId)
            }
            if (unanchored.length > 0) {
              const anchors = new Map<string, AnchorPoint>(
                nodes.map((n) => [n.nodeId, { ...n, height: nodeHeight(heights, view.id, n.nodeId) }]),
              )
              const placements = placeBucketNodes(
                unanchored,
                relations,
                heights,
                view.id,
                x + GROUP_PAD_X,
                y + GROUP_PAD_TOP,
                { anchors, allRelations: relations },
              )
              for (const n of placements) {
                const height = nodeHeight(heights, view.id, n.nodeId)
                while (hasOverlap(n.x, n.y, n.width, height, nodes, heights, view.id)) {
                  n.y += height + ROW_GAP
                }
                nodes.push(n)
              }
            }
          }
        }

        const inside = nodes.filter((n) => members.some((o) => o.nodeId === n.nodeId))
        if (groupId) {
          if (oldGroup) {
            groups.push({ ...oldGroup })
            groupY = oldGroup.y + oldGroup.height + 19
            continue
          }
          const left = inside.length ? Math.min(...inside.map((n) => n.x - GROUP_PAD_X)) : x
          const top = Math.min(y, ...inside.map((n) => n.y - GROUP_PAD_TOP))
          const right = inside.length ? Math.max(...inside.map((n) => n.x + n.width + GROUP_PAD_X)) : x + 320
          const bottom = Math.max(
            y + 178,
            ...inside.map((n) => n.y + nodeHeight(heights, view.id, n.nodeId) + GROUP_PAD_BOTTOM),
          )
          groups.push({ groupId, x: left, y: top, width: right - left, height: bottom - top })
          groupY = bottom + 19
        }
      }
      return {
        viewId: view.id,
        nodes,
        groups,
        ...(previous?.schemaVersion === 2 ? { mode: old?.mode ?? 'vertical' } : {}),
      }
    }),
  }
}

export function viewBounds(
  view: ViewLayout,
  heights: Heights,
): { x: number; y: number; width: number; height: number } {
  const rects = [
    ...view.groups,
    ...view.nodes.map((n) => ({
      ...n,
      height: nodeHeight(heights, view.viewId, n.nodeId),
    })),
  ]
  if (!rects.length) return { x: 0, y: 0, width: 320, height: 240 }
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return {
    x,
    y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  }
}

export function groupCount(view: View): number {
  return view.groups.length + (view.occurrences.some((o) => !o.groupId) ? 1 : 0)
}

export function availableModes(view: View): LayoutMode[] {
  const count = groupCount(view)
  return ['vertical', ...(count >= 2 ? ['grid'] : [])] as LayoutMode[]
}

/**
 * 主动重排指定视图：'vertical'（单列纵向）或 'grid'（双列田字），基于真实高度全局协同跨组与跨列寻优。
 */
export function relayoutView(
  map: KnowledgeMap,
  viewId: string,
  mode: LayoutMode,
  heights: Heights,
): ViewLayout {
  const view = map.views.find((v) => v.id === viewId)
  if (view && mode === 'columns') mode = groupCount(view) >= 2 ? 'grid' : 'vertical'
  if (!view || !availableModes(view).includes(mode)) throw new Error('当前视图不支持此排列方式')
  const relations = map.relations.filter((r) => view.relationIds.includes(r.id))
  if (mode === 'vertical') {
    const fresh = placeFreshBuckets(view, relations, heights, 48)
    return { viewId, mode, nodes: fresh.nodes, groups: fresh.groups }
  }

  // 'grid' 模式：直接全视图双列实高实宽联合求解
  const input = buildViewSolverInput(view, relations, heights, 'grid', GRID_GROUP_GAP)
  const solved = solveGlobalViewLayout(input)

  // 计算两列内真实左起偏移（若整列均未占 col 0 则整体贴左对齐，并保持同列分组统一 x 与 width）
  const colMinX: [number, number] = [Infinity, Infinity]
  const colMaxX: [number, number] = [-Infinity, -Infinity]
  input.buckets.forEach((bucket, bi) => {
    const col = bi % 2
    for (const idx of bucket.nodeIndices) {
      const r = solved.rects[idx]
      if (r.x - GROUP_PAD_X < colMinX[col]) colMinX[col] = r.x - GROUP_PAD_X
      if (r.x + r.width + GROUP_PAD_X > colMaxX[col]) colMaxX[col] = r.x + r.width + GROUP_PAD_X
    }
  })

  const colWidth: [number, number] = [
    colMinX[0] < Infinity ? colMaxX[0] - colMinX[0] : 320,
    colMinX[1] < Infinity ? colMaxX[1] - colMinX[1] : 320,
  ]
  const colLeft: [number, number] = [42, 42 + colWidth[0] + GRID_GROUP_GAP]
  const colShift: [number, number] = [
    colMinX[0] < Infinity ? colLeft[0] - colMinX[0] : 0,
    colMinX[1] < Infinity ? colLeft[1] - colMinX[1] : 0,
  ]

  const nodes: NodeLayout[] = []
  const groups: GroupLayout[] = []
  input.buckets.forEach((bucket, bi) => {
    const col = bi % 2
    const shiftX = colShift[col]
    for (const idx of bucket.nodeIndices) {
      nodes.push({
        nodeId: input.nodeIds[idx],
        x: solved.rects[idx].x + shiftX,
        y: solved.rects[idx].y,
        width: CARD_WIDTH,
        manual: false,
      })
    }
    if (bucket.groupId) {
      groups.push({
        groupId: bucket.groupId,
        x: colLeft[col],
        y: solved.groupTops[bi],
        width: colWidth[col],
        height: solved.groupBottoms[bi] - solved.groupTops[bi],
      })
    }
  })

  return { viewId, mode, nodes, groups }
}

/**
 * 局部整理指定视图（FR-012）：
 * - scope: 'unlocked' 钉死全部 manual: true 节点与全部分组外框（位移 0），仅重排未锁定节点并确保零重叠；
 * - scope: { groupId } 钉死其他全部分组及其成员（位移 0），仅重排目标分组内节点（可选紧凑重算目标组框）。
 */
export function relayoutViewPartial(
  map: KnowledgeMap,
  current: ViewLayout,
  heights: Heights,
  options: PartialRelayoutOptions,
): ViewLayout {
  const cloneCurrent = (): ViewLayout => ({
    ...current,
    nodes: current.nodes.map((n) => ({ ...n })),
    groups: current.groups.map((g) => ({ ...g })),
  })

  const view = map.views.find((v) => v.id === current.viewId)
  if (!view) return cloneCurrent()

  const relations = map.relations.filter((r) => view.relationIds.includes(r.id))
  const mode: 'vertical' | 'grid' =
    current.mode === 'grid' && groupCount(view) >= 2 ? 'grid' : 'vertical'
  const currentNodeById = new Map(current.nodes.map((n) => [n.nodeId, n]))
  const currentGroupById = new Map(current.groups.map((g) => [g.groupId, g]))

  const pinnedNodes = new Map<string, NodeLayout>()
  const pinnedBucketIds = new Set<string | undefined>()
  const fixedGroups = new Map<string, GroupLayout>()

  if (options.scope === 'unlocked') {
    for (const g of current.groups) fixedGroups.set(g.groupId, g)
    let unlockedCount = 0
    for (const occ of view.occurrences) {
      const saved = currentNodeById.get(occ.nodeId)
      if (saved?.manual) pinnedNodes.set(occ.nodeId, { ...saved })
      else unlockedCount++
    }
    if (unlockedCount === 0) return cloneCurrent()
  } else {
    const targetGroupId = options.scope.groupId
    if (!view.groups.some((g) => g.id === targetGroupId)) return cloneCurrent()
    for (const g of current.groups) fixedGroups.set(g.groupId, g)
    const bucketIds: (string | undefined)[] = [
      ...view.groups.map((g) => g.id),
      ...(view.occurrences.some((o) => !o.groupId) ? [undefined] : []),
    ]
    for (const bid of bucketIds) {
      if (bid !== targetGroupId) pinnedBucketIds.add(bid)
    }
    for (const occ of view.occurrences) {
      if (occ.groupId !== targetGroupId) {
        const saved = currentNodeById.get(occ.nodeId)
        if (saved) pinnedNodes.set(occ.nodeId, { ...saved })
      }
    }
  }

  const input = buildViewSolverInput(view, relations, heights, mode, mode === 'grid' ? GRID_GROUP_GAP : 19, {
    pinnedNodes,
    pinnedBucketIds,
    fixedGroups,
  })
  const solved = solveGlobalViewLayout(input)

  // 先锁定所有钉死节点（绝对 0 漂移），再校验未锁定节点并做零重叠物理安全保障。
  const finalizedNodes: NodeLayout[] = []
  const nodeById = new Map<string, NodeLayout>()
  for (let i = 0; i < input.nodeIds.length; i++) {
    const id = input.nodeIds[i]
    if (input.isPinned[i]) {
      const saved = pinnedNodes.get(id)!
      finalizedNodes.push(saved)
      nodeById.set(id, saved)
    }
  }

  for (let i = 0; i < input.nodeIds.length; i++) {
    if (input.isPinned[i]) continue
    const id = input.nodeIds[i]
    const h = input.nodeH[i]
    const cand: NodeLayout = {
      nodeId: id,
      x: solved.rects[i].x,
      y: solved.rects[i].y,
      width: CARD_WIDTH,
      manual: false,
    }
    if (hasOverlap(cand.x, cand.y, cand.width, h, finalizedNodes, heights, view.id)) {
      const bucket = input.buckets[input.nodeBucket[i]]
      const baseX = bucket.fixedBox
        ? bucket.fixedBox.x + GROUP_PAD_X
        : mode === 'grid'
          ? solved.colLefts[input.nodeBucket[i] % 2] + GROUP_PAD_X
          : 42 + GROUP_PAD_X
      const baseY = bucket.fixedBox
        ? bucket.fixedBox.y + GROUP_PAD_TOP
        : solved.groupTops[input.nodeBucket[i]] + GROUP_PAD_TOP
      // 优先在所属分组网格空槽中寻找最近无重叠位置，避免把卡片推到极远处
      let resolved = false
      let bestSpot: { x: number; y: number; dist: number } | undefined
      const maxSearchRows = Math.max(bucket.rows + 4, 8)
      for (let r = 0; r < maxSearchRows; r++) {
        const y = baseY + r * (h + ROW_GAP)
        const colLimit = bucket.fixedBox ? bucket.gridCols : Math.max(3, bucket.gridCols)
        for (let c = 0; c < colLimit; c++) {
          const x = baseX + c * COL_STEP
          if (hasOverlap(x, y, cand.width, h, finalizedNodes, heights, view.id)) continue
          const dist = Math.hypot(x - cand.x, y - cand.y)
          if (!bestSpot || dist < bestSpot.dist) bestSpot = { x, y, dist }
        }
      }
      if (bestSpot) {
        cand.x = bestSpot.x
        cand.y = bestSpot.y
        resolved = true
      }
      if (!resolved) {
        while (hasOverlap(cand.x, cand.y, cand.width, h, finalizedNodes, heights, view.id)) {
          cand.y += h + ROW_GAP
        }
      }
    }
    finalizedNodes.push(cand)
    nodeById.set(id, cand)
  }

  // 保持节点输出顺序与视图 occurrences 一致（确定性输出）
  const orderedNodes: NodeLayout[] = []
  for (const occ of view.occurrences) {
    const placed = nodeById.get(occ.nodeId)
    if (placed) orderedNodes.push(placed)
  }

  let groups: GroupLayout[]
  if (options.scope === 'unlocked' || !options.refitTargetGroup) {
    groups = current.groups.map((g) => ({ ...g }))
  } else {
    const targetGroupId = options.scope.groupId
    groups = current.groups.map((g) => {
      if (g.groupId !== targetGroupId) return { ...g }
      const inside = orderedNodes.filter((n) =>
        view.occurrences.some((o) => o.groupId === targetGroupId && o.nodeId === n.nodeId),
      )
      if (!inside.length) return { ...g }
      const left = Math.min(...inside.map((n) => n.x - GROUP_PAD_X))
      const top = Math.min(g.y, ...inside.map((n) => n.y - GROUP_PAD_TOP))
      const right = Math.max(...inside.map((n) => n.x + n.width + GROUP_PAD_X))
      const bottom = Math.max(
        top + 178,
        ...inside.map((n) => n.y + nodeHeight(heights, view.id, n.nodeId) + GROUP_PAD_BOTTOM),
      )
      return { groupId: g.groupId, x: left, y: top, width: right - left, height: bottom - top }
    })
  }

  // 确保未存的分组（若有）也完整保留
  for (const g of view.groups) {
    if (!groups.some((item) => item.groupId === g.id)) {
      const oldG = currentGroupById.get(g.id)
      if (oldG) groups.push({ ...oldG })
    }
  }

  return {
    ...current,
    nodes: orderedNodes,
    groups,
  }
}
