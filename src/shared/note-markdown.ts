import { Marked } from 'marked'
import type { Token, Tokens, TokenizerExtension } from 'marked'
import { isPlot, parsePlotData, type PlotToken } from './note-plot.ts'

export type FormulaToken = {
  type: 'formulaInline' | 'formulaBlock'
  raw: string
  source: string
  tex: string
  delimiter: '$' | '$$' | '\\(' | '\\['
}

const escaped = (text: string, at: number) => {
  let count = 0
  while (at > 0 && text[--at] === '\\') count++
  return count % 2 !== 0
}

function inlineFormula(src: string): FormulaToken | undefined {
  const parens = src.startsWith('\\(')
  if (!parens && (!src.startsWith('$') || src[1] === '$' || /\s/.test(src[1] ?? ' '))) return
  const line = src.slice(0, 8194).split('\n', 1)[0]
  const start = parens ? 2 : 1
  const close = parens ? '\\)' : '$'
  // 明确的带标点金额不拿后文的美元符号当作结束符。
  if (!parens && /^\$\d+(?:[.,]\d+)*[，；。！？：、]/.test(line)) return
  for (let end = line.indexOf(close, start); end >= 0; end = line.indexOf(close, end + close.length)) {
    if (escaped(line, end)) continue
    const tex = line.slice(start, end)
    if (!tex.trim() || (!parens && (/\s$/.test(tex) || /[\d$]/.test(line[end + 1] ?? '')))) return
    return { type: 'formulaInline', raw: line.slice(0, end + close.length), source: line.slice(0, end + close.length), tex, delimiter: parens ? '\\(' : '$' }
  }
}

function blockFormula(src: string): FormulaToken | undefined {
  const match = /^ {0,3}(\$\$|\\\[)([^\n]*)/.exec(src)
  if (!match) return
  const [, open, rest] = match
  const closing = open === '$$' ? '$$' : '\\]'
  const line = rest.trimEnd()
  if (line.endsWith(closing) && !escaped(line, line.length - closing.length)) {
    const tex = line.slice(0, -closing.length)
    if (tex.trim() && !tex.includes(closing))
      return { type: 'formulaBlock', raw: match[0], source: match[0], tex, delimiter: open as FormulaToken['delimiter'] }
    return
  }
  if (rest.trim()) return
  let offset = match[0].length + 1
  const start = offset
  while (offset < src.length) {
    const next = src.indexOf('\n', offset)
    const end = next < 0 ? src.length : next
    const row = src.slice(offset, end)
    if (row.replace(/^ {0,3}/, '').trimEnd() === closing) {
      const tex = src.slice(start, offset - 1)
      if (tex.trim()) return { type: 'formulaBlock', raw: src.slice(0, end), source: src.slice(0, end), tex, delimiter: open as FormulaToken['delimiter'] }
      return
    }
    if (!row.trim() || /^ {0,3}(?:#{1,6}\s|[~`]{3,})/.test(row) || end - start > 24576) return
    offset = end + 1
  }
}

const block: TokenizerExtension = {
  name: 'formulaBlock',
  level: 'block',
  start: source => /(?:^|\n) {0,3}(?:\$\$|\\\[)/.exec(source)?.index,
  tokenizer: blockFormula,
}
const inline: TokenizerExtension = {
  name: 'formulaInline',
  level: 'inline',
  start: source => {
    const match = /[\\$]/.exec(source)
    return match?.index
  },
  tokenizer(src) {
    // 双美元在非独立段落中按原文保留，避免从第二个美元误识别。
    if (src.startsWith('$$')) return { type: 'text', raw: '$$', text: '$$' }
    return inlineFormula(src)
  },
}
const sourceOffsets = new WeakMap<object, {
  source: string
  length: number
  originalOffset: (offset: number) => number
}>()
const plotBlock: TokenizerExtension = {
  name: 'notePlot',
  level: 'block',
  tokenizer(src, tokens) {
    // Marked 给列表与引用正文使用各自的 token 数组。
    if (tokens !== this.lexer.tokens) return
    const opening = /^ {0,3}(\x60{3,})dsh-plot[ \t]*(?:\n|$)/.exec(src)
    const input = sourceOffsets.get(this.lexer)
    if (!opening || !input) return
    const begin = opening[0].length
    let end = begin
    let closing = begin - Number(opening[0].endsWith('\n'))
    let closed = false
    for (let cursor = begin; cursor < src.length;) {
      const next = src.indexOf('\n', cursor)
      end = next === -1 ? src.length : next
      const line = src.slice(cursor, end)
      const ticks = /^ {0,3}(\x60{3,})[ \t]*$/.exec(line)
      if (ticks && ticks[1].length >= opening[1].length) {
        closing = cursor
        closed = true
        break
      }
      if (!line.trim() || /^ {0,3}(?:\x60{3,}|~{3,})/.test(line)) {
        end = closing
        break
      }
      closing = end
      cursor = end + 1
    }
    // Tokenize a missing closer locally so it cannot consume the following note.
    end = closed ? end : closing
    const offset = input.length - src.length
    const start = input.originalOffset(offset)
    const finish = input.originalOffset(offset + end)
    const token: PlotToken = {
      type: 'notePlot', raw: src.slice(0, end), source: input.source.slice(start, finish),
      start, end: finish,
      ...(closed ? parsePlotData(src.slice(begin, closing)) : { error: '图块缺少结束围栏' }),
    }
    return token
  },
}
const markdown = new Marked({ gfm: true, breaks: true, extensions: [block, inline, plotBlock] })
export function formulaFromRaw(raw: string): FormulaToken | undefined {
  const first = blockFormula(raw) ?? inlineFormula(raw)
  return first?.source === raw ? first : undefined
}

export function lexNote(source: string) {
  if (!source.includes('dsh-plot')) return markdown.lexer(source)
  const lexer = new markdown.Lexer(markdown.defaults)
  const breaks: number[] = []
  for (const match of source.matchAll(/\r\n/g)) breaks.push(match.index + 1 - breaks.length)
  sourceOffsets.set(lexer, {
    source, length: source.length - breaks.length,
    originalOffset(offset) {
      let lo = 0, hi = breaks.length
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (breaks[mid] <= offset) lo = mid + 1
        else hi = mid
      }
      return offset + lo
    },
  })
  const tokens = lexer.lex(source)
  const plots = tokens.filter(isPlot)
  const ids = new Set<string>()
  const duplicates = new Set<string>()
  for (const { id } of plots) if (id) {
    if (ids.has(id)) duplicates.add(id)
    ids.add(id)
  }
  for (const token of plots) if (token.id && duplicates.has(token.id)) {
    token.error = '图块 ID 重复'
    delete token.data
    delete token.expressions
  }
  return tokens
}
export const notePlots = (source: string) => source.includes('dsh-plot') ? lexNote(source).filter(isPlot) : []
export function sameNotePlots(before: string, after: string, previous = notePlots(before), next = notePlots(after)): boolean {
  if (before === after) return true
  return previous.length === next.length && previous.every((plot, i) => plot.source === next[i].source)
}
export const isFormula = (token: {type: string}): token is FormulaToken =>
  token.type === 'formulaInline' || token.type === 'formulaBlock'

// 取得当前平面输入中的不透明片段。一般文字仍按编辑器原有规则写入。
export function noteSourceSpans(source: string) {
  const spans: { start: number; end: number; token: Token }[] = []
  function scan(tokens: Token[], start: number, limit: number) {
    let cursor = start
    for (const token of tokens) {
      const at = source.indexOf(token.raw, cursor)
      if (at < 0 || at + token.raw.length > limit) continue
      cursor = at + token.raw.length
      if (isFormula(token) || ['code', 'codespan', 'escape'].includes(token.type)) {
        spans.push({ start: at, end: isFormula(token) ? at + token.source.length : cursor, token })
      } else if (token.type !== 'link' && token.type !== 'image' && token.type !== 'html') {
        const children = (token as { tokens?: Token[] }).tokens
        if (children) scan(children, at, cursor)
        else if (token.type === 'list') scan((token as Tokens.List).items, at, cursor)
      }
    }
  }
  scan(lexNote(source), 0, source.length)
  return spans
}

/** Marked 将换行归一化，范围始终回到原始 Markdown。 */
export function noteBlocks(source: string, tokens = lexNote(source)) {
  const normalized = source.replace(/\r\n?/g, '\n')
  const breaks = [...source.matchAll(/\r\n/g)].map((match, index) => match.index + 1 - index)
  const original = (at: number) => {
    let lo = 0, hi = breaks.length
    while (lo < hi) {
      const middle = (lo + hi) >>> 1
      if (breaks[middle] <= at) lo = middle + 1
      else hi = middle
    }
    return at + lo
  }
  const positions = new WeakMap<Token, { start: number; end: number }>()
  const blocks: { token: Token; start: number; end: number }[] = []
  function findRange(raw: string, from: number, limit: number, projected: boolean) {
    const direct = normalized.indexOf(raw, from)
    if (!projected || !raw.includes('\n')) return direct < 0 ? undefined : { at: direct, end: direct + raw.length }
    const rows = raw.split('\n')
    const first = rows[0]
    for (let at = normalized.indexOf(first, from); at >= 0 && at < limit; at = normalized.indexOf(first, at + 1)) {
      if (direct >= 0 && at >= direct) return { at: direct, end: direct + raw.length }
      let end = at + first.length
      for (const row of rows.slice(1)) {
        if (normalized[end] !== '\n') { end = -1; break }
        end++
        if (!row) continue
        const next = normalized.indexOf(row, end)
        if (next < end || next + row.length > limit || !/^[> \t]*$/.test(normalized.slice(end, next))) {
          end = -1
          break
        }
        end = next + row.length
      }
      if (end >= at) return { at, end }
    }
    return undefined
  }
  function scan(items: Token[], from: number, limit: number, top = false, projected = false) {
    for (const token of items) {
      if (!token.raw.length) continue
      const match = findRange(token.raw, from, limit, projected)
      if (!match || match.end > limit || (top && /\S/.test(normalized.slice(from, match.at)))) {
        if (top) return
        continue
      }
      const { at, end } = match
      from = end
      const range = { start: original(at), end: original(from) }
      positions.set(token, range)
      if (top && token.type !== 'space') {
        while (range.end > range.start && /[\r\n]/.test(source[range.end - 1])) range.end--
        blocks.push({ token, ...range })
      }
      const nested = (token as { tokens?: Token[] }).tokens
      const prefix = token.type === 'heading' ? /^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(token.raw)?.[0].length
        : token.type === 'blockquote' ? /^ {0,3}>[ \t]?/.exec(token.raw)?.[0].length
        : token.type === 'list_item' ? /^\s*(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(token.raw)?.[0].length
        : token.type === 'strong' || token.type === 'del' ? 2
        : token.type === 'em' ? 1 : 0
      if (nested) scan(nested, at + (prefix ?? 0), from, false, projected || token.type === 'blockquote' || token.type === 'list_item')
      else if (token.type === 'list') scan((token as Tokens.List).items, at, from, false, projected)
    }
  }
  scan(tokens, 0, normalized.length, true)
  return { positions, blocks }
}

const generatedImagePath = /^(?:\.\.\/)*assets\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.image\.json$/i

export function noteImageToken(token: Token): Tokens.Image | undefined {
  if (token.type === 'image') return token as Tokens.Image
  if (token.type !== 'link') return
  // 兼容图片引用误删 ! 的旧笔记。只识别插件插图按钮生成的资源链接形态。
  const link = token as Tokens.Link
  if (link.text !== '图片' || !generatedImagePath.test(link.href) || link.raw !== '[图片](' + link.href + ')') return
  return { ...link, type: 'image', title: null }
}

export function notePreviewSpans(source: string, tokens = lexNote(source), indexed = noteBlocks(source, tokens)) {
  const normalized = (value: string) => value.replace(/\r\n?/g, '\n')
  const spans: { start: number; end: number; token: FormulaToken | Tokens.Image | PlotToken }[] = []
  function scan(items: Token[]) {
    for (const token of items) {
      const range = indexed.positions.get(token)
      if (isPlot(token)) {
        if (token.end > token.start && source.slice(token.start, token.end) === token.source)
          spans.push({ start: token.start, end: token.end, token })
        continue
      }
      const preview = isFormula(token) ? token : noteImageToken(token)
      if (preview) {
        if (range && normalized(source.slice(range.start, range.end)) === preview.raw) spans.push({ ...range, token: preview })
      } else if (token.type === 'list') scan((token as Tokens.List).items)
      else if (!['code', 'codespan', 'html'].includes(token.type)) {
        const children = (token as { tokens?: Token[] }).tokens
        if (children) scan(children)
      }
    }
  }
  scan(tokens)
  return spans
}

export function inlineSourcePoints(source: string, token: Token, start: number) {
  const text = (token as { text?: string }).text
  if (token.type !== 'text' || token.raw !== text || (token as { tokens?: Token[] }).tokens?.length) return
  const offsets = [start]
  let offset = start
  for (const char of token.raw) {
    offset += char === '\n' && source.startsWith('\r\n', offset) ? 2 : char.length
    if (char.length === 2) offsets.push(-1)
    offsets.push(offset)
  }
  if (source.slice(start, offset).replace(/\r\n?/g, '\n') === token.raw) return offsets
}

export function insertNoteBlock(source: string, at: number, block: string) {
  const eol = /\r\n|\n|\r/.exec(source)?.[0] ?? '\n'
  const before = source.slice(0, at), after = source.slice(at)
  const lines = (edge: string) => (edge.match(/\r\n|\n|\r/g) ?? []).length
  const left = /\s*$/.exec(before)![0], right = /^\s*/.exec(after)![0]
  const leading = before.trim() ? eol.repeat(Math.max(0, 2 - lines(left))) : ''
  const trailing = after.trim() ? eol.repeat(Math.max(0, 2 - lines(right))) : ''
  // Existing whitespace stays in place, including the whitespace at EOF.
  return { markdown: before + leading + block + trailing + after, start: at + leading.length }
}

export function moveNoteImage(markdown: string, start: number, end: number, destination: number) {
  if (destination >= start && destination <= end) return
  const tokens = lexNote(markdown)
  const index = noteBlocks(markdown, tokens)
  if (destination !== 0 && destination !== markdown.length &&
      !index.blocks.some(block => block.start === destination || block.end === destination)) return
  const isImage = (span: ReturnType<typeof notePreviewSpans>[number], at: number, until: number) =>
    span.token.type === 'image' && span.start === at && span.end === until
  if (!notePreviewSpans(markdown, tokens, index).some(span => isImage(span, start, end))) return
  const standalone = index.blocks.findIndex(block => block.start === start && block.end === end)
  if (standalone !== -1) {
    const order = index.blocks.filter((block, i) => i !== standalone && block.start < destination).length
    if (order === standalone) return
  }

  const raw = markdown.slice(start, end)
  const image = raw.startsWith('!') ? raw : '!' + raw
  const rest = markdown.slice(0, start) + markdown.slice(end)
  const at = destination > end ? destination - (end - start) : destination
  const moved = insertNoteBlock(rest, at, image)
  if (moved.markdown === markdown) return
  const finish = moved.start + image.length
  const movedTokens = lexNote(moved.markdown)
  const movedIndex = noteBlocks(moved.markdown, movedTokens)
  const block = movedIndex.blocks.find(item => item.start === moved.start && item.end === finish)
  if (block?.token.type === 'paragraph' &&
      notePreviewSpans(moved.markdown, movedTokens, movedIndex).some(span => isImage(span, moved.start, finish)))
    return moved
}

export function changeNotePlot(markdown: string, id: string, destination?: number) {
  const { blocks } = noteBlocks(markdown)
  const plot = blocks.find(({ token }) => isPlot(token) && token.data?.id === id)
  if (!plot || !isPlot(plot.token)) return
  const { start, end, source } = plot.token
  const rest = markdown.slice(0, start) + markdown.slice(end)
  const expected = blocks.filter(block => block !== plot)
  let result = rest
  if (destination !== undefined) {
    if (destination !== 0 && destination !== markdown.length &&
        !blocks.some(block => block.start === destination || block.end === destination)) return
    if (destination >= start && destination <= end) return
    const index = expected.findIndex(block => block.start >= destination)
    const order = index === -1 ? expected.length : index
    if (order === blocks.indexOf(plot)) return
    expected.splice(order, 0, plot)
    result = insertNoteBlock(rest, destination > end ? destination - (end - start) : destination, source).markdown
  }
  const next = noteBlocks(result).blocks
  if (next.length !== expected.length || next.some((block, index) => {
    const prior = expected[index]
    return block.token.type !== prior.token.type || result.slice(block.start, block.end) !== markdown.slice(prior.start, prior.end)
  })) return
  return result
}

export function manualPlotDelta(before: string, after: string) {
  const previous = notePlots(before), next = notePlots(after)
  const invalid = (items: PlotToken[]) => items.filter(plot => !plot.data).map(plot => plot.source)
  const oldInvalid = invalid(previous), newInvalid = invalid(next)
  if (oldInvalid.length !== newInvalid.length || oldInvalid.some((source, index) => source !== newInvalid[index])) return
  const prior = new Map(previous.flatMap(plot => plot.data ? [[plot.data.id, plot.source] as const] : []))
  const current = new Map(next.flatMap(plot => plot.data ? [[plot.data.id, plot.source] as const] : []))
  for (const [id, source] of current) if (prior.has(id) && prior.get(id) !== source) return
  return {
    removed: [...prior].filter(([id]) => !current.has(id)),
    restored: [...current].filter(([id]) => !prior.has(id)),
  }
}
