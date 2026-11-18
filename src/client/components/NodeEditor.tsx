import { useLayoutEffect, useMemo, useRef, useState, type ComponentType, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import type { KnowledgeNode, MapSnapshot } from '../../shared/map-types.ts'
import type { PlotData } from '../../shared/note-plot.ts'
import type { NoteAnchor } from '../../shared/note-position.ts'
import type { EditSession } from '../edit-session.ts'
import type { SelectionSnapshot } from '../selection.ts'
import { loadRichNote, type PlotHost } from '../note-rich-text.ts'
import { NotePlot } from './NotePlot.tsx'
import type { MarkdownNoteEditorProps } from './MarkdownNoteEditor.tsx'

export type NoteViewport = {
  capture: (scroller: HTMLElement) => NoteViewportAnchor | undefined
  restore: (scroller: HTMLElement, anchor: NoteViewportAnchor) => void
}
export type NoteViewportAnchor = { at: number; delta: number }
export type NoteBodyEditor = ComponentType<MarkdownNoteEditorProps>

type NodeEditorProps = {
  session?: EditSession
  editor?: NoteBodyEditor
  node: KnowledgeNode
  snapshot: MapSnapshot
  viewId?: string
  editing: boolean
  viewport: MutableRefObject<NoteViewport | undefined>
  onPlotReference?: (plot: PlotData) => void
  onPositionReference?: (anchor: NoteAnchor, text: string) => void
  onSelectionReference?: (selection: SelectionSnapshot) => void
}

export function NodeEditor({ session, editor: Editor, node, snapshot, viewId = '', editing, viewport,
  onPlotReference, onPositionReference, onSelectionReference }: NodeEditorProps) {
  const [, setVersion] = useState(0)
  const root = useRef<HTMLElement>(null)
  const fieldComposing = useRef(false)
  const nodeId = node.id
  useLayoutEffect(() => session?.subscribe(() => setVersion(version => version + 1)), [session, nodeId])
  useLayoutEffect(() => () => {
    if (fieldComposing.current) {
      fieldComposing.current = false
      session?.composition(false)
    }
  }, [session, editing])
  const readValue = { kind: 'details' as const, nodeId, title: node.title, summary: node.summary, markdown: snapshot.notes[nodeId] ?? '', images: [] }
  const current = () => {
    if (session?.draft?.edit.nodeId === nodeId) return session.draft.edit
    if (session?.working.map.nodes.some(candidate => candidate.id === nodeId)) return session.details(nodeId)
    return readValue
  }
  const value = editing ? current() : readValue
  const disabled = !session || ['conflict', 'recovery_required', 'readonly'].includes(session.status)
  const edit = editing && session && Editor && viewId
  const resources = useMemo(() => editing && session ? session.previewResources(nodeId) : snapshot.resources,
    [editing, session, nodeId, snapshot.resources, session?.working.resources, session?.draft])
  useLayoutEffect(() => {
    for (const field of root.current?.querySelectorAll<HTMLTextAreaElement>('textarea.note-inline-title,textarea.note-inline-summary') ?? []) {
      field.style.height = '0px'
      field.style.height = field.scrollHeight + 'px'
    }
  }, [value.title, value.summary, editing])
  const startFieldComposition = () => {
    fieldComposing.current = true
    session?.composition(true)
  }
  const updateField = (field: 'title' | 'summary', text: string) => {
    if (!disabled) session?.input({ ...current(), [field]: text }, viewId, fieldComposing.current)
  }
  const finishFieldComposition = (field: 'title' | 'summary', text: string) => {
    fieldComposing.current = false
    updateField(field, text)
    session?.composition(false)
  }

  return <section ref={root} className={edit && !disabled ? 'note-sheet' : 'note-sheet note-readonly'} aria-label="节点详情"
    onBlur={event => {
      if (!edit || event.currentTarget.contains(event.relatedTarget) ||
        (event.relatedTarget instanceof Element && event.relatedTarget.closest('.note-position-menu'))) return
      void session?.save()
    }}>
    {edit ? <>
      <textarea className="note-inline-title" aria-label="节点标题" placeholder="节点标题" rows={1} value={value.title} readOnly={disabled}
        onChange={event => updateField('title', event.target.value)}
        onCompositionStart={startFieldComposition} onCompositionEnd={event => finishFieldComposition('title', event.currentTarget.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur() } }}/>
      <textarea className="note-inline-summary" aria-label="节点摘要" placeholder={disabled ? '' : '添加一句摘要…'} rows={1}
        value={value.summary} readOnly={disabled} onChange={event => updateField('summary', event.target.value)}
        onCompositionStart={startFieldComposition} onCompositionEnd={event => finishFieldComposition('summary', event.currentTarget.value)}/>
    </> : <>
      <h2 className="note-inline-title note-static-field">{value.title}</h2>
      <div className="note-inline-summary note-static-field">{value.summary}</div>
    </>}
    <div className="note-prose">
      {edit ? <Editor session={session} nodeId={nodeId} viewId={viewId} markdown={value.markdown} resources={resources}
        disabled={disabled} viewport={viewport}
        onMarkdown={(markdown, images, composing, immediate) => session.input({ ...current(), markdown, images }, viewId, composing, immediate)}
        onPlotReference={onPlotReference} onPositionReference={onPositionReference} onSelectionReference={onSelectionReference}/> :
        <ReadNoteBody nodeId={nodeId} markdown={value.markdown} resources={resources} viewport={viewport} onPlotReference={onPlotReference}/>}
    </div>
    {edit && !value.title.trim() && <p className="note-inline-error" role="alert">标题还没有填写</p>}
  </section>
}

function ReadNoteBody({ nodeId, markdown, resources, viewport, onPlotReference }: {
  nodeId: string; markdown: string; resources: Readonly<Record<string, string>>
  viewport: MutableRefObject<NoteViewport | undefined>; onPlotReference?: (plot: PlotData) => void
}) {
  const body = useRef<HTMLDivElement>(null)
  const [plots, setPlots] = useState<PlotHost[]>([])
  useLayoutEffect(() => {
    if (body.current) setPlots(loadRichNote(body.current, markdown, href => resources[nodeId + ':' + href]).plots)
  }, [markdown, nodeId, resources])
  useLayoutEffect(() => {
    const root = body.current
    if (!root) return
    const blocks = () => [...root.querySelectorAll<HTMLElement>(':scope > [data-note-source-start]:not([hidden])')]
    const bridge: NoteViewport = {
      capture(scroller) {
        const top = scroller.getBoundingClientRect().top
        const rect = root.getBoundingClientRect()
        if (top < rect.top || top > rect.bottom) return
        const block = blocks().find(element => element.getBoundingClientRect().bottom > top)
        if (!block) return
        const scale = rect.height / root.offsetHeight || 1
        return { at: Number(block.dataset.noteSourceStart), delta: (top - block.getBoundingClientRect().top) / scale }
      },
      restore(scroller, anchor) {
        const block = blocks().findLast(element => Number(element.dataset.noteSourceStart) <= anchor.at)
        if (!block) return
        const rect = scroller.getBoundingClientRect()
        const scale = rect.height / scroller.offsetHeight || 1
        scroller.scrollTop += (block.getBoundingClientRect().top - rect.top) / scale + anchor.delta
      },
    }
    viewport.current = bridge
    return () => { if (viewport.current === bridge) viewport.current = undefined }
  }, [viewport])
  return <>
    <div ref={body} className="detail-body note-rich-body"/>
    {plots.map(({ element, token }, index) => createPortal(
      <NotePlot token={token} onReference={onPlotReference}/>, element, token.data?.id ?? 'invalid:' + index))}
  </>
}
