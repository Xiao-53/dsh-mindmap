import { useLayoutEffect, useRef, useState, type DragEvent, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import { Annotation, Compartment, EditorSelection, EditorState, StateEffect, StateField, Transaction, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, keymap, placeholder, type DecorationSet } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { changeNotePlot, isFormula, lexNote, moveNoteImage, noteBlocks, notePreviewSpans, sameNotePlots } from '../../shared/note-markdown.ts'
import { isPlot, type PlotData, type PlotToken } from '../../shared/note-plot.ts'
import type { NoteAnchor } from '../../shared/note-position.ts'
import { digest } from '../../shared/fingerprint.ts'
import { IMAGE_LIMIT, validateImage, type ImageAsset } from '../../shared/image-resource.ts'
import type { EditSession } from '../edit-session.ts'
import { captureSourceSelection, type SelectionSnapshot } from '../selection.ts'
import { loadRichNote, noteImage } from '../note-rich-text.ts'
import { copyEditorSelection, NoteEditorSource, replaceNoteDocument } from '../note-editor-source.ts'
import { NoteEditorHistory } from '../note-editor-history.ts'
import { noteComposing, noteFormatExtension, notePresentation, notePresentationChanged, noteRangeActive, setNoteComposition } from '../note-editor-format.ts'
import { continueNoteList, deleteNoteListPrefix } from '../note-editor-keys.ts'
import { decorateFormula } from '../note-editor-math.ts'
import { pickNotePosition, savedNotePosition } from '../note-editor-position.ts'
import { NotePlot } from './NotePlot.tsx'
import type { NoteViewport } from './NodeEditor.tsx'

export type MarkdownNoteEditorProps = {
  session: EditSession
  nodeId: string
  viewId: string
  markdown: string
  resources: Readonly<Record<string, string>>
  disabled: boolean
  viewport: MutableRefObject<NoteViewport | undefined>
  onMarkdown: (markdown: string, images: ImageAsset[], composing: boolean, immediate: boolean) => void
  onPlotReference?: (plot: PlotData) => void
  onPositionReference?: (anchor: NoteAnchor, text: string) => void
  onSelectionReference?: (selection: SelectionSnapshot) => void
}

type ControlledChange = { source: NoteEditorSource; kind: 'sync' | 'history' | 'plot' | 'image' }
const exactSource = Annotation.define<ControlledChange>()
const assetEdit = Annotation.define<{ images: ImageAsset[] }>()
const refreshWidgets = StateEffect.define<null>()
const sourceCache = new WeakMap<Transaction, NoteEditorSource>()
const plotWarning = '请用图表自带的移动或删除操作。图表数据可交给 DSH 修改。'

function sourceAfter(transaction: Transaction): NoteEditorSource {
  const controlled = transaction.annotation(exactSource)
  if (controlled) return controlled.source
  let source = sourceCache.get(transaction)
  if (!source) {
    source = new NoteEditorSource(transaction.startState.field(sourceField).apply(transaction.changes))
    sourceCache.set(transaction, source)
  }
  return source
}

const sourceField: StateField<NoteEditorSource> = StateField.define({
  create: state => new NoteEditorSource(state.doc.toString()),
  update: (source, transaction) => transaction.docChanged || transaction.annotation(exactSource) ? sourceAfter(transaction) : source,
})

function indexSource(source: NoteEditorSource) {
  const tokens = lexNote(source.markdown)
  const indexed = noteBlocks(source.markdown, tokens)
  const spans = notePreviewSpans(source.markdown, tokens, indexed).flatMap(span => {
    const from = source.editorAt(span.start), to = source.editorAt(span.end)
    return from === undefined || to === undefined ? [] : [{ ...span, from, to }]
  })
  return { blocks: indexed.blocks, spans, plots: tokens.filter(isPlot) }
}

const indexes = new WeakMap<NoteEditorSource, ReturnType<typeof indexSource>>()
function indexedNote(source: NoteEditorSource) {
  let index = indexes.get(source)
  if (!index) {
    index = indexSource(source)
    indexes.set(source, index)
  }
  return index
}

type PlotHost = { element: HTMLElement; token: PlotToken; key: number }
class PlotWidget extends WidgetType {
  constructor(readonly token: PlotToken, readonly mount: (element: HTMLElement, token?: PlotToken) => void) { super() }
  eq(other: PlotWidget) { return this.token.source === other.token.source && this.token.error === other.token.error }
  toDOM(view: EditorView) {
    const element = view.dom.ownerDocument.createElement('div')
    element.className = 'note-plot-host'
    element.dataset.noteLockedPlot = ''
    element.contentEditable = 'false'
    this.mount(element, this.token)
    return element
  }
  destroy(element: HTMLElement) { this.mount(element) }
}

type ImageActions = {
  remove: (view: EditorView, element: HTMLElement) => void
  bindDrag: (view: EditorView, element: HTMLElement) => void
  destroy: (element: HTMLElement) => void
}

class ImageWidget extends WidgetType {
  constructor(readonly raw: string, readonly alt: string, readonly url: string | undefined,
    readonly writable: boolean, readonly actions: ImageActions) { super() }
  eq(other: ImageWidget) {
    return this.raw === other.raw && this.alt === other.alt && this.url === other.url && this.writable === other.writable
  }
  toDOM(view: EditorView) {
    const element = noteImage(view.dom.ownerDocument, this.raw, this.alt, this.url,
      this.writable ? () => this.actions.remove(view, element) : undefined)
    if (this.writable) this.actions.bindDrag(view, element)
    return element
  }
  destroy(element: HTMLElement) { this.actions.destroy(element) }
}

type NoteDragRange = { start: number; end: number }
type ImageDrag = NoteDragRange & {
  source: NoteEditorSource; element: HTMLElement; pointerId: number; x: number; y: number; moved: boolean
}

type PositionMenu = {
  panel: HTMLElement
  x: number
  y: number
  source: NoteEditorSource
  target?: ReturnType<typeof pickNotePosition>
  selection?: SelectionSnapshot
}

function isEditingBlocked(props: MarkdownNoteEditorProps) {
  return props.disabled || ['conflict', 'recovery_required', 'readonly'].includes(props.session.status)
}

function notePositionForElement(view: EditorView, element: HTMLElement) {
  if (view.dom.contains(element)) return view.posAtDOM(element)
}

function nearbySpan(view: EditorView, element: HTMLElement, match: (span: ReturnType<typeof indexSource>['spans'][number]) => boolean) {
  const at = notePositionForElement(view, element)
  if (at === undefined) return
  const spans = indexedNote(view.state.field(sourceField)).spans
  return spans.find(span => span.from === at && match(span)) ?? spans.find(span => span.from <= at && span.to >= at && match(span))
}

function dragTarget(view: EditorView, clientX: number, clientY: number, moving: NoteDragRange) {
  const { dom } = view
  const bounds = dom.closest('.inspector-body')?.getBoundingClientRect() ?? dom.getBoundingClientRect()
  const body = dom.getBoundingClientRect()
  if (clientX < Math.max(bounds.left, body.left) || clientX > Math.min(bounds.right, body.right) ||
      clientY < Math.max(bounds.top, body.top) || clientY > Math.min(bounds.bottom, body.bottom)) return
  const source = view.state.field(sourceField)
  const { blocks } = indexedNote(source)
  const choices = [{ at: 0, end: false }, ...blocks.flatMap(block => [
    { at: block.start, end: false }, { at: block.end, end: true },
  ]), { at: source.markdown.length, end: true }]
  let best: { at: number; y: number } | undefined
  for (const { at, end: isEnd } of choices) {
    const pos = source.editorAt(at)
    if (pos === undefined || pos < view.viewport.from || pos > view.viewport.to) continue
    const coords = view.coordsAtPos(pos, isEnd ? -1 : 1)
    const block = view.lineBlockAt(pos)
    const y = coords ? (isEnd ? coords.bottom : coords.top) : view.documentTop + (isEnd ? block.bottom : block.top) * view.scaleY
    if (!best || Math.abs(y - clientY) < Math.abs(best.y - clientY)) best = { at, y }
  }
  if (!best || best.at >= moving.start && best.at <= moving.end) return
  return best
}

async function decodeImage(file: File) {
  if (file.size > IMAGE_LIMIT) throw new Error('图片不能超过 8 MiB')
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP')
  const bitmap = await createImageBitmap(file)
  bitmap.close()
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return validateImage({
    schemaVersion: 1, kind: 'image', id: crypto.randomUUID(), mimeType: file.type,
    byteLength: bytes.length, encoding: 'base64', data: btoa(binary), sha256: await digest(bytes),
  })
}

export function MarkdownNoteEditor(props: MarkdownNoteEditorProps) {
  const latest = useRef(props)
  latest.current = props
  const root = useRef<HTMLDivElement>(null)
  const mountedView = useRef<EditorView>()
  const fileInput = useRef<HTMLInputElement>(null)
  const storedPick = useRef<{ view: EditorView; source: NoteEditorSource; from: number; to: number }>()
  const drag = useRef<NoteDragRange & { id: string; source: NoteEditorSource }>()
  const imageDrag = useRef<ImageDrag>()
  const menuElement = useRef<HTMLDivElement>(null)
  const [hosts, setHosts] = useState<PlotHost[]>([])
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [drop, setDrop] = useState<number>()
  const [menu, setMenu] = useState<PositionMenu>()
  const compartment = useRef(new Compartment()).current

  const composing = (view: EditorView) => noteComposing(view.state) || view.compositionStarted || view.composing
  const canAct = (view: EditorView) => !isEditingBlocked(latest.current) && !composing(view) && mountedView.current === view

  const showDrop = (view: EditorView | undefined, target?: { y: number }) => {
    const top = root.current?.getBoundingClientRect().top
    setDrop(target && view && top !== undefined ? (target.y - top) / view.scaleY : undefined)
  }

  const releaseImageDrag = (pending: ImageDrag) => {
    if (imageDrag.current !== pending) return
    imageDrag.current = undefined
    pending.element.classList.remove('note-image-dragging')
    if (pending.element.hasPointerCapture(pending.pointerId)) pending.element.releasePointerCapture(pending.pointerId)
  }

  function publishExact(view: EditorView, source: NoteEditorSource, kind: ControlledChange['kind'], selection?: EditorState['selection']) {
    const current = view.state.field(sourceField)
    view.dispatch({
      changes: replaceNoteDocument(current.text, source.text),
      selection,
      annotations: exactSource.of({ source, kind }),
      userEvent: kind === 'history' ? 'input.history' : 'input.' + kind,
      scrollIntoView: kind === 'history',
    })
  }

  useLayoutEffect(() => {
    if (!root.current) return
    let live = true
    let serial = 0
    const plotHosts = new Map<HTMLElement, PlotHost>()
    let widgetsQueued = false
    const registerPlot = (element: HTMLElement, token?: PlotToken) => {
      if (token) plotHosts.set(element, { element, token, key: ++serial })
      else plotHosts.delete(element)
      if (widgetsQueued) return
      widgetsQueued = true
      queueMicrotask(() => {
        widgetsQueued = false
        if (live) setHosts([...plotHosts.values()])
      })
    }

    const history = new NoteEditorHistory()
    let compositionStart: { markdown: string; selection: EditorState['selection'] } | undefined
    let endCompositionTimer: ReturnType<typeof setTimeout> | undefined
    const cursorState = (state: EditorState) => ({ markdown: state.field(sourceField).markdown, selection: state.selection })
    const traverse = (view: EditorView, redo: boolean) => {
      if (canAct(view)) {
        const target = history.travel(view.state.field(sourceField).markdown, redo)
        if (target) publishExact(view, new NoteEditorSource(target.markdown), 'history', target.selection)
      }
      // An empty body history must not fall through to the host's undo stack.
      return true
    }

    const activate = (view: EditorView, element: HTMLElement) => {
      if (!canAct(view)) return
      const span = nearbySpan(view, element, spec => isFormula(spec.token) && spec.token.source === element.dataset.noteFormula)
      if (!span || !isFormula(span.token)) return
      const from = span.from + span.token.source.indexOf(span.token.delimiter) + span.token.delimiter.length
      view.dispatch({ selection: { anchor: Math.min(span.to, from) }, scrollIntoView: true })
      view.focus()
    }
    const deleteImageRange = (view: EditorView, from: number, to: number) => {
      view.dispatch({ changes: { from, to }, selection: { anchor: from }, annotations: assetEdit.of({ images: [] }), userEvent: 'delete.image' })
      view.focus()
    }
    const removeImage = (view: EditorView, element: HTMLElement) => {
      if (!canAct(view)) return
      const span = nearbySpan(view, element, spec => spec.token.type === 'image' && spec.token.raw === element.dataset.noteImage)
      if (span) deleteImageRange(view, span.from, span.to)
    }
    const deleteImageAtEdge = (view: EditorView, forward: boolean) => {
      const { selection } = view.state
      if (!canAct(view) || !selection.main.empty || selection.ranges.length !== 1) return false
      const { head } = selection.main
      const span = indexedNote(view.state.field(sourceField)).spans.find(item =>
        item.token.type === 'image' && (forward ? item.from === head : item.to === head))
      if (!span) return false
      deleteImageRange(view, span.from, span.to)
      return true
    }

    const bindImageDrag = (view: EditorView, element: HTMLElement) => {
      element.classList.add('note-image-movable')
      element.title = '拖动图片以调整正文位置'
      element.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0 || imageDrag.current || drag.current || !canAct(view) ||
            (event.target as Element).closest('button')) return
        const span = nearbySpan(view, element, spec => spec.token.type === 'image' && spec.token.raw === element.dataset.noteImage)
        if (!span) return
        // 图片走指针捕获，避免原生拖放携带文件或 data URL 进入宿主输入框。
        element.setPointerCapture(event.pointerId)
        event.preventDefault()
        imageDrag.current = {
          source: view.state.field(sourceField), element, pointerId: event.pointerId,
          start: span.start, end: span.end, x: event.clientX, y: event.clientY, moved: false,
        }
      })
      const pendingFor = (event: PointerEvent) => {
        const pending = imageDrag.current
        if (pending?.element === element && pending.pointerId === event.pointerId) return pending
      }
      const targetFor = (event: PointerEvent, pending: ImageDrag) => {
        if (pending.moved && canAct(view) && view.state.field(sourceField) === pending.source)
          return dragTarget(view, event.clientX, event.clientY, pending)
      }
      element.addEventListener('pointermove', event => {
        const pending = pendingFor(event)
        if (!pending) return
        if (!pending.moved) {
          if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 4) return
          pending.moved = true
          element.classList.add('note-image-dragging')
        }
        showDrop(view, targetFor(event, pending))
      })
      element.addEventListener('pointerup', event => {
        const pending = pendingFor(event)
        if (!pending) return
        const target = targetFor(event, pending)
        releaseImageDrag(pending)
        setDrop(undefined)
        if (!target) return
        const moved = moveNoteImage(pending.source.markdown, pending.start, pending.end, target.at)
        if (!moved) return
        const source = new NoteEditorSource(moved.markdown)
        const cursor = source.editorAt(moved.start)
        if (cursor === undefined || !latest.current.session.finishInput()) return
        publishExact(view, source, 'image', EditorSelection.single(cursor))
        view.focus()
      })
      const cancel = (event: PointerEvent) => {
        const pending = pendingFor(event)
        if (!pending) return
        releaseImageDrag(pending)
        setDrop(undefined)
      }
      element.addEventListener('pointercancel', cancel)
      element.addEventListener('lostpointercapture', cancel)
    }
    const imageActions: ImageActions = {
      remove: removeImage,
      bindDrag: bindImageDrag,
      destroy: element => {
        const pending = imageDrag.current
        if (pending?.element !== element) return
        releaseImageDrag(pending)
        queueMicrotask(() => { if (live && !imageDrag.current && !drag.current) setDrop(undefined) })
      },
    }

    type Widgets = { display: DecorationSet; atomic: DecorationSet }
    const decorationState = (state: EditorState): Widgets => {
      const ranges: Range<Decoration>[] = [], locked: Range<Decoration>[] = []
      const { spans } = indexedNote(state.field(sourceField))
      for (const { from, to, token } of spans) {
        if (isFormula(token)) decorateFormula(ranges, state, token, from, to, activate)
        else if (isPlot(token)) {
          const decoration = Decoration.replace({ widget: new PlotWidget(token, registerPlot), block: true, inclusive: false }).range(from, to)
          ranges.push(decoration)
          locked.push(decoration)
        } else if (!noteRangeActive(state, from + 1, to - 1)) {
          const url = latest.current.resources[latest.current.nodeId + ':' + token.href]
          ranges.push(Decoration.replace({ widget: new ImageWidget(token.raw, token.text, url, !state.readOnly, imageActions) }).range(from, to))
        }
      }
      return { display: Decoration.set(ranges, true), atomic: Decoration.set(locked, true) }
    }

    const widgets = StateField.define<Widgets>({
      create: decorationState,
      update(previous, tr) {
        if (noteComposing(tr.state)) return tr.docChanged
          ? { display: previous.display.map(tr.changes), atomic: previous.atomic.map(tr.changes) }
          : previous
        if (tr.docChanged || tr.selection || tr.annotation(exactSource) ||
            notePresentationChanged(tr.startState, tr.state) || tr.effects.some(effect => effect.is(refreshWidgets)))
          return decorationState(tr.state)
        return previous
      },
      provide: field => [
        EditorView.decorations.from(field, value => value.display),
        EditorView.atomicRanges.of(view => view.state.field(field).atomic),
      ],
    })

    const rejectPlotChange = () => queueMicrotask(() => { if (live) setError(plotWarning) })
    const keepValidSource = EditorState.transactionFilter.of(tr => {
      const controlled = tr.annotation(exactSource)
      if (!tr.docChanged && !controlled) return tr
      if (controlled?.kind !== 'sync' && isEditingBlocked(latest.current)) return []
      const before = tr.startState.field(sourceField)
      const next = sourceAfter(tr)
      if (next.text !== tr.newDoc.toString()) return []
      if ((controlled && controlled.kind !== 'image') || (!before.markdown.includes('dsh-plot') && !next.markdown.includes('dsh-plot'))) return tr
      if (sameNotePlots(before.markdown, next.markdown, indexedNote(before).plots, indexedNote(next).plots)) return tr
      rejectPlotChange()
      return []
    })

    const positionMenu = (view: EditorView, position: number, x: number, y: number, pointer: boolean) => {
      const panel = view.dom.closest<HTMLElement>('.inspector')
      const current = latest.current
      if (!panel || !canAct(view) || (!current.onPositionReference && !current.onSelectionReference)) return false
      const source = view.state.field(sourceField)
      const range = view.state.selection.main
      let selection: SelectionSnapshot | undefined
      if (current.onSelectionReference && !range.empty && (!pointer || range.from <= position && position <= range.to)) {
        const projection = view.dom.ownerDocument.createElement('div')
        const { textPoints } = loadRichNote(projection, source.markdown, () => undefined)
        selection = captureSourceSelection(projection, textPoints, source.originalAt(range.from), source.originalAt(range.to))
      }
      setMenu({ panel, x, y, source, target: pickNotePosition(view, source, position, pointer ? y : undefined), selection })
      return true
    }

    const view = new EditorView({
      parent: root.current,
      state: EditorState.create({
        doc: new NoteEditorSource(props.markdown).text,
        extensions: [
          sourceField.init(() => new NoteEditorSource(props.markdown)), notePresentation, widgets, keepValidSource,
          markdown({ base: markdownLanguage, addKeymap: false, completeHTMLTags: false, pasteURLAsLink: false }),
          noteFormatExtension(state => indexedNote(state.field(sourceField)).spans),
          EditorView.lineWrapping, placeholder('写下内容…'), compartment.of(readOnlyExtensions(props.disabled)),
          EditorView.contentAttributes.of({ 'aria-label': '正文', 'aria-multiline': 'true' }),
          EditorView.clipboardOutputFilter.of((_text, state) => copyEditorSelection(state.field(sourceField), state)),
          keymap.of([
            { key: 'Enter', run: continueNoteList },
            { key: 'Backspace', run: editor => deleteImageAtEdge(editor, false) || deleteNoteListPrefix(editor) },
            { key: 'Delete', run: editor => deleteImageAtEdge(editor, true) },
            { key: 'Mod-z', run: editor => traverse(editor, false), preventDefault: true },
            { key: 'Mod-y', run: editor => traverse(editor, true), preventDefault: true },
            { key: 'Mod-Shift-z', run: editor => traverse(editor, true), preventDefault: true },
            ...defaultKeymap,
          ]),
          EditorView.domEventHandlers({
            contextmenu(event, editor) {
              const target = event.target as Element | null
              if (!target || target.closest('[data-note-locked-plot],[data-note-image],.note-cm-formula,.note-cm-math-preview')) return false
              const at = editor.posAtCoords({ x: event.clientX, y: event.clientY })
              return at !== null && positionMenu(editor, at, event.clientX, event.clientY, true)
            },
            keydown(event, editor) {
              if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return false
              const at = editor.state.selection.main.head
              const rect = editor.coordsAtPos(at)
              return !!rect && positionMenu(editor, at, rect.left, rect.bottom, false)
            },
            beforeinput(event, editor) {
              if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') return traverse(editor, event.inputType === 'historyRedo')
              if (event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward')
                return deleteImageAtEdge(editor, event.inputType === 'deleteContentForward')
              return false
            },
            compositionstart(_event, editor) {
              if (!compositionStart) compositionStart = cursorState(editor.state)
              clearTimeout(endCompositionTimer)
              latest.current.session.composition(true)
              editor.dispatch({ effects: setNoteComposition.of(true) })
              return false
            },
            compositionend(_event, editor) {
              clearTimeout(endCompositionTimer)
              endCompositionTimer = setTimeout(() => {
                if (mountedView.current !== editor) return
                const after = cursorState(editor.state)
                if (compositionStart) history.record(compositionStart, after, 'composition')
                compositionStart = undefined
                editor.dispatch({ effects: setNoteComposition.of(false) })
                latest.current.session.composition(false)
              }, 0)
              return false
            },
          }),
          EditorView.updateListener.of(update => {
            for (const tr of update.transactions) {
              const before = cursorState(tr.startState), after = cursorState(tr.state)
              if (before.markdown === after.markdown) continue
              const controlled = tr.annotation(exactSource)?.kind
              if (controlled === 'sync') { history.clear(); continue }
              const inComposition = noteComposing(tr.state)
              const type = tr.annotation(Transaction.userEvent) ?? 'input'
              if (controlled !== 'history' && !inComposition) history.record(before, after, type)
              const asset = tr.annotation(assetEdit)
              latest.current.onMarkdown(after.markdown, asset?.images ?? [], inComposition, !!asset || controlled === 'plot' || controlled === 'image')
              if (errorText.current === plotWarning) setError('')
              setMenu(undefined)
            }
          }),
        ],
      }),
    })
    mountedView.current = view
    const bridge: NoteViewport = {
      capture(scroller) {
        const top = scroller.getBoundingClientRect().top
        const bounds = view.dom.getBoundingClientRect()
        if (top < bounds.top || top > bounds.bottom) return
        const block = view.lineBlockAtHeight((top - view.documentTop) / view.scaleY)
        return { at: view.state.field(sourceField).originalAt(block.from), delta: (top - view.documentTop) / view.scaleY - block.top }
      },
      restore(scroller, anchor) {
        const source = view.state.field(sourceField)
        const at = source.editorAt(anchor.at)
        if (at === undefined) return
        view.requestMeasure({
          read: current => {
            const rect = scroller.getBoundingClientRect()
            const scale = rect.height / scroller.offsetHeight || 1
            const top = current.documentTop + current.lineBlockAt(at).top * current.scaleY
            return (top - rect.top) / scale + anchor.delta
          },
          write: delta => { if (mountedView.current === view) scroller.scrollTop += delta },
        })
      },
    }
    props.viewport.current = bridge
    return () => {
      live = false
      clearTimeout(endCompositionTimer)
      if (compositionStart) props.session.composition(false)
      if (props.viewport.current === bridge) props.viewport.current = undefined
      mountedView.current = undefined
      view.destroy()
    }
  }, [props.session, props.nodeId, props.viewId])

  const errorText = useRef(error)
  errorText.current = error
  useLayoutEffect(() => {
    const view = mountedView.current
    if (!view) return
    if (view.state.readOnly !== props.disabled)
      view.dispatch({ effects: [compartment.reconfigure(readOnlyExtensions(props.disabled)), refreshWidgets.of(null)] })
    if (props.disabled) {
      drag.current = undefined
      if (imageDrag.current) releaseImageDrag(imageDrag.current)
      setDrop(undefined)
      setMenu(undefined)
    }
  }, [props.disabled, compartment])
  useLayoutEffect(() => {
    const view = mountedView.current
    const draft = props.session.draft?.edit
    const current = draft?.nodeId === props.nodeId ? draft.markdown : props.session.working.notes[props.nodeId] ?? ''
    if (view && view.state.field(sourceField).markdown !== current && !noteComposing(view.state))
      publishExact(view, new NoteEditorSource(current), 'sync')
  }, [props.markdown, props.nodeId, props.session])
  useLayoutEffect(() => {
    mountedView.current?.dispatch({ effects: refreshWidgets.of(null) })
  }, [props.resources])

  useLayoutEffect(() => {
    const element = menuElement.current
    if (!menu || !element) return
    const rect = menu.panel.getBoundingClientRect()
    const scaleX = rect.width / menu.panel.offsetWidth || 1
    const scaleY = rect.height / menu.panel.offsetHeight || 1
    const left = (menu.x - rect.left) / scaleX
    const top = (menu.y - rect.top) / scaleY
    element.style.left = Math.max(8, Math.min(left, menu.panel.clientWidth - element.offsetWidth - 8)) + 'px'
    element.style.top = Math.max(8, Math.min(top + 6, menu.panel.clientHeight - element.offsetHeight - 8)) + 'px'
    element.querySelector('button')?.focus({ preventScroll: true })
    const dismiss = () => setMenu(undefined)
    const pointer = (event: PointerEvent) => { if (!element.contains(event.target as Node)) dismiss() }
    menu.panel.ownerDocument.addEventListener('pointerdown', pointer, true)
    const scrolling = menu.panel.querySelector('.inspector-body')
    scrolling?.addEventListener('scroll', dismiss)
    return () => {
      menu.panel.ownerDocument.removeEventListener('pointerdown', pointer, true)
      scrolling?.removeEventListener('scroll', dismiss)
    }
  }, [menu])

  const commitPlot = (id: string, destination?: number) => {
    const view = mountedView.current
    if (!view || !canAct(view)) return
    const markdown = changeNotePlot(view.state.field(sourceField).markdown, id, destination)
    if (markdown === undefined || !latest.current.session.finishInput()) return
    publishExact(view, new NoteEditorSource(markdown), 'plot')
    view.focus()
  }

  const openImagePicker = () => {
    const view = mountedView.current
    if (!view || !canAct(view)) return
    const { from, to } = view.state.selection.main
    storedPick.current = { view, source: view.state.field(sourceField), from, to }
    fileInput.current?.click()
  }

  const addImage = async (file?: File) => {
    const picked = storedPick.current
    storedPick.current = undefined
    if (!file || !picked) return
    setAdding(true)
    try {
      const image = await decodeImage(file)
      const { view, source, from, to } = picked
      if (mountedView.current !== view) return
      if (!canAct(view) || view.state.field(sourceField) !== source) {
        setError('正文已变化，请重新选择图片插入位置。')
        return
      }
      const { session, nodeId } = latest.current
      const href = '../'.repeat(session.notePath(nodeId).split('/').length - 1) + 'assets/' + image.id + '.image.json'
      const insert = '![图片](' + href + ')'
      setError('')
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, annotations: assetEdit.of({ images: [image] }), userEvent: 'input.image' })
      view.focus()
    } catch (cause) {
      if (mountedView.current === picked.view) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mountedView.current === picked.view) setAdding(false)
    }
  }

  const addReference = async () => {
    const view = mountedView.current
    const current = menu
    setMenu(undefined)
    view?.focus()
    if (!view || !current || !canAct(view) || !props.onPositionReference) return
    if (!current.target) { setError('请在正文文字或块间空白重新选点。'); return }
    const result = await savedNotePosition(props.session, props.nodeId, current.source.markdown, current.target)
    if (!canAct(view)) return
    if (!result || view.state.field(sourceField) !== current.source) {
      setError('已保存的正文无法确认该位置，请完成保存后重新选点。')
      return
    }
    setError('')
    latest.current.onPositionReference?.(result.anchor, result.text)
  }

  const plotDrop = (event: DragEvent, final: boolean) => {
    const pending = drag.current
    if (!pending) return
    event.preventDefault()
    event.stopPropagation()
    const view = mountedView.current
    const target = view && canAct(view) && view.state.field(sourceField) === pending.source
      ? dragTarget(view, event.clientX, event.clientY, pending) : undefined
    if (final) {
      drag.current = undefined
      setDrop(undefined)
      if (target) commitPlot(pending.id, target.at)
    } else {
      event.dataTransfer.dropEffect = target ? 'move' : 'none'
      showDrop(view, target)
    }
  }

  return <>
    <div className="note-live-wrap" onDragOverCapture={e => plotDrop(e, false)} onDropCapture={e => plotDrop(e, true)}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(undefined) }}>
      <div className="detail-body note-live-editor" ref={root}/>
      {drop !== undefined && <div aria-hidden="true" className="note-plot-drop" style={{ top: drop }}/>}
    </div>
    {hosts.map(({ element, token, key }) => createPortal(
      <NotePlot token={token} onReference={props.onPlotReference} controls={token.data && !props.disabled ? {
        remove: () => commitPlot(token.data!.id),
        startDrag: event => {
          const view = mountedView.current
          if (!view || !canAct(view) || imageDrag.current) { event.preventDefault(); return }
          const id = token.data!.id
          const source = view.state.field(sourceField)
          const plot = indexedNote(source).plots.find(item => item.data?.id === id)
          if (!plot) { event.preventDefault(); return }
          drag.current = { id, source, start: plot.start, end: plot.end }
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('application/x-dsh-note-plot', token.data!.id)
          event.dataTransfer.setDragImage(element, 16, 16)
        },
        endDrag: () => { drag.current = undefined; setDrop(undefined) },
      } : undefined}/>, element, key))}
    {!props.disabled && <div className="note-inline-tools">
      <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => { void addImage(event.target.files?.[0]); event.target.value = '' }}/>
      <button className="note-tool" type="button" disabled={adding} aria-label="插入图片" title="插入图片（PNG、JPEG、WebP）"
        onMouseDown={event => event.preventDefault()} onClick={openImagePicker}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/></svg>
      </button>
      {adding && <span className="note-edit-hint">正在加入图片…</span>}
    </div>}
    {menu && createPortal(<div ref={menuElement} className="note-position-menu" role="menu" aria-label="正文操作"
      onMouseDown={event => event.preventDefault()}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setMenu(undefined) }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); setMenu(undefined); mountedView.current?.focus(); return }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        const buttons = Array.from(event.currentTarget.querySelectorAll('button'))
        const next = (buttons.indexOf(event.target as HTMLButtonElement) + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
        event.preventDefault()
        event.stopPropagation()
        buttons[next]?.focus({ preventScroll: true })
      }}>
      {props.onPositionReference && <button type="button" role="menuitem" onClick={() => { void addReference() }}>
        {menu.target?.gap === undefined ? '添加图表/公式' : '添加此位置到正文'}
      </button>}
      {menu.selection && props.onSelectionReference && <button type="button" role="menuitem" onClick={() => {
        setMenu(undefined)
        const view = mountedView.current
        view?.focus()
        if (view?.state.field(sourceField) === menu.source) props.onSelectionReference?.(menu.selection!)
      }}>添加到正文</button>}
    </div>, menu.panel)}
    {error && <p className="note-inline-error" role="alert">{error}</p>}
  </>
}

function readOnlyExtensions(disabled: boolean) {
  return [EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]
}
