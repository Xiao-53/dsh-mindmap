export interface SelectionSnapshot {
  text: string
  before: string
  after: string
}
export function captureSelection(
  container: HTMLElement,
  selection: Selection | null = window.getSelection(),
): SelectionSnapshot | undefined {
  if (
    !selection ||
    selection.isCollapsed ||
    !selection.rangeCount ||
    !selection.anchorNode ||
    !selection.focusNode ||
    !container.contains(selection.anchorNode) ||
    !container.contains(selection.focusNode)
  )
    return
  const range = selection.getRangeAt(0)
  const text = range.toString()
  if (!text.trim()) return
  const before = range.cloneRange()
  before.selectNodeContents(container)
  before.setEnd(range.startContainer, range.startOffset)
  const after = range.cloneRange()
  after.selectNodeContents(container)
  after.setStart(range.endContainer, range.endOffset)
  return {
    text,
    before: before.toString().slice(-48),
    after: after.toString().slice(0, 48),
  }
}
