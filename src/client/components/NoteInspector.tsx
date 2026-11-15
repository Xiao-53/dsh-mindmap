import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KnowledgeNode, MapSnapshot } from '../../shared/map-types.ts'
import { RenderNote } from '../render-note.tsx'
import { captureSelection } from '../selection.ts'
import type { SelectionSnapshot } from '../selection.ts'
import { readableNote, copyNote } from '../copy-note.ts'
import { highlightReference } from '../reference-navigation.ts'
import type { ReferenceSnapshot } from '../reference-source.ts'
import { referenceContentDigest } from '../reference-source.ts'
export function NoteInspector({
  snapshot,
  node,
  scroll,
  onScroll,
  onClose,
  onInsert,
  onRetry,
  notify,
  reference,
  offline, width = 320, onWidth,
}: {
  snapshot: MapSnapshot
  node: KnowledgeNode
  scroll: number
  onScroll: (top: number) => void
  onClose: () => void
  onInsert: (selection: SelectionSnapshot) => void
  onRetry?: () => void
  notify: (text: string) => void
  reference?: ReferenceSnapshot
  width?: number
  onWidth?: (width: number) => void
  offline?: boolean
}) {
  const readable = useRef<HTMLDivElement>(null)
  const scrollable = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const resize = useRef<{ x: number; width: number }>()
  const [popup, setPopup] = useState({ x: 12, y: 60 })
  const [selection, setSelection] = useState<SelectionSnapshot>()
  const [menu, setMenu] = useState(false)
  const markdown = snapshot.notes[node.id] ?? ''
  useLayoutEffect(() => {
    close.current?.focus()
  }, [node.id])
  useLayoutEffect(() => {
    if (scrollable.current) scrollable.current.scrollTop = scroll
  }, [node.id, scroll])
  useEffect(() => {
    const update = () => {
      const area = readable.current
      if (!area) return
      const selected = captureSelection(area)
      setSelection(selected)
      setMenu(!!selected && !offline)
      const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : undefined
      if (selected && range) {
        const box = area.getBoundingClientRect(), rect = range.getBoundingClientRect()
        setPopup({ x: Math.max(8, Math.min(rect.left-box.left, box.width-145)), y: Math.max(8, Math.min(rect.bottom-box.top+6, box.height-48)) })
      }
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [node.id])
  useEffect(() => {
    setSelection(undefined)
    setMenu(false)
  }, [node.id, markdown])
  useEffect(() => {
    if (!reference || reference.kind === 'node' || reference.nodeId !== node.id || !readable.current) return
    const digest = referenceContentDigest(snapshot, node)
    if (
      digest !== reference.noteDigest ||
      !highlightReference(readable.current, reference)
    )
      notify('来源正文已变化或选文无法唯一定位；已定位节点，引用原文保持不变。')
  }, [reference, node.id, snapshot.fingerprint])
  return (
    <aside
      ref={readable}
      className="inspector open"
      style={{ width }}
      aria-label={`${node.title} 的笔记`}
      onContextMenu={e => {
        const current = readable.current ? captureSelection(readable.current) : undefined
        if (current && !offline) { e.preventDefault(); setSelection(current); setMenu(true) }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && menu) {
          e.preventDefault()
          e.stopPropagation()
          setMenu(false)
          readable.current?.focus()
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
        <h2>{node.title}</h2>
        <div className="inspector-intro">{/^##\s+简介\s*$/m.test(markdown)
          ? <RenderNote markdown={markdown} nodeId={node.id} resources={snapshot.resources} sectionFilter="intro"/>
          : node.summary}</div>
      </header>
      <div
        ref={scrollable}
        className="inspector-body"
        tabIndex={0}
        onScroll={(e) => onScroll(e.currentTarget.scrollTop)}
        onContextMenu={(e) => {
          const current = readable.current ? captureSelection(readable.current) : undefined
          setSelection(current)
          if (current) {
            e.preventDefault()
            setMenu(true)
          }
        }}
        onKeyDown={(e) => {
          if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
            const current = readable.current ? captureSelection(readable.current) : undefined
            setSelection(current)
            if (current) {
              e.preventDefault()
              setMenu(true)
            }
          }
        }}
      >
        <RenderNote
          markdown={markdown}
          nodeId={node.id}
          resources={snapshot.resources}
          sectionFilter="body"
        />
      </div>
      <div className="detail-footer">
        <button className="btn" onClick={() => { void copyNote(readableNote(node.title, node.summary, markdown)).then(result => notify(result.message)) }}>复制内容</button>
        {onRetry && <button className="btn" onClick={onRetry}>重试添加到正文</button>}
      </div>
      {menu && !offline && (
        <div className="selection-menu selection-popup" style={{ left: popup.x, top: popup.y }} role="toolbar" aria-label="选文操作" onMouseDown={e => e.preventDefault()}>
          <button onClick={() => { if (selection) onInsert(selection); setMenu(false); window.getSelection()?.removeAllRanges() }}>添加到正文</button>
        </div>
      )}
    </aside>
  )
}
