import type { MapSnapshot } from '../shared/map-types.ts'
import type { ReferenceSnapshot } from './reference-source.ts'
export function resolveReference(
  ref: ReferenceSnapshot,
  snapshot: MapSnapshot,
): { viewId?: string; nodeId?: string; message?: string } {
  if (
    ref.mapId !== snapshot.map.id ||
    ref.workspaceKey !== snapshot.workspaceKey
  )
    return { message: '来源工作区或地图已失效；保留原文快照。' }
  const node = snapshot.map.nodes.find((n) => n.id === ref.nodeId)
  if (!node) return { message: '来源节点已删除；保留原文快照。' }
  const origin = snapshot.map.views.find(
    (v) =>
      v.id === ref.originViewId &&
      (v.centerNodeId === ref.nodeId ||
        v.occurrences.some((o) => o.nodeId === ref.nodeId)),
  )
  const other =
    snapshot.map.views.find((v) =>
      v.occurrences.some((o) => o.nodeId === ref.nodeId),
    ) ?? snapshot.map.views.find((v) => v.centerNodeId === ref.nodeId)
  return {
    viewId: origin?.id ?? other?.id ?? snapshot.map.rootViewId,
    nodeId: node.id,
    message: origin
      ? undefined
      : other
        ? '原出现位置已移除，已定位同一节点的可用位置。'
        : '此节点已无画布出现位置，已打开详情。',
  }
}
export function uniqueSelection(
  text: string,
  ref: ReferenceSnapshot,
): { start: number; end: number } | undefined {
  const matches: number[] = []
  let from = 0
  while (from <= text.length) {
    const i = text.indexOf(ref.text, from)
    if (i < 0) break
    if (
      text.slice(Math.max(0, i - ref.before.length), i) === ref.before &&
      text.slice(
        i + ref.text.length,
        i + ref.text.length + ref.after.length,
      ) === ref.after
    )
      matches.push(i)
    from = i + 1
  }
  return matches.length === 1
    ? { start: matches[0], end: matches[0] + ref.text.length }
    : undefined
}
export function highlightReference(
  container: HTMLElement,
  ref: ReferenceSnapshot,
): boolean {
  const location = uniqueSelection(container.textContent ?? '', ref)
  if (!location) return false
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let offset = 0
  let start: { node: Node; offset: number } | undefined
  let end: { node: Node; offset: number } | undefined
  while (walker.nextNode()) {
    const node = walker.currentNode
    const length = node.textContent?.length ?? 0
    if (!start && offset + length >= location.start)
      start = { node, offset: location.start - offset }
    if (offset + length >= location.end) {
      end = { node, offset: location.end - offset }
      break
    }
    offset += length
  }
  if (!start || !end) return false
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  start.node.parentElement?.scrollIntoView({ block: 'nearest' })
  return true
}
