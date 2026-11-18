import { inlineSourcePoints, isFormula, lexNote, noteBlocks, noteSourceSpans } from '../shared/note-markdown.ts'
import { isPlot, type PlotToken } from '../shared/note-plot.ts'
import { safeHref } from './render-note.tsx'
import { formulaElement, mathMarkup } from './note-math.ts'
import type { Token, Tokens } from 'marked'

type RichToken = Token & { text?: string; tokens?: Token[] }
type OriginalBlock = { raw: string; html: string }
export type PlotHost = { element: HTMLElement; token: PlotToken }
type SourcePoints = WeakMap<Node, { text: string; offsets: number[] }>
const projectedPoints = new WeakMap<HTMLElement, SourcePoints>()

export function noteImage(document: Document, raw: string, alt: string, src?: string): HTMLElement {
  const wrapper = document.createElement('span')
  wrapper.className = 'note-inline-image'
  wrapper.contentEditable = 'false'
  wrapper.dataset.noteImage = raw
  if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(src ?? '')) {
    const image = document.createElement('img')
    image.src = src!
    image.alt = alt
    wrapper.append(image)
  } else {
    const label = document.createElement('span')
    label.className = 'note-image-missing'
    label.textContent = `${alt || '图片'} · 未载入`
    wrapper.append(label)
  }
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'note-image-remove'
  remove.setAttribute('aria-label', `移除图片：${alt || '图片'}`)
  remove.title = '移除这处图片引用'
  remove.textContent = '×'
  wrapper.append(remove)
  return wrapper
}

export function loadRichNote(root: HTMLElement, markdown: string, resource: (href: string) => string | undefined) {
  const document = root.ownerDocument
  // 避免在每次输入时重写未编辑的 Markdown 块。
  const originals = new WeakMap<HTMLElement, OriginalBlock>()
  const textPoints: SourcePoints = new WeakMap()
  const plots: PlotHost[] = []
  const tokens = lexNote(markdown)
  const { positions } = noteBlocks(markdown, tokens)
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
      else output.textContent = token.text ?? ''
      return output
    }
    if (isFormula(token)) return formulaElement(document, token, true)
    switch (token.type) {
      case 'space': return document.createTextNode('')
      case 'paragraph': return element('p')
      case 'heading': return element(`h${(token as Tokens.Heading).depth}`)
      case 'strong': return element('strong')
      case 'em': return element('em')
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
      case 'image': {
        const image = token as Tokens.Image
        return noteImage(document, image.raw, image.text, resource(image.href))
      }
      case 'list': {
        const { ordered, start, items } = token as Tokens.List
        const list = document.createElement(ordered ? 'ol' : 'ul')
        if (list instanceof HTMLOListElement && start) list.start = start
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
        const text = document.createTextNode(token.text ?? token.raw)
        const position = positions.get(token)
        const offsets = position && inlineSourcePoints(markdown, token, position.start)
        if (offsets) textPoints.set(text, { text: text.data, offsets })
        return text
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
    blocks.push(block)
    originals.set(block, { raw: isPlot(token) ? token.source : token.raw.trimEnd(), html: block.innerHTML })
  }
  root.replaceChildren(...blocks)
  projectedPoints.set(root, textPoints)
  return { originals, textPoints, plots, source: markdown }
}

export function setRichNoteMode(root: HTMLElement, editable: boolean, originals: WeakMap<HTMLElement, OriginalBlock>) {
  // 只刷新呈现属性，保留块原文和编辑历史。
  for (const block of root.children) {
    if (!(block instanceof HTMLElement) || block.dataset.noteLockedPlot !== undefined) continue
    const original = originals.get(block)
    const pristine = original?.html === block.innerHTML
    const formulas = block.matches('[data-note-formula]') ? [block] : block.querySelectorAll<HTMLElement>('[data-note-formula]')
    for (const formula of formulas) {
      const display = formula.classList.contains('note-math-block')
      formula.tabIndex = editable || display ? 0 : -1
      if (editable || display) formula.setAttribute('role', editable ? 'button' : 'region')
      else formula.removeAttribute('role')
      if (!formula.classList.contains('note-math-invalid')) {
        if (editable) formula.setAttribute('aria-label', '编辑公式：' + formula.dataset.noteFormula)
        else if (display) formula.setAttribute('aria-label', '数学公式')
        else formula.removeAttribute('aria-label')
      }
    }
    if (original && pristine) original.html = block.innerHTML
  }
}

export function sourcePointAt(
  root: HTMLElement, projection: ReturnType<typeof loadRichNote> | undefined,
  markdown: string, node: Node, offset: number,
) {
  if (!root.contains(node) || node.parentElement?.closest('pre,code,[data-note-href],[contenteditable="false"]')) return
  const point = projection?.textPoints.get(node)
  if (point && projection?.source === markdown && node.textContent === point.text) {
    const at = point.offsets[offset]
    return at >= 0 ? at : undefined
  }
  // 浏览器原生输入可能合并文本节点。按同一渲染规则核对当前块后再映射。
  const temporary = root.ownerDocument.createElement('div')
  const fresh = loadRichNote(temporary, markdown, () => undefined)
  let block: Node = node
  while (block.parentNode && block.parentNode !== root && block !== root) block = block.parentNode
  const index = Array.prototype.indexOf.call(root.childNodes, block)
  const match = temporary.childNodes[index]
  if (!match || block.textContent !== match.textContent) return
  const prefix = root.ownerDocument.createRange()
  prefix.selectNodeContents(block)
  prefix.setEnd(node, offset)
  let remaining = prefix.toString().length
  const walker = root.ownerDocument.createTreeWalker(match, NodeFilter.SHOW_TEXT)
  for (let part = walker.nextNode(); part; part = walker.nextNode()) {
    const size = part.textContent?.length ?? 0
    if (remaining <= size) {
      const at = fresh.textPoints.get(part)?.offsets[remaining]
      if (at !== undefined && at >= 0) return at
      if (remaining < size) return
    }
    remaining -= size
  }
}


function hasBlockContent(node: Node) {
  if (node.textContent?.trim()) return true
  if (!(node instanceof HTMLElement)) return false
  const content = 'img,hr,pre,table,ul,ol,blockquote,[data-note-locked-plot],[data-note-image],[data-note-formula],[data-note-literal]'
  return node.matches(content) || !!node.querySelector(content)
}

export function noteGapAt(root: HTMLElement, markdown: string, node: Node | null, offset: number, pointerY?: number) {
  const children = Array.from(root.childNodes)
  const content = children.filter(hasBlockContent)
  if (content.length !== noteBlocks(markdown).blocks.length) return
  const bounds = root.getBoundingClientRect()
  if (pointerY !== undefined) {
    if (pointerY < bounds.top || pointerY > bounds.bottom) return
    for (const [index, child] of content.entries()) {
      const range = root.ownerDocument.createRange()
      range.selectNode(child)
      const rect = child instanceof HTMLElement ? child.getBoundingClientRect() : range.getBoundingClientRect()
      if (!rect.height) continue
      if (pointerY < rect.top) return index
      if (pointerY <= rect.bottom) return
    }
    return content.length
  }
  if (node === root) return children.slice(0, offset).filter(hasBlockContent).length
  let child = node
  while (child && child.parentNode !== root) child = child.parentNode
  if (!child || hasBlockContent(child)) return
  return children.slice(0, children.indexOf(child as ChildNode)).filter(hasBlockContent).length
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

const escapeText = (text: string) => text.replaceAll('\u00a0', ' ').replace(/[\\`*_[\]~<>]/g, '\\$&')
function textMarkdown(text: string) {
  if (!/[$`\\~]/.test(text)) return escapeText(text)
  const spans = noteSourceSpans(text)
  let cursor = 0, output = ''
  for (const span of spans) {
    output += escapeText(text.slice(cursor, span.start)) + text.slice(span.start, span.end)
    cursor = span.end
  }
  return output + escapeText(text.slice(cursor))
}
const blockTags = new Set(['P', 'DIV', 'PRE', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'TABLE', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

export function readRichNote(root: HTMLElement, originals: WeakMap<HTMLElement, OriginalBlock>): string {
  const children = (node: Node) => Array.from(node.childNodes).map(serialize).join('')
  const blocks = (node: Node) => {
    const output: string[] = []
    let inline = ''
    for (const child of node.childNodes) {
      const text = serialize(child)
      if (child instanceof HTMLElement && (blockTags.has(child.tagName) || originals.has(child))) {
        if (inline.trim()) output.push(inline.trimEnd())
        inline = ''
        if (text.trim()) output.push(child.dataset.noteLockedPlot === undefined ? text.trimEnd() : text)
      } else inline += text
    }
    if (inline.trim()) output.push(inline.trimEnd())
    return output.join('\n\n')
  }
  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return textMarkdown(node.textContent ?? '')
    if (!(node instanceof HTMLElement)) return ''
    const original = originals.get(node)
    if (original && node.innerHTML === original.html) return original.raw
    if (node.dataset.noteLockedPlot !== undefined) return node.dataset.noteLockedPlot
    if (node.dataset.noteFormula !== undefined) return node.dataset.noteFormula
    if (node.dataset.noteImage !== undefined) return node.dataset.noteImage
    if (node.dataset.noteLiteral !== undefined) return node.dataset.noteLiteral
    if (node.dataset.noteHref !== undefined) {
      const title = node.dataset.noteTitle ? ' ' + JSON.stringify(node.dataset.noteTitle) : ''
      const href = node.dataset.noteHref.replace(/[<>\s]/g, char => encodeURIComponent(char))
      return `[${children(node)}](<${href}>${title})`
    }
    if (node.classList.contains('note-table')) return blocks(node)
    const tag = node.tagName
    if (/^H[1-6]$/.test(tag)) return '#'.repeat(Number(tag[1])) + ' ' + children(node).trim()
    switch (tag) {
      case 'BR': return '\n'
      case 'HR': return '---'
      case 'B': case 'STRONG': return children(node).trim() ? '**' + children(node) + '**' : ''
      case 'I': case 'EM': return children(node).trim() ? '*' + children(node) + '*' : ''
      case 'S': case 'DEL': case 'STRIKE': return children(node).trim() ? '~~' + children(node) + '~~' : ''
      case 'CODE': {
        const text = node.textContent ?? ''
        const fence = '`'.repeat(1 + Math.max(0, ...Array.from(text.matchAll(/`+/g), m => m[0].length)))
        const pad = /^(?:`|\s)|(?:`|\s)$/.test(text) ? ' ' : ''
        return text ? fence + pad + text + pad + fence : ''
      }
      case 'PRE': {
        const text = node.innerText ?? node.textContent ?? ''
        const fence = '`'.repeat(Math.max(3, 1 + Math.max(0, ...Array.from(text.matchAll(/`+/g), m => m[0].length))))
        return fence + (node.dataset.language ?? '') + '\n' + text + '\n' + fence
      }
      case 'BLOCKQUOTE': return blocks(node).split('\n').map(line => '> ' + line).join('\n')
      case 'UL': case 'OL': {
        const start = node instanceof HTMLOListElement ? node.start : 1
        return Array.from(node.children).filter(item => item.tagName === 'LI').map((item, index) => {
          const bullet = tag === 'OL' ? `${start + index}. ` : '- '
          const task = (item as HTMLElement).dataset.noteTask
          const text = (task === undefined ? '' : `[${task}] `) + blocks(item)
          return bullet + text.replaceAll('\n', '\n' + ' '.repeat(bullet.length))
        }).join('\n')
      }
      case 'TABLE': {
        const table = node as HTMLTableElement
        const rows = Array.from(table.rows)
        const cells = (row: HTMLTableRowElement) => Array.from(row.cells).map(cell => children(cell).trim().replaceAll('|','\\|').replaceAll('\n',' '))
        const line = (values: string[]) => '| ' + values.join(' | ') + ' |'
        if (!rows[0]) return ''
        const align = Array.from(rows[0].cells).map(cell => ({left: ':---', center: ':---:', right: '---:'}[cell.style.textAlign] ?? '---'))
        return [line(cells(rows[0])), line(align), ...rows.slice(1).map(row => line(cells(row)))].join('\n')
      }
      case 'P': case 'DIV': case 'LI': return blocks(node)
      default: return children(node)
    }
  }
  return blocks(root)
}

export type BodyPosition = { anchor: number; focus: number }

function bodyParts(root: HTMLElement) {
  const parts: { node: Node; length: number; atomic: boolean }[] = []
  function visit(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) parts.push({ node, length: (node as Text).length, atomic: false })
    else if (node instanceof HTMLElement && (node.dataset.noteFormula !== undefined ||
      node.dataset.noteImage !== undefined || node.dataset.noteLiteral !== undefined ||
      node.dataset.noteLockedPlot !== undefined || node.tagName === 'BR')) {
      parts.push({ node, length: 1, atomic: true })
    } else for (const child of node.childNodes) visit(child)
  }
  visit(root)
  return parts
}

function boundary(node: Node, end: boolean) {
  const parent = node.parentNode!
  return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) + Number(end) }
}

export function bodyPosition(root: HTMLElement): BodyPosition | undefined {
  const selection = root.ownerDocument.getSelection()
  if (!selection?.anchorNode || !selection.focusNode || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return
  const parts = bodyParts(root)
  const offset = (node: Node, at: number) => {
    const point = root.ownerDocument.createRange()
    point.setStart(node, at)
    point.collapse(true)
    let result = 0
    for (const part of parts) {
      if (!part.atomic && part.node === node) return result + at
      if (part.node.contains(node)) return result + 1
      const start = boundary(part.node, false)
      if (point.comparePoint(start.node, start.offset) >= 0) break
      result += part.length
    }
    return result
  }
  return {
    anchor: offset(selection.anchorNode, selection.anchorOffset),
    focus: offset(selection.focusNode, selection.focusOffset),
  }
}

export function restoreBodyPosition(root: HTMLElement, position?: BodyPosition) {
  const parts = bodyParts(root)
  const point = (at: number) => {
    for (const part of parts) {
      if (at <= part.length) return part.atomic ? boundary(part.node, at > 0) : { node: part.node, offset: at }
      at -= part.length
    }
    return { node: root, offset: root.childNodes.length }
  }
  const start = point(position?.anchor ?? Infinity)
  const end = point(position?.focus ?? Infinity)
  root.ownerDocument.getSelection()?.setBaseAndExtent(start.node, start.offset, end.node, end.offset)
}

export function promoteNoteFormulas(root: HTMLElement) {
  if (!/[$\\]/.test(root.textContent ?? '') && !root.querySelector('[data-note-formula]')) return
  // 末尾继续键入数字时，单美元式可能退回金额文本。
  for (const prior of root.querySelectorAll<HTMLElement>('[data-note-formula]')) {
    const raw = prior.dataset.noteFormula!
    if (prior.closest('[data-note-locked-plot]')) continue
    if (/^\$(?!\$)/.test(raw) && /^\d/.test(prior.nextSibling?.textContent ?? '')) {
      prior.replaceWith(root.ownerDocument.createTextNode(raw))
    }
  }
  root.normalize()
  const position = bodyPosition(root)
  const document = root.ownerDocument
  const candidates: { node: Text; offset: number }[] = []
  let offset = 0
  for (const part of bodyParts(root)) {
    if (!part.atomic && part.node instanceof Text) candidates.push({ node: part.node, offset })
    offset += part.length
  }
  // 对同一文本节点从右向左替换，范围左侧的偏移保持有效。
  const replacements: { at: number; length: number }[] = []
  for (const { node, offset } of candidates.reverse()) {
    const parent = node.parentElement
    if (!parent || parent.closest('code,pre,[contenteditable="false"],[data-note-href]')) continue
    const raw = node.data
    if (!/[$\\]/.test(raw)) continue
    for (const span of noteSourceSpans(raw).reverse()) {
      if (!isFormula(span.token) || mathMarkup(span.token.tex, span.token.type === 'formulaBlock') === null) continue
      if (span.token.type === 'formulaBlock' && parent.closest('li,td,th,h1,h2,h3,h4,h5,h6')) continue
      // 只有逻辑行的边界才允许独立公式。粘贴中的显式换行也形成边界。
      if (span.token.type === 'formulaBlock' &&
        ((span.start === 0 && node.previousSibling && !(node.previousSibling instanceof HTMLBRElement)) ||
         (span.end === raw.length && node.nextSibling && !(node.nextSibling instanceof HTMLBRElement)))) continue
      const range = document.createRange()
      range.setStart(node, span.start)
      range.setEnd(node, span.end)
      range.deleteContents()
      range.insertNode(formulaElement(document, span.token, true))
      replacements.push({ at: offset + span.start, length: span.end - span.start })
    }
  }
  if (position && replacements.length) {
    const remap = (at: number) => {
      for (const span of replacements) {
        if (at > span.at) at = at >= span.at + span.length ? at - span.length + 1 : span.at + 1
      }
      return at
    }
    restoreBodyPosition(root, { anchor: remap(position.anchor), focus: remap(position.focus) })
  }
}
