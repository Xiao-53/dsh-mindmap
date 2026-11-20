import { projectedCaret } from './note-rich-text.ts'
import { noteProjection } from './selection.ts'
import type { MapSnapshot } from '../shared/map-types.ts'
import type { ReferenceSnapshot } from './reference-source.ts'
import { locateNoteAnchor } from '../shared/note-position.ts'
import { noteBlocks, notePlots } from '../shared/note-markdown.ts'
import { plotContent } from '../shared/note-plot.ts'
import { sameWorkspaceKey } from '../shared/workspace-path.ts'
export function resolveReference(
  ref: ReferenceSnapshot,
  snapshot: MapSnapshot,
): { viewId?: string; nodeId?: string; message?: string } {
  if (
    ref.mapId !== snapshot.map.id ||
    !sameWorkspaceKey(ref.workspaceKey, snapshot.workspaceKey)
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
function scrollInNote(container: HTMLElement, target: Pick<DOMRect, 'top' | 'bottom'>) {
  const scroller = container.querySelector<HTMLElement>('.inspector-body')
  if (!scroller) return
  const viewport = scroller.getBoundingClientRect()
  const scale = viewport.height / scroller.offsetHeight || 1
  if (target.top < viewport.top) scroller.scrollTop += (target.top - viewport.top) / scale
  else if (target.bottom > viewport.bottom) {
    scroller.scrollTop += Math.min(target.top - viewport.top, target.bottom - viewport.bottom) / scale
  }
}
export function highlightReference(
  container: HTMLElement,
  ref: ReferenceSnapshot,
): boolean {
  let projection = noteProjection(container)
  let location = uniqueSelection(projection.text, ref)
  const body = container.querySelector<HTMLElement>('.note-rich-body')
  if (!location && body) {
    projection = noteProjection(body, true)
    location = uniqueSelection(projection.text, ref)
  }
  if (!location) return false
  const start = projection.boundary(location.start, false)
  const end = projection.boundary(location.end, true)
  if (!start || !end) return false
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  if (start.node.parentElement) scrollInNote(container, start.node.parentElement.getBoundingClientRect())
  return true
}

export function focusPlotReference(container: HTMLElement, ref: ReferenceSnapshot, markdown: string): boolean {
  const current = notePlots(markdown).find(token => token.data?.id === ref.plotId)
  if (!current?.data || plotContent(current.data) !== ref.plotContent) return false
  const element = [...container.querySelectorAll<HTMLElement>('[data-note-plot]')]
    .find(item => item.dataset.notePlot === ref.plotId)
  if (!element) return false
  element.focus({ preventScroll: true })
  scrollInNote(container, element.getBoundingClientRect())
  return true
}

export async function focusNotePosition(container: HTMLElement, ref: ReferenceSnapshot, markdown: string, signal: AbortSignal) {
  if (!ref.anchor) return false
  const location = await locateNoteAnchor(markdown, ref.anchor)
  if (!location || signal.aborted) return false
  const body = container.querySelector<HTMLElement>('.note-rich-body')
  if (!body) return false
  if (location.gapIndex !== undefined) {
    const bounds = body.getBoundingClientRect()
    const blocks = Array.from(body.children)
    const previous = blocks.slice(0, location.gapIndex).reverse().map(block => block.getBoundingClientRect()).find(rect => rect.height)
    const next = blocks.slice(location.gapIndex).map(block => block.getBoundingClientRect()).find(rect => rect.height)
    const top = ((previous?.bottom ?? bounds.top) + (next?.top ?? bounds.bottom)) / 2
    body.tabIndex = -1
    body.focus({ preventScroll: true })
    scrollInNote(container, { top, bottom: top + 1 })
    return true
  }
  const index = location.block ? noteBlocks(markdown).blocks.findIndex(block => block.start === location.block?.start) : -1
  const target = index < 0 ? body : body?.children.item(index)
  if (!(target instanceof HTMLElement)) return false
  target.tabIndex = -1
  target.focus({ preventScroll: true })
  const caret = projectedCaret(body, target, location.inline)?.getBoundingClientRect()
  scrollInNote(container, caret?.height ? caret : target.getBoundingClientRect())
  return true
}
