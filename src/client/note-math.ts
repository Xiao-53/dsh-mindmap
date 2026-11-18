import { mathMarkup } from '../shared/note-math.ts'
import type { FormulaToken } from '../shared/note-markdown.ts'
export { mathMarkup } from '../shared/note-math.ts'

export function formulaElement(document: Document, token: FormulaToken, editable = false) {
  const display = token.type === 'formulaBlock'
  const node = document.createElement(display ? 'div' : 'span')
  node.className = 'note-math' + (display ? ' note-math-block' : '')
  node.dataset.noteFormula = token.source
  const markup = mathMarkup(token.tex, display)
  if (markup !== null) {
    // 唯一 HTML 来源是受限选项下的 KaTeX，不插入任意原文或异常消息。
    node.innerHTML = markup
  } else {
    node.classList.add('note-math-invalid')
    node.textContent = token.source
    node.title = '公式无法预览'
    node.setAttribute('aria-label', '公式无法预览：' + token.source)
  }
  if (editable) {
    node.contentEditable = 'false'
    node.tabIndex = 0
    node.setAttribute('role', 'button')
    if (markup !== null) node.setAttribute('aria-label', '编辑公式：' + token.tex)
  } else if (display) {
    node.tabIndex = 0
    node.setAttribute('role', 'region')
    if (markup !== null) node.setAttribute('aria-label', '数学公式')
  }
  return node
}
