import { inlineSourcePoints, isFormula, lexNote, noteBlocks, noteImageToken } from '../shared/note-markdown.ts'
import { isPlot, type PlotToken } from '../shared/note-plot.ts'
export function safeHref(href: string): string | undefined {
  return /^(https?:\/\/|mailto:|#)/i.test(href) ? href : undefined
}
import { formulaElement } from './note-math.ts'
import type { Token, Tokens } from 'marked'

type RichToken = Token & { text?: string; tokens?: Token[] }
export type PlotHost = { element: HTMLElement; token: PlotToken }
type SourcePoints = WeakMap<Node, { text: string; offsets: number[] }>
const projectedPoints = new WeakMap<HTMLElement, SourcePoints>()
const listPrefix = /^ {0,3}(?:([-+*])|(\d{1,9})([.)]))[ \t\u00a0]+/

export function noteImage(document: Document, raw: string, alt: string, src?: string, onRemove?: () => void): HTMLElement {
  const wrapper = document.createElement('span')
  wrapper.className = 'note-inline-image'
  wrapper.contentEditable = 'false'
  wrapper.dataset.noteImage = raw
  wrapper.addEventListener('dragstart', event => { event.preventDefault(); event.stopPropagation() })
  if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(src ?? '')) {
    const image = document.createElement('img')
    image.src = src!
    image.alt = alt
    image.draggable = false
    wrapper.append(image)
  } else {
    const label = document.createElement('span')
    label.className = 'note-image-missing'
    label.textContent = `${alt || '图片'} · 未载入`
    wrapper.append(label)
  }
  if (onRemove) {
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'note-image-remove'
    remove.setAttribute('aria-label', '移除图片：' + (alt || '图片'))
    remove.title = '移除这处图片引用'
    remove.textContent = '×'
    remove.addEventListener('click', onRemove)
    wrapper.append(remove)
  }
  return wrapper
}

export function loadRichNote(root: HTMLElement, markdown: string, resource: (href: string) => string | undefined) {
  const document = root.ownerDocument
  const textPoints: SourcePoints = new WeakMap()
  const plots: PlotHost[] = []
  const tokens = lexNote(markdown)
  const { positions } = noteBlocks(markdown, tokens)
  function literal(token: RichToken) {
    const value = token.text ?? token.raw
    const node = document.createTextNode(value)
    const range = positions.get(token)
    if (!range || !value) return node
    const source = markdown.slice(range.start, range.end).replace(/\r\n?/g, '\n')
    const at = source.indexOf(value)
    if (at < 0 || source.indexOf(value, at + 1) >= 0) return node
    let original = range.start
    for (let i = 0; i < at; i++) original += source[i] === '\n' && markdown.startsWith('\r\n', original) ? 2 : 1
    const offsets = inlineSourcePoints(markdown, { type: 'text', raw: value, text: value }, original)
    if (offsets) textPoints.set(node, { text: value, offsets })
    return node
  }
  const render = (token: RichToken): Node => {
    if (isPlot(token)) {
      const block = document.createElement('div')
      block.className = 'note-plot-host'
      block.contentEditable = 'false'
      block.dataset.noteLockedPlot = token.source
      plots.push({ element: block, token })
      return block
    }
    const element = (tag: string, tokens = token.tokens) => {
      const output = document.createElement(tag)
      if (tokens) output.append(...tokens.map(render))
      else if (token.text) output.append(literal(token))
      return output
    }
    if (isFormula(token)) {
      const formula = formulaElement(document, token)
      const range = positions.get(token)
      if (range) textPoints.set(formula, { text: token.source, offsets: [range.start, range.end] })
      return formula
    }
    const image = noteImageToken(token)
    if (image) return noteImage(document, image.raw, image.text, resource(image.href))
    switch (token.type) {
      case 'space': return document.createTextNode('')
      case 'paragraph': return element('p')
      case 'heading': return element(`h${(token as Tokens.Heading).depth}`)
      case 'strong': case 'em': {
        const emphasis = element(token.type)
        emphasis.dataset.noteEmphasis = (token.raw.startsWith('_') ? '_' : '*').repeat(token.type === 'strong' ? 2 : 1)
        return emphasis
      }
      case 'del': return element('del')
      case 'codespan': return element('code')
      case 'code': {
        const block = document.createElement('pre')
        block.dataset.language = (token as Tokens.Code).lang ?? ''
        block.append(element('code'))
        return block
      }
      case 'br': return document.createElement('br')
      case 'hr': return document.createElement('hr')
      case 'blockquote': return element('blockquote')
      case 'link': {
        const target = token as Tokens.Link
        const url = safeHref(target.href) ?? resource(target.href)
        const link = element(url ? 'a' : 'span')
        if (url) {
          link.setAttribute('href', url)
          if (!url.startsWith('#')) {
            link.setAttribute('target', '_blank')
            link.setAttribute('rel', 'noreferrer')
          }
        }
        link.className = 'note-rich-link'
        link.dataset.noteHref = (token as Tokens.Link).href
        link.dataset.noteTitle = (token as Tokens.Link).title ?? ''
        return link
      }
      case 'list': {
        const { ordered, start, items } = token as Tokens.List
        const list = document.createElement(ordered ? 'ol' : 'ul')
        if (list instanceof HTMLOListElement && typeof start === 'number') list.start = start
        const marker = listPrefix.exec(token.raw)
        if (marker) list.dataset.noteListMarker = marker[1] ?? marker[3]
        for (const item of items) {
          const li = element('li', item.tokens)
          if (item.task) {
            li.dataset.noteTask = item.checked ? 'x' : ' '
            // marked 可将复选框作为独立 token 提供。
            const checkbox = li.querySelector('[data-note-checkbox]')
            if (checkbox) checkbox.remove()
          }
          list.append(li)
        }
        return list
      }
      case 'checkbox': {
        const mark = document.createElement('span')
        mark.dataset.noteCheckbox = ''
        return mark
      }
      case 'table': {
        const { header, rows } = token as Tokens.Table
        const wrapper = document.createElement('div')
        wrapper.className = 'note-table'
        const table = document.createElement('table')
        wrapper.append(table)
        for (const [index, cells] of [header, ...rows].entries()) {
          const row = table.insertRow()
          for (const cell of cells) {
            const entry = element(index ? 'td' : 'th', cell.tokens)
            if (cell.align) entry.style.textAlign = cell.align
            row.append(entry)
          }
        }
        return wrapper
      }
      case 'text': {
        if (token.tokens) return element('span')
        return literal(token)
      }
      case 'escape': {
        // 保留转义的美元语义，附近正文编辑时不可把它重新识别成定界符。
        if (token.text !== '$') return document.createTextNode(token.text ?? token.raw)
        const literal = document.createElement('span')
        literal.dataset.noteLiteral = token.raw
        literal.contentEditable = 'false'
        literal.textContent = token.text
        return literal
      }
      default: {
        const literal = document.createElement('span')
        literal.contentEditable = 'false'
        literal.dataset.noteLiteral = token.raw
        if (token.type === 'def') literal.hidden = true
        else literal.textContent = token.text ?? token.raw
        return literal
      }
    }
  }
  const blocks: HTMLElement[] = []
  for (const token of tokens) {
    if (token.type === 'space') continue
    const rendered = render(token)
    const block = rendered instanceof HTMLElement ? rendered : document.createElement('p')
    if (block !== rendered) block.append(rendered)
    const range = positions.get(token)
    if (range) block.dataset.noteSourceStart = String(range.start)
    blocks.push(block)
  }
  root.replaceChildren(...blocks)
  projectedPoints.set(root, textPoints)
  return { textPoints, plots }
}

export function projectedCaret(root: HTMLElement, block: HTMLElement, source: number) {
  const points = projectedPoints.get(root)
  if (!points) return
  const walker = root.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const point = points.get(node)
    const offset = point?.text === node.textContent ? point.offsets.indexOf(source) : -1
    if (offset >= 0) {
      const range = root.ownerDocument.createRange()
      range.setStart(node, offset)
      range.collapse(true)
      return range
    }
  }
}
