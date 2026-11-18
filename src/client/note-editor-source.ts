import type { ChangeSet, EditorState } from '@codemirror/state'
import { lexNote } from '../shared/note-markdown.ts'
import { isPlot } from '../shared/note-plot.ts'

const newline = /\r\n|\r|\n/
export const normalizeMarkdown = (source: string) => source.replace(/\r\n?/g, '\n')

function countAtOrBefore(sorted: readonly number[], offset: number) {
  let low = 0, high = sorted.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (sorted[middle] <= offset) low = middle + 1
    else high = middle
  }
  return low
}

/** CodeMirror uses one character per logical line ending. Keep exact source at the persistence boundary. */
export class NoteEditorSource {
  readonly text: string
  private readonly endings: number[] = []
  private readonly logicalEndings: number[] = []
  private readonly insertedEol: string

  constructor(readonly markdown: string) {
    this.text = normalizeMarkdown(markdown)
    this.insertedEol = newline.exec(markdown)?.[0] ?? '\n'
    for (const match of markdown.matchAll(/\r\n/g)) {
      this.logicalEndings.push(match.index + 1 - this.endings.length)
      this.endings.push(match.index + 2)
    }
  }

  originalAt(offset: number) {
    return offset + countAtOrBefore(this.logicalEndings, offset)
  }

  editorAt(offset: number) {
    if (offset < 0 || offset > this.markdown.length) return
    if (this.markdown[offset - 1] === '\r' && this.markdown[offset] === '\n') return
    return offset - countAtOrBefore(this.endings, offset)
  }

  referenceAt(offset: number) {
    if (offset < 0 || offset > this.text.length) return
    const at = this.originalAt(offset)
    if (/[\uD800-\uDBFF]/.test(this.markdown[at - 1] ?? '') &&
        /[\uDC00-\uDFFF]/.test(this.markdown[at] ?? '')) return
    return at
  }

  apply(changes: ChangeSet) {
    let previous = 0
    const pieces: string[] = []
    const append = (part: string) => {
      if (!part) return
      // A splice may put a lone CR and LF next to one another. Keep both logical breaks.
      if (pieces.at(-1)?.endsWith('\r') && part.startsWith('\n')) pieces.push('\n')
      pieces.push(part)
    }
    changes.iterChanges((from, to, _fromNew, _toNew, inserted) => {
      append(this.markdown.slice(previous, this.originalAt(from)))
      append(inserted.sliceString(0, inserted.length, this.insertedEol))
      previous = this.originalAt(to)
    })
    append(this.markdown.slice(previous))
    return pieces.join('')
  }
}

/** A targeted CodeMirror change retains unaffected line and widget identities on history and host updates. */
export function replaceNoteDocument(oldText: string, newText: string) {
  let from = 0
  const length = Math.min(oldText.length, newText.length)
  while (from < length && oldText[from] === newText[from]) from++
  if (from === oldText.length && from === newText.length) return []
  let oldEnd = oldText.length, newEnd = newText.length
  while (oldEnd > from && newEnd > from && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  return { from, to: oldEnd, insert: newText.slice(from, newEnd) }
}

export function copyEditorSelection(source: NoteEditorSource, state: EditorState) {
  const plots = source.markdown.includes('dsh-plot') ? lexNote(source.markdown).filter(isPlot) : []
  const ranged = state.selection.ranges.filter(range => !range.empty)
  const ranges = ranged.length ? ranged : state.selection.ranges.map(range => state.doc.lineAt(range.from))
  return ranges.map(range => {
    const start = source.originalAt(range.from), end = source.originalAt(range.to)
    let from = start, text = ''
    for (const plot of plots) {
      if (plot.end <= from) continue
      if (plot.start >= end) break
      text += source.markdown.slice(from, Math.max(from, plot.start))
      from = Math.min(end, plot.end)
    }
    return text + source.markdown.slice(from, end)
  }).join('\n')
}
