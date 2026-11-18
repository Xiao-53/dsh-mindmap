export interface SelectionSnapshot {
  text: string
  before: string
  after: string
}
type Boundary = { node: Node; offset: number }
type TextPart = { node: Text | HTMLElement; text: string; formula: boolean }
const formulaSelector = '[data-note-formula]'

function parts(root: HTMLElement): TextPart[] {
  const result: TextPart[] = []
  function visit(node: Node) {
    if (node instanceof Element && (node.hasAttribute('data-plot-art') || node.matches('.note-plot-menu,.note-image-remove,[hidden]'))) return
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text
      result.push({ node: text, text: text.data, formula: false })
    } else if (node instanceof HTMLElement && node.hasAttribute('data-note-formula')) {
      result.push({ node, text: node.dataset.noteFormula ?? '', formula: true })
    } else {
      for (const child of node.childNodes) visit(child)
    }
  }
  visit(root)
  return result
}

function nodeBoundary(node: Node, after: boolean): Boundary {
  const parent = node.parentNode!
  return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) + Number(after) }
}

function projectRange(root: HTMLElement, range: Range) {
  let before = '', text = '', after = ''
  for (const part of parts(root)) {
    if (range.intersectsNode(part.node)) {
      if (part.formula) text += part.text
      else {
        const start = part.node === range.startContainer ? range.startOffset : 0
        const end = part.node === range.endContainer ? range.endOffset : part.text.length
        before += part.text.slice(0, start)
        text += part.text.slice(start, end)
        after += part.text.slice(end)
      }
    } else {
      const end = nodeBoundary(part.node, true)
      if (range.comparePoint(end.node, end.offset) <= 0) before += part.text
      else after += part.text
    }
  }
  return { text, before: before.slice(-48), after: after.slice(0, 48) }
}

export function noteProjection(root: HTMLElement) {
  const spans = parts(root)
  return {
    text: spans.map(s => s.text).join(''),
    boundary(offset: number, end: boolean): Boundary | undefined {
      for (const part of spans) {
        if (offset < part.text.length || (end && offset === part.text.length)) {
          return part.formula ? nodeBoundary(part.node, end || offset === part.text.length) : { node: part.node, offset }
        }
        offset -= part.text.length
      }
      return { node: root, offset: root.childNodes.length }
    },
  }
}

export function copyFormulaSelection(root: HTMLElement, event: ClipboardEvent) {
  const selection = root.ownerDocument.getSelection()
  if (!selection?.rangeCount || !event.clipboardData) return
  const captured = captureSelection(root, selection)
  if (!captured) return
  const range = selection.getRangeAt(0)
  if (![...root.querySelectorAll(formulaSelector)].some(element => range.intersectsNode(element))) return
  event.clipboardData.setData('text/plain', captured.text)
  event.preventDefault()
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
  const result = projectRange(container, selection.getRangeAt(0))
  return result.text.trim() ? result : undefined
}
