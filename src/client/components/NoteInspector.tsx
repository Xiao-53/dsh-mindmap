import { NeighborPills } from './NeighborPills.tsx'
import { NodeEditor, type NoteBodyEditor, type NoteViewport, type NoteViewportAnchor } from './NodeEditor.tsx'
import type { EditSession } from '../edit-session.ts'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KnowledgeNode, MapSnapshot } from '../../shared/map-types.ts'
import type { NoteAnchor } from '../../shared/note-position.ts'
import { captureSelection, copyFormulaSelection } from '../selection.ts'
import type { SelectionSnapshot } from '../selection.ts'
import { readableNote, copyNote } from '../copy-note.ts'
import { focusNotePosition, focusPlotReference, highlightReference } from '../reference-navigation.ts'
import type { ReferenceSnapshot } from '../reference-source.ts'
import { referenceContentDigest } from '../reference-source.ts'
import type { PlotData } from '../../shared/note-plot.ts'
export function NoteInspector({
  snapshot,
  editSession, bodyEditor, viewId,
  node,
  scroll,
  onScroll,
  onClose,
  onSelectNeighbor,
  onFinishEdit,
  onInsert,
  onPlotReference,
  onPositionReference,
  onRetry,
  notify,
  reference,
  offline, width = 320, onWidth,
}: {
  editSession?: EditSession
  bodyEditor?: NoteBodyEditor
  viewId?: string
  snapshot: MapSnapshot
  node: KnowledgeNode
  scroll: number
  onScroll: (top: number) => void
  onSelectNeighbor?: (nodeId: string) => void
  onClose: () => void
  onFinishEdit?: (finish: () => void) => void
  onInsert?: (selection: SelectionSnapshot) => void
  onPlotReference?: (plot: PlotData) => void
  onPositionReference?: (anchor: NoteAnchor, text: string) => void
  onRetry?: () => void
  notify: (text: string) => void
  reference?: ReferenceSnapshot
  width?: number
  onWidth?: (width: number) => void
  offline?: boolean
}) {
  const view = snapshot.map.views.find(v => v.id === viewId)
  const [editing, setEditing] = useState(false)
  const canEdit = !offline && !!editSession && !!bodyEditor && !!viewId && snapshot.writable !== false
  const inlineEditor = canEdit && editing
  const canInsert = !!onInsert && !offline
  const editBlocked = editSession && ['readonly', 'conflict', 'recovery_required'].includes(editSession.status)
  const readable = useRef<HTMLDivElement>(null)
  const scrollable = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const resize = useRef<{ x: number; width: number }>()
  const [popup, setPopup] = useState({ x: 12, y: 60 })
  const [menu, setMenu] = useState(false)
  const [referenceFallback, setReferenceFallback] = useState(false)
  const viewport = useRef<NoteViewport>()
  const toggleScroll = useRef<{ top: number; anchor?: NoteViewportAnchor }>()
  const markdown = snapshot.notes[node.id] ?? ''
  useLayoutEffect(() => {
    close.current?.focus({ preventScroll: true })
  }, [node.id])
  useLayoutEffect(() => {
    if (scrollable.current) {
      scrollable.current.scrollTop = toggleScroll.current?.top ?? scroll
      const anchor = toggleScroll.current?.anchor
      if (anchor) viewport.current?.restore(scrollable.current, anchor)
    }
    toggleScroll.current = undefined
  }, [node.id, scroll, inlineEditor])
  const toggleEdit = (enable: boolean) => {
    const scroller = scrollable.current
    if (scroller) toggleScroll.current = { top: scroller.scrollTop, anchor: viewport.current?.capture(scroller) }
    setEditing(enable)
  }
  const updateSelectionMenu = () => {
    const area = readable.current
    if (!area || !canInsert || inlineEditor) {
      setMenu(false)
      return false
    }
    const selection = area.ownerDocument.getSelection()
    const selected = captureSelection(area, selection)
    const rect = selected && selection?.getRangeAt(0).getBoundingClientRect?.()
    const box = area.getBoundingClientRect()
    const visible = !!selected && (!rect || (rect.bottom >= box.top && rect.top <= box.bottom))
    if (visible && rect) {
      setPopup({
        x: Math.max(8, Math.min(rect.left - box.left, box.width - 145)),
        y: Math.max(8, Math.min(rect.bottom - box.top + 6, box.height - 48)),
      })
    }
    setMenu(visible)
    return visible
  }
  useEffect(() => {
    const document = readable.current?.ownerDocument
    updateSelectionMenu()
    document?.addEventListener('selectionchange', updateSelectionMenu)
    return () => document?.removeEventListener('selectionchange', updateSelectionMenu)
  }, [node.id, canInsert, markdown, inlineEditor])
  const previousReference = useRef(reference)
  useEffect(() => {
    if (reference !== previousReference.current && reference && inlineEditor)
      onFinishEdit?.(() => toggleEdit(false))
    previousReference.current = reference
  }, [reference, inlineEditor, onFinishEdit])
  useEffect(() => {
    if (!reference || reference.kind === 'node' || reference.nodeId !== node.id || !readable.current || inlineEditor) {
      setReferenceFallback(false)
      return
    }
    if (reference.kind === 'plot') {
      const area = readable.current
      const frame = requestAnimationFrame(() => setReferenceFallback(!focusPlotReference(area, reference, markdown)))
      return () => cancelAnimationFrame(frame)
    }
    if (reference.kind === 'note-position') {
      const controller = new AbortController()
      setReferenceFallback(false)
      void focusNotePosition(readable.current, reference, markdown, controller.signal).then(found => {
        if (!controller.signal.aborted) setReferenceFallback(!found)
      })
      return () => controller.abort()
    }
    setReferenceFallback(false)
    const digest = referenceContentDigest(snapshot, node)
    if (
      digest !== reference.noteDigest ||
      !highlightReference(readable.current, reference)
    )
      notify('来源正文已变化或选文无法唯一定位；已定位节点，引用原文保持不变。')
  }, [reference, node.id, snapshot.fingerprint, inlineEditor, markdown])
  return (
    <aside
      ref={readable}
      className={`inspector open inspector-inline${canEdit ? ' inspector-editable' : ''}`}
      style={{ width }}
      aria-label={`${node.title} 的笔记`}
      onCopy={e => copyFormulaSelection(e.currentTarget, e.nativeEvent)}
      onContextMenu={e => {
        if ((e.target as HTMLElement).closest('textarea,input,button,[contenteditable="true"]')) return
        if (updateSelectionMenu()) e.preventDefault()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && menu) {
          e.preventDefault()
          e.stopPropagation()
          setMenu(false)
          readable.current?.focus({ preventScroll: true })
        }
      }}
    >
      <div className="inspector-resize" role="separator" aria-label="调整笔记宽度" aria-orientation="vertical" aria-valuenow={width} tabIndex={0}
        onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); resize.current = { x: e.clientX, width }; e.currentTarget.setPointerCapture(e.pointerId) }}
        onPointerMove={e => { if (!resize.current) return; const limit = (readable.current?.parentElement?.clientWidth ?? 360)-32; onWidth?.(Math.max(Math.min(260, limit), Math.min(limit, resize.current.width+resize.current.x-e.clientX))) }}
        onPointerUp={e => { resize.current = undefined; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) }}
        onPointerCancel={() => { resize.current = undefined }}
        onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); const limit = (readable.current?.parentElement?.clientWidth ?? 360)-32; onWidth?.(Math.max(Math.min(260, limit), Math.min(limit, width+(e.key === 'ArrowLeft' ? 20 : -20)))) } }} />
      <header className="inspector-head">
        <div className="inspector-flag">
          <span>节点详情</span>
          <button ref={close} aria-label="关闭笔记" onClick={onClose}>
            ×
          </button>
        </div>
      </header>
      <div
        ref={scrollable}
        className="inspector-body"
        tabIndex={0}
        onScroll={(e) => {
          onScroll(e.currentTarget.scrollTop)
          if (menu) updateSelectionMenu()
        }}
        onKeyDown={(e) => {
          if (!canInsert || (e.target as HTMLElement).closest('textarea,input,button,[contenteditable="true"]')) return
          if (((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') && updateSelectionMenu()) e.preventDefault()
        }}
      >
        {view && onSelectNeighbor && <NeighborPills map={snapshot.map} view={view} nodeId={node.id} onSelect={onSelectNeighbor} />}
        <NodeEditor key={node.id} session={editSession} editor={bodyEditor} viewport={viewport} node={node} snapshot={snapshot} viewId={viewId} editing={inlineEditor}
          onPlotReference={onPlotReference} onPositionReference={onPositionReference} onSelectionReference={onInsert}/>
        {referenceFallback && (reference?.kind === 'plot' || reference?.kind === 'note-position') && <details className="note-plot" open>
          <summary>{reference.kind === 'plot' ? '图块已变化或无法定位 · 引用快照' : '正文位置无法确认，请重新选点 · 引用快照'}</summary>
          <pre>{reference.text}</pre>
        </details>}
      </div>
      <div className="detail-footer">
        <button className="btn" onClick={() => { void copyNote(readableNote(node.title, node.summary, markdown)).then(result => notify(result.message)) }}>复制内容</button>
        {canEdit && <button className="btn" aria-pressed={inlineEditor} disabled={!editing && editBlocked} onClick={() => {
          if (editing) {
            const finish = () => toggleEdit(false)
            if (onFinishEdit) onFinishEdit(finish)
            else if (editSession?.finishInput()) {
              void editSession.save()
              finish()
            }
          } else {
            setMenu(false)
            window.getSelection()?.removeAllRanges()
            toggleEdit(true)
          }
        }}>{inlineEditor ? '完成' : '编辑'}</button>}
        {onRetry && <button className="btn" onClick={onRetry}>重试加入提问框</button>}
      </div>
      {menu && canInsert && (
        <div className="selection-menu selection-popup" style={{ left: popup.x, top: popup.y }} role="toolbar" aria-label="选文操作" onMouseDown={e => e.preventDefault()}>
          <button type="button" onClick={() => {
            const area = readable.current
            const selection = area?.ownerDocument.getSelection()
            const current = area && captureSelection(area, selection)
            setMenu(false)
            selection?.removeAllRanges()
            if (current) onInsert?.(current)
          }}>添加到正文</button>
        </div>
      )}
    </aside>
  )
}
