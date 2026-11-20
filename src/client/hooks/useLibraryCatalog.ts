import { useCallback, useEffect, useRef, useState } from 'react'
import type { MapLibrary } from '../../shared/library.ts'
import type { MapListing } from '../../shared/map-types.ts'
import { sameWorkspaceKey } from '../../shared/workspace-path.ts'
import { dropEditSession } from '../edit-session.ts'
import type { HostAdapter } from '../host-adapter.ts'
import type { HistoryDirection } from '../navigation.ts'
import { onCompletedMapChange } from '../open-completed-map.ts'
import type { AtlasNavigation } from '../register-sidebar.tsx'
import { deleteRetainedLayout } from './useViewportLayout.ts'

export type AtlasPage = { kind: 'library' | 'trash' } | { kind: 'map'; id: string; workspaceKey?: string }

export function useLibraryCatalog({
  host,
  sessionId,
  tab,
  selectMap,
}: {
  host: HostAdapter
  sessionId: string
  tab: { visible: boolean; navigation: { revision: number; params?: unknown } }
  selectMap: (id: string) => void
}) {
  const [page, setPage] = useState<AtlasPage>({ kind: 'library' })
  const pages = useRef<{ current: AtlasPage; back: AtlasPage[]; forward: AtlasPage[] }>({
    current: page,
    back: [],
    forward: [],
  })
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
    if (refreshing.current) {
      if (changed) reloadNeeded.current = true
      return refreshing.current
    }
    const signal = lifetime.current.signal
    const run = async () => {
      do {
        reloadNeeded.current = false
        const revision = ++listingRevision.current
        if (!catalogReady.current) setLoading(true)
        setError('')
        try {
          const list = await host.list(signal)
          if (!signal.aborted && revision === listingRevision.current) {
            catalogReady.current = true
            setListing(list)
          }
        } catch (e) {
          if (!signal.aborted && revision === listingRevision.current) setError(String(e))
        } finally {
          if (!signal.aborted && revision === listingRevision.current) setLoading(false)
        }
      } while (reloadNeeded.current && !signal.aborted)
    }
    const pending = run().finally(() => {
      if (refreshing.current === pending) refreshing.current = undefined
    })
    refreshing.current = pending
    return pending
  }, [host])

  useEffect(() => {
    lifetime.current = new AbortController()
    refreshing.current = undefined
    reloadNeeded.current = false
    catalogReady.current = false
    setListing({ maps: [], diagnostics: [] })
    setLoading(true)
    return () => lifetime.current.abort()
  }, [refresh])

  const libraryDependencies = [
    ...listing.maps.map(map => map.id),
    ...(listing.incompleteCreates ?? []).map(item => item.mapId + ':' + item.state),
    ...listing.diagnostics.map(d => d.path),
  ].sort().join('\n')

  useEffect(() => {
    if (selected || !tab.visible) return
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    const stop = host.watchLibrary?.(catalog.current, (changed = true) => { void refresh(changed) }, lifetime.current.signal)
    const unlistenCompleted = onCompletedMapChange(() => { void refresh(true) })
    return () => {
      window.removeEventListener('focus', onFocus)
      stop?.()
      unlistenCompleted()
    }
  }, [host, refresh, selected, tab.visible, libraryDependencies])

  useEffect(() => {
    if (!selected && tab.visible) void refresh()
  }, [selected, tab.visible, refresh])

  const showPage = (next: AtlasPage, restore = false) => {
    restoreReading.current = restore
    pages.current.current = next
    if (next.kind === 'map') selectMap(next.id)
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
      !!target.workspaceKey && sameWorkspaceKey(target.workspaceKey, listing.library?.workspaceKey) &&
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
    if (libraryWorkspace.current && !sameWorkspaceKey(libraryWorkspace.current, workspaceKey)) {
      pages.current.back = []
      pages.current.forward = []
    }
    libraryWorkspace.current = workspaceKey
  }, [listing.library?.workspaceKey])

  useEffect(() => {
    if (selected) return
    const params = tab.navigation.params as AtlasNavigation | undefined
    if (params?.mapId) open(params.mapId)
    else visitPage({ kind: 'library' })
  }, [tab.navigation.revision])

  const backToLibrary = (workspaceKey?: string) => {
    if (pages.current.current.kind === 'map' && workspaceKey) {
      pages.current.current = { ...pages.current.current, workspaceKey }
    }
    if (pages.current.back.at(-1)?.kind === 'library') traversePages('back')
    else visitPage({ kind: 'library' })
  }

  const clearForwardHistory = () => {
    pages.current.forward = []
  }

  const cleanupCreate = async (mapId: string, operationId: string) => {
    if (!listing.library || !host.cleanupCreate) throw new Error('清理入口尚未就绪，请重新载入后重试')
    try {
      await host.cleanupCreate(mapId, operationId, listing.library.workspaceKey, lifetime.current.signal)
    } finally {
      await refresh(true)
    }
  }

  const compactRetired = host.compactRetired
    ? async () => {
      if (!listing.library || !host.compactRetired) throw new Error('目录尚未就绪，请重新载入后重试')
      await host.compactRetired(listing.library.workspaceKey, lifetime.current.signal)
      await refresh(true)
    }
    : undefined

  const purge = async (ids: string[]) => {
    if (!listing.library) throw new Error('目录尚未就绪，请重新载入后重试')
    let result
    try {
      result = await host.purge(ids, listing.library, lifetime.current.signal)
    } catch (e) {
      await refresh()
      throw e
    }
    for (const deletedId of result.deletedIds) {
      deleteRetainedLayout(sessionId, listing.library.workspaceKey, deletedId)
      dropEditSession(listing.library.workspaceKey, deletedId)
    }
    listingRevision.current++
    setLoading(false)
    setListing(old => ({ ...old, maps: old.maps.filter(map => !result.deletedIds.includes(map.id)), library: result.library }))
    if (result.failures.length) {
      throw new Error(`已删除 ${result.deletedIds.length} 项；其余保留在回收站，可重试：\n${result.failures.map(f => `${listing.maps.find(m => m.id === f.id)?.title ?? f.id}：${f.message}`).join('\n')}`)
    }
  }

  const rename = async (id: string, title: string, previousTitle: string) => {
    if (!listing.library) throw new Error('目录尚未就绪，请刷新后重试')
    await host.rename(id, title, previousTitle, listing.library.workspaceKey, lifetime.current.signal)
    await refresh()
  }

  const saveLibrary = async (data: MapLibrary) => {
    if (!listing.library) throw new Error('目录尚未就绪，请刷新后重试')
    const library = await host.saveLibrary(data, listing.library, lifetime.current.signal)
    listingRevision.current++
    setLoading(false)
    setListing(old => ({ ...old, library }))
  }

  return {
    page,
    selected,
    restoreReading: restoreReading.current,
    listing,
    loading,
    error,
    refresh,
    open,
    visitPage,
    traversePages,
    backToLibrary,
    clearForwardHistory,
    cleanupCreate,
    compactRetired,
    purge,
    rename,
    saveLibrary,
  }
}
