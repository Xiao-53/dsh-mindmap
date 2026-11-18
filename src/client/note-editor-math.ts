import type { EditorState, Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import type { FormulaToken } from '../shared/note-markdown.ts'
import { formulaElement, mathMarkup } from './note-math.ts'
import { noteRangeActive } from './note-editor-format.ts'

const sourceStyle = Decoration.mark({ class: 'note-cm-tex' })
const delimiterStyle = Decoration.mark({ class: 'note-cm-delimiter' })
const sourceLine = Decoration.line({ class: 'note-cm-math-line' })
const previews = new WeakMap<FormulaToken, boolean>()

class FormulaWidget extends WidgetType {
  constructor(readonly token: FormulaToken, readonly active: boolean, readonly reveal: (view: EditorView, dom: HTMLElement) => void) { super() }

  eq(other: FormulaWidget) {
    return other.token.source === this.token.source && other.token.type === this.token.type && other.active === this.active
  }

  toDOM(view: EditorView) {
    const element: HTMLElement = formulaElement(view.dom.ownerDocument, this.token)
    if (this.active) {
      element.tabIndex = -1
      element.classList.add('note-cm-math-preview')
    } else {
      element.tabIndex = 0
      element.classList.add('note-cm-formula')
      element.setAttribute('role', 'button')
      element.setAttribute('aria-label', '编辑公式：' + this.token.tex)
      element.addEventListener('click', () => this.reveal(view, element))
      element.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        this.reveal(view, element)
      })
    }
    return element
  }
}

export function decorateFormula(
  ranges: Range<Decoration>[], state: EditorState, token: FormulaToken, from: number, to: number,
  reveal: (view: EditorView, dom: HTMLElement) => void,
) {
  const display = token.type === 'formulaBlock'
  let valid = previews.get(token)
  if (valid === undefined) {
    valid = mathMarkup(token.tex, display) !== null
    previews.set(token, valid)
  }
  if (valid && !noteRangeActive(state, from, to)) {
    ranges.push(Decoration.replace({ widget: new FormulaWidget(token, false, reveal), block: display, inclusive: false }).range(from, to))
    return
  }
  ranges.push(sourceStyle.range(from, to))
  const opening = token.source.indexOf(token.delimiter)
  const ending = token.source.trimEnd().length
  const width = token.delimiter.length
  if (opening >= 0 && ending >= opening + 2 * width) {
    ranges.push(delimiterStyle.range(from + opening, from + opening + width), delimiterStyle.range(from + ending - width, from + ending))
  }
  if (display) {
    const last = state.doc.lineAt(to)
    for (let n = state.doc.lineAt(from).number; n <= last.number; n++)
      ranges.push(sourceLine.range(state.doc.line(n).from))
    if (valid) ranges.push(Decoration.widget({ widget: new FormulaWidget(token, true, reveal), side: 1, block: true }).range(last.to))
  }
}
