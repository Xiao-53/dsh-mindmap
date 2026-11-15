import type { KnowledgeMap } from '../shared/map-types.ts'
import type { PendingInsertion } from './insert-reference.ts'
export interface Camera {
  x: number
  y: number
  zoom: number
}
export interface ReadingLocation {
  viewId: string
  selectedNodeId?: string
  detailScroll: number
  focusSource?: string
  camera?: Camera
}
export interface ReadingHistory {
  back: ReadingLocation[]
  forward: ReadingLocation[]
}
export interface ReadingState {
  workspaceKey: string
  sessionId: string
  mapId: string
  viewId: string
  cameras: Record<string, Camera>
  selectedNodeId?: string
  detailScroll: number
  focusSource?: string
  history?: ReadingHistory
}
export interface ReadingStore {
  selectedMapId?: string
  maps: Record<string, ReadingState>
  pending: Record<string, PendingInsertion | undefined>
}
export const readingKey = (workspace: string, map: string) =>
  JSON.stringify([workspace, map])
export function initialReading(
  workspaceKey: string,
  sessionId: string,
  map: KnowledgeMap,
): ReadingState {
  return {
    workspaceKey,
    sessionId,
    mapId: map.id,
    viewId: map.rootViewId,
    cameras: {},
    detailScroll: 0,
  }
}
export function reconcileReading(
  state: ReadingState,
  map: KnowledgeMap,
): { state: ReadingState; notice?: string } {
  const viewRemoved = !map.views.some((v) => v.id === state.viewId)
  const nodeRemoved = state.selectedNodeId && !validReadingLocation(map, state)
  const history = state.history && {
    back: state.history.back.filter(location => validReadingLocation(map, location)),
    forward: state.history.forward.filter(location => validReadingLocation(map, location)),
  }
  return {
    state: {
      ...state,
      viewId: viewRemoved ? map.rootViewId : state.viewId,
      selectedNodeId: viewRemoved || nodeRemoved ? undefined : state.selectedNodeId,
      detailScroll: viewRemoved || nodeRemoved ? 0 : state.detailScroll,
      history,
    },
    notice:
      viewRemoved || nodeRemoved
        ? '当前阅读对象已删除，已返回可用视图。'
        : undefined,
  }
}

// 中心节点可打开本节笔记；其他详情目标须仍属于原视图。
export function validReadingLocation(map: KnowledgeMap, location: ReadingLocation): boolean {
  const view = map.views.find(view => view.id === location.viewId)
  return !!view && (!location.selectedNodeId || (
    map.nodes.some(node => node.id === location.selectedNodeId) &&
    (view.centerNodeId === location.selectedNodeId ||
      view.occurrences.some(item => item.nodeId === location.selectedNodeId))
  ))
}
