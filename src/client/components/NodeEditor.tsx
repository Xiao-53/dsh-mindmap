import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { KnowledgeNode, MapSnapshot } from '../../shared/map-types.ts'
import type { PlotData } from '../../shared/note-plot.ts'
import { captureNoteAnchor, captureNoteGap, locateNoteAnchor, type NoteAnchor } from '../../shared/note-position.ts'
import { captureSelection, type SelectionSnapshot } from '../selection.ts'
import { NotePlot } from './NotePlot.tsx'
import type { EditSession, FormulaDraft } from '../edit-session.ts'
import { digest } from '../../shared/fingerprint.ts'
import { IMAGE_LIMIT, imageUrl, validateImage } from '../../shared/image-resource.ts'
import { bodyPosition, loadRichNote, noteImage, noteGapAt, promoteNoteFormulas, readRichNote, restoreBodyPosition, setRichNoteMode, sourcePointAt, type BodyPosition, type PlotHost } from '../note-rich-text.ts'

import { changeNotePlot, formulaFromRaw, noteBlocks, sameNotePlots } from '../../shared/note-markdown.ts'
import { formulaElement, mathMarkup } from '../note-math.ts'

type BodyState = { markdown: string; position?: BodyPosition }
type BodyAction = { before: BodyState; after: BodyState; kind: string; at: number }

function FormulaPreview({ tex, display }: { tex: string; display: boolean }) {
  const markup = mathMarkup(tex, display)
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (host.current) host.current.innerHTML = markup ?? ''
  }, [markup])
  return <><div className="note-math note-math-block" ref={host}/>{markup === null && <div role="status">公式未完成或无法预览。</div>}</>
}

type NodeEditorProps = {
  session?: EditSession
  node: KnowledgeNode
  snapshot: MapSnapshot
  viewId?: string
  editing: boolean
  onPlotReference?: (plot: PlotData) => void
  onPositionReference?: (anchor: NoteAnchor, text: string) => void
  onSelectionReference?: (selection: SelectionSnapshot) => void
}

export function NodeEditor({session,node,snapshot,viewId='',editing,onPlotReference,onPositionReference,onSelectionReference}:NodeEditorProps) {
  const nodeId = node.id
  const readValue = { kind: 'details' as const, nodeId, title: node.title, summary: node.summary, markdown: snapshot.notes[nodeId] ?? '', images: [] }
  const current=()=>session?.draft?.edit.nodeId===nodeId?session.draft.edit:session?.details(nodeId) ?? readValue
  const [draft,setValue]=useState(current),[error,setError]=useState(''),[adding,setAdding]=useState(false)
  const value = editing ? draft : readValue
  const root=useRef<HTMLElement>(null), body=useRef<HTMLDivElement>(null), fileInput=useRef<HTMLInputElement>(null)
  const composing=useRef(false),live=useRef(true),caret=useRef<Range>(),shownMarkdown=useRef<string>()
  const projection=useRef<ReturnType<typeof loadRichNote>>()
  const originals=useRef<ReturnType<typeof loadRichNote>['originals']>(new WeakMap())
  const [plots,setPlots] = useState<PlotHost[]>([])
  const dragPlot = useRef<{ id: string; markdown: string }>()
  const [drop,setDrop] = useState<{ at: number; y: number }>()
  const [positionMenu,setPositionMenu] = useState<{ at?: number; gapIndex?: number; gapY?: number; x: number; y: number; markdown: string; panel: HTMLElement; selection?: SelectionSnapshot }>()
  const positionMenuElement = useRef<HTMLDivElement>(null)
  const resourcesUsed = useRef<Record<string, string>>()
  const disabled = !editing || !session || !viewId || ['conflict','recovery_required','readonly'].includes(session.status)
  const editableRef = useRef(false)
  editableRef.current = !disabled
  const renderBody = (field: HTMLElement, markdown: string) => {
    const resources = session?.previewResources(nodeId) ?? snapshot.resources
    resourcesUsed.current = snapshot.resources
    const next = loadRichNote(field, markdown, href => resources[nodeId + ':' + href])
    setRichNoteMode(field, !disabled, next.originals)
    projection.current = next
    originals.current = next.originals
    setPlots(next.plots)
  }
  const history = useRef<{ entries: BodyAction[]; cursor: number }>({ entries: [], cursor: 0 })
  const lastPosition = useRef<BodyPosition>()
  const beforePosition = useRef<BodyPosition>()
  const [formulaDraft, setFormulaDraft] = useState<FormulaDraft | undefined>(()=>
    session?.formulaDraft?.nodeId===nodeId && session.formulaDraft.viewId===viewId ? session.formulaDraft : undefined)
  const formulaField = useRef<HTMLTextAreaElement>(null)
  useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
  useEffect(()=>session?.subscribe(()=>{
    if(session.working.map.nodes.some(node=>node.id===nodeId))setValue(current())
    const candidate=session.formulaDraft
    setFormulaDraft(candidate?.nodeId===nodeId && candidate.viewId===viewId ? candidate : undefined)
  }),[session,nodeId])
  useLayoutEffect(()=>{
    for(const field of root.current?.querySelectorAll<HTMLTextAreaElement>('textarea')??[]) {
      field.style.height='0px';field.style.height=`${field.scrollHeight}px`
    }
  },[value.title,value.summary,editing])
  useLayoutEffect(() => {
    if (body.current) setRichNoteMode(body.current, !disabled, originals.current)
    if (disabled) {
      dragPlot.current = undefined
      setDrop(undefined)
      setPositionMenu(undefined)
    }
  }, [disabled])
  useLayoutEffect(() => {
    const menu = positionMenuElement.current
    if (!menu || !positionMenu) return
    const { panel, x, y } = positionMenu
    const rect = panel.getBoundingClientRect()
    const scaleX = rect.width / panel.offsetWidth || 1
    const scaleY = rect.height / panel.offsetHeight || 1
    const left = (x - rect.left) / scaleX - panel.clientLeft
    const top = (y - rect.top) / scaleY - panel.clientTop
    const margin = 8
    const below = top + 5
    const preferredTop = below + menu.offsetHeight <= panel.clientHeight - margin ? below : top - menu.offsetHeight - 5
    menu.style.left = Math.max(margin, Math.min(left, panel.clientWidth - menu.offsetWidth - margin)) + 'px'
    menu.style.top = Math.max(margin, Math.min(preferredTop, panel.clientHeight - menu.offsetHeight - margin)) + 'px'
    menu.querySelector('button')?.focus({ preventScroll: true })
  }, [positionMenu])
  useEffect(() => {
    if (!positionMenu) return
    const { panel } = positionMenu
    const scroller = panel.querySelector('.inspector-body')
    const dismiss = () => setPositionMenu(undefined)
    const pointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !positionMenuElement.current?.contains(event.target)) dismiss()
    }
    panel.ownerDocument.addEventListener('pointerdown', pointerDown, true)
    scroller?.addEventListener('scroll', dismiss)
    return () => {
      panel.ownerDocument.removeEventListener('pointerdown', pointerDown, true)
      scroller?.removeEventListener('scroll', dismiss)
    }
  }, [positionMenu])
  useLayoutEffect(()=>{
    if (!body.current || composing.current) return
    const old = resourcesUsed.current
    const resourcesChanged = old !== snapshot.resources && (!old ||
      Object.keys(snapshot.resources).some(key => key.startsWith(nodeId + ':') && old[key] !== snapshot.resources[key]) ||
      Object.keys(old).some(key => key.startsWith(nodeId + ':') && !Object.hasOwn(snapshot.resources, key)))
    if (shownMarkdown.current === value.markdown && !resourcesChanged) return
    const contentChanged = shownMarkdown.current !== value.markdown
    const position = !contentChanged ? bodyPosition(body.current) : undefined
    renderBody(body.current, value.markdown)
    if (!contentChanged) {
      if (position) restoreBodyPosition(body.current, position)
      return
    }
    shownMarkdown.current=value.markdown
    caret.current=undefined
    history.current={entries:[],cursor:0}
  },[value.markdown,session,nodeId,snapshot.resources])
  useEffect(()=>{
    const rememberCaret=()=>{
      const selection=window.getSelection()
      if(selection?.rangeCount && body.current?.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        caret.current=selection.getRangeAt(0).cloneRange()
        lastPosition.current=bodyPosition(body.current)
      }
    }
    document.addEventListener('selectionchange',rememberCaret)
    return ()=>document.removeEventListener('selectionchange',rememberCaret)
  },[])
  const update=(next:typeof value,immediate=false)=>{
    if(disabled)return
    setValue(next);session?.input(next,viewId,composing.current,immediate)
  }
  const plotError = '请用图表自带的移动或删除操作。图表数据可交给 DSH 修改。'
  const formulas = () => [...(body.current?.querySelectorAll<HTMLElement>('[data-note-formula]') ?? [])]
    .filter(element => !element.closest('[data-note-locked-plot]'))
  const touchesPlot = (range: Range) =>
    Array.from(body.current?.querySelectorAll('[data-note-locked-plot]') ?? []).some(plot => range.intersectsNode(plot))
  const selectedPlot = () => {
    const selection = body.current?.ownerDocument.getSelection()
    return !!selection?.rangeCount && touchesPlot(selection.getRangeAt(0))
  }
  const syncBody=(images:typeof value.images=[],immediate=false,kind='action')=>{
    const field=body.current
    if(!field || disabled || composing.current)return
    const before={markdown:shownMarkdown.current??current().markdown,position:beforePosition.current??lastPosition.current}
    promoteNoteFormulas(field)
    const markdown=readRichNote(field,originals.current)
    const position=bodyPosition(field)
    beforePosition.current=undefined
    lastPosition.current=position
    if (!sameNotePlots(before.markdown, markdown)) {
      renderBody(field, before.markdown)
      restoreBodyPosition(field, before.position)
      lastPosition.current = before.position
      setError(plotError)
      return
    }
    if(markdown===before.markdown && !images.length)return
    setError(previous => previous === plotError ? '' : previous)
    if(markdown!==before.markdown) {
      const stack=history.current
      stack.entries.splice(stack.cursor)
      const previous=stack.entries.at(-1)
      const at=performance.now()
      const after={markdown,position}
      const contiguous=previous?.after.position?.focus===before.position?.anchor
        && previous?.after.position?.anchor===before.position?.focus
      if(kind==='insertText' && previous?.kind===kind && contiguous && at-previous.at<650) {
        previous.after=after
        previous.at=at
      } else {
        stack.entries.push({before,after,kind,at})
        if(stack.entries.length>30)stack.entries.shift()
      }
      stack.cursor=stack.entries.length
    }
    shownMarkdown.current=markdown
    update({...current(),markdown,images},immediate)
  }

  const commitPlot = (id: string, at?: number) => {
    const field = body.current
    if (!field || !session || disabled || composing.current || formulaDraft || !session.finishInput()) return
    const before = { markdown: shownMarkdown.current ?? current().markdown, position: bodyPosition(field) ?? lastPosition.current }
    const markdown = changeNotePlot(before.markdown, id, at)
    if (markdown === undefined) return
    renderBody(field, markdown)
    field.focus({ preventScroll: true })
    restoreBodyPosition(field, before.position)
    lastPosition.current = bodyPosition(field)
    const stack = history.current
    stack.entries.splice(stack.cursor)
    stack.entries.push({ before, after: { markdown, position: lastPosition.current }, kind: 'plot', at: performance.now() })
    if (stack.entries.length > 30) stack.entries.shift()
    stack.cursor = stack.entries.length
    shownMarkdown.current = markdown
    update({ ...current(), markdown }, true)
    if (session.finishInput()) void session.save()
  }
  const dropTarget = (y: number) => {
    const field = body.current, drag = dragPlot.current
    if (!field || !drag || drag.markdown !== shownMarkdown.current) return
    const blocks = noteBlocks(drag.markdown).blocks
    const children = Array.from(field.children)
    if (children.length !== blocks.length || field.childNodes.length !== children.length) return
    const top = field.getBoundingClientRect().top
    let edge = top
    for (const [index, child] of children.entries()) {
      const rect = child.getBoundingClientRect()
      if (!rect.height) continue
      if (y < (rect.top + rect.bottom) / 2) return { at: blocks[index].start, y: rect.top - top }
      edge = rect.bottom
    }
    return { at: drag.markdown.length, y: edge - top }
  }
  const showPositionMenu = (node: Node | null, offset: number, x: number, y: number, pointer = false) => {
    const field = body.current
    const panel = field?.closest<HTMLElement>('.inspector')
    if (!field || !panel || disabled || !onPositionReference || composing.current || formulaDraft) return
    const markdown = shownMarkdown.current ?? current().markdown
    const gapIndex = !markdown.trim() ? 0 : noteGapAt(field, markdown, node, offset, pointer ? y : undefined)
    const bounds = field.getBoundingClientRect()
    const scale = bounds.height / field.offsetHeight || 1
    const gapY = gapIndex === undefined ? undefined : Math.max(0, Math.min(field.clientHeight, (y - bounds.top) / scale))
    const at = gapIndex === undefined && node ? sourcePointAt(field, projection.current, markdown, node, offset) : undefined
    const selected = field.ownerDocument.getSelection()
    const range = selected?.rangeCount ? selected.getRangeAt(0) : undefined
    const selection = onSelectionReference && node && field.contains(node) && range?.isPointInRange(node, offset)
      ? captureSelection(panel, selected) : undefined
    setPositionMenu({ at, gapIndex, gapY, x, y, markdown, panel, selection })
  }
  const addPositionReference = async () => {
    const picked = positionMenu
    body.current?.focus({ preventScroll: true })
    setPositionMenu(undefined)
    if (!session || !picked || disabled || !onPositionReference) return
    if (picked.at === undefined && picked.gapIndex === undefined) {
      setError('请在正文文字或块间空白重新选点。')
      return
    }
    const source = session.baseline
    const savedMarkdown = source.notes[nodeId] ?? ''
    const captured = picked.gapIndex === undefined
      ? await captureNoteAnchor(picked.markdown, source.map.id, nodeId, picked.at!)
      : await captureNoteGap(picked.markdown, source.map.id, nodeId, picked.gapIndex)
    let result = captured
    if (captured && picked.markdown !== savedMarkdown) {
      const location = await locateNoteAnchor(savedMarkdown, captured.anchor)
      result = location && (location.gapIndex === undefined
        ? await captureNoteAnchor(savedMarkdown, source.map.id, nodeId, location.inline)
        : await captureNoteGap(savedMarkdown, source.map.id, nodeId, location.gapIndex))
    }
    if (!live.current || !editableRef.current) return
    if (!result || session.baseline !== source || shownMarkdown.current !== picked.markdown) {
      setError('已保存的正文无法确认该位置，请完成保存后重新选点。')
      return
    }
    setError('')
    onPositionReference(result.anchor, result.text)
  }
  const moveHistory=(redo:boolean)=>{
    const field=body.current,stack=history.current
    if(!field||disabled||composing.current)return
    const action=stack.entries[redo?stack.cursor:stack.cursor-1]
    const destination=redo?action?.after:action?.before
    if(!destination) {
      // 非可取消的原生历史事件可能已改动 DOM，重新投影已知的正文。
      if(readRichNote(field,originals.current)!==shownMarkdown.current) {
        renderBody(field,shownMarkdown.current??current().markdown)
        restoreBodyPosition(field,lastPosition.current)
      }
      return
    }
    stack.cursor+=redo?1:-1
    renderBody(field,destination.markdown)
    restoreBodyPosition(field,destination.position)
    lastPosition.current=destination.position
    beforePosition.current=undefined
    shownMarkdown.current=destination.markdown
    update({...current(),markdown:destination.markdown},true)
  }
  const nativeInput = useRef<(event: InputEvent)=>void>()
  nativeInput.current=event=>{
    if (disabled) return
    if(event.inputType==='historyUndo'||event.inputType==='historyRedo') {
      if(event.cancelable) {
        event.preventDefault()
        moveHistory(event.inputType==='historyRedo')
      }
    } else {
      if (!composing.current) beforePosition.current=body.current?bodyPosition(body.current):undefined
      const field = body.current
      if (!field || !event.cancelable || !/^(delete|insert)/.test(event.inputType)) return
      if (!field.querySelector('[data-note-locked-plot]')) return
      const targets = event.getTargetRanges?.() ?? []
      const intersects = targets.some(target => {
        const range = field.ownerDocument.createRange()
        range.setStart(target.startContainer, target.startOffset)
        range.setEnd(target.endContainer, target.endOffset)
        return touchesPlot(range)
      })
      if (intersects || (!targets.length && selectedPlot())) {
        event.preventDefault()
        setError(plotError)
      }
    }
  }
  useEffect(()=>{
    const field=body.current
    const handler=(event:Event)=>nativeInput.current?.(event as InputEvent)
    field?.addEventListener('beforeinput',handler)
    return ()=>field?.removeEventListener('beforeinput',handler)
  },[])
  const placeCaret=(range?:Range)=>{
    const field=body.current
    if(!field)return
    field.focus({preventScroll:true})
    const next=range && field.contains(range.commonAncestorContainer)?range:document.createRange()
    if(next!==range){next.selectNodeContents(field);next.collapse(false)}
    const selection=window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(next)
    return next
  }
  const insertAtCaret=(node:Node)=>{
    const range=placeCaret(caret.current)
    if(!range)return false
    if (touchesPlot(range)) { setError(plotError); return false }
    // 图片 HTML 来自我们创建的 DOM，外部粘贴只接受纯文本。
    if(node instanceof HTMLElement && document.execCommand('insertHTML',false,node.outerHTML))return true
    range.deleteContents()
    range.insertNode(node)
    range.setStartAfter(node)
    range.collapse(true)
    caret.current=range.cloneRange()
    placeCaret(range)
    return true
  }
  const addImage=async(file?:File)=>{
    if(!file||!session||disabled||formulaDraft||composing.current)return
    setAdding(true)
    try{
      if(file.size>IMAGE_LIMIT)throw new Error('图片不能超过 8 MiB')
      if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请选择 PNG、JPEG 或 WebP')
      const bitmap=await createImageBitmap(file);bitmap.close()
      const bytes=new Uint8Array(await file.arrayBuffer());let binary=''
      for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192))
      const asset=await validateImage({schemaVersion:1,kind:'image',id:crypto.randomUUID(),mimeType:file.type,encoding:'base64',byteLength:bytes.length,sha256:await digest(bytes),data:btoa(binary)})
      if(!live.current||session.formulaDraft||composing.current||['conflict','recovery_required','readonly'].includes(session.status))return
      const path=session.notePath(nodeId)
      const href='../'.repeat(path.split('/').length-1)+`assets/${asset.id}.image.json`
      if (!insertAtCaret(noteImage(document,`![图片](${href})`,'图片',imageUrl(asset)))) return
      syncBody([asset],true)
      setError('')
    }catch(e){if(live.current)setError(e instanceof Error?e.message:String(e))}
    finally{if(live.current)setAdding(false)}
  }
  const removeImage=(button:HTMLElement)=>{
    const image=button.closest<HTMLElement>('[data-note-image]')
    if(!image || disabled || composing.current)return
    const range=document.createRange()
    range.selectNode(image)
    placeCaret(range)
    if (!document.execCommand('delete',false) || image.isConnected) image.remove()
    syncBody([],true)
    setError('')
  }
  const startComposition=()=>{
    composing.current=true
    if(body.current)beforePosition.current=bodyPosition(body.current)
    session?.composition(true)
  }
  const endComposition=(field:'title'|'summary',text:string)=>{composing.current=false;update({...current(),[field]:text})}
  const formulaToken = formulaDraft ? formulaFromRaw(formulaDraft.raw) : undefined
  const formulaStale = !!formulaDraft && value.markdown!==formulaDraft.markdown
  const openFormula=(element:HTMLElement)=>{
    if(!session || disabled || composing.current || formulaDraft || element.closest('[data-note-locked-plot]'))return
    if(session.hasPendingFormula){setError('已有一条公式草稿，请回到原节点处理。');return}
    const raw=element.dataset.noteFormula
    const parsed=raw?formulaFromRaw(raw):undefined
    if(!parsed || !body.current)return
    const occurrence=formulas().indexOf(element)
    if(occurrence<0)return
    const next={nodeId,viewId,occurrence,markdown:current().markdown,raw:parsed.raw,originalTex:parsed.tex,tex:parsed.tex}
    session.setFormulaDraft(next)
    setFormulaDraft(next)
  }
  useLayoutEffect(()=>{
    if(formulaDraft)formulaField.current?.focus({preventScroll:false})
  },[formulaDraft?.occurrence])
  const finishFormula=(action:'apply'|'delete'|'cancel')=>{
    if(!session||!formulaDraft||!body.current)return
    if(!formulaToken){if(action==='cancel')session.setFormulaDraft(undefined);return}
    const field=body.current
    const target=formulas()[formulaDraft.occurrence]
    const matching=!formulaStale && target?.dataset.noteFormula===formulaDraft.raw
    if(action!=='cancel' && (disabled || !matching))return
    if(matching && target) {
      const range=document.createRange()
      range.setStartBefore(target)
      range.collapse(true)
      placeCaret(range)
      beforePosition.current=bodyPosition(field)
      if(action==='delete')target.remove()
      if(action==='apply' && formulaDraft.tex!==formulaDraft.originalTex) {
        const close=({'$':'$','$$':'$$','\\(':'\\)','\\[':'\\]'})[formulaToken.delimiter]
        const bodyTex=formulaDraft.tex.trim()
        const multiline=formulaToken.type==='formulaBlock' && (bodyTex.includes('\n') || formulaToken.raw.includes('\n'))
        const raw=multiline?formulaToken.delimiter+'\n'+bodyTex+'\n'+close:formulaToken.delimiter+bodyTex+close
        const result=formulaFromRaw(raw)
        if(!result || mathMarkup(result.tex,result.type==='formulaBlock')===null) {
          setError('公式需遵循原有行内或独立格式，请修正后再应用。')
          formulaField.current?.focus()
          return
        }
        const replacement=formulaElement(document,result,true)
        target.replaceWith(replacement)
        range.setStartAfter(replacement)
        range.collapse(true)
        placeCaret(range)
      }
    }
    session.setFormulaDraft(undefined)
    setFormulaDraft(undefined)
    setError('')
    if(action!=='cancel')syncBody([],true)
    else beforePosition.current=undefined
  }

  return <section ref={root} className={disabled ? 'note-sheet note-readonly' : 'note-sheet'} aria-label="节点详情" onBlur={e=>{
    const next = e.relatedTarget
    if (editing && (!(next instanceof Node) || (!e.currentTarget.contains(next) && !positionMenuElement.current?.contains(next))))
      void session?.save()
  }}>
    {editing ? <><textarea className="note-inline-title" aria-label="节点标题" placeholder="节点标题" rows={1} value={value.title} readOnly={disabled}
      onChange={e=>update({...current(),title:e.target.value})} onCompositionStart={startComposition} onCompositionEnd={e=>endComposition('title',e.currentTarget.value)}
      onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.blur()}}}/>
    <textarea className="note-inline-summary" aria-label="节点摘要" placeholder={disabled?'':'添加一句摘要…'} rows={1} value={value.summary} readOnly={disabled}
      onChange={e=>update({...current(),summary:e.target.value})} onCompositionStart={startComposition} onCompositionEnd={e=>endComposition('summary',e.currentTarget.value)}/></> :
      <><h2 className="note-inline-title note-static-field">{value.title}</h2>
        <div className="note-inline-summary note-static-field">{value.summary}</div></>}
    <div className="note-prose"
      onDragOver={event => {
        if (disabled || !dragPlot.current) return
        event.preventDefault()
        const target = dropTarget(event.clientY)
        event.dataTransfer.dropEffect = target ? 'move' : 'none'
        setDrop(target)
      }}
      onDragLeave={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDrop(undefined)
      }}
      onDrop={event => {
        event.preventDefault()
        const drag = dragPlot.current
        const target = dropTarget(event.clientY)
        dragPlot.current = undefined
        setDrop(undefined)
        if (drag && target && body.current?.contains(event.target as Node)) commitPlot(drag.id, target.at)
      }}>
      <div ref={body} className="detail-body note-rich-body" role={editing ? 'textbox' : undefined} aria-label="正文" aria-multiline={editing || undefined}
        contentEditable={!disabled} aria-readonly={editing ? disabled : undefined} tabIndex={disabled ? undefined : 0} data-placeholder={disabled ? undefined : '写下内容…'}
        onInput={event=>{
          const kind=(event.nativeEvent as InputEvent).inputType
          if(kind==='historyUndo'||kind==='historyRedo')moveHistory(kind==='historyRedo')
          else syncBody([],false,kind)
        }}
        onCompositionStart={startComposition}
        onCompositionEnd={()=>{composing.current=false;session?.composition(false);syncBody([],true,'composition')}}
        onPaste={event=>{
          if(disabled)return
          event.preventDefault()
          const text=event.clipboardData.getData('text/plain')
          if(!text)return
          const selection=window.getSelection()
          if(selection?.rangeCount)caret.current=selection.getRangeAt(0).cloneRange()
          beforePosition.current=body.current?bodyPosition(body.current):undefined
          if (insertAtCaret(document.createTextNode(text.replaceAll('\r\n','\n').replaceAll('\r','\n'))))
            syncBody([],false,'paste')
        }}
        onCut={event => { if (!disabled && selectedPlot()) { event.preventDefault(); setError(plotError) } }}
        onDragStart={event => { if (!disabled && !dragPlot.current && selectedPlot()) event.preventDefault() }}
        onContextMenu={event => {
          if (disabled || !onPositionReference || (event.target as Element).closest('[data-note-locked-plot]')) return
          event.preventDefault()
          event.stopPropagation()
          const doc = event.currentTarget.ownerDocument
          const point = doc.caretPositionFromPoint?.(event.clientX, event.clientY)
          const fallback = point ? undefined : (doc as Document & {
            caretRangeFromPoint?: (x: number, y: number) => Range | null
          }).caretRangeFromPoint?.(event.clientX, event.clientY)
          showPositionMenu(point?.offsetNode ?? fallback?.startContainer ?? null,
            point?.offset ?? fallback?.startOffset ?? 0, event.clientX, event.clientY, true)
        }}
        onClick={event=>{
          if (disabled) return
          const clicked=event.target as Element
          if (clicked.closest('a[data-note-href]')) event.preventDefault()
          const formula=clicked.closest<HTMLElement>('[data-note-formula]')
          if(formula){openFormula(formula);return}
          const button=clicked.closest<HTMLElement>('button.note-image-remove')
          if(button)removeImage(button)
        }}
        onKeyDown={event=>{
          if(disabled || event.nativeEvent.isComposing || composing.current)return
          const key=event.key.toLowerCase()
          if (positionMenu && key === 'escape') {
            event.preventDefault(); event.stopPropagation(); setPositionMenu(undefined); return
          }
          if (onPositionReference && (key === 'contextmenu' || (event.shiftKey && key === 'f10'))) {
            event.preventDefault(); event.stopPropagation()
            const selected = event.currentTarget.ownerDocument.getSelection()
            const rect = selected?.rangeCount ? selected.getRangeAt(0).getBoundingClientRect() : event.currentTarget.getBoundingClientRect()
            showPositionMenu(selected?.focusNode ?? null, selected?.focusOffset ?? 0, rect.left, rect.bottom)
            return
          }
          const formula=(event.target as Element).closest<HTMLElement>('[data-note-formula]')
          if(formula&&(key==='enter'||key===' ')){
            event.preventDefault();event.stopPropagation();openFormula(formula);return
          }
          if((event.ctrlKey||event.metaKey)&&!event.altKey&&(key==='z'||key==='y')){
            event.preventDefault();event.stopPropagation();moveHistory(key==='y'||event.shiftKey);return
          }
          // 独立公式源码内部换行保持同一文本段，避免浏览器拆成多层 DIV。
          if(key==='enter'&&!event.shiftKey){
            const selected=window.getSelection()
            const node=selected?.anchorNode
            const text=node?.nodeType===Node.TEXT_NODE?node.textContent?.slice(0,selected?.anchorOffset):''
            if(text && /(?:^|\n) {0,3}(?:\$\$|\\\[)[ \t]*(?:\n[\s\S]*)?$/.test(text)){
              event.preventDefault()
              if(selected?.rangeCount)caret.current=selected.getRangeAt(0).cloneRange()
              beforePosition.current=bodyPosition(event.currentTarget)
              insertAtCaret(document.createTextNode('\n'))
              syncBody([],false,'insertLineBreak')
              return
            }
          }
          if(event.key==='Escape' && !event.nativeEvent.isComposing){
            event.stopPropagation()
            event.currentTarget.blur()
            void session?.save()
          }
        }}
      />
      {plots.map(({ element, token }, index) => createPortal(<>
        <NotePlot token={token} onReference={onPlotReference}/>
        {!disabled && token.data && <div className="note-plot-controls" data-plot-art>
          <button className="note-plot-drag" type="button" draggable aria-label="拖动图表" title="拖动图表"
            disabled={!!formulaDraft} onDragStart={event => {
              const id = token.data?.id
              if (!id || composing.current || !shownMarkdown.current) { event.preventDefault(); return }
              dragPlot.current = { id, markdown: shownMarkdown.current }
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('application/x-dsh-note-plot', id)
              event.dataTransfer.setDragImage(element, 16, 16)
            }}
            onDragEnd={() => { dragPlot.current = undefined; setDrop(undefined) }}>⠿</button>
          <button type="button" title="删除图表" aria-label="删除图表" disabled={!!formulaDraft}
            onClick={() => commitPlot(token.data!.id)}>×</button>
        </div>}
      </>, element, token.data?.id ?? 'invalid:' + index))}
      {drop && <div aria-hidden="true" className="note-plot-drop" style={{ top: (body.current?.offsetTop ?? 0) + drop.y }}/>}
      {positionMenu?.gapY !== undefined && <div aria-hidden="true" className="note-plot-drop"
        style={{ top: (body.current?.offsetTop ?? 0) + positionMenu.gapY }}/>}
    </div>
    {positionMenu && createPortal(<div ref={positionMenuElement} className="note-position-menu" role="menu" aria-label="正文操作"
      onMouseDown={event => event.preventDefault()}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPositionMenu(undefined) }}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          body.current?.focus({ preventScroll: true })
          setPositionMenu(undefined)
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          const items = Array.from(event.currentTarget.querySelectorAll('button'))
          const current = items.indexOf(event.target as HTMLButtonElement)
          event.preventDefault()
          event.stopPropagation()
          items[(current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus({ preventScroll: true })
        }
      }}>
      <button type="button" role="menuitem" onClick={() => { void addPositionReference() }}>
        {positionMenu.gapIndex === undefined ? '添加图表/公式' : '添加此位置到正文'}
      </button>
      {positionMenu.selection && <button type="button" role="menuitem" onClick={() => {
        const selection = positionMenu.selection
        body.current?.focus({ preventScroll: true })
        setPositionMenu(undefined)
        positionMenu.panel.ownerDocument.getSelection()?.removeAllRanges()
        if (selection) onSelectionReference?.(selection)
      }}>添加到正文</button>}
    </div>, positionMenu.panel)}
    {editing && formulaDraft&&<section className="note-formula-editor" role="group" aria-label="编辑公式" onKeyDown={event=>{
      if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.stopPropagation();finishFormula('cancel')}
    }}>
      <label>公式<textarea ref={formulaField} value={formulaDraft.tex} onChange={event=>{
        const next={...formulaDraft,tex:event.currentTarget.value}
        session?.setFormulaDraft(next)
        setFormulaDraft(next)
      }} rows={3}/></label>
      <FormulaPreview tex={formulaDraft.tex} display={formulaToken?.type==='formulaBlock'}/>
      {formulaStale&&<p role="status">正文已变化，可以复制公式草稿或取消。</p>}
      <div className="editor-actions">
        <button className="btn" disabled={disabled||formulaStale||mathMarkup(formulaDraft.tex,formulaToken?.type==='formulaBlock')===null}
          onClick={()=>finishFormula('apply')}>应用</button>
        <button className="btn" onClick={()=>finishFormula('cancel')}>取消</button>
        <button className="btn" disabled={disabled||formulaStale} onClick={()=>finishFormula('delete')}>删除公式</button>
      </div>
    </section>}
    {!disabled && <div className="note-inline-tools">
      <><input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={e=>{void addImage(e.target.files?.[0]);e.target.value=''}}/>
        <button className="note-tool" disabled={adding||!!formulaDraft} aria-label="插入图片" title="插入图片（PNG、JPEG、WebP）" onMouseDown={e=>e.preventDefault()} onClick={()=>fileInput.current?.click()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/></svg>
        </button>{adding&&<span className="note-edit-hint">正在加入图片…</span>}</>
    </div>}
    {editing && !value.title.trim()&&<p className="note-inline-error" role="alert">标题还没有填写</p>}
    {editing && error&&<p className="note-inline-error" role="alert">{error}</p>}
  </section>
}
