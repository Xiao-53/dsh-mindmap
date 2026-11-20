import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { fillLayout } from '../../shared/layout.ts'
import type { MapListing, MapSnapshot } from '../../shared/map-types.ts'
import { collectLocalImageHrefs } from '../../shared/note-markdown.ts'
import { sameWorkspaceKey } from '../../shared/workspace-path.ts'
import { editSession, type EditSession } from '../edit-session.ts'
import { downloadHtml } from '../export-html.ts'
import type { HostAdapter } from '../host-adapter.ts'
import { readingKey, reconcileReading, type ReadingState } from '../reading-state.ts'
import type { ReferenceSnapshot } from '../reference-source.ts'
import { SnapshotLoader } from '../refresh-map.ts'
import type { createReadingStore } from '../register-sidebar.tsx'

export type ReadingLatestSnapshot = {
  snapshot?: MapSnapshot
  reading?: ReadingState
  mapId?: string
  reference?: ReferenceSnapshot
  visible: boolean
}

export function useMapDocument({
  sessionId,
  offline,
  host,
  mapId,
  actions,
  latestRef,
  lifetime,
  clearDraftRef,
  onResetUiRef,
  notify,
}: {
  sessionId: string
  offline?: boolean
  host: Pick<HostAdapter, 'read' | 'list'> & Partial<Pick<HostAdapter, 'watch' | 'cleanupOrphanAssets' | 'readResources'>>
  mapId?: string
  actions: PropsStore<ReturnType<typeof createReadingStore>>['actions']
  latestRef: MutableRefObject<ReadingLatestSnapshot>
  lifetime: MutableRefObject<AbortController>
  clearDraftRef: MutableRefObject<() => void>
  onResetUiRef: MutableRefObject<() => void>
  notify: (text: string) => void
}) {
  const [listing, setListing] = useState<MapListing>({ maps: [], diagnostics: [] })
  const [snapshot, setSnapshot] = useState<MapSnapshot>()
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [watchError, setWatchError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [leaveAction, setLeaveAction] = useState<() => void>()
  const [leaving, setLeaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [, renderEditor] = useState(0)

  const editor = useRef<EditSession>()
  const unsubscribeEditor = useRef<() => void>()
  const leaveCancel = useRef<HTMLButtonElement>(null)
  const loader = useRef(new SnapshotLoader())
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const attemptedResources = useRef<Set<string>>(new Set())
  const exporting = useRef(false)

  useEffect(() => {
    if (leaveAction) leaveCancel.current?.focus()
  }, [leaveAction])

  useEffect(() => {
    return () => {
      unsubscribeEditor.current?.()
      editor.current?.detach()
      loader.current.cancel()
    }
  }, [])

  useEffect(() => {
    const signal = lifetime.current.signal
    void host
      .list(signal)
      .then(list => {
        if (signal.aborted) return
        setListing(list)
        if (!latestRef.current.mapId && list.maps[0]) actions.selectMap(list.maps[0].id)
        else if (!list.maps.length) setLoading(false)
      })
      .catch(e => {
        if (!signal.aborted) {
          setError(String(e))
          setLoading(false)
        }
      })
  }, [host])

  const load = useCallback(async () => {
    const currentId = latestRef.current.mapId
    if (!currentId || lifetime.current.signal.aborted) return
    setLoading(true)
    const result = await loader.current.load(signal =>
      host.read(
        currentId,
        signal,
        latestRef.current.reference?.workspaceKey ?? latestRef.current.snapshot?.workspaceKey,
      ),
    )
    if (!result || latestRef.current.mapId !== currentId || lifetime.current.signal.aborted) return
    if (result.snapshot) {
      if (latestRef.current.reference && !sameWorkspaceKey(result.snapshot.workspaceKey, latestRef.current.reference.workspaceKey)) {
        setError('来源工作区已变化，引用原文已保留。')
        setLoading(false)
        return
      }
      if (!offline) {
        const active = editSession(sessionId, host as HostAdapter, result.snapshot)
        if (editor.current !== active) {
          unsubscribeEditor.current?.()
          editor.current?.detach()
          editor.current = active
          unsubscribeEditor.current = active.subscribe(() => {
            if (lifetime.current.signal.aborted || latestRef.current.mapId !== active.working.map.id) return
            setSnapshot(active.working)
            setIsSaving(active.status === 'saving')
            const blocked = ['failed', 'conflict', 'recovery_required', 'readonly'].includes(active.status)
            setSaveError(blocked ? active.message : '')
            if (active.message && !blocked) notify(active.message)
            renderEditor(n => n + 1)
          })
        }
        setSnapshot(active.working)
        const blocked = ['failed', 'conflict', 'recovery_required', 'readonly'].includes(active.status)
        setSaveError(blocked ? active.message : '')
        if (active.message && !blocked) notify(active.message)
      } else {
        setSnapshot(result.snapshot)
      }
      const currentKey = readingKey(result.snapshot.workspaceKey, currentId)
      const state = latestRef.current.reading
      if (state && state.mapId === currentId && sameWorkspaceKey(state.workspaceKey, result.snapshot.workspaceKey)) {
        const reconciled = reconcileReading(state, result.snapshot.map)
        actions.setReading(currentKey, reconciled.state)
        latestRef.current.reading = reconciled.state
        if (reconciled.notice) notify(reconciled.notice)
      }
    }
    setError(result.error ?? '')
    setLoading(false)
  }, [host, actions, offline, sessionId])

  refreshRef.current = load

  useEffect(() => {
    loader.current.cancel()
    loader.current.snapshot = undefined
    attemptedResources.current.clear()
    setSnapshot(undefined)
    setError('')
    setWatchError('')
    setSaveError('')
    onResetUiRef.current()
    if (mapId) void load()
    return () => loader.current.cancel()
  }, [mapId, host])

  const dependencies = snapshot ? snapshot.files.map(f => f.path).join('\n') : ''
  useEffect(() => {
    if (!snapshot || offline || !host.watch) return
    setWatchError('')
    return host.watch(
      snapshot,
      () => { void refreshRef.current() },
      setWatchError,
      lifetime.current.signal,
    )
  }, [snapshot?.map.id, snapshot?.workspaceKey, dependencies, host, offline])

  const discardChanges = async () => {
    const active = editor.current
    if (!active) return true
    try {
      const done = await active.discardLatest()
      if (done) {
        clearDraftRef.current()
        setSaveError('')
      }
      return done
    } catch (e) {
      setSaveError(String(e))
      return false
    }
  }

  const guard = async (action: () => void) => {
    const active = editor.current
    if (!active) {
      action()
      return
    }
    const allowed = await active.flush()
    if (lifetime.current.signal.aborted || editor.current !== active) return
    if (allowed) {
      action()
      return
    }
    setSaveError(active.message || '修改尚未保存，请重试或明确放弃后离开')
    setLeaveAction(() => action)
  }

  const cleanupAssets = host.cleanupOrphanAssets
    ? async () => {
      const baseline = editor.current?.baseline ?? latestRef.current.snapshot
      if (!baseline) return
      const res = await host.cleanupOrphanAssets!(baseline.map.id, baseline.fingerprint, baseline.workspaceKey, lifetime.current.signal)
      notify(res.deletedAssetIds.length ? `已清理 ${res.deletedAssetIds.length} 项未引用图片` : '没有可清理的未引用图片')
      void load()
    }
    : undefined

  const exportOfflineMap = async (viewId: string) => {
    if (exporting.current) return
    const saved = editor.current?.baseline ?? latestRef.current.snapshot
    if (!saved || saved.writable === false) {
      notify('资源不完整，不能导出完整地图')
      return
    }
    const missingNodeIds = saved.map.nodes
      .filter(node => collectLocalImageHrefs(saved.notes[node.id] ?? '').some(href => saved.resources[`${node.id}:${href}`] === undefined))
      .map(node => node.id)
    const hydrated: Record<string, string> = { ...saved.resources }
    if (missingNodeIds.length > 0 && host.readResources) {
      exporting.current = true
      try {
        const chunkSize = 4
        for (let i = 0; i < missingNodeIds.length; i += chunkSize) {
          const batch = missingNodeIds.slice(i, i + chunkSize)
          try {
            const res = await host.readResources(saved.map.id, batch, lifetime.current.signal, saved.workspaceKey)
            Object.assign(hydrated, res.resources)
            if (res.diagnostics.length) {
              notify('部分图片未能载入，不能导出完整离线包')
              return
            }
          } catch (e) {
            if (batch.length <= 1) throw e
            for (const singleId of batch) {
              const single = await host.readResources(saved.map.id, [singleId], lifetime.current.signal, saved.workspaceKey)
              Object.assign(hydrated, single.resources)
              if (single.diagnostics.length) {
                notify('部分图片未能载入，不能导出完整离线包')
                return
              }
            }
          }
        }
        if (editor.current && editor.current.baseline.map.id === saved.map.id && editor.current.baseline.fingerprint === saved.fingerprint) {
          editor.current.mergeResources(hydrated)
        }
      } catch (e) {
        if (!lifetime.current.signal.aborted) notify(`导出前加载图片失败：${e instanceof Error ? e.message : String(e)}`)
        return
      } finally {
        exporting.current = false
      }
    }
    const fullSnapshot: MapSnapshot = { ...saved, resources: hydrated }
    downloadHtml(fullSnapshot, fillLayout(fullSnapshot.map, fullSnapshot.layout, {}), viewId)
    notify('已导出已保存版本的离线 HTML。')
  }

  return {
    listing,
    setListing,
    snapshot,
    setSnapshot,
    editor,
    isSaving,
    error,
    setError,
    watchError,
    saveError,
    leaveAction,
    setLeaveAction,
    leaving,
    setLeaving,
    leaveCancel,
    loading,
    setLoading,
    load,
    discardChanges,
    guard,
    cleanupAssets,
    exportOfflineMap,
    attemptedResources,
  }
}

/** 打开节点详情时按需懒加载本节点图片资源，避免初始整图传输放大 RPC 体积。 */
export function useLazyNodeResources({
  offline,
  host,
  snapshot,
  setSnapshot,
  selectedNodeId,
  editor,
  latestRef,
  lifetime,
  attemptedResources,
  notify,
}: {
  offline?: boolean
  host: Pick<HostAdapter, 'read' | 'list'> & Partial<Pick<HostAdapter, 'readResources'>>
  snapshot?: MapSnapshot
  setSnapshot: (updater: (prev: MapSnapshot | undefined) => MapSnapshot | undefined) => void
  selectedNodeId?: string
  editor: MutableRefObject<EditSession | undefined>
  latestRef: MutableRefObject<ReadingLatestSnapshot>
  lifetime: MutableRefObject<AbortController>
  attemptedResources: MutableRefObject<Set<string>>
  notify: (text: string) => void
}) {
  const selectedNote = selectedNodeId ? (snapshot?.notes[selectedNodeId] ?? '') : ''
  useEffect(() => {
    if (offline || !host.readResources || !snapshot || !selectedNodeId || !selectedNote) return
    const missing = collectLocalImageHrefs(selectedNote).filter(
      href => snapshot.resources[`${selectedNodeId}:${href}`] === undefined,
    )
    if (!missing.length) return
    const targetMapId = snapshot.map.id
    const targetWsKey = snapshot.workspaceKey
    const fetchKey = `${targetMapId}\0${snapshot.fingerprint}\0${selectedNodeId}\0${missing.join('\n')}`
    if (attemptedResources.current.has(fetchKey)) return
    attemptedResources.current.add(fetchKey)
    const controller = new AbortController()
    let completed = false
    void host.readResources(targetMapId, [selectedNodeId], controller.signal, targetWsKey)
      .then(res => {
        completed = true
        if (controller.signal.aborted || lifetime.current.signal.aborted || latestRef.current.mapId !== targetMapId) return
        if (Object.keys(res.resources).length) {
          if (editor.current && editor.current.baseline.map.id === targetMapId) {
            editor.current.mergeResources(res.resources)
          } else {
            setSnapshot(prev => prev && prev.map.id === targetMapId
              ? { ...prev, resources: { ...prev.resources, ...res.resources } }
              : prev)
          }
        }
        if (res.diagnostics.length) {
          notify(`部分节点图片未能载入：${res.diagnostics[0].message}`)
        }
      })
      .catch(err => {
        if (!completed && !controller.signal.aborted && !lifetime.current.signal.aborted) {
          attemptedResources.current.delete(fetchKey)
          notify(`加载节点图片失败：${err instanceof Error ? err.message : String(err)}`)
        }
      })
    return () => {
      controller.abort()
      if (!completed) attemptedResources.current.delete(fetchKey)
    }
  }, [offline, host, snapshot?.map.id, snapshot?.fingerprint, snapshot?.workspaceKey, snapshot?.resources, selectedNodeId, selectedNote])
}
