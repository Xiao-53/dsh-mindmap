import { useLayoutEffect, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { fillLayout, relayoutView, relayoutViewPartial, type Heights, type PartialRelayoutOptions } from '../../shared/layout.ts'
import type { LayoutMode, MapLayout, MapSnapshot, ViewLayout } from '../../shared/map-types.ts'
import { workspaceComparisonKey } from '../../shared/workspace-path.ts'
import type { EditSession } from '../edit-session.ts'
import { measureNodes } from '../measure-nodes.ts'
import type { ReadingState } from '../reading-state.ts'

export type LayoutDraft = { layout: MapLayout; base: MapSnapshot; revision: number }

// 会话内保留，覆盖切图、目录、页签卸载和未完成保存；不写入内容或分享。
const MAX_RETAINED_LAYOUTS = 32
const retainedLayouts = new Map<string, LayoutDraft>()

export const layoutDraftKey = (session: string, workspace: string, map: string) =>
  JSON.stringify([session, workspaceComparisonKey(workspace), map])

export function deleteRetainedLayout(session: string, workspace: string, map: string) {
  retainedLayouts.delete(layoutDraftKey(session, workspace, map))
}

function rememberRetainedLayout(key: string, value: LayoutDraft) {
  retainedLayouts.delete(key)
  retainedLayouts.set(key, value)
  while (retainedLayouts.size > MAX_RETAINED_LAYOUTS) retainedLayouts.delete(retainedLayouts.keys().next().value!)
}

export function useViewportLayout({
  sessionId,
  offline,
  mapId,
  host,
  snapshot,
  reading,
  readingRef,
  editor,
  navigationBusy,
  notify,
}: {
  sessionId: string
  offline?: boolean
  mapId?: string
  host: unknown
  snapshot?: MapSnapshot
  reading?: ReadingState
  readingRef: MutableRefObject<ReadingState | undefined>
  editor: MutableRefObject<EditSession | undefined>
  navigationBusy: MutableRefObject<boolean>
  notify: (text: string) => void
}) {
  const [draft, setDraft] = useState<LayoutDraft>()
  const [nodeDragging, setNodeDragging] = useState(false)
  const [heights, setHeights] = useState<Heights>({})
  const [measured, setMeasured] = useState('')
  const measurements = useRef<HTMLDivElement>(null)
  const dragOrigin = useRef<ViewLayout>()
  const dragCommitted = useRef(false)
  const draftRef = useRef(draft)
  const layoutRef = useRef<MapLayout>()

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if ([...retainedLayouts.keys()].some(k => JSON.parse(k)[0] === sessionId)) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [sessionId])

  useEffect(() => {
    draftRef.current = undefined
    setDraft(undefined)
    setHeights({})
    setMeasured('')
  }, [mapId, host])

  useLayoutEffect(() => {
    const container = measurements.current
    if (!snapshot || !container) return
    const measure = () => {
      const next = measureNodes(container)
      setHeights(old => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
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
  }, [snapshot?.fingerprint, snapshot?.map])

  const layout = useMemo(
    () => draft?.layout ?? (snapshot ? fillLayout(snapshot.map, snapshot.layout, heights) : undefined),
    [snapshot, heights, draft],
  )
  layoutRef.current = layout

  const clearDraft = () => {
    if (editor.current) deleteRetainedLayout(sessionId, editor.current.baseline.workspaceKey, editor.current.baseline.map.id)
    draftRef.current = undefined
    setDraft(undefined)
  }

  const moveNode = (id: string, x: number, y: number) => {
    if (!snapshot || !reading || !layoutRef.current) return
    const previous = draftRef.current
    const next: LayoutDraft = {
      base: previous?.base ?? snapshot,
      revision: (previous?.revision ?? 0) + 1,
      layout: {
        ...layoutRef.current,
        views: layoutRef.current.views.map(v => v.viewId !== reading.viewId ? v : {
          ...v,
          nodes: v.nodes.map(n => n.nodeId === id ? { ...n, x, y, manual: true } : n),
        }),
      },
    }
    if (!offline) rememberRetainedLayout(layoutDraftKey(sessionId, next.base.workspaceKey, next.base.map.id), next)
    draftRef.current = next
    layoutRef.current = next.layout
    // 拖动期间仅更新工作副本引用，不重绘阅读页；画布负责实时预览。
  }

  const saveLayoutNow = async () => {
    const active = editor.current
    if (!active) return
    if (draftRef.current && readingRef.current) {
      const target = draftRef.current.layout.views.find(v => v.viewId === readingRef.current!.viewId)
      const before = dragOrigin.current
      const samePosition = target && before && target.nodes.every(n => {
        const old = before.nodes.find(b => b.nodeId === n.nodeId)
        return old?.x === n.x && old?.y === n.y
      })
      if (target && !samePosition) active.setLayout({ ...target, mode: target.mode ?? 'vertical' }, before, 'move')
      deleteRetainedLayout(sessionId, active.baseline.workspaceKey, active.baseline.map.id)
      draftRef.current = undefined
      setDraft(undefined)
    }
    await active.save(true)
  }

  const changeLayout = (mode: LayoutMode, reset = false) => {
    const current = layoutRef.current
    if (!snapshot || !reading || !current || measured !== snapshot.fingerprint || navigationBusy.current) return
    const old = current.views.find(view => view.viewId === reading.viewId)
    if (!reset && (old?.mode ?? 'vertical') === mode) return
    const active = editor.current
    if (!offline && !active?.finishInput()) return
    try {
      const next = relayoutView(active?.working.map ?? snapshot.map, reading.viewId, mode, heights)
      if (offline) {
        setDraft(previous => ({
          base: snapshot,
          revision: (previous?.revision ?? 0) + 1,
          layout: { ...current, views: current.views.map(view => view.viewId === next.viewId ? next : view) },
        }))
      } else active?.setLayout(next, old)
    } catch (error) {
      notify(String(error))
    }
  }

  const relayoutPartial = (options: PartialRelayoutOptions) => {
    const current = layoutRef.current
    if (!snapshot || !reading || !current || measured !== snapshot.fingerprint || navigationBusy.current) return
    const old = current.views.find(view => view.viewId === reading.viewId)
    if (!old) return
    const active = editor.current
    if (!offline && !active?.finishInput()) return
    try {
      const next = relayoutViewPartial(active?.working.map ?? snapshot.map, old, heights, options)
      if (offline) {
        setDraft(previous => ({
          base: snapshot,
          revision: (previous?.revision ?? 0) + 1,
          layout: { ...current, views: current.views.map(view => view.viewId === next.viewId ? next : view) },
        }))
      } else active?.setLayout(next, old)
    } catch (error) {
      notify(String(error))
    }
  }

  const startDrag = (viewLayout: ViewLayout, onCleanupUi?: () => void) => {
    dragCommitted.current = false
    if (offline) return
    editor.current?.finishInput()
    dragOrigin.current = structuredClone(viewLayout)
    setNodeDragging(true)
    onCleanupUi?.()
  }

  const commitDrag = () => {
    dragCommitted.current = true
    if (offline) {
      if (draftRef.current) setDraft(draftRef.current)
      return
    }
    setDraft(draftRef.current)
    void saveLayoutNow()
  }

  const endDrag = (restoreFocusTarget?: HTMLElement | null) => {
    if (offline) {
      draftRef.current = undefined
      if (!dragCommitted.current) layoutRef.current = layout
    } else {
      setNodeDragging(false)
      if (!dragCommitted.current) {
        draftRef.current = undefined
        if (editor.current) deleteRetainedLayout(sessionId, editor.current.baseline.workspaceKey, editor.current.baseline.map.id)
      }
      setDraft(draftRef.current)
    }
    restoreFocusTarget?.focus({ preventScroll: true })
  }

  return {
    draft,
    draftRef,
    nodeDragging,
    heights,
    measured,
    measurements,
    layout,
    clearDraft,
    moveNode,
    saveLayoutNow,
    changeLayout,
    relayoutPartial,
    startDrag,
    commitDrag,
    endDrag,
  }
}
