import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ReferenceInsert,
  TokenSpan,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MapListing, MapSnapshot, MapLayout } from '../shared/map-types.ts'
import { fillLayout, nodeHeight } from '../shared/layout.ts'
import type { Heights } from '../shared/layout.ts'
import type { HostAdapter } from './host-adapter.ts'
import type {
  createReadingStore,
  AtlasNavigation,
} from './register-sidebar.tsx'
import {
  initialReading,
  readingKey,
  reconcileReading,
} from './reading-state.ts'
import { SnapshotLoader } from './refresh-map.ts'
import {
  NavigationTransition,
  nodeDestination,
  viewPath,
  targetReading,
  recordReadingNavigation,
  historyReading,
} from './navigation.ts'
import type { HistoryDirection } from './navigation.ts'
import { measureNodes } from './measure-nodes.ts'
import { restoreFocus } from './focus-management.ts'
import { insertPending } from './insert-reference.ts'
import type { PendingInsertion } from './insert-reference.ts'
import type { ReferenceSnapshot } from './reference-source.ts'
import { referenceContentDigest } from './reference-source.ts'
import { resolveReference } from './reference-navigation.ts'
import type { SelectionSnapshot } from './selection.ts'
import { MapHeader } from './components/MapHeader.tsx'
import { MapViewport } from './components/MapViewport.tsx'
import { MapScene } from './components/MapScene.tsx'
import { NoteInspector } from './components/NoteInspector.tsx'
import { SearchOverlay } from './components/SearchOverlay.tsx'
import { NodeCard } from './components/NodeCard.tsx'
import { NodeMenu } from './components/NodeMenu.tsx'
import { MapLibrary } from './components/MapLibrary.tsx'
import { readableNote } from './copy-note.ts'
import { downloadHtml } from './export-html.ts'

export type AtlasPaneProps = PropsRuntime<'sidebar.right.pane.tab'> &
  PropsStore<ReturnType<typeof createReadingStore>> & {
    host: HostAdapter
    insertReference: (ref: ReferenceInsert, span: TokenSpan) => boolean
    insertText?: (text: string, span: TokenSpan) => boolean
  }
type AtlasPage = { kind: 'library' | 'trash' } | { kind: 'map'; id: string; workspaceKey?: string }
export function AtlasPane(props: AtlasPaneProps) {
  const { tab } = props.useTabInfo()
  const [page, setPage] = useState<AtlasPage>({ kind: 'library' })
  const pages = useRef<{ current: AtlasPage; back: AtlasPage[]; forward: AtlasPage[] }>({ current: page, back: [], forward: [] })
  const selected = page.kind === 'map' ? page.id : undefined
  const restoreReading = useRef(false)
  const [listing, setListing] = useState<MapListing>({ maps: [], diagnostics: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const lifetime = useRef(new AbortController())
  const listingRevision = useRef(0)
  const refreshing = useRef<Promise<void>>()
  const reloadNeeded = useRef(false)
  const catalogReady = useRef(false)
  const catalog = useRef(listing)
  catalog.current = listing
  const refresh = useCallback((changed = false): Promise<void> => {
    if (refreshing.current) { if (changed) reloadNeeded.current = true; return refreshing.current }
    const signal = lifetime.current.signal
    const run = async () => {
      do {
        reloadNeeded.current = false
        const revision = ++listingRevision.current
        if (!catalogReady.current) setLoading(true)
        setError('')
        try {
          const list = await props.host.list(signal)
          if (!signal.aborted && revision === listingRevision.current) { catalogReady.current = true; setListing(list) }
        } catch (e) { if (!signal.aborted && revision === listingRevision.current) setError(String(e)) }
        finally { if (!signal.aborted && revision === listingRevision.current) setLoading(false) }
      } while (reloadNeeded.current && !signal.aborted)
    }
    const pending = run().finally(() => { if (refreshing.current === pending) refreshing.current = undefined })
    refreshing.current = pending
    return pending
  }, [props.host])
  useEffect(() => {
    lifetime.current = new AbortController()
    refreshing.current = undefined
    reloadNeeded.current = false
    catalogReady.current = false
    setListing({ maps: [], diagnostics: [] })
    setLoading(true)
    return () => lifetime.current.abort()
  }, [refresh])
  const libraryDependencies = [...listing.maps.map(map => map.id), ...listing.diagnostics.map(d => d.path)].sort().join('\n')
  useEffect(() => {
    if (selected || !tab.visible) return
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    const stop = props.host.watchLibrary?.(catalog.current, (changed = true) => { void refresh(changed) }, lifetime.current.signal)
    return () => { window.removeEventListener('focus', onFocus); stop?.() }
  }, [props.host, refresh, selected, tab.visible, libraryDependencies])
  useEffect(() => { if (!selected && tab.visible) void refresh() }, [selected, tab.visible, refresh])
  const showPage = (next: AtlasPage, restore = false) => {
    restoreReading.current = restore
    pages.current.current = next
    if (next.kind === 'map') props.actions.selectMap(next.id)
    setPage(next)
  }
  const visitPage = (next: AtlasPage) => {
    const current = pages.current.current
    if (current.kind !== next.kind || (current.kind === 'map' && next.kind === 'map' && current.id !== next.id)) {
      pages.current.back.push(current)
      pages.current.forward = []
    }
    showPage(next)
  }
  const open = (id: string) => visitPage({ kind: 'map', id, workspaceKey: listing.library?.workspaceKey })
  const traversePages = (direction: HistoryDirection, workspaceKey?: string) => {
    if (!tab.visible) return
    const history = pages.current
    if (history.current.kind === 'map' && workspaceKey) history.current = { ...history.current, workspaceKey }
    const available = history[direction].filter(target => target.kind !== 'map' || !listing.library || (
      !!target.workspaceKey && target.workspaceKey === listing.library?.workspaceKey &&
      listing.maps.some(map => map.id === target.id && !listing.library?.data.deletedMapIds?.includes(map.id) &&
        !listing.library?.data.purgedMapIds?.includes(map.id))
    ))
    const target = available.pop()
    // 目录尚未就绪时保留地图历史，等待可确认工作区和身份后再恢复。
    if (target?.kind === 'map' && !listing.library) return
    history[direction] = available
    if (!target) return
    history[direction === 'back' ? 'forward' : 'back'].push(history.current)
    showPage(target, true)
  }
  const libraryWorkspace = useRef<string>()
  useEffect(() => {
    const workspaceKey = listing.library?.workspaceKey
    if (!workspaceKey) return
    if (libraryWorkspace.current && libraryWorkspace.current !== workspaceKey) {
      pages.current.back = []
      pages.current.forward = []
    }
    libraryWorkspace.current = workspaceKey
  }, [listing.library?.workspaceKey])
  useEffect(() => {
    const params = tab.navigation.params as AtlasNavigation | undefined
    if (params?.mapId) open(params.mapId)
    else visitPage({ kind: 'library' })
  }, [tab.navigation.revision])
  if (selected) return <ReadingPane {...props} restoreReading={restoreReading.current} onMap={open} onPageHistory={traversePages} onViewNavigation={() => { pages.current.forward = [] }} onLibrary={workspaceKey => {
    if (pages.current.current.kind === 'map' && workspaceKey) pages.current.current = { ...pages.current.current, workspaceKey }
    if (pages.current.back.at(-1)?.kind === 'library') traversePages('back')
    else visitPage({ kind: 'library' })
  }} />
  return <div className="dsh-atlas-shell" onMouseDownCapture={e => {
    if (e.button === 3 || e.button === 4) { e.preventDefault(); e.stopPropagation() }
  }} onMouseUpCapture={e => {
    if (e.button !== 3 && e.button !== 4) return
    e.preventDefault(); e.stopPropagation()
    traversePages(e.button === 3 ? 'back' : 'forward')
  }} onAuxClickCapture={e => { if (e.button === 3 || e.button === 4) { e.preventDefault(); e.stopPropagation() } }}><MapLibrary listing={listing} loading={loading} error={error}
    refresh={() => { void refresh() }} open={open} trash={page.kind === 'trash'} setTrash={trash => visitPage({ kind: trash ? 'trash' : 'library' })}
    purge={async ids => {
      if (!listing.library) throw new Error('目录尚未就绪，请重新载入后重试')
      let result
      try { result = await props.host.purge(ids, listing.library, lifetime.current.signal) }
      catch (e) { await refresh(); throw e }
      listingRevision.current++
      setLoading(false)
      setListing(old => ({ ...old, maps: old.maps.filter(map => !result.deletedIds.includes(map.id)), library: result.library }))
      if (result.failures.length) throw new Error(`已删除 ${result.deletedIds.length} 项；其余保留在回收站，可重试：\n${result.failures.map(f => `${listing.maps.find(m => m.id === f.id)?.title ?? f.id}：${f.message}`).join('\n')}`)
    }}
    rename={async (id, title, previousTitle) => {
      if (!listing.library) throw new Error('目录尚未就绪，请刷新后重试')
      await props.host.rename(id, title, previousTitle, listing.library.workspaceKey, lifetime.current.signal)
      await refresh()
    }}
    save={async data => {
      if (!listing.library) throw new Error('目录尚未就绪，请刷新后重试')
      const library = await props.host.saveLibrary(data, listing.library, lifetime.current.signal)
      listingRevision.current++
      setLoading(false)
      setListing(old => ({ ...old, library }))
    }} /></div>
}
type LayoutDraft = { layout: MapLayout; base: MapSnapshot; revision: number }
// 会话内保留，覆盖切图、目录、页签卸载和未完成保存；不写入内容或分享。
const retainedLayouts = new Map<string, LayoutDraft>()
const layoutDraftKey = (session: string, workspace: string, map: string) => JSON.stringify([session, workspace, map])
export function ReadingPane(props: AtlasPaneProps & {
  onLibrary: (workspaceKey?: string) => void
  onMap?: (id: string) => void
  onPageHistory?: (direction: HistoryDirection, workspaceKey: string) => void
  onViewNavigation?: () => void
  offline?: boolean
  restoreReading?: boolean
}) {
  const {
    host,
    sessionId,
    actions,
    useStore,
    useTabInfo,
    inputActions,
    insertReference,
  } = props
  const { tab } = useTabInfo()
  const stored = useStore((s) => s)
  const mapId = stored.selectedMapId
  const [listing, setListing] = useState<MapListing>({
    maps: [],
    diagnostics: [],
  })
  const [snapshot, setSnapshot] = useState<MapSnapshot>()
  const [draft, setDraft] = useState<LayoutDraft>()
  const draftRef = useRef(draft)
  const layoutRef = useRef<MapLayout>()
  const saving = useRef(false)
  const [isSaving,setIsSaving] = useState(false)
  const [nodeDragging,setNodeDragging] = useState(false)
  const saveAgain = useRef(false)
  const [error, setError] = useState('')
  const [watchError, setWatchError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [noticeFading, setNoticeFading] = useState(false)
  const [noticeRevision, setNoticeRevision] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [inspectorWidth, setInspectorWidth] = useState(320)
  const [phase, setPhase] = useState<'idle' | 'out' | 'in'>('idle')
  const [heights, setHeights] = useState<Heights>({})
  const [measured, setMeasured] = useState('')
  const [reference, setReference] = useState<ReferenceSnapshot>()
  const [exitMotion, setExitMotion] = useState<{
    ratio: number
    x: number
    y: number
  }>()
  const [nodeMenu, setNodeMenu] = useState<{
    id: string
    x: number
    y: number
  }>()
  const root = useRef<HTMLDivElement>(null)
  const measurements = useRef<HTMLDivElement>(null)
  const focus = useRef<HTMLElement | null>(null)
  const lifetime = useRef(new AbortController())
  const loader = useRef(new SnapshotLoader())
  const navigation = useRef(new NavigationTransition())
  const navigationBusy = useRef(false)
  const updatePhase = (next: 'idle' | 'out' | 'in') => {
    navigationBusy.current = next !== 'idle'
    setPhase(next)
  }
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const saveRef = useRef<() => Promise<void>>(async () => {})
  const saveAttempt = useRef('')
  const processedReference = useRef('')
  const skipInitialReference = useRef(props.restoreReading)
  const navigationIntent = useRef<{
    key: string
    nodeId?: string
    historyDirection?: HistoryDirection
  }>()
  const key = snapshot ? readingKey(snapshot.workspaceKey, snapshot.map.id) : ''
  const pending = stored.pending[key]
  const reading = snapshot
    ? ((stored.maps[key]?.sessionId === sessionId ? stored.maps[key] : undefined) ??
      initialReading(snapshot.workspaceKey, sessionId, snapshot.map))
    : undefined
  const latest = useRef({
    snapshot,
    reading,
    mapId,
    reference,
    visible: tab.visible,
  })
  latest.current = { snapshot, reading, mapId, reference, visible: tab.visible }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if ([...retainedLayouts.keys()].some(k => JSON.parse(k)[0] === sessionId)) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [sessionId])
  const notify = useCallback((text: string) => { setNotice(text); setNoticeRevision(value => value + 1) }, [])
  useEffect(() => {
    setNoticeFading(false)
    if (!notice) return
    const fade = setTimeout(() => setNoticeFading(true), 3000)
    const close = setTimeout(() => setNotice(''), 3240)
    return () => { clearTimeout(fade); clearTimeout(close) }
  }, [notice, noticeRevision])
  useEffect(() => {
    lifetime.current = new AbortController()
    navigation.current = new NavigationTransition()
    return () => {
      lifetime.current.abort()
      loader.current.cancel()
      navigation.current.dispose()
    }
  }, [])
  useEffect(() => {
    const signal = lifetime.current.signal
    void host
      .list(signal)
      .then((list) => {
        if (signal.aborted) return
        setListing(list)
        if (!latest.current.mapId && list.maps[0])
          actions.selectMap(list.maps[0].id)
        else if (!list.maps.length) setLoading(false)
      })
      .catch((e) => {
        if (!signal.aborted) {
          setError(String(e))
          setLoading(false)
        }
      })
  }, [host])
  useEffect(() => {
    if (skipInitialReference.current) { skipInitialReference.current = false; return }
    const params = tab.navigation.params as AtlasNavigation | undefined
    if (params?.mapId) actions.selectMap(params.mapId)
    setReference(params?.reference)
    processedReference.current = ''
  }, [tab.navigation.revision])
  const load = useCallback(async () => {
    const currentId = latest.current.mapId
    if (!currentId || lifetime.current.signal.aborted) return
    setLoading(true)
    const result = await loader.current.load((signal) =>
      host.read(
        currentId,
        signal,
        latest.current.reference?.workspaceKey ??
          latest.current.snapshot?.workspaceKey,
      ),
    )
    if (
      !result ||
      latest.current.mapId !== currentId ||
      lifetime.current.signal.aborted
    )
      return
    if (result.snapshot) {
      if (
        latest.current.reference &&
        result.snapshot.workspaceKey !== latest.current.reference.workspaceKey
      ) {
        setError('来源工作区已变化，引用原文已保留。')
        setLoading(false)
        return
      }
      const retained = retainedLayouts.get(layoutDraftKey(sessionId, result.snapshot.workspaceKey, currentId))
      if (retained) {
        draftRef.current = retained
        setDraft(retained)
        setSaveError('')
      }
      setSnapshot((old) =>
        old?.fingerprint === result.snapshot!.fingerprint &&
        old.workspaceKey === result.snapshot!.workspaceKey
          ? old
          : result.snapshot,
      )
      const currentKey = readingKey(result.snapshot.workspaceKey, currentId)
      const state = latest.current.reading
      if (state && state.mapId === currentId && state.workspaceKey === result.snapshot.workspaceKey) {
        const reconciled = reconcileReading(state, result.snapshot.map)
        actions.setReading(currentKey, reconciled.state)
        latest.current.reading = reconciled.state
        if (reconciled.notice) setNotice(reconciled.notice)
      }
    }
    setError(result.error ?? '')
    setLoading(false)
  }, [host, actions])
  refreshRef.current = load
  useEffect(() => {
    loader.current.cancel()
    loader.current.snapshot = undefined
    setSnapshot(undefined)
    draftRef.current = undefined
    setDraft(undefined)
    setError('')
    setWatchError('')
    setSaveError('')
    setHeights({})
    setMeasured('')
    saveAttempt.current = ''
    setSearchOpen(false)
    setNodeMenu(undefined)
    updatePhase('idle')
    navigationIntent.current = undefined
    navigation.current.dispose()
    navigation.current = new NavigationTransition()
    if (mapId) void load()
    return () => loader.current.cancel()
  }, [mapId, host])
  const dependencies = snapshot
    ? snapshot.files.map((f) => f.path).join('\n')
    : ''
  useEffect(() => {
    if (!snapshot) return
    setWatchError('')
    return host.watch(
      snapshot,
      () => {
        void refreshRef.current()
      },
      setWatchError,
      lifetime.current.signal,
    )
  }, [snapshot?.map.id, snapshot?.workspaceKey, dependencies, host])
  useLayoutEffect(() => {
    const container = measurements.current
    if (!snapshot || !container) return
    const measure = () => {
      const next = measureNodes(container)
      setHeights((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      )
      setMeasured(snapshot.fingerprint)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    let alive = true
    void document.fonts?.ready.then(() => {
      if (alive) measure()
    })
    return () => {
      alive = false
      observer.disconnect()
    }
  }, [snapshot?.fingerprint])
  const layout = useMemo(
    () =>
      draft?.layout ?? (snapshot ? fillLayout(snapshot.map, snapshot.layout, heights) : undefined),
    [snapshot, heights, draft],
  )
  layoutRef.current = layout
  const moveNode = (id: string, x: number, y: number) => {
    if (!snapshot || !reading || !layoutRef.current) return
    const previous = draftRef.current
    const next = { base: previous?.base ?? snapshot, revision: (previous?.revision ?? 0) + 1,
      layout: { ...layoutRef.current, views: layoutRef.current.views.map(v => v.viewId !== reading.viewId ? v : {
        ...v, nodes: v.nodes.map(n => n.nodeId === id ? { ...n, x, y, manual: true } : n),
      }) } }
    retainedLayouts.set(layoutDraftKey(sessionId, next.base.workspaceKey, next.base.map.id), next)
    draftRef.current = next
    layoutRef.current = next.layout
    // 拖动期间仅更新工作副本引用，不重绘阅读页；画布负责实时预览。
  }
  const saveLayoutNow = async () => {
    if (saving.current) { saveAgain.current = true; return }
    const edit = draftRef.current
    const current = edit?.base ?? latest.current.snapshot
    const candidate = edit?.layout ?? layoutRef.current
    if (!current || !candidate) return
    saving.current = true
    setIsSaving(true)
    try {
      const saved = await host.saveLayout(current, candidate, lifetime.current.signal, !!edit)
      const retainedKey = layoutDraftKey(sessionId, current.workspaceKey, current.map.id)
      const retained = retainedLayouts.get(retainedKey)
      if (edit && retained?.revision === edit.revision) retainedLayouts.delete(retainedKey)
      else if (retained) retainedLayouts.set(retainedKey, { ...retained, base: saved })
      if (
        latest.current.mapId === current.map.id &&
        !lifetime.current.signal.aborted
      ) {
        setSaveError('')
        setSnapshot(saved)
        if (edit && draftRef.current?.revision === edit.revision) {
          draftRef.current = undefined
          setDraft(undefined)
        } else if (draftRef.current) {
          const next = { ...draftRef.current, base: saved }
          retainedLayouts.set(retainedKey, next)
          draftRef.current = next
          setDraft(next)
        }
      }
    } catch (e) {
      if (
        latest.current.mapId === current.map.id &&
        !lifetime.current.signal.aborted
      )
        setSaveError(
          `布局尚未保存，当前内存位置仍可阅读：${e instanceof Error ? e.message : String(e)}`,
        )
    } finally {
      saving.current = false
      if (!lifetime.current.signal.aborted) setIsSaving(false)
      if (saveAgain.current && !lifetime.current.signal.aborted) {
        saveAgain.current = false
        void saveRef.current()
      }
    }
  }
  saveRef.current = saveLayoutNow
  const discardLayout = () => {
    if (saving.current) return
    const edit = draftRef.current
    if (edit) retainedLayouts.delete(layoutDraftKey(sessionId, edit.base.workspaceKey, edit.base.map.id))
    draftRef.current = undefined
    setDraft(undefined)
    setSaveError('')
    saveAttempt.current = ''
    void load()
  }
  useEffect(() => {
    if (
      !snapshot ||
      draft ||
      !layout ||
      measured !== snapshot.fingerprint ||
      JSON.stringify(layout) === JSON.stringify(snapshot.layout)
    )
      return
    const attempt = `${snapshot.fingerprint}\n${JSON.stringify(layout)}`
    if (saveAttempt.current === attempt) return
    saveAttempt.current = attempt
    void saveRef.current()
  }, [snapshot, layout, measured, draft])
  const navigate = (viewId: string, nodeId?: string, historyDirection?: HistoryDirection) => {
    const current = latest.current
    if (
      navigationBusy.current || !current.visible ||
      !current.snapshot ||
      !current.reading || current.mapId !== current.snapshot.map.id ||
      !current.snapshot.map.views.some((v) => v.id === viewId)
    )
      return
    setSearchOpen(false)
    setNodeMenu(undefined)
    navigationIntent.current = {
      key: readingKey(current.snapshot.workspaceKey, current.snapshot.map.id),
      nodeId,
      historyDirection,
    }
    const viewport = root.current
      ?.querySelector('.content-area')
      ?.getBoundingClientRect() ?? { width: 360, height: 500 }
    const commit = (id: string) => {
      const active = latest.current
      const intent = navigationIntent.current
      if (!active.visible || !active.snapshot || !active.reading || !intent ||
        active.mapId !== active.snapshot.map.id ||
        readingKey(active.snapshot.workspaceKey, active.snapshot.map.id) !== intent.key ||
        !active.snapshot.map.views.some(view => view.id === id)) return
      const next = intent.historyDirection
        ? historyReading(active.reading, active.snapshot.map, intent.historyDirection)
        : recordReadingNavigation(active.reading, targetReading(
          active.reading, id, intent.nodeId, layout, heights, viewport,
        ))
      if (!next) return
      if (!intent.historyDirection && next.viewId !== active.reading.viewId) props.onViewNavigation?.()
      if (intent.historyDirection) setReference(undefined)
      latest.current.reading = next
      actions.setReading(intent.key, next)
    }
    if (current.reading.viewId === viewId && phase === 'idle') {
      commit(viewId)
      return
    }
    const sourceLayout = layout?.views.find(
      (v) => v.viewId === current.reading!.viewId,
    )
    const first = sourceLayout?.nodes[0]
    const camera = current.reading.cameras[current.reading.viewId] ?? {
      x: 24 - (first?.x ?? 0),
      y: 60 - (first?.y ?? 0),
      zoom: 1,
    }
    const source = sourceLayout?.nodes.find(
      (n) =>
        n.nodeId ===
        current.snapshot!.map.views.find((v) => v.id === viewId)?.centerNodeId,
    )
    const area = root.current
      ?.querySelector('.content-area')
      ?.getBoundingClientRect()
    setExitMotion({
      ratio: viewPath(current.snapshot.map, current.reading.viewId).includes(
        viewId,
      )
        ? 0.99
        : 1.026,
      x: source
        ? camera.x + (source.x + source.width / 2) * camera.zoom
        : (area?.width ?? 360) / 2,
      y: source
        ? camera.y +
          (source.y +
            nodeHeight(heights, current.reading.viewId, source.nodeId) / 2) *
            camera.zoom
        : (area?.height ?? 500) / 2,
    })
    navigation.current.navigate(
      viewId,
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      updatePhase,
      commit,
    )
  }
  const traverseHistory = (direction: HistoryDirection) => {
    const current = latest.current
    if (!current.visible || !current.snapshot || !current.reading) return
    // 动画完成前忽略重复侧键。
    if (navigationBusy.current) return
    const target = historyReading(current.reading, current.snapshot.map, direction)
    if (target) navigate(target.viewId, target.selectedNodeId, direction)
    else if (!props.offline) {
      setReference(undefined)
      if (props.onPageHistory) props.onPageHistory(direction, current.snapshot.workspaceKey)
      else if (direction === 'back') props.onLibrary(current.snapshot.workspaceKey)
    }
  }
  useEffect(() => {
    if (!reference || !snapshot || snapshot.map.id !== reference.mapId) return
    const token = `${tab.navigation.revision}:${JSON.stringify(reference)}`
    if (processedReference.current === token) return
    processedReference.current = token
    const target = resolveReference(reference, snapshot)
    if (target.nodeId && target.viewId) navigate(target.viewId, target.nodeId)
    if (target.message) setNotice(target.message)
  }, [snapshot, reference, tab.navigation.revision])
  const openNote = (id: string) => {
    const reading = latest.current.reading
    if (!reading || navigationBusy.current) return
    if (!(document.activeElement as HTMLElement | null)?.closest('.node-menu'))
      focus.current = document.activeElement as HTMLElement
    const next = {
      ...reading,
      selectedNodeId: id,
      detailScroll: id === reading.selectedNodeId ? reading.detailScroll : 0,
      focusSource: id,
    }
    latest.current.reading = next
    actions.setReading(key, next)
  }
  const closeNote = () => {
    const reading = latest.current.reading
    if (navigationBusy.current) return
    if (reading) {
      const next = { ...reading, selectedNodeId: undefined }
      latest.current.reading = next
      actions.setReading(key, next)
      restoreFocus(
        (focus.current?.isConnected ? focus.current : undefined) ??
          root.current?.querySelector<HTMLElement>(
            `[data-node="${reading.focusSource}"]`,
          ) ??
          null,
        root.current,
      )
    }
  }
  const openSearch = () => {
    focus.current = document.activeElement as HTMLElement
    setSearchOpen(true)
  }
  const chooseMap = (id: string) => {
    setReference(undefined)
    if (props.onMap) props.onMap(id)
    else actions.selectMap(id)
  }
  const closeSearch = () => {
    setSearchOpen(false)
    restoreFocus(focus.current, root.current)
  }
  const insert = (selected: SelectionSnapshot, nodeId = reading?.selectedNodeId, kind: 'node' | 'selection' = 'selection') => {
    if (!snapshot || !nodeId || !reading) return
    const node = snapshot.map.nodes.find(
      (n) => n.id === nodeId,
    )!
    const snapshotRef: ReferenceSnapshot = {
      version: 1,
      kind,
      ...selected,
      mapId: snapshot.map.id,
      nodeId: node.id,
      originViewId: reading.viewId,
      fingerprint: snapshot.fingerprint,
      noteDigest: referenceContentDigest(snapshot, node),
      mapTitle: snapshot.map.title,
      nodeTitle: node.title,
      sessionId,
      workspaceKey: snapshot.workspaceKey,
      resourceAddress: fileAddressFor(
        sessionId,
        undefined,
        `dsh-knowledge-maps/${snapshot.map.id}/map.json`,
      ),
    }
    const next: PendingInsertion = {
      snapshot: snapshotRef,
      sessionId,
      span: inputActions.captureInsertion(),
    }
    const outcome = insertPending(next, {
      sessionId,
      alive: !lifetime.current.signal.aborted && tab.visible,
      insert: insertReference,
    })
    actions.setPending(key, outcome.pending)
    notify(outcome.message)
  }
  const retry = () => {
    if (!pending) return
    const outcome = insertPending(
      { ...pending, span: inputActions.captureInsertion() },
      {
        sessionId,
        alive: !lifetime.current.signal.aborted && tab.visible,
        insert: insertReference,
      },
    )
    actions.setPending(key, outcome.pending)
    notify(outcome.message)
  }
  const view =
    snapshot?.map.views.find((v) => v.id === reading?.viewId) ??
    snapshot?.map.views.find((v) => v.id === snapshot.map.rootViewId)
  const viewLayout = layout?.views.find((v) => v.viewId === view?.id)
  const node = snapshot?.map.nodes.find((n) => n.id === reading?.selectedNodeId)
  const menuNode = snapshot?.map.nodes.find((n) => n.id === nodeMenu?.id)
  const closeNodeMenu = () => {
    setNodeMenu(undefined)
    restoreFocus(focus.current, root.current)
  }
  return (
    <div className="dsh-atlas-shell">
    <div
      ref={root}
      className="dsh-atlas reading-pane"
      tabIndex={-1}
      onMouseDownCapture={(e) => {
        if (e.button !== 3 && e.button !== 4) return
        e.preventDefault()
        e.stopPropagation()
      }}
      onMouseUpCapture={(e) => {
        if (e.button !== 3 && e.button !== 4) return
        e.preventDefault()
        e.stopPropagation()
        traverseHistory(e.button === 3 ? 'back' : 'forward')
      }}
      onAuxClickCapture={(e) => {
        if (e.button !== 3 && e.button !== 4) return
        e.preventDefault()
        e.stopPropagation()
      }}
      onPointerUpCapture={(e) => {
        if (e.button === 3 || e.button === 4) e.stopPropagation()
      }}
      onPointerDownCapture={(e) => {
        if (e.button === 3 || e.button === 4) { e.stopPropagation(); return }
        if (nodeMenu && !(e.target as HTMLElement).closest('.node-menu'))
          setNodeMenu(undefined)
      }}
      onKeyDown={(e) => {
        if (
          (e.ctrlKey || e.metaKey) &&
          ['f', 'k'].includes(e.key.toLowerCase()) &&
          snapshot
        ) {
          e.preventDefault()
          e.stopPropagation()
          openSearch()
        }
        if (e.key === 'Escape') {
          if (searchOpen) {
            e.preventDefault()
            e.stopPropagation()
            closeSearch()
          } else if (nodeMenu) {
            e.preventDefault()
            e.stopPropagation()
            closeNodeMenu()
          } else if (node) {
            e.preventDefault()
            e.stopPropagation()
            closeNote()
          }
        }
      }}
    >
      {snapshot && view && reading ? (
        <MapHeader
          map={snapshot.map}
          library={() => props.onLibrary(snapshot?.workspaceKey)}
          offline={props.offline}
          saveStatus={props.offline ? undefined : {
            state: isSaving ? 'saving' : saveError ? 'error' : nodeDragging || draft || (layout && JSON.stringify(layout) !== JSON.stringify(snapshot.layout)) ? 'unsaved' : 'saved',
            detail: isSaving ? undefined : saveError || undefined,
            save: () => { void saveRef.current() },
            discard: discardLayout,
            canDiscard: !!draft || !!saveError,
          }}
          exportMap={props.offline ? undefined : () => {
            if (layout) { downloadHtml(snapshot, layout, reading.viewId); notify('已导出可离线阅读的 HTML。') }
          }}
          view={view}
          maps={listing.maps.filter(m => !listing.library?.data.deletedMapIds?.includes(m.id))}
          selectMap={chooseMap}
          navigate={navigate}
          search={openSearch}
          refresh={() => {
            void load()
            void host
              .list(lifetime.current.signal)
              .then(setListing)
              .catch((e) => setError(String(e)))
          }}
        />
      ) : (
        <header className="map-header">
          <div className="head-top">
            <h1>思维导图</h1>
            <button className="btn" onClick={() => props.onLibrary(snapshot?.workspaceKey)}>← 全部导图</button>
            <button
              className="btn"
              onClick={() => {
                setError('')
                setLoading(true)
                void host
                  .list(lifetime.current.signal)
                  .then((value) => {
                    setListing(value)
                    setLoading(false)
                    if (value.maps[0]) actions.selectMap(value.maps[0].id)
                  })
                  .catch((e) => {
                    setError(String(e))
                    setLoading(false)
                  })
                if (mapId) void load()
              }}
            >
              刷新
            </button>
            <button
              className="btn"
              aria-label="关闭地图页签"
              onClick={tab.actions.close}
            >
              ×
            </button>
          </div>
          {listing.maps.length > 0 && (
            <select
              aria-label="选择地图"
              value={mapId ?? ''}
              onChange={(e) => chooseMap(e.target.value)}
            >
              {!mapId && <option value="">选择地图</option>}
              {listing.maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          )}
        </header>
      )}
      {(error || watchError) && (
        <div className="status-region" role="status">
          {error && (
            <p>
              {snapshot
                ? '外部更新无效，正在阅读最近有效版本。'
                : '地图读取失败。'}{' '}
              {error}
            </p>
          )}
          {watchError && <p>{watchError}</p>}
          <button className="btn" onClick={() => { void load() }}>重新读取</button>
        </div>
      )}
      <div className="content-area">
        {snapshot && view && viewLayout && reading ? (
          <MapViewport
            key={view.id}
            centerNodeId={view.centerNodeId}
            camera={reading.cameras[view.id]}
            onCamera={(camera) => {
              const current = latest.current.reading
              if (!current || current.viewId !== view.id) return
              latest.current.reading = { ...current, cameras: { ...current.cameras, [view.id]: camera } }
              actions.setCamera(key, current, view.id, camera)
            }}
            layout={viewLayout}
            heights={heights}
            phase={phase}
            exitMotion={exitMotion}
          >
            <MapScene
              map={snapshot.map}
              view={view}
              layout={viewLayout}
              heights={heights}
              selected={reading.selectedNodeId}
              locked={phase !== 'idle'}
              onMove={moveNode}
              onCommit={() => { setDraft(draftRef.current); void saveRef.current() }}
              onDragStart={() => { setNodeDragging(true); setNodeMenu(undefined); setSearchOpen(false) }}
              onDragEnd={() => { setNodeDragging(false); setDraft(draftRef.current) }}
              onMenu={(id, x, y) => {
                const bounds = root.current
                  ?.querySelector('.content-area')
                  ?.getBoundingClientRect()
                focus.current =
                  root.current?.querySelector<HTMLElement>(
                    `[data-node="${id}"]`,
                  ) ?? null
                setNodeMenu({
                  id,
                  x: Math.max(
                    8,
                    Math.min(
                      x - (bounds?.left ?? 0),
                      (bounds?.width ?? 360) - 188,
                    ),
                  ),
                  y: Math.max(
                    8,
                    Math.min(
                      y - (bounds?.top ?? 0),
                      (bounds?.height ?? 500) - 148,
                    ),
                  ),
                })
              }}
              onNote={openNote}
              onOpen={(id) => {
                const n = snapshot.map.nodes.find((n) => n.id === id)!
                const dest = nodeDestination(n, view.id)
                focus.current =
                  root.current?.querySelector<HTMLElement>(
                    `[data-node="${id}"]`,
                  ) ?? null
                if (dest) navigate(dest)
                else openNote(id)
              }}
            />
          </MapViewport>
        ) : (
          <div className="empty-state" aria-live="polite">
            {loading ? (
              '正在读取地图…'
            ) : error ? (
              '修正文件或权限后重试。'
            ) : (
              <>
                工作区暂无有效思维导图。
                <br />将 map.json 与 Markdown 笔记放入
                dsh-knowledge-maps/&lt;mapId&gt;/ 后刷新。
              </>
            )}
            {listing.diagnostics.length > 0 && (
              <details>
                <summary>未载入的目录（{listing.diagnostics.length}）</summary>
                {listing.diagnostics.map((d) => (
                  <p key={d.path}>
                    {d.path}：{d.message}
                  </p>
                ))}
              </details>
            )}
          </div>
        )}
        {snapshot && node && reading && !searchOpen && (
          <NoteInspector
            key={`${view?.id}/${node.id}`}
            snapshot={snapshot}
            node={node}
            width={inspectorWidth}
            onWidth={setInspectorWidth}
            scroll={reading.detailScroll}
            onScroll={(top) => {
              const current = latest.current.reading
              if (current?.viewId === view?.id && current?.selectedNodeId === node.id && current.detailScroll !== top) {
                const next = { ...current, detailScroll: top }
                latest.current.reading = next
                actions.setReading(key, next)
              }
            }}
            onClose={closeNote}
            onInsert={selection => insert(selection)}
            offline={props.offline}
            onRetry={pending ? retry : undefined}
            notify={notify}
            reference={reference?.nodeId === node.id ? reference : undefined}
          />
        )}
        {searchOpen && snapshot && (
          <SearchOverlay
            snapshot={snapshot}
            close={closeSearch}
            choose={(result) => navigate(snapshot.map.nodes.find(n => n.id === result.nodeId)?.childViewId ?? result.viewId, result.nodeId)}
          />
        )}
        {!props.offline && nodeMenu && menuNode && reading && (
          <NodeMenu
            x={nodeMenu.x}
            y={nodeMenu.y}
            add={props.offline ? undefined : () => {
              insert({ text: readableNote(menuNode.title, menuNode.summary, snapshot?.notes[menuNode.id] ?? ''), before: '', after: '' }, menuNode.id, 'node')
              closeNodeMenu()
            }}
            close={closeNodeMenu}
          />
        )}
        {notice && (
          <div className={`notice ${noticeFading ? 'is-fading' : ''}`} role="status">
            <span>{notice}</span>
            <button aria-label="关闭提示" onClick={() => setNotice('')}>
              ×
            </button>
          </div>
        )}
        {reference &&
          (!snapshot ||
            !snapshot.map.nodes.some((n) => n.id === reference.nodeId) ||
            snapshot.workspaceKey !== reference.workspaceKey) && (
            <aside className="reference-fallback">
              <strong>引用原文快照</strong>
              <blockquote>{reference.text}</blockquote>
              <p>
                {reference.mapTitle} / {reference.nodeTitle}
              </p>
              <button className="btn" onClick={() => setReference(undefined)}>
                关闭快照
              </button>
            </aside>
          )}
      </div>
      <div ref={measurements} className="measure-nodes" aria-hidden="true">
        {snapshot?.map.views.flatMap((v) =>
          v.occurrences.map((o) => (
            <NodeCard
              key={`${v.id}/${o.nodeId}`}
              measure
              node={snapshot.map.nodes.find((n) => n.id === o.nodeId)!}
              viewId={v.id}
              layout={snapshot.layout?.views
                .find((x) => x.viewId === v.id)
                ?.nodes.find((n) => n.nodeId === o.nodeId)}
            />
          )),
        )}
      </div>
    </div>
    </div>
  )
}
