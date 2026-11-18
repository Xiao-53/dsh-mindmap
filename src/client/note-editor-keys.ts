import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'

const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false })

const composing = (view: EditorView) => view.composing || view.compositionStarted
const ensureContext = (state: EditorState) => ensureSyntaxTree(state, Math.min(state.doc.length, state.selection.main.head + 1), 20)
export const continueNoteList: Command = view => !composing(view) && !!ensureContext(view.state) && continueMarkup(view)

export const deleteNoteListPrefix: Command = view => {
  if (composing(view) || view.state.readOnly || !ensureContext(view.state)) return false
  const { state } = view
  const cursor = state.selection.main
  if (state.selection.ranges.length !== 1 || !cursor.empty) return deleteMarkupBackward(view)
  const row = state.doc.lineAt(cursor.head)
  for (let node = syntaxTree(state).resolveInner(cursor.head, -1); node; ) {
    if (node.name === 'ListItem') {
      const mark = node.getChild('ListMark')
      if (!mark || state.doc.lineAt(mark.from).number !== row.number) break
      const tail = state.sliceDoc(mark.to, row.to)
      const start = mark.to + (/^[ \t]*/.exec(tail)?.[0].length ?? 0)
      if (cursor.head !== start) break
      if (!tail.trim()) return continueMarkup(view) || deleteMarkupBackward(view)
      const previous = node.prevSibling
      if (previous?.name === 'ListItem' && previous.lastChild?.name === 'Paragraph' &&
          previous.lastChild.to === previous.to && /^[\s>]*$/.test(state.sliceDoc(previous.to, mark.from))) {
        view.dispatch({
          changes: { from: previous.to, to: start, insert: ' ' },
          selection: { anchor: previous.to + 1 },
          userEvent: 'delete.backward',
          scrollIntoView: true,
        })
        return true
      }
      break
    }
    if (!node.parent) break
    node = node.parent
  }
  return deleteMarkupBackward(view)
}
