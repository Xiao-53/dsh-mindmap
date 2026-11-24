import type {
  KnowledgeMap,
  LayoutMode,
  MapLayout,
  ViewLayout,
  GroupLayout,
  NodeLayout,
  Relation,
} from './map-types.ts'

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

export const heightKey = (viewId: string, nodeId: string) =>
  `${viewId}/${nodeId}`

export const nodeHeight = (h: Heights, viewId: string, nodeId: string) =>
  h[heightKey(viewId, nodeId)] ?? 130

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

interface IntraEdge {
  from: number
  to: number
  dependency: boolean
  weight: number
}

interface ExternalEdge {
  local: number
  localIsTarget: boolean
  dependency: boolean
  weight: number
  anchorNodeId: string
  anchorCenterX: number
  anchorCenterY: number
  anchorX: number
  anchorY: number
  anchorBottom: number
}

interface GridSlot {
  row: number
  col: number
}

function computeTopology(count: number, edges: readonly IntraEdge[]) {
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
  const workingIn = [...indegree]
  const order: number[] = []
  const remaining = new Set(Array.from({ length: count }, (_, i) => i))
  let isAcyclic = true
  while (remaining.size) {
    const ready = [...remaining]
      .filter((i) => workingIn[i] === 0)
      .sort((a, b) => degree[b] - degree[a] || a - b)
    let next = ready[0]
    if (next === undefined) {
      isAcyclic = false
      next = [...remaining].sort((a, b) => workingIn[a] - workingIn[b] || degree[b] - degree[a] || a - b)[0]!
    }
    remaining.delete(next)
    order.push(next)
    for (const e of edges) if (e.dependency && e.from === next) workingIn[e.to]--
  }
  const layer = Array<number>(count).fill(0)
  if (isAcyclic) {
    for (const u of order) {
      for (const e of edges) {
        if (e.dependency && e.from === u) {
          layer[e.to] = Math.max(layer[e.to], layer[u] + 1)
        }
      }
    }
  }
  return { degree, indegree, outdegree, order, isAcyclic, layer }
}

function averageExternalAnchorX(
  nodeIdx: number,
  externalEdges: readonly ExternalEdge[],
): { has: boolean; centerX: number } {
  let sumX = 0
  let sumW = 0
  for (const e of externalEdges) {
    if (e.local !== nodeIdx) continue
    sumX += e.anchorCenterX * e.weight
    sumW += e.weight
  }
  return sumW > 0 ? { has: true, centerX: sumX / sumW } : { has: false, centerX: 0 }
}

function buildInitialSlots(
  count: number,
  gridCols: number,
  rows: number,
  order: readonly number[],
  intraEdges: readonly IntraEdge[],
  externalEdges: readonly ExternalEdge[],
  layer: readonly number[],
  useLayeredSeed: boolean,
  baseX: number,
): { slots: GridSlot[]; slotOf: number[] } {
  const slots: GridSlot[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < gridCols; col++) {
      slots.push({ row, col })
    }
  }
  const slotOf = Array<number>(count).fill(-1)
  const used = Array<boolean>(slots.length).fill(false)
  const claim = (node: number, slotIdx: number) => {
    slotOf[node] = slotIdx
    used[slotIdx] = true
  }

  if (useLayeredSeed) {
    const orderRank = new Map(order.map((n, idx) => [n, idx]))
    for (let r = 0; r < rows; r++) {
      const members = Array.from({ length: count }, (_, i) => i)
        .filter((i) => layer[i] === r)
        .sort((a, b) => {
          const ax = averageExternalAnchorX(a, externalEdges)
          const bx = averageExternalAnchorX(b, externalEdges)
          if (ax.has && bx.has && Math.abs(ax.centerX - bx.centerX) > 1e-6) {
            return ax.centerX - bx.centerX
          }
          return (orderRank.get(a) ?? a) - (orderRank.get(b) ?? b)
        })
      const preferredCols =
        members.length === 1 && gridCols === 3
          ? [1]
          : members.length === 2 && gridCols === 3
            ? [0, 2]
            : members.map((_, idx) => idx % gridCols)
      members.forEach((node, idx) => {
        const idxCandidate = r * gridCols + preferredCols[idx]
        if (idxCandidate < slots.length && !used[idxCandidate]) {
          claim(node, idxCandidate)
        } else {
          const free = used.findIndex((u) => !u)
          if (free >= 0) claim(node, free)
        }
      })
    }
    for (let i = 0; i < count; i++) {
      if (slotOf[i] === -1) {
        const free = used.findIndex((u) => !u)
        if (free >= 0) claim(i, free)
      }
    }
    return { slots, slotOf }
  }

  if (intraEdges.length === 0 && externalEdges.length > 0) {
    const ranked = Array.from({ length: count }, (_, i) => ({
      i,
      ext: averageExternalAnchorX(i, externalEdges),
    })).sort((a, b) => {
      if (a.ext.has !== b.ext.has) return a.ext.has ? -1 : 1
      if (a.ext.has && Math.abs(a.ext.centerX - b.ext.centerX) > 1e-6) {
        return a.ext.centerX - b.ext.centerX
      }
      return a.i - b.i
    })
    for (const item of ranked) {
      const prefCol = item.ext.has
        ? clamp(Math.round((item.ext.centerX - CARD_WIDTH / 2 - baseX) / COL_STEP), 0, gridCols - 1)
        : 0
      let chosen = -1
      let bestCost = Infinity
      for (let s = 0; s < slots.length; s++) {
        if (used[s]) continue
        const sl = slots[s]
        const distCost = item.ext.has
          ? Math.abs(sl.col - prefCol) * 100 + sl.row * 10
          : sl.row * 100 + sl.col
        if (distCost < bestCost) {
          bestCost = distCost
          chosen = s
        }
      }
      claim(item.i, chosen)
    }
    return { slots, slotOf }
  }

  for (let idx = 0; idx < count; idx++) {
    const row = Math.floor(idx / gridCols)
    const col = row % 2 ? gridCols - 1 - (idx % gridCols) : idx % gridCols
    claim(order[idx], row * gridCols + col)
  }
  return { slots, slotOf }
}

/**
 * 计算单个分组（或无分组区域）内节点的初始布局。
 * 保留纯孤立节点旧序直铺；有组内或跨组连线时，采用“距离目标 + 结构规则”混合求解。
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
  const intraEdges: IntraEdge[] = []
  for (const r of relations) {
    if (r.fromNodeId === r.toNodeId) continue
    const from = indices.get(r.fromNodeId)
    const to = indices.get(r.toNodeId)
    if (from === undefined || to === undefined) continue
    const dependency = r.type === 'dependency'
    intraEdges.push({
      from,
      to,
      dependency,
      weight: dependency ? DEPENDENCY_WEIGHT : SUPPLEMENT_WEIGHT,
    })
  }

  const externalEdges: ExternalEdge[] = []
  const anchors = options?.anchors
  if (anchors && anchors.size > 0) {
    for (const r of options.allRelations ?? relations) {
      if (r.fromNodeId === r.toNodeId) continue
      const fromLocal = indices.get(r.fromNodeId)
      const toLocal = indices.get(r.toNodeId)
      if (fromLocal !== undefined && toLocal === undefined) {
        const anchor = anchors.get(r.toNodeId)
        if (!anchor) continue
        const dependency = r.type === 'dependency'
        externalEdges.push({
          local: fromLocal,
          localIsTarget: false,
          dependency,
          weight: dependency ? DEPENDENCY_WEIGHT : SUPPLEMENT_WEIGHT,
          anchorNodeId: r.toNodeId,
          anchorCenterX: anchor.x + anchor.width / 2,
          anchorCenterY: anchor.y + anchor.height / 2,
          anchorX: anchor.x,
          anchorY: anchor.y,
          anchorBottom: anchor.y + anchor.height,
        })
      } else if (toLocal !== undefined && fromLocal === undefined) {
        const anchor = anchors.get(r.fromNodeId)
        if (!anchor) continue
        const dependency = r.type === 'dependency'
        externalEdges.push({
          local: toLocal,
          localIsTarget: true,
          dependency,
          weight: dependency ? DEPENDENCY_WEIGHT : SUPPLEMENT_WEIGHT,
          anchorNodeId: r.fromNodeId,
          anchorCenterX: anchor.x + anchor.width / 2,
          anchorCenterY: anchor.y + anchor.height / 2,
          anchorX: anchor.x,
          anchorY: anchor.y,
          anchorBottom: anchor.y + anchor.height,
        })
      }
    }
  }

  // 无组内连线且无跨组连线时，严格保持按输入顺序从左到右、从上到下的规整网格。
  if (intraEdges.length === 0 && externalEdges.length === 0) {
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

  const { degree, indegree, outdegree, order, isAcyclic, layer } = computeTopology(count, intraEdges)
  const intraConnectedCount = degree.filter((d) => d > 0).length
  const columns = Math.min(3, externalEdges.length > 0 ? 3 : count)
  const baseRows = Math.ceil(count / columns)
  const hasForkOrJoin = outdegree.some((d) => d >= 2) || indegree.some((d) => d >= 2)
  const maxLayer = isAcyclic ? Math.max(0, ...layer) : 0
  const layerCount = maxLayer + 1
  const layerCounts = Array<number>(layerCount).fill(0)
  for (const l of layer) layerCounts[l]++
  const maxLayerSize = Math.max(1, ...layerCounts)
  const useLayeredSeed =
    externalEdges.length === 0 &&
    intraConnectedCount === count &&
    isAcyclic &&
    hasForkOrJoin &&
    layerCount >= 2 &&
    maxLayerSize <= 3 &&
    layerCount <= baseRows + 1

  const gridCols = useLayeredSeed
    ? externalEdges.length > 0
      ? 3
      : Math.min(3, Math.max(2, maxLayerSize === 2 && count >= 4 ? 3 : maxLayerSize))
    : columns
  const rows = useLayeredSeed ? layerCount : baseRows

  const { slots, slotOf } = buildInitialSlots(
    count,
    gridCols,
    rows,
    order,
    intraEdges,
    externalEdges,
    layer,
    useLayeredSeed,
    baseX,
  )

  const occupiedBySlot = Array<number>(slots.length).fill(-1)
  slotOf.forEach((s, node) => {
    occupiedBySlot[s] = node
  })
  const grid = Array.from({ length: rows }, () => Array<number>(gridCols).fill(-1))
  const posRow = Array<number>(count).fill(0)
  const posCol = Array<number>(count).fill(0)

  const syncGrid = () => {
    for (let r = 0; r < rows; r++) grid[r].fill(-1)
    for (let i = 0; i < count; i++) {
      const s = slots[slotOf[i]]
      posRow[i] = s.row
      posCol[i] = s.col
      grid[s.row][s.col] = i
    }
  }

  const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)

  const anchorEntries = anchors ? [...anchors.entries()] : []
  let anchorMinX = Infinity
  let anchorMaxX = -Infinity
  for (const [, pt] of anchorEntries) {
    if (pt.x < anchorMinX) anchorMinX = pt.x
    if (pt.x > anchorMaxX) anchorMaxX = pt.x
  }

  // 预计算跨分组穿经本区域的已锚定纵向连线，以及各跨组连线在不同候选列对其它锚点卡的遮挡数。
  const passingVerticals: { x: number; yLo: number; yHi: number; anchorBlocked: boolean }[] = []
  if (anchorEntries.length > 0 && options?.allRelations) {
    const viewMinY = baseY - 20
    const viewMaxY = baseY + rows * 162
    for (const r of options.allRelations) {
      if (r.fromNodeId === r.toNodeId) continue
      if (indices.has(r.fromNodeId) || indices.has(r.toNodeId)) continue
      const a = anchors!.get(r.fromNodeId)
      const b = anchors!.get(r.toNodeId)
      if (!a || !b) continue
      if (Math.abs(a.x - b.x) > SNAP_STRAIGHT_THRESHOLD) continue
      const vx = (a.x + b.x) / 2
      const yLo = Math.min(a.y + a.height, b.y + b.height)
      const yHi = Math.max(a.y, b.y)
      if (yHi <= viewMinY || yLo >= viewMaxY) continue
      let anchorBlocked = false
      for (const [id, pt] of anchorEntries) {
        if (id === r.fromNodeId || id === r.toNodeId) continue
        if (Math.abs(pt.x - vx) <= SNAP_STRAIGHT_THRESHOLD && pt.y + pt.height > yLo + 2 && pt.y < yHi - 2) {
          anchorBlocked = true
          break
        }
      }
      passingVerticals.push({ x: vx, yLo, yHi, anchorBlocked })
    }
  }

  const extAnchorBlocks: number[][] = externalEdges.map((e) => {
    const counts = Array<number>(gridCols).fill(0)
    if (anchorEntries.length === 0) return counts
    const bucketMidY = baseY + (rows * 162) / 2
    const bandLo = e.anchorY > bucketMidY ? baseY + rows * 162 : e.anchorBottom
    const bandHi = e.anchorY > bucketMidY ? e.anchorY : baseY
    for (let c = 0; c < gridCols; c++) {
      const colX = baseX + c * COL_STEP
      if (Math.abs(colX - e.anchorX) > SNAP_STRAIGHT_THRESHOLD) continue
      let blocks = 0
      for (const [id, pt] of anchorEntries) {
        if (id === e.anchorNodeId) continue
        if (Math.abs(pt.x - colX) <= SNAP_STRAIGHT_THRESHOLD && pt.y + pt.height > bandLo + 2 && pt.y < bandHi - 2) {
          blocks++
        }
      }
      counts[c] = blocks
    }
    return counts
  })

  const score = (): number => {
    syncGrid()
    let cost = 0

    let localMinX = Infinity
    let localMaxX = -Infinity
    for (let i = 0; i < count; i++) {
      const lx = baseX + posCol[i] * COL_STEP
      if (lx < localMinX) localMinX = lx
      if (lx > localMaxX) localMaxX = lx
      // 轻度顶行紧凑重力：优先填满上方行再向下排布，避免孤立上方空洞。
      cost += 28 * posRow[i]
    }
    const minSceneX = Math.min(anchorMinX, localMinX)
    const maxSceneX = Math.max(anchorMaxX, localMaxX)
    const isInteriorX = (x: number) =>
      minSceneX < x - SNAP_STRAIGHT_THRESHOLD && maxSceneX > x + SNAP_STRAIGHT_THRESHOLD

    const verticalSegs: { x: number; yLo: number; yHi: number; arched: boolean }[] = []

    for (const e of intraEdges) {
      const ar = posRow[e.from], ac = posCol[e.from]
      const br = posRow[e.to], bc = posCol[e.to]
      const dr = Math.abs(ar - br)
      const dc = Math.abs(ac - bc)
      cost += e.weight * (40 * (dr + dc - 1) ** 2 + 25 * dr * dc)
      if (dr === 0 && dc === 2 && gridCols >= 3 && grid[ar][1] !== -1) {
        cost += 500
      } else if (dc === 0) {
        const lx = baseX + ac * COL_STEP
        const lo = Math.min(ar, br)
        const hi = Math.max(ar, br)
        let blocked = false
        for (let r = lo + 1; r < hi; r++) {
          if (grid[r][ac] !== -1) {
            cost += 500
            blocked = true
            break
          }
        }
        verticalSegs.push({
          x: lx,
          yLo: baseY + lo * 162 + 130,
          yHi: baseY + hi * 162,
          arched: blocked && !isInteriorX(lx),
        })
      }
      if (e.dependency) {
        if (ar > br) cost += 45
        if (ar === br && ar % 2 === 0 && ac > bc) cost += 15
      }
    }

    if (useLayeredSeed) {
      for (let i = 0; i < count; i++) {
        if (degree[i] > 0) cost += 220 * Math.abs(posRow[i] - layer[i])
      }
    }

    for (let i = 0; i < count; i++) {
      if (degree[i] < 3) continue
      if (gridCols === 3 && posCol[i] === 1) cost -= 35 * degree[i]
      if (rows >= 3 && posRow[i] > 0 && posRow[i] < rows - 1) cost -= 20 * degree[i]
    }

    for (let i = 0; i < intraEdges.length; i++) {
      const e = intraEdges[i]
      const ax = posCol[e.from], ay = posRow[e.from]
      const bx = posCol[e.to], by = posRow[e.to]
      for (let j = i + 1; j < intraEdges.length; j++) {
        const f = intraEdges[j]
        if (e.from === f.from || e.from === f.to || e.to === f.from || e.to === f.to) continue
        const cx = posCol[f.from], cy = posRow[f.from]
        const dx = posCol[f.to], dy = posRow[f.to]
        if (cross(ax, ay, bx, by, cx, cy) * cross(ax, ay, bx, by, dx, dy) < 0 &&
            cross(cx, cy, dx, dy, ax, ay) * cross(cx, cy, dx, dy, bx, by) < 0) {
          cost += 180
        }
      }
    }

    for (const v of passingVerticals) {
      let hitLocal = false
      for (let k = 0; k < count; k++) {
        const kx = baseX + posCol[k] * COL_STEP
        const ky = baseY + posRow[k] * 162
        if (Math.abs(kx - v.x) <= SNAP_STRAIGHT_THRESHOLD && v.yLo < ky && v.yHi > ky + 130) {
          hitLocal = true
          // 内列无法同侧拱桥会直穿卡片，给予重罚；外边界列允许绕卡拱桥。
          cost += isInteriorX(kx) ? 700 : 120
        }
      }
      verticalSegs.push({
        x: v.x,
        yLo: v.yLo,
        yHi: v.yHi,
        arched: (v.anchorBlocked || hitLocal) && !isInteriorX(v.x),
      })
    }

    if (externalEdges.length > 0) {
      for (let eIdx = 0; eIdx < externalEdges.length; eIdx++) {
        const e = externalEdges[eIdx]
        const r = posRow[e.local], c = posCol[e.local]
        const lx = baseX + c * COL_STEP
        const cx = lx + CARD_WIDTH / 2
        const ly = baseY + r * 162
        const dx = Math.abs(cx - e.anchorCenterX)
        cost += e.weight * 0.45 * dx
        if (dx <= SNAP_STRAIGHT_THRESHOLD) {
          cost -= 28 * e.weight
          const pointingDown = e.anchorY >= ly + 130
          const pointingUp = e.anchorBottom <= ly
          if (pointingDown || pointingUp) {
            let localBlocks = 0
            for (let k = 0; k < count; k++) {
              if (k === e.local || posCol[k] !== c) continue
              if ((pointingDown && posRow[k] > r) || (pointingUp && posRow[k] < r)) {
                localBlocks++
              }
            }
            const totalBlocks = localBlocks + extAnchorBlocks[eIdx][c]
            if (totalBlocks > 0) {
              cost += totalBlocks * (isInteriorX(lx) ? 700 : 120)
            }
            const yLo = pointingDown ? ly + 130 : e.anchorBottom
            const yHi = pointingDown ? e.anchorY : ly
            if (yHi > yLo + 10) {
              verticalSegs.push({
                x: lx,
                yLo,
                yHi,
                arched: totalBlocks > 0 && !isInteriorX(lx),
              })
            }
          }
        } else {
          const pointingDown = e.anchorY > baseY + rows * 162
          const pointingUp = e.anchorBottom < baseY
          if (pointingDown || pointingUp) {
            for (let k = 0; k < count; k++) {
              if (k === e.local || posCol[k] !== c) continue
              if ((pointingDown && posRow[k] > r) || (pointingUp && posRow[k] < r)) {
                cost += 90
                break
              }
            }
          }
        }
      }
      for (let i = 0; i < externalEdges.length; i++) {
        const e1 = externalEdges[i]
        const above1 = e1.anchorCenterY < baseY
        const cx1 = baseX + posCol[e1.local] * COL_STEP + CARD_WIDTH / 2
        for (let j = i + 1; j < externalEdges.length; j++) {
          const e2 = externalEdges[j]
          if (e1.local === e2.local) continue
          const above2 = e2.anchorCenterY < baseY
          if (above1 !== above2) continue
          const cx2 = baseX + posCol[e2.local] * COL_STEP + CARD_WIDTH / 2
          if ((cx1 - cx2) * (e1.anchorCenterX - e2.anchorCenterX) < -1e-6) {
            cost += 120
          }
        }
      }
    }

    for (let i = 0; i < verticalSegs.length; i++) {
      const s1 = verticalSegs[i]
      for (let j = i + 1; j < verticalSegs.length; j++) {
        const s2 = verticalSegs[j]
        if (Math.abs(s1.x - s2.x) <= SNAP_STRAIGHT_THRESHOLD && s1.arched === s2.arched) {
          if (Math.min(s1.yHi, s2.yHi) - Math.max(s1.yLo, s2.yLo) > 10) {
            cost += 800
          }
        }
      }
    }

    return cost
  }

  // Stage 1: 完整槽位池局部寻优（交换已占槽位 + 移入空槽位），有限轮次确定性收敛。
  for (let pass = 0; pass < 6; pass++) {
    let best = score()
    let bestMove: { kind: 'swap'; a: number; b: number } | { kind: 'move'; node: number; toSlot: number } | undefined

    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const si = slotOf[i], sj = slotOf[j]
        slotOf[i] = sj; slotOf[j] = si
        const candidate = score()
        if (candidate < best - 1e-6) {
          best = candidate
          bestMove = { kind: 'swap', a: i, b: j }
        }
        slotOf[i] = si; slotOf[j] = sj
      }
    }

    for (let i = 0; i < count; i++) {
      const fromSlot = slotOf[i]
      for (let s = 0; s < slots.length; s++) {
        if (occupiedBySlot[s] !== -1) continue
        slotOf[i] = s
        occupiedBySlot[fromSlot] = -1
        occupiedBySlot[s] = i
        const candidate = score()
        if (candidate < best - 1e-6) {
          best = candidate
          bestMove = { kind: 'move', node: i, toSlot: s }
        }
        slotOf[i] = fromSlot
        occupiedBySlot[s] = -1
        occupiedBySlot[fromSlot] = i
      }
    }

    if (!bestMove) break
    if (bestMove.kind === 'swap') {
      const si = slotOf[bestMove.a], sj = slotOf[bestMove.b]
      slotOf[bestMove.a] = sj
      slotOf[bestMove.b] = si
      occupiedBySlot[si] = bestMove.b
      occupiedBySlot[sj] = bestMove.a
    } else {
      const fromSlot = slotOf[bestMove.node]
      occupiedBySlot[fromSlot] = -1
      occupiedBySlot[bestMove.toSlot] = bestMove.node
      slotOf[bestMove.node] = bestMove.toSlot
    }
  }

  // 压缩全空中间行，按各行最大实测卡片高度生成纵坐标。
  const usedRows = [...new Set(slotOf.map((s) => slots[s].row))].sort((a, b) => a - b)
  const rowRemap = new Map(usedRows.map((r, compact) => [r, compact]))
  const finalRow = slotOf.map((s) => rowRemap.get(slots[s].row)!)
  const finalCol = slotOf.map((s) => slots[s].col)
  const compactRows = usedRows.length
  const rowHeights = Array<number>(compactRows).fill(0)
  for (let i = 0; i < count; i++) {
    rowHeights[finalRow[i]] = Math.max(rowHeights[finalRow[i]], nodeHeight(heights, viewId, memberIds[i]))
  }
  const rowY = [baseY]
  for (let r = 1; r < compactRows; r++) rowY[r] = rowY[r - 1] + rowHeights[r - 1] + ROW_GAP

  return memberIds.map((nodeId, i) => ({
    nodeId,
    x: baseX + finalCol[i] * COL_STEP,
    y: rowY[finalRow[i]],
    width: CARD_WIDTH,
    manual: false,
  }))
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
        ? 150
        : 0
    const total = cand.rank * 40 + distScore + offCanvasPenalty + outOfGroupPenalty
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

function buildCompactBox(
  groupId: string | undefined,
  placed: NodeLayout[],
  heights: Heights,
  viewId: string,
  baseY: number,
  alignLeftToOrigin: boolean,
) {
  const left = placed.length
    ? alignLeftToOrigin
      ? Math.min(42, ...placed.map((n) => n.x - GROUP_PAD_X))
      : Math.min(...placed.map((n) => n.x - GROUP_PAD_X))
    : 42
  const top = Math.min(baseY, ...placed.map((n) => n.y - GROUP_PAD_TOP))
  const right = placed.length
    ? Math.max(...placed.map((n) => n.x + n.width + GROUP_PAD_X))
    : left + 320
  const bottom = Math.max(
    baseY + 178,
    ...placed.map((n) => n.y + nodeHeight(heights, viewId, n.nodeId) + GROUP_PAD_BOTTOM),
  )
  return { groupId, nodes: placed, left, top, width: right - left, height: bottom - top, bottom }
}

function placeFreshBuckets(
  view: import('./map-types.ts').View,
  relations: readonly Relation[],
  heights: Heights,
  verticalGap: number,
): { nodes: NodeLayout[]; groups: GroupLayout[] } {
  const buckets: (string | undefined)[] = [
    ...view.groups.map((g) => g.id),
    ...(view.occurrences.some((o) => !o.groupId) ? [undefined] : []),
  ]
  const memberLists = buckets.map((groupId) =>
    view.occurrences.filter((o) => o.groupId === groupId).map((o) => o.nodeId),
  )
  const anchors = new Map<string, AnchorPoint>()

  // Pass 1: 自上而下前向锚点传播。
  let groupY = 48
  const pass1Boxes = buckets.map((groupId, idx) => {
    const members = memberLists[idx]
    const placed = placeBucketNodes(members, relations, heights, view.id, 42 + GROUP_PAD_X, groupY + GROUP_PAD_TOP, {
      anchors,
      allRelations: relations,
    })
    for (const n of placed) {
      anchors.set(n.nodeId, { ...n, height: nodeHeight(heights, view.id, n.nodeId) })
    }
    const box = buildCompactBox(groupId, placed, heights, view.id, groupY, false)
    groupY = box.bottom + verticalGap
    return box
  })

  const hasCrossBucketEdge =
    buckets.length >= 2 &&
    relations.some((r) => {
      if (r.fromNodeId === r.toNodeId) return false
      const gFrom = view.occurrences.find((o) => o.nodeId === r.fromNodeId)?.groupId
      const gTo = view.occurrences.find((o) => o.nodeId === r.toNodeId)?.groupId
      return (
        view.occurrences.some((o) => o.nodeId === r.fromNodeId) &&
        view.occurrences.some((o) => o.nodeId === r.toNodeId) &&
        gFrom !== gTo
      )
    })

  let finalBoxes = pass1Boxes
  if (hasCrossBucketEdge) {
    // Pass 2: 两轮全视图反向协同重算，使上游/中游/下游分组互相避让纵向直穿并重算纵坐标。
    for (let sweep = 0; sweep < 2; sweep++) {
      let sweepY = 48
      finalBoxes = buckets.map((groupId, idx) => {
        const members = memberLists[idx]
        const memberSet = new Set(members)
        const otherAnchors = new Map<string, AnchorPoint>()
        for (const [id, pt] of anchors) {
          if (!memberSet.has(id)) otherAnchors.set(id, pt)
        }
        const placed = placeBucketNodes(members, relations, heights, view.id, 42 + GROUP_PAD_X, sweepY + GROUP_PAD_TOP, {
          anchors: otherAnchors,
          allRelations: relations,
        })
        for (const n of placed) {
          anchors.set(n.nodeId, { ...n, height: nodeHeight(heights, view.id, n.nodeId) })
        }
        const box = buildCompactBox(groupId, placed, heights, view.id, sweepY, false)
        sweepY = box.bottom + verticalGap
        return box
      })
    }
  }

  const nonEmptyBoxes = finalBoxes.filter((b) => b.nodes.length > 0)
  const unifiedLeft = nonEmptyBoxes.length ? Math.min(...nonEmptyBoxes.map((b) => b.left)) : undefined
  const unifiedRight = nonEmptyBoxes.length
    ? Math.max(...nonEmptyBoxes.map((b) => b.left + b.width))
    : undefined
  const unifiedWidth = unifiedLeft !== undefined && unifiedRight !== undefined ? unifiedRight - unifiedLeft : undefined

  const nodes: NodeLayout[] = []
  const groups: GroupLayout[] = []
  for (const box of finalBoxes) {
    nodes.push(...box.nodes)
    if (box.groupId) {
      groups.push({
        groupId: box.groupId,
        x: unifiedLeft ?? box.left,
        y: box.top,
        width: unifiedWidth ?? box.width,
        height: box.height,
      })
    }
  }
  return { nodes, groups }
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

export function groupCount(view: import('./map-types.ts').View): number {
  return view.groups.length + (view.occurrences.some((o) => !o.groupId) ? 1 : 0)
}

export function availableModes(view: import('./map-types.ts').View): import('./map-types.ts').LayoutMode[] {
  const count = groupCount(view)
  return ['vertical', ...(count >= 2 ? ['grid'] : [])] as import('./map-types.ts').LayoutMode[]
}

/**
 * 主动重排指定视图：'vertical'（单列纵向）或 'grid'（双列田字），同步协同跨组与跨列距离。
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

  const buckets: (string | undefined)[] = [
    ...view.groups.map((g) => g.id),
    ...(view.occurrences.some((o) => !o.groupId) ? [undefined] : []),
  ]
  const memberLists = buckets.map((groupId) =>
    view.occurrences.filter((o) => o.groupId === groupId).map((o) => o.nodeId),
  )
  const anchors = new Map<string, AnchorPoint>()

  const layoutGridPass = (useExistingAnchors: boolean, colLefts?: [number, number], rowTops?: number[]) => {
    const rawBoxes = buckets.map((groupId, i) => {
      const members = memberLists[i]
      const col = i % 2
      const rowIdx = Math.floor(i / 2)
      const estBaseX = colLefts ? colLefts[col] : col === 0 ? 42 : 1040
      const estBaseY = rowTops?.[rowIdx] ?? 48 + rowIdx * 360
      const memberSet = new Set(members)
      const passAnchors = new Map<string, AnchorPoint>()
      if (useExistingAnchors) {
        for (const [id, pt] of anchors) {
          if (!memberSet.has(id)) passAnchors.set(id, pt)
        }
      } else {
        for (const [id, pt] of anchors) passAnchors.set(id, pt)
      }
      const placed = placeBucketNodes(
        members,
        relations,
        heights,
        viewId,
        estBaseX + GROUP_PAD_X,
        estBaseY + GROUP_PAD_TOP,
        { anchors: passAnchors, allRelations: relations },
      )
      for (const n of placed) {
        anchors.set(n.nodeId, { ...n, height: nodeHeight(heights, viewId, n.nodeId) })
      }
      const minX = placed.length ? Math.min(...placed.map((n) => n.x - GROUP_PAD_X)) : estBaseX
      const maxX = placed.length ? Math.max(...placed.map((n) => n.x + n.width + GROUP_PAD_X)) : estBaseX + 320
      const minY = estBaseY
      const maxY = Math.max(
        estBaseY + 178,
        ...placed.map((n) => n.y + nodeHeight(heights, viewId, n.nodeId) + GROUP_PAD_BOTTOM),
      )
      const normalized = placed.map((n) => ({ ...n, x: n.x - minX, y: n.y - minY }))
      return {
        groupId,
        nodes: normalized,
        rawIndent: Math.max(0, minX - estBaseX),
        width: maxX - minX,
        height: maxY - minY,
      }
    })

    const columns = 2
    const widths = Array.from({ length: columns }, (_, col) =>
      Math.max(0, ...rawBoxes.filter((_, i) => i % columns === col).map((b) => b.width)),
    )
    const nextColLefts: [number, number] = [42, 42 + widths[0] + 48]
    const nextRowTops: number[] = []
    const nodes: NodeLayout[] = []
    const groups: GroupLayout[] = []
    let top = 48
    for (let i = 0; i < rawBoxes.length; i += columns) {
      nextRowTops.push(top)
      const row = rawBoxes.slice(i, i + columns)
      let left = 42
      row.forEach((box, col) => {
        const indent = Math.min(box.rawIndent, Math.max(0, widths[col] - box.width))
        const boxLeft = left + indent
        for (const n of box.nodes) {
          const placed = { ...n, x: n.x + boxLeft, y: n.y + top }
          nodes.push(placed)
          anchors.set(placed.nodeId, { ...placed, height: nodeHeight(heights, viewId, placed.nodeId) })
        }
        if (box.groupId) groups.push({ groupId: box.groupId, x: left, y: top, width: widths[col], height: box.height })
        left += widths[col] + 48
      })
      top += Math.max(...row.map((b) => b.height)) + 48
    }
    return { nodes, groups, colLefts: nextColLefts, rowTops: nextRowTops }
  }

  const pass1 = layoutGridPass(false)
  const hasCross =
    buckets.length >= 2 &&
    relations.some((r) => {
      if (r.fromNodeId === r.toNodeId) return false
      const gFrom = view.occurrences.find((o) => o.nodeId === r.fromNodeId)?.groupId
      const gTo = view.occurrences.find((o) => o.nodeId === r.toNodeId)?.groupId
      return (
        view.occurrences.some((o) => o.nodeId === r.fromNodeId) &&
        view.occurrences.some((o) => o.nodeId === r.toNodeId) &&
        gFrom !== gTo
      )
    })
  const finalGrid = hasCross ? layoutGridPass(true, pass1.colLefts, pass1.rowTops) : pass1
  return { viewId, mode, nodes: finalGrid.nodes, groups: finalGrid.groups }
}
