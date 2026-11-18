import type { EditorView } from '@codemirror/view'
import type { EditSession } from './edit-session.ts'
import { captureNoteAnchor, captureNoteGap, locateNoteAnchor } from '../shared/note-position.ts'
import { noteBlocks } from '../shared/note-markdown.ts'
import type { NoteEditorSource } from './note-editor-source.ts'

type PickedPosition = { at: number; gap?: never } | { gap: number; at?: never }

export function pickNotePosition(view: EditorView, source: NoteEditorSource, position: number, pointerY?: number): PickedPosition | undefined {
  if (!source.markdown.trim()) return { at: 0 }
  const at = source.referenceAt(position)
  if (at === undefined) return
  const line = view.state.doc.lineAt(position)
  if (line.text.trim()) return { at }

  if (pointerY !== undefined) {
    const rect = view.coordsAtPos(position)
    if (!rect || pointerY < rect.top || pointerY > rect.bottom) return
  }
  const { blocks } = noteBlocks(source.markdown)
  const index = blocks.findIndex(block => block.start > at)
  const gap = index === -1 ? blocks.length : index
  const before = blocks[gap - 1]?.end ?? 0
  const after = blocks[gap]?.start ?? source.markdown.length
  if (at < before || at > after || source.markdown.slice(before, after).trim()) return
  return { gap }
}

export async function savedNotePosition(session: EditSession, nodeId: string, markdown: string, picked: PickedPosition) {
  const baseline = session.baseline
  const saved = baseline.notes[nodeId] ?? ''
  const mapId = baseline.map.id
  const captured = picked.gap === undefined ? await captureNoteAnchor(markdown, mapId, nodeId, picked.at)
    : await captureNoteGap(markdown, mapId, nodeId, picked.gap)
  if (!captured) return
  if (markdown === saved) return session.baseline === baseline ? captured : undefined
  const location = await locateNoteAnchor(saved, captured.anchor)
  if (!location) return
  const reference = location.gapIndex === undefined ? await captureNoteAnchor(saved, mapId, nodeId, location.inline)
    : await captureNoteGap(saved, mapId, nodeId, location.gapIndex)
  if (session.baseline === baseline) return reference
}
