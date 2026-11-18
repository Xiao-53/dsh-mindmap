import type { EditorSelection } from '@codemirror/state'

type BodyState = { markdown: string; selection: EditorSelection }
type BodyAction = { before: BodyState; after: BodyState; kind: string; at: number }

export class NoteEditorHistory {
  private entries: BodyAction[] = []
  private cursor = 0

  record(before: BodyState, after: BodyState, kind: string) {
    if (before.markdown === after.markdown) return
    this.entries.splice(this.cursor)
    const previous = this.entries.at(-1)
    const at = performance.now()
    if (kind === 'input.type' && previous?.kind === kind && at - previous.at < 650 &&
        previous.after.selection.eq(before.selection) && before.selection.main.empty) {
      previous.after = after
      previous.at = at
    } else {
      this.entries.push({ before, after, kind, at })
      if (this.entries.length > 30) this.entries.shift()
    }
    this.cursor = this.entries.length
  }

  travel(markdown: string, redo: boolean) {
    const entry = this.entries[redo ? this.cursor : this.cursor - 1]
    if (!entry || markdown !== (redo ? entry.before.markdown : entry.after.markdown)) return
    this.cursor += redo ? 1 : -1
    return redo ? entry.after : entry.before
  }

  clear() {
    this.entries = []
    this.cursor = 0
  }
}
