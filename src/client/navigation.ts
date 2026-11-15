import type { KnowledgeMap, KnowledgeNode } from '../shared/map-types.ts'
import type { MapLayout } from '../shared/map-types.ts'
import type { Heights } from '../shared/layout.ts'
import { nodeHeight } from '../shared/layout.ts'
import type { ReadingLocation, ReadingState } from './reading-state.ts'
import { validReadingLocation } from './reading-state.ts'
export type HistoryDirection = 'back' | 'forward'
const readingLocation = (state: ReadingState): ReadingLocation => ({
  viewId: state.viewId,
  selectedNodeId: state.selectedNodeId,
  detailScroll: state.detailScroll,
  focusSource: state.focusSource,
  camera: state.cameras[state.viewId],
})
export function recordReadingNavigation(state: ReadingState, next: ReadingState): ReadingState {
  // 笔记属于当前页面状态；仅切换导图视图才新增历史。
  if (state.viewId === next.viewId)
    return next
  return {
    ...next,
    history: {
      back: [...(state.history?.back ?? []), readingLocation(state)],
      forward: [],
    },
  }
}
export function historyReading(
  state: ReadingState,
  map: KnowledgeMap,
  direction: HistoryDirection,
): ReadingState | undefined {
  const history = state.history ?? { back: [], forward: [] }
  const available = history[direction].filter(location =>
    validReadingLocation(map, location),
  )
  // 跳过升级前留下的同视图笔记历史。
  while (available.at(-1)?.viewId === state.viewId) available.pop()
  const target = available.at(-1)
  if (!target) return
  const opposite = direction === 'back' ? 'forward' : 'back'
  const cameras = { ...state.cameras }
  if (target.camera) cameras[target.viewId] = target.camera
  else delete cameras[target.viewId]
  return {
    ...state,
    viewId: target.viewId,
    selectedNodeId: target.selectedNodeId,
    detailScroll: target.detailScroll,
    focusSource: target.focusSource,
    cameras,
    history: {
      ...history,
      [direction]: available.slice(0, -1),
      [opposite]: [...history[opposite], readingLocation(state)],
    },
  }
}
export function targetReading(
  state: ReadingState,
  viewId: string,
  nodeId: string | undefined,
  layout: MapLayout | undefined,
  heights: Heights,
  viewport: { width: number; height: number },
): ReadingState {
  const next = {
    ...state,
    viewId,
    selectedNodeId: nodeId,
    detailScroll: state.viewId === viewId && state.selectedNodeId === nodeId ? state.detailScroll : 0,
    focusSource: nodeId,
  }
  const position = layout?.views
    .find((v) => v.viewId === viewId)
    ?.nodes.find((n) => n.nodeId === nodeId)
  if (!position) return next
  const zoom = Math.min(1.4, Math.max(state.cameras[viewId]?.zoom ?? 1, 1.05))
  return {
    ...next,
    cameras: {
      ...state.cameras,
      [viewId]: {
        zoom,
        x: viewport.width * 0.46 - (position.x + position.width / 2) * zoom,
        y:
          viewport.height * 0.5 -
          (position.y + nodeHeight(heights, viewId, position.nodeId) / 2) *
            zoom,
      },
    },
  }
}
export function viewPath(map: KnowledgeMap, viewId: string): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  const views = new Map(map.views.map((v) => [v.id, v]))
  let current = views.get(viewId)
  while (current) {
    if (seen.has(current.id)) throw new Error('视图父级成环')
    seen.add(current.id)
    result.unshift(current.id)
    current =
      current.parentViewId === null
        ? undefined
        : views.get(current.parentViewId)
  }
  return result
}
export const nodeDestination = (node: KnowledgeNode, currentViewId: string) =>
  node.childViewId && node.childViewId !== currentViewId
    ? node.childViewId
    : undefined
export class NavigationTransition {
  private timer?: ReturnType<typeof setTimeout>
  private target?: string
  private phase: 'idle' | 'out' | 'in' = 'idle'
  private alive = true
  navigate(
    target: string,
    reduced: boolean,
    setPhase: (phase: 'idle' | 'out' | 'in') => void,
    commit: (id: string) => void,
  ) {
    this.target = target
    if (reduced) {
      clearTimeout(this.timer)
      commit(target)
      this.phase = 'idle'
      setPhase('idle')
      return
    }
    if (this.phase === 'out') return
    clearTimeout(this.timer)
    this.phase = 'out'
    setPhase('out')
    this.timer = setTimeout(() => {
      if (!this.alive || !this.target) return
      commit(this.target)
      this.phase = 'in'
      setPhase('in')
      this.timer = setTimeout(() => {
        if (this.alive) {
          this.phase = 'idle'
          setPhase('idle')
        }
      }, 320)
    }, 180)
  }
  dispose() {
    this.alive = false
    clearTimeout(this.timer)
  }
}
