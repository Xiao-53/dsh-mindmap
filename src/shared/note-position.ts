import { z } from 'zod'
import type { Token, Tokens } from 'marked'
import { digest } from './fingerprint.ts'
import { formulaFromRaw, inlineSourcePoints, insertNoteBlock, isFormula, noteBlocks } from './note-markdown.ts'
import { isPlot } from './note-plot.ts'
import { mathMarkup } from './note-math.ts'
import { idSchema } from './validate-map.ts'

const sha = z.string().regex(/^[a-f0-9]{64}$/)
const offset = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const base = { version: z.literal(1), mapId: idSchema, nodeId: idSchema, noteDigest: sha }
export const noteAnchorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal('start') }),
  z.strictObject({
    ...base, version: z.literal(2), kind: z.literal('gap'), offset,
    previousBlockDigest: sha.nullable(), nextBlockDigest: sha.nullable(),
  }),
  z.strictObject({
    ...base, kind: z.literal('block'), blockStart: offset, blockLength: offset.positive(),
    blockDigest: sha, clickOffset: offset, previousBlockDigest: sha.nullable(), nextBlockDigest: sha.nullable(),
  }),
])
export const noteInsertKind = z.enum(['inline_formula', 'display_formula', 'plot'])
export type NoteAnchor = z.infer<typeof noteAnchorSchema>
type Block = ReturnType<typeof noteBlocks>['blocks'][number]
type NoteLocation = { inline: number; after?: number; block?: Block; gapIndex?: number }

function* inlineTokens(token: Token): Generator<Token> {
  if (['code', 'codespan', 'link', 'image', 'html', 'escape', 'table'].includes(token.type)) return
  yield token
  const nested = (token as { tokens?: Token[] }).tokens ?? (token.type === 'list' ? (token as Tokens.List).items : [])
  for (const child of nested) yield* inlineTokens(child)
}

function hasInlineBoundary(source: string, block: Block, at: number, positions: ReturnType<typeof noteBlocks>['positions']) {
  for (const token of inlineTokens(block.token)) {
    const range = positions.get(token)
    if (range && at >= range.start && at <= range.end && inlineSourcePoints(source, token, range.start)?.includes(at)) return true
  }
  return false
}

const blockDigest = (source: string, block?: Block) => block ? digest(source.slice(block.start, block.end)) : null

function gapOffset(source: string, blocks: Block[], index: number) {
  const start = blocks[index - 1]?.end ?? 0
  const end = blocks[index]?.start ?? source.length
  if (start <= end && !source.slice(start, end).trim()) return start
}

export async function captureNoteGap(source: string, mapId: string, nodeId: string, index: number) {
  const { blocks } = noteBlocks(source)
  if (!Number.isInteger(index) || index < 0 || index > blocks.length) return
  const at = gapOffset(source, blocks, index)
  if (at === undefined) return
  const previous = blocks[index - 1], next = blocks[index]
  const [noteDigest, previousBlockDigest, nextBlockDigest] = await Promise.all([
    digest(source), blockDigest(source, previous), blockDigest(source, next),
  ])
  const anchor: NoteAnchor = {
    kind: 'gap', version: 2, mapId, nodeId, noteDigest, offset: at, previousBlockDigest, nextBlockDigest,
  }
  const label = !previous ? '正文开头' : !next ? '正文末尾' : '两段之间'
  const before = previous ? source.slice(Math.max(previous.start, previous.end - 80), previous.end) : ''
  const after = next ? source.slice(next.start, Math.min(next.end, next.start + 80)) : ''
  return { anchor, text: [before, '▏' + label, after].filter(Boolean).join('\n') }
}

export async function captureNoteAnchor(source: string, mapId: string, nodeId: string, at: number) {
  const base = { version: 1 as const, mapId, nodeId, noteDigest: await digest(source) }
  if (!source.trim()) return { anchor: { ...base, kind: 'start' as const }, text: '正文开头' }
  const { blocks, positions } = noteBlocks(source)
  const index = blocks.findIndex(block => at >= block.start && at <= block.end && hasInlineBoundary(source, block, at, positions))
  const block = blocks[index]
  if (!block) return
  const [current, previous, next] = await Promise.all([
    blockDigest(source, block), blockDigest(source, blocks[index - 1]), blockDigest(source, blocks[index + 1]),
  ])
  const anchor: NoteAnchor = { ...base, kind: 'block', blockStart: block.start, blockLength: block.end - block.start,
    blockDigest: current!, clickOffset: at - block.start, previousBlockDigest: previous, nextBlockDigest: next }
  const left = source.slice(Math.max(block.start, at - 100), at)
  const right = source.slice(at, Math.min(block.end, at + 100))
  return { anchor, text: left + '▏' + right }
}

export async function locateNoteAnchor(source: string, anchor: NoteAnchor): Promise<NoteLocation | undefined> {
  if (anchor.kind === 'start') return source.trim() ? undefined : { inline: 0, after: 0 }
  const { blocks, positions } = noteBlocks(source)
  const exact = await digest(source) === anchor.noteDigest
  if (anchor.kind === 'gap') {
    const hashes = await Promise.all(blocks.map(block => blockDigest(source, block)))
    let found: NoteLocation | undefined
    for (let index = 0; index <= blocks.length; index++) {
      if ((hashes[index - 1] ?? null) !== anchor.previousBlockDigest ||
          (hashes[index] ?? null) !== anchor.nextBlockDigest) continue
      const at = gapOffset(source, blocks, index)
      if (at === undefined || (exact && at !== anchor.offset)) continue
      if (found) return
      found = { inline: at, after: at, gapIndex: index }
    }
    return found
  }
  if (anchor.clickOffset > anchor.blockLength) return
  const possible = await Promise.all(blocks.map(async (block, index) => {
    if (block.end - block.start !== anchor.blockLength || (exact && block.start !== anchor.blockStart)) return
    const at = block.start + anchor.clickOffset
    if (!hasInlineBoundary(source, block, at, positions) || await blockDigest(source, block) !== anchor.blockDigest) return
    if (!exact && (await blockDigest(source, blocks[index - 1]) !== anchor.previousBlockDigest ||
        await blockDigest(source, blocks[index + 1]) !== anchor.nextBlockDigest)) return
    return { inline: at, after: block.token.type === 'paragraph' ? block.end : undefined, block }
  }))
  const matches = possible.filter(match => match !== undefined)
  if (matches.length === 1) return matches[0]
}

export async function insertAnchoredNote(source: string, anchor: NoteAnchor, kind: z.infer<typeof noteInsertKind>, fragment: string) {
  const location = await locateNoteAnchor(source, anchor)
  if (!location) throw new Error('原位置已变化或无法唯一确认，请重新选点')
  const inline = kind === 'inline_formula'
  const raw = fragment.trim()
  const token = kind === 'plot' ? noteBlocks(raw).blocks[0]?.token : formulaFromRaw(raw.replace(/\r\n?/g, '\n'))
  if (kind === 'plot') {
    if (!token || !isPlot(token) || !token.data || token.source !== raw) throw new Error('请提供一张完整且有效的图表')
  } else if (!token || !isFormula(token) || (token.type === 'formulaInline') !== inline || mathMarkup(token.tex, !inline) === null) {
    throw new Error('请提供一个与插入位置匹配的有效公式')
  }
  if (!inline && location.after === undefined) throw new Error('请在可插入独立内容的正文段落重新选点')
  const at = inline ? location.inline : location.after!
  const result = inline && location.gapIndex === undefined
    ? { markdown: source.slice(0, at) + raw + source.slice(at), start: at }
    : insertNoteBlock(source, at, raw)
  const { blocks, positions } = noteBlocks(result.markdown)
  const end = result.start + raw.length
  const matches = ({ token: item, start, end: finish }: Block) => item.type === token.type && start === result.start && finish === end
  if (!inline) {
    if (!blocks.some(block => matches(block) && (!isPlot(block.token) || !!block.token.data)))
      throw new Error('插入会改变周围正文解析，请重新选点')
  } else {
    const target = blocks.find(block => block.start <= result.start && block.end >= end)
    if (!target || (location.gapIndex !== undefined && (target.token.type !== 'paragraph' || target.start !== result.start || target.end !== end))
      || ![...inlineTokens(target.token)].some(item => {
      const range = positions.get(item)
      return range && matches({ token: item, ...range })
    })) throw new Error('点击处无法保留行内公式边界，请重新选点')
  }
  const previous = noteBlocks(source).blocks
  const unchanged = inline && location.block ? previous.filter(block => block.start !== location.block?.start) : previous
  for (const block of unchanged) {
    const delta = block.start >= at ? result.markdown.length - source.length : 0
    if (!blocks.some(next => next.start === block.start + delta && next.end === block.end + delta && next.token.type === block.token.type))
      throw new Error('插入会改变周围正文解析，请重新选点')
  }
  return result.markdown
}
