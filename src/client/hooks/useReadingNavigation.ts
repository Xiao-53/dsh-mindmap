import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { ReferenceInsert, TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { Heights } from '../../shared/layout.ts'
import { nodeHeight } from '../../shared/layout.ts'
import type { MapLayout, MapSnapshot } from '../../shared/map-types.ts'
import { notePlots } from '../../shared/note-markdown.ts'
import { plotContent, type PlotData } from '../../shared/note-plot.ts'
import type { NoteAnchor } from '../../shared/note-position.ts'
import { sameWorkspaceKey } from '../../shared/workspace-path.ts'
import type { EditSession } from '../edit-session.ts'
import { restoreFocus } from '../focus-management.ts'
import { insertPending, type PendingInsertion } from '../insert-reference.ts'
import {
  historyReading,
  NavigationTransition,
  neighborFocusZoom,
  recordReadingNavigation,
  targetReading,
  viewPath,
  type HistoryDirection,
} from '../navigation.ts'
import { readingKey } from '../reading-state.ts'
import { resolveReference } from '../reference-navigation.ts'
import { referenceContentDigest, type ReferenceSnapshot } from '../reference-source.ts'
import type { AtlasNavigation, createReadingStore } from '../register-sidebar.tsx'
import type { SelectionSnapshot } from '../selection.ts'
import type { ReadingLatestSnapshot } from './useMapDocument.ts'
import type { LayoutDraft } from './useViewportLayout.ts'

function safeFileAddress(sessionId: string, relativePath: string): string {
  try {
    return fileAddressFor(sessionId, undefined, relativePath)
  } catch {
    return relativePath
  }
}

export function useReadingNavigation({
  sessionId,
  offline,
  tab,
  actions,
  snapshot,
  latestRef,
  lifetime,
  rootRef,
  layout,
  heights,
  readingKeyValue,
  pending,
  editor,
  draftRef,
  nodeDragging,
  navigationBusy,
  leaveAction,
  guard,
  load,
  restoreReading,
  onMap,
  onLibrary,
  onPageHistory,
  onViewNavigation,
  inputActions,
  insertReference,
  notify,
}: {
  sessionId: string
  offline?: boolean
  tab: { visible: boolean; navigation: { revision: number; params?: unknown } }
  actions: PropsStore<ReturnType<typeof createReadingStore>>['actions']
  snapshot?: MapSnapshot
  latestRef: MutableRefObject<ReadingLatestSnapshot>
  lifetime: MutableRefObject<AbortController>
  rootRef: MutableRefObject<HTMLDivElement | null>
  layout?: MapLayout
  heights: Heights
  readingKeyValue: string
  pending?: PendingInsertion
  editor: MutableRefObject<EditSession | undefined>
  draftRef: MutableRefObject<LayoutDraft | undefined>
  nodeDragging: boolean
  navigationBusy: MutableRefObject<boolean>
  leaveAction?: () => void
  guard: (action: () => void) => Promise<void>
  load: () => Promise<void>
  restoreReading?: boolean
  onMap?: (id: string) => void
  onLibrary: (workspaceKey?: string) => void
  onPageHistory?: (direction: HistoryDirection, workspaceKey: string) => void
  onViewNavigation?: () => void
  inputActions?: { captureInsertion: () => TokenSpan }
  insertReference?: (ref: ReferenceInsert, span: TokenSpan) => boolean
  notify: (text: string) => void
}) {
  const [phase, setPhase] = useState<'idle' | 'out' | 'in'>('idle')
  const [exitMotion, setExitMotion] = useState<{ ratio: number; x: number; y: number }>()
  const [searchOpen, setSearchOpen] = useState(false)
  const [inspectorWidth, setInspectorWidth] = useState(320)
  const [reference, setReference] = useState<ReferenceSnapshot>()
  const [pendingAutoOpen, setPendingAutoOpen] = useState<string>()
  const [nodeMenu, setNodeMenu] = useState<{ id: string; x: number; y: number }>()

  const focus = useRef<HTMLElement | null>(null)
  const navigation = useRef(new NavigationTransition())
  const processedReference = useRef('')
  const skipInitialReference = useRef(restoreReading)
  const appliedNavRevision = useRef<number>()
  const navigationIntent = useRef<{
    key: string
    nodeId?: string
    historyDirection?: HistoryDirection
  }>()

  const updatePhase = (next: 'idle' | 'out' | 'in') => {
    navigationBusy.current = next !== 'idle'
    setPhase(next)
  }

  useEffect(() => {
    navigation.current = new NavigationTransition()
    return () => navigation.current.dispose()
  }, [])

  const resetNavigation = () => {
    setSearchOpen(false)
    setNodeMenu(undefined)
    updatePhase('idle')
    navigationIntent.current = undefined
    navigation.current.dispose()
    navigation.current = new NavigationTransition()
  }

  const navigate = (viewId: string, nodeId?: string, historyDirection?: HistoryDirection) => {
    const current = latestRef.current
    if (
      navigationBusy.current || !current.visible ||
      !current.snapshot ||
      !current.reading || current.mapId !== current.snapshot.map.id ||
      !current.snapshot.map.views.some(v => v.id === viewId)
    )
      return
    setSearchOpen(false)
    setNodeMenu(undefined)
    navigationIntent.current = {
      key: readingKey(current.snapshot.workspaceKey, current.snapshot.map.id),
      nodeId,
      historyDirection,
    }
    const viewport = rootRef.current
      ?.querySelector('.content-area')
      ?.getBoundingClientRect() ?? { width: 360, height: 500 }
    const commit = (id: string) => {
      const active = latestRef.current
      const intent = navigationIntent.current
      if (
        !active.visible || !active.snapshot || !active.reading || !intent ||
        active.mapId !== active.snapshot.map.id ||
        readingKey(active.snapshot.workspaceKey, active.snapshot.map.id) !== intent.key ||
        !active.snapshot.map.views.some(view => view.id === id)
      )
        return
      const next = intent.historyDirection
        ? historyReading(active.reading, active.snapshot.map, intent.historyDirection)
        : recordReadingNavigation(active.reading, targetReading(
          active.reading, id, intent.nodeId, layout, heights, viewport,
        ))
      if (!next) return
      if (!intent.historyDirection && next.viewId !== active.reading.viewId) onViewNavigation?.()
      if (intent.historyDirection) setReference(undefined)
      latestRef.current.reading = next
      actions.setReading(intent.key, next)
    }
    if (current.reading.viewId === viewId && phase === 'idle') {
      commit(viewId)
      return
    }
    const sourceLayout = layout?.views.find(v => v.viewId === current.reading!.viewId)
    const first = sourceLayout?.nodes[0]
    const camera = current.reading.cameras[current.reading.viewId] ?? {
      x: 24 - (first?.x ?? 0),
      y: 60 - (first?.y ?? 0),
      zoom: 1,
    }
    const source = sourceLayout?.nodes.find(
      n => n.nodeId === current.snapshot!.map.views.find(v => v.id === viewId)?.centerNodeId,
    )
    const area = rootRef.current?.querySelector('.content-area')?.getBoundingClientRect()
    setExitMotion({
      ratio: viewPath(current.snapshot.map, current.reading.viewId).includes(viewId) ? 0.99 : 1.026,
      x: source ? camera.x + (source.x + source.width / 2) * camera.zoom : (area?.width ?? 360) / 2,
      y: source
        ? camera.y + (source.y + nodeHeight(heights, current.reading.viewId, source.nodeId) / 2) * camera.zoom
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
    const current = latestRef.current
    if (!current.visible || !current.snapshot || !current.reading) return
    // 动画完成前忽略重复侧键。
    if (navigationBusy.current) return
    const target = historyReading(current.reading, current.snapshot.map, direction)
    if (target) void guard(() => navigate(target.viewId, target.selectedNodeId, direction))
    else if (!offline) {
      setReference(undefined)
      void guard(() => {
        if (onPageHistory) onPageHistory(direction, current.snapshot!.workspaceKey)
        else if (direction === 'back') onLibrary(current.snapshot!.workspaceKey)
      })
    }
  }

  useEffect(() => {
    if (!reference || !snapshot || snapshot.map.id !== reference.mapId) return
    const token = `${tab.navigation.revision}:${JSON.stringify(reference)}`
    if (processedReference.current === token) return
    processedReference.current = token
    const target = resolveReference(reference, snapshot)
    if (target.nodeId && target.viewId) void guard(() => navigate(target.viewId!, target.nodeId))
    if (target.message) notify(target.message)
  }, [snapshot, reference, tab.navigation.revision])

  const selectNode = (id: string) => {
    const reading = latestRef.current.reading
    if (!reading || navigationBusy.current) return
    if (!(document.activeElement as HTMLElement | null)?.closest('.node-menu')) {
      focus.current = document.activeElement as HTMLElement
    }
    const next = {
      ...reading,
      selectedNodeId: id,
      detailHidden: true,
      focusSource: id,
    }
    latestRef.current.reading = next
    actions.setReading(readingKeyValue, next)
  }

  const openNote = (id: string) => {
    const reading = latestRef.current.reading
    if (!reading || navigationBusy.current) return
    if (!(document.activeElement as HTMLElement | null)?.closest('.node-menu')) {
      focus.current = document.activeElement as HTMLElement
    }
    const next = {
      ...reading,
      selectedNodeId: id,
      detailHidden: false,
      detailScroll: id === reading.selectedNodeId ? reading.detailScroll : 0,
      focusSource: id,
    }
    latestRef.current.reading = next
    actions.setReading(readingKeyValue, next)
  }

  const closeNote = () => {
    const reading = latestRef.current.reading
    if (navigationBusy.current) return
    if (reading?.selectedNodeId) {
      const next = { ...reading, detailHidden: true }
      latestRef.current.reading = next
      actions.setReading(readingKeyValue, next)
      restoreFocus(
        (focus.current?.isConnected ? focus.current : undefined) ??
          rootRef.current?.querySelector<HTMLElement>(`[data-node="${reading.focusSource}"]`) ??
          null,
        rootRef.current,
      )
    }
  }

  const clearSelection = () => {
    const reading = latestRef.current.reading
    if (!reading?.selectedNodeId || navigationBusy.current) return
    const next = { ...reading, selectedNodeId: undefined, detailHidden: undefined }
    latestRef.current.reading = next
    actions.setReading(readingKeyValue, next)
  }

  const focusNodeInView = (targetNodeId: string) => {
    const { reading, snapshot, visible } = latestRef.current
    if (!visible || !reading || !snapshot || navigationBusy.current) return
    const view = snapshot.map.views.find(v => v.id === reading.viewId)
    if (!view || !(view.centerNodeId === targetNodeId || view.occurrences.some(o => o.nodeId === targetNodeId))) return
    const viewport = rootRef.current?.querySelector('.content-area')?.getBoundingClientRect() ?? { width: 360, height: 500 }
    const visibleWidth = viewport.width - inspectorWidth >= 180 ? viewport.width - inspectorWidth : viewport.width
    const viewLayout = layout?.views.find(v => v.viewId === reading.viewId)
    const zoom = neighborFocusZoom(viewLayout, heights, viewport)
    const next = targetReading(reading, reading.viewId, targetNodeId, layout, heights, { width: visibleWidth, height: viewport.height }, zoom)
    setReference(undefined)
    latestRef.current.reading = next
    actions.setReading(readingKeyValue, next)
  }

  const openSearch = () => {
    void guard(() => {
      focus.current = document.activeElement as HTMLElement
      setSearchOpen(true)
    })
  }

  const closeSearch = () => {
    setSearchOpen(false)
    restoreFocus(focus.current, rootRef.current)
  }

  const chooseMap = (id: string) => {
    setReference(undefined)
    void guard(() => {
      if (onMap) onMap(id)
      else actions.selectMap(id)
    })
  }

  useEffect(() => {
    const params = tab.navigation.params as AtlasNavigation | undefined
    const isInitial = appliedNavRevision.current === undefined
    appliedNavRevision.current = tab.navigation.revision
    if (isInitial) {
      if (skipInitialReference.current) {
        skipInitialReference.current = false
        return
      }
      if (params?.mapId && (!latestRef.current.mapId || params.mapId === latestRef.current.mapId)) {
        if (!latestRef.current.mapId) actions.selectMap(params.mapId)
        if (params.reference) {
          setReference(params.reference)
          processedReference.current = ''
        }
      }
      return
    }
    if (params?.autoOpen) {
      const activeEl = typeof document !== 'undefined' ? document.activeElement : null
      const editingInput = !!activeEl?.closest?.('.inspector input, .inspector textarea, .inspector [contenteditable="true"], .note-live-editor')
      const protectedState = nodeDragging || !!draftRef.current || !!editor.current?.dirty || !!editor.current?.uncertain || !!leaveAction || latestRef.current.reference !== undefined || editingInput
      if (protectedState) {
        setPendingAutoOpen(params.mapId ?? latestRef.current.mapId)
        return
      }
      setPendingAutoOpen(undefined)
      if (params.mapId && params.mapId !== latestRef.current.mapId) {
        if (onMap) onMap(params.mapId)
        else actions.selectMap(params.mapId)
      } else {
        void load()
      }
      return
    }
    if (params?.mapId || params?.reference) {
      void guard(() => {
        setPendingAutoOpen(undefined)
        if (params?.mapId && params.mapId !== latestRef.current.mapId) {
          if (onMap) onMap(params.mapId)
          else actions.selectMap(params.mapId)
        }
        setReference(params?.reference)
        processedReference.current = ''
      })
      return
    }
    void guard(() => {
      setPendingAutoOpen(undefined)
      setReference(undefined)
      onLibrary(latestRef.current.snapshot?.workspaceKey)
    })
  }, [tab.navigation.revision])

  const insert = (
    selected: SelectionSnapshot,
    nodeId = latestRef.current.reading?.selectedNodeId,
    kind: 'node' | 'selection' | 'plot' | 'note-position' = 'selection',
    plot?: PlotData,
    anchor?: NoteAnchor,
  ) => {
    const snapshot = latestRef.current.snapshot
    const reading = latestRef.current.reading
    if (offline || !inputActions || !insertReference || !snapshot || !nodeId || !reading) return
    const saved = kind === 'plot' || kind === 'note-position' ? editor.current?.baseline ?? snapshot : snapshot
    const node = saved.map.nodes.find(n => n.id === nodeId)
    if (!node || (anchor && (anchor.mapId !== saved.map.id || anchor.nodeId !== nodeId))) return
    const content = plot && plotContent(plot)
    if (kind === 'plot') {
      const actual = notePlots(saved.notes[nodeId] ?? '').find(token => token.data?.id === plot?.id)
      if (
        saved.map.id !== snapshot.map.id ||
        !sameWorkspaceKey(saved.workspaceKey, snapshot.workspaceKey) ||
        !actual?.data ||
        plotContent(actual.data) !== content
      ) {
        notify('已保存的笔记中找不到此图块，请重新打开笔记后再引用。')
        return
      }
    }
    const snapshotRef: ReferenceSnapshot = {
      version: 1,
      kind,
      ...selected,
      mapId: saved.map.id,
      nodeId: node.id,
      originViewId: reading.viewId,
      fingerprint: saved.fingerprint,
      noteDigest: referenceContentDigest(saved, node),
      mapTitle: saved.map.title,
      nodeTitle: node.title,
      sessionId,
      workspaceKey: saved.workspaceKey,
      ...(plot && { plotId: plot.id, plotContent: content }),
      ...(anchor && { anchor }),
      resourceAddress: safeFileAddress(sessionId, `dsh-knowledge-maps/${saved.map.id}/map.json`),
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
    actions.setPending(readingKeyValue, outcome.pending)
    notify(outcome.message)
  }

  const retry = () => {
    const snapshot = latestRef.current.snapshot
    if (
      offline || !inputActions || !insertReference || !pending || !snapshot ||
      !sameWorkspaceKey(pending.snapshot.workspaceKey, snapshot.workspaceKey) ||
      pending.snapshot.mapId !== snapshot.map.id
    )
      return
    const outcome = insertPending(
      { ...pending, span: inputActions.captureInsertion() },
      {
        sessionId,
        alive: !lifetime.current.signal.aborted && tab.visible,
        insert: insertReference,
      },
    )
    actions.setPending(readingKeyValue, outcome.pending)
    notify(outcome.message)
  }

  const openNodeMenu = (id: string, x: number, y: number) => {
    const bounds = rootRef.current?.querySelector('.content-area')?.getBoundingClientRect()
    focus.current = rootRef.current?.querySelector<HTMLElement>(`[data-node="${id}"]`) ?? null
    setNodeMenu({
      id,
      x: Math.max(8, Math.min(x - (bounds?.left ?? 0), (bounds?.width ?? 360) - 188)),
      y: Math.max(8, Math.min(y - (bounds?.top ?? 0), (bounds?.height ?? 500) - 148)),
    })
  }

  const closeNodeMenu = () => {
    setNodeMenu(undefined)
    restoreFocus(focus.current, rootRef.current)
  }

  const acceptPendingAutoOpen = () => {
    const targetId = pendingAutoOpen
    setPendingAutoOpen(undefined)
    void guard(() => {
      setReference(undefined)
      if (targetId && targetId !== latestRef.current.mapId) {
        if (onMap) onMap(targetId)
        else actions.selectMap(targetId)
      } else {
        void load()
      }
    })
  }

  return {
    phase,
    exitMotion,
    searchOpen,
    setSearchOpen,
    inspectorWidth,
    setInspectorWidth,
    reference,
    setReference,
    pendingAutoOpen,
    setPendingAutoOpen,
    nodeMenu,
    setNodeMenu,
    focus,
    navigationBusy,
    resetNavigation,
    navigate,
    traverseHistory,
    selectNode,
    openNote,
    closeNote,
    clearSelection,
    focusNodeInView,
    openSearch,
    closeSearch,
    chooseMap,
    insert,
    retry,
    openNodeMenu,
    closeNodeMenu,
    acceptPendingAutoOpen,
  }
}
