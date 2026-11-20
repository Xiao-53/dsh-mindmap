import { useEffect, useRef, useState } from 'react'
import type { ReferenceInsert, TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { plotText } from '../shared/note-plot.ts'
import { sameWorkspaceKey } from '../shared/workspace-path.ts'
import { MapHeader } from './components/MapHeader.tsx'
import { MapLibrary } from './components/MapLibrary.tsx'
import { MapScene } from './components/MapScene.tsx'
import { MapViewport } from './components/MapViewport.tsx'
import { NodeCard } from './components/NodeCard.tsx'
import type { NoteBodyEditor } from './components/NodeEditor.tsx'
import { NodeMenu } from './components/NodeMenu.tsx'
import { NoteInspector } from './components/NoteInspector.tsx'
import { SearchOverlay } from './components/SearchOverlay.tsx'
import { readableNote } from './copy-note.ts'
import type { HostAdapter } from './host-adapter.ts'
import { useLibraryCatalog } from './hooks/useLibraryCatalog.ts'
import { useLazyNodeResources, useMapDocument, type ReadingLatestSnapshot } from './hooks/useMapDocument.ts'
import { useReadingNavigation } from './hooks/useReadingNavigation.ts'
import { useViewportLayout } from './hooks/useViewportLayout.ts'
import { nodeDestination, type HistoryDirection } from './navigation.ts'
import { initialReading, readingKey, type ReadingState } from './reading-state.ts'
import type { createReadingStore } from './register-sidebar.tsx'
import { AtlasThemeProvider, useAtlasTheme } from './theme.ts'

export type AtlasPaneProps = PropsRuntime<'sidebar.right.pane.tab'> &
  PropsStore<ReturnType<typeof createReadingStore>> & {
    host: HostAdapter
    bodyEditor?: NoteBodyEditor
    insertReference: (ref: ReferenceInsert, span: TokenSpan) => boolean
  }

export function AtlasPane(props: AtlasPaneProps) {
  const { tab } = props.useTabInfo()
  const theme = useAtlasTheme(false)
  const catalog = useLibraryCatalog({
    host: props.host,
    sessionId: props.sessionId,
    tab,
    selectMap: props.actions.selectMap,
  })
  if (catalog.selected) {
    return (
      <ReadingPane
        {...props}
        restoreReading={catalog.restoreReading}
        onMap={catalog.open}
        onPageHistory={catalog.traversePages}
        onViewNavigation={catalog.clearForwardHistory}
        onLibrary={catalog.backToLibrary}
      />
    )
  }
  return (
    <AtlasThemeProvider value={theme}>
      <div
        className="dsh-atlas-shell"
        data-atlas-theme={theme.theme}
        onMouseDownCapture={e => {
          if (e.button === 3 || e.button === 4) { e.preventDefault(); e.stopPropagation() }
        }}
        onMouseUpCapture={e => {
          if (e.button !== 3 && e.button !== 4) return
          e.preventDefault()
          e.stopPropagation()
          catalog.traversePages(e.button === 3 ? 'back' : 'forward')
        }}
        onAuxClickCapture={e => {
          if (e.button === 3 || e.button === 4) { e.preventDefault(); e.stopPropagation() }
        }}
      >
        <MapLibrary
          listing={catalog.listing}
          loading={catalog.loading}
          error={catalog.error}
          refresh={() => { void catalog.refresh() }}
          open={catalog.open}
          trash={catalog.page.kind === 'trash'}
          setTrash={trash => catalog.visitPage({ kind: trash ? 'trash' : 'library' })}
          cleanupCreate={catalog.cleanupCreate}
          compactRetired={catalog.compactRetired}
          purge={catalog.purge}
          rename={catalog.rename}
          save={catalog.saveLibrary}
        />
      </div>
    </AtlasThemeProvider>
  )
}

export type ReadingPaneProps = Pick<AtlasPaneProps, 'actions' | 'useStore'> & {
  sessionId: string
  useTabInfo: () => { tab: { visible: boolean; navigation: { revision: number; params?: unknown }; actions: { close: () => void } } }
  onLibrary: (workspaceKey?: string) => void
  onMap?: (id: string) => void
  onPageHistory?: (direction: HistoryDirection, workspaceKey: string) => void
  onViewNavigation?: () => void
  restoreReading?: boolean
} & (
  | ({ offline?: false; host: HostAdapter } & Pick<AtlasPaneProps, 'inputActions' | 'insertReference' | 'bodyEditor'>)
  | { offline: true; host: Pick<HostAdapter, 'read' | 'list'> }
)

export function ReadingPane(props: ReadingPaneProps) {
  const { host, sessionId, actions, useStore, useTabInfo } = props
  const theme = useAtlasTheme(props.offline)
  const { tab } = useTabInfo()
  const stored = useStore(s => s)
  const mapId = stored.selectedMapId

  const [notice, setNotice] = useState('')
  const [noticeFading, setNoticeFading] = useState(false)
  const [noticeRevision, setNoticeRevision] = useState(0)
  const notify = (text: string) => {
    setNotice(text)
    setNoticeRevision(value => value + 1)
  }
  useEffect(() => {
    setNoticeFading(false)
    if (!notice) return
    const fade = setTimeout(() => setNoticeFading(true), 3000)
    const close = setTimeout(() => setNotice(''), 3240)
    return () => { clearTimeout(fade); clearTimeout(close) }
  }, [notice, noticeRevision])

  const root = useRef<HTMLDivElement>(null)
  const lifetime = useRef(new AbortController())
  const navigationBusy = useRef(false)
  const latest = useRef<ReadingLatestSnapshot>({ visible: tab.visible })
  const readingRef = useRef<ReadingState | undefined>()
  const clearDraftRef = useRef<() => void>(() => {})
  const resetNavRef = useRef<() => void>(() => {})

  useEffect(() => {
    lifetime.current = new AbortController()
    return () => { lifetime.current.abort() }
  }, [])

  const doc = useMapDocument({
    sessionId,
    offline: props.offline,
    host,
    mapId,
    actions,
    latestRef: latest,
    lifetime,
    clearDraftRef,
    onResetUiRef: resetNavRef,
    notify,
  })

  const key = doc.snapshot ? readingKey(doc.snapshot.workspaceKey, doc.snapshot.map.id) : ''
  const pending = stored.pending[key]
  const reading = doc.snapshot
    ? ((stored.maps[key]?.sessionId === sessionId ? stored.maps[key] : undefined) ??
      initialReading(doc.snapshot.workspaceKey, sessionId, doc.snapshot.map))
    : undefined

  useLazyNodeResources({
    offline: props.offline,
    host,
    snapshot: doc.snapshot,
    setSnapshot: doc.setSnapshot,
    selectedNodeId: reading?.selectedNodeId,
    editor: doc.editor,
    latestRef: latest,
    lifetime,
    attemptedResources: doc.attemptedResources,
    notify,
  })

  const vp = useViewportLayout({
    sessionId,
    offline: props.offline,
    mapId,
    host,
    snapshot: doc.snapshot,
    reading,
    readingRef,
    editor: doc.editor,
    navigationBusy,
    notify,
  })
  clearDraftRef.current = vp.clearDraft

  const nav = useReadingNavigation({
    sessionId,
    offline: props.offline,
    tab,
    actions,
    snapshot: doc.snapshot,
    latestRef: latest,
    lifetime,
    rootRef: root,
    layout: vp.layout,
    heights: vp.heights,
    readingKeyValue: key,
    pending,
    editor: doc.editor,
    draftRef: vp.draftRef,
    nodeDragging: vp.nodeDragging,
    navigationBusy,
    leaveAction: doc.leaveAction,
    guard: doc.guard,
    load: doc.load,
    restoreReading: props.restoreReading,
    onMap: props.onMap,
    onLibrary: props.onLibrary,
    onPageHistory: props.onPageHistory,
    onViewNavigation: props.onViewNavigation,
    inputActions: props.offline ? undefined : props.inputActions,
    insertReference: props.offline ? undefined : props.insertReference,
    notify,
  })
  resetNavRef.current = nav.resetNavigation

  latest.current = {
    snapshot: doc.snapshot,
    reading,
    mapId,
    reference: nav.reference,
    visible: tab.visible,
  }
  readingRef.current = reading

  const snapshot = doc.snapshot
  const view =
    snapshot?.map.views.find(v => v.id === reading?.viewId) ??
    snapshot?.map.views.find(v => v.id === snapshot.map.rootViewId)
  const viewLayout = vp.layout?.views.find(v => v.viewId === view?.id)
  const node = snapshot?.map.nodes.find(n => n.id === reading?.selectedNodeId)
  const menuNode = snapshot?.map.nodes.find(n => n.id === nav.nodeMenu?.id)

  return (
    <AtlasThemeProvider value={theme}>
      <div className="dsh-atlas-shell" data-atlas-theme={theme.theme}>
        <div
          ref={root}
          className="dsh-atlas reading-pane"
          data-atlas-theme={theme.theme}
          tabIndex={-1}
        onMouseDownCapture={e => {
          if (e.button !== 3 && e.button !== 4) return
          e.preventDefault()
          e.stopPropagation()
        }}
        onMouseUpCapture={e => {
          if (e.button !== 3 && e.button !== 4) return
          e.preventDefault()
          e.stopPropagation()
          nav.traverseHistory(e.button === 3 ? 'back' : 'forward')
        }}
        onAuxClickCapture={e => {
          if (e.button !== 3 && e.button !== 4) return
          e.preventDefault()
          e.stopPropagation()
        }}
        onPointerUpCapture={e => {
          if (e.button === 3 || e.button === 4) e.stopPropagation()
        }}
        onPointerDownCapture={e => {
          if (e.button === 3 || e.button === 4) { e.stopPropagation(); return }
          if (nav.nodeMenu && !(e.target as HTMLElement).closest('.node-menu')) nav.setNodeMenu(undefined)
        }}
        onKeyDown={e => {
          const mod = (e.ctrlKey || e.metaKey) && !(e.ctrlKey && e.metaKey) && !e.altKey
          const keyLower = e.key.toLowerCase()
          const isUndo = mod && !e.shiftKey && keyLower === 'z'
          const isRedo = mod && ((!e.shiftKey && keyLower === 'y') || (e.shiftKey && keyLower === 'z'))
          if (
            !props.offline &&
            (isUndo || isRedo) &&
            !doc.leaveAction &&
            !e.repeat &&
            !e.nativeEvent.isComposing &&
            !(e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')
          ) {
            const entry = doc.editor.current?.travel(isRedo)
            if (entry) {
              nav.navigate(entry.viewId, entry.after.kind === 'details' ? entry.after.nodeId : undefined)
              e.preventDefault()
              e.stopPropagation()
            }
            return
          }
          if ((e.ctrlKey || e.metaKey) && ['f', 'k'].includes(keyLower) && snapshot) {
            e.preventDefault()
            e.stopPropagation()
            nav.openSearch()
          }
          if (e.key === 'Escape') {
            if (nav.searchOpen) {
              e.preventDefault()
              e.stopPropagation()
              nav.closeSearch()
            } else if (nav.nodeMenu) {
              e.preventDefault()
              e.stopPropagation()
              nav.closeNodeMenu()
            } else if (node) {
              e.preventDefault()
              e.stopPropagation()
              void doc.guard(nav.closeNote)
            }
          }
        }}
      >
        {snapshot && view && reading ? (
          <MapHeader
            map={snapshot.map}
            library={() => { void doc.guard(() => props.onLibrary(snapshot.workspaceKey)) }}
            layoutMode={viewLayout?.mode ?? 'vertical'}
            onLayout={mode => vp.changeLayout(mode)}
            onReset={props.offline ? undefined : () => vp.changeLayout('vertical', true)}
            offline={props.offline}
            saveStatus={props.offline ? undefined : {
              state: doc.isSaving ? 'saving' : doc.saveError ? 'error' : vp.nodeDragging || vp.draft || doc.editor.current?.dirty ? 'unsaved' : 'saved',
              detail: doc.isSaving ? undefined : doc.saveError || undefined,
              save: () => { void vp.saveLayoutNow() },
              discard: () => { void doc.discardChanges() },
              canDiscard: !!doc.editor.current?.dirty || !!doc.saveError,
              cleanupAssets: doc.cleanupAssets,
            }}
            exportMap={props.offline ? undefined : () => { void doc.exportOfflineMap(reading.viewId) }}
            view={view}
            maps={doc.listing.maps.filter(m => !doc.listing.library?.data.deletedMapIds?.includes(m.id))}
            selectMap={nav.chooseMap}
            navigate={id => { void doc.guard(() => nav.navigate(id)) }}
            search={nav.openSearch}
            refresh={() => {
              void doc.load()
              void host.list(lifetime.current.signal).then(doc.setListing).catch(e => doc.setError(String(e)))
            }}
          />
        ) : props.offline ? null : (
          <header className="map-header">
            <div className="head-top">
              <h1>思维导图</h1>
              <button className="btn" onClick={() => props.onLibrary(snapshot?.workspaceKey)}>← 全部导图</button>
              <button
                className="btn"
                onClick={() => {
                  doc.setError('')
                  doc.setLoading(true)
                  void host.list(lifetime.current.signal)
                    .then(value => {
                      doc.setListing(value)
                      doc.setLoading(false)
                      if (value.maps[0]) actions.selectMap(value.maps[0].id)
                    })
                    .catch(e => {
                      doc.setError(String(e))
                      doc.setLoading(false)
                    })
                  if (mapId) void doc.load()
                }}
              >
                刷新
              </button>
              <button className="btn" aria-label="关闭地图页签" onClick={() => { void doc.guard(tab.actions.close) }}>
                ×
              </button>
            </div>
            {doc.listing.maps.length > 0 && (
              <select aria-label="选择地图" value={mapId ?? ''} onChange={e => nav.chooseMap(e.target.value)}>
                {!mapId && <option value="">选择地图</option>}
                {doc.listing.maps.map(m => (
                  <option key={m.id} value={m.id}>{m.title}</option>
                ))}
              </select>
            )}
          </header>
        )}
        {snapshot?.diagnostics?.map(d => <p className="status-region" key={d.path}>{d.path}：{d.message}</p>)}
        {!props.offline && doc.leaveAction && (
          <div className="editor-exit-backdrop">
            <section
              className="editor-exit-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="处理未保存修改"
              onKeyDown={e => {
                if (e.key === 'Escape' && !doc.leaving) { e.preventDefault(); e.stopPropagation(); doc.setLeaveAction(undefined) }
                if (e.key === 'Tab') {
                  const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
                  const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
                  e.preventDefault()
                  buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
                }
              }}
            >
              <h3>修改尚未保存</h3>
              <p>{doc.saveError || '当前副本已保留。'}</p>
              <div className="editor-actions">
                <button
                  className="btn"
                  disabled={doc.leaving}
                  onClick={() => {
                    doc.setLeaving(true)
                    void (async () => {
                      try {
                        if (await doc.editor.current?.flush()) {
                          const pendingAction = doc.leaveAction
                          doc.setLeaveAction(undefined)
                          pendingAction?.()
                        }
                      } finally { doc.setLeaving(false) }
                    })()
                  }}
                >
                  重试保存并继续
                </button>
                <button
                  className="btn"
                  disabled={doc.leaving}
                  onClick={() => {
                    doc.setLeaving(true)
                    void (async () => {
                      try {
                        if (await doc.discardChanges()) {
                          const pendingAction = doc.leaveAction
                          doc.setLeaveAction(undefined)
                          pendingAction?.()
                        }
                      } finally { doc.setLeaving(false) }
                    })()
                  }}
                >
                  放弃修改并继续
                </button>
                <button
                  className="btn"
                  ref={doc.leaveCancel}
                  disabled={doc.leaving}
                  onClick={() => { doc.setLeaveAction(undefined); root.current?.focus() }}
                >
                  保留并取消离开
                </button>
              </div>
            </section>
          </div>
        )}
        {(doc.error || doc.watchError) && (
          <div className="status-region" role="status">
            {doc.error && <p>{snapshot ? '外部更新无效，正在阅读最近有效版本。' : '地图读取失败。'} {doc.error}</p>}
            {doc.watchError && <p>{doc.watchError}</p>}
            <button className="btn" onClick={() => { void doc.load() }}>重新读取</button>
          </div>
        )}
        <div className="content-area">
          {snapshot && view && viewLayout && reading ? (
            <MapViewport
              key={view.id}
              centerNodeId={view.centerNodeId}
              camera={reading.cameras[view.id]}
              onCamera={camera => {
                const current = latest.current.reading
                if (!current || current.viewId !== view.id) return
                latest.current.reading = { ...current, cameras: { ...current.cameras, [view.id]: camera } }
                actions.setCamera(key, current, view.id, camera)
              }}
              layout={viewLayout}
              heights={vp.heights}
              phase={nav.phase}
              exitMotion={nav.exitMotion}
            >
              <MapScene
                map={snapshot.map}
                view={view}
                layout={viewLayout}
                heights={vp.heights}
                selected={reading.selectedNodeId}
                locked={nav.phase !== 'idle'}
                onMove={props.offline || !['readonly', 'conflict', 'recovery_required'].includes(doc.editor.current?.status ?? '') ? vp.moveNode : undefined}
                onCommit={vp.commitDrag}
                onDragStart={() => vp.startDrag(viewLayout, () => { nav.setNodeMenu(undefined); nav.setSearchOpen(false) })}
                onDragEnd={() => vp.endDrag(root.current)}
                onMenu={props.offline ? undefined : nav.openNodeMenu}
                onNote={id => { void doc.guard(() => nav.openNote(id)) }}
                onOpen={id => {
                  const targetNode = snapshot.map.nodes.find(n => n.id === id)!
                  const dest = nodeDestination(targetNode, view.id)
                  nav.focus.current = root.current?.querySelector<HTMLElement>(`[data-node="${id}"]`) ?? null
                  void doc.guard(() => { if (dest) nav.navigate(dest); else nav.openNote(id) })
                }}
              />
            </MapViewport>
          ) : (
            <div className="empty-state" aria-live="polite">
              {doc.loading ? '正在读取地图…' : doc.error ? '修正文件或权限后重试。' : (
                <>
                  工作区暂无有效思维导图。
                  <br />将 map.json 与 Markdown 笔记放入 dsh-knowledge-maps/&lt;mapId&gt;/ 后刷新。
                </>
              )}
              {doc.listing.diagnostics.length > 0 && (
                <details>
                  <summary>未载入的目录（{doc.listing.diagnostics.length}）</summary>
                  {doc.listing.diagnostics.map(d => <p key={d.path}>{d.path}：{d.message}</p>)}
                </details>
              )}
            </div>
          )}
          {snapshot && node && reading && !nav.searchOpen && (
            <NoteInspector
              key={`${view?.id}/${node.id}`}
              snapshot={snapshot}
              editSession={props.offline ? undefined : doc.editor.current}
              bodyEditor={props.offline ? undefined : props.bodyEditor}
              viewId={view?.id}
              node={node}
              width={nav.inspectorWidth}
              onWidth={nav.setInspectorWidth}
              scroll={reading.detailScroll}
              onScroll={top => {
                const current = latest.current.reading
                if (current?.viewId === view?.id && current?.selectedNodeId === node.id && current.detailScroll !== top) {
                  const next = { ...current, detailScroll: top }
                  latest.current.reading = next
                  actions.setReading(key, next)
                }
              }}
              onClose={() => { void doc.guard(nav.closeNote) }}
              onFinishEdit={finish => { void doc.guard(finish) }}
              onInsert={props.offline ? undefined : selection => nav.insert(selection)}
              onPlotReference={props.offline ? undefined : plot =>
                nav.insert({ text: plotText(plot), before: '', after: '' }, node.id, 'plot', plot)}
              onPositionReference={props.offline ? undefined : (anchor, text) =>
                nav.insert({ text, before: '', after: '' }, node.id, 'note-position', undefined, anchor)}
              offline={props.offline}
              onRetry={!props.offline && pending ? nav.retry : undefined}
              notify={notify}
              reference={nav.reference?.nodeId === node.id ? nav.reference : undefined}
            />
          )}
          {nav.searchOpen && snapshot && (
            <SearchOverlay
              snapshot={snapshot}
              close={nav.closeSearch}
              choose={result => {
                void doc.guard(() => nav.navigate(snapshot.map.nodes.find(n => n.id === result.nodeId)?.childViewId ?? result.viewId, result.nodeId))
              }}
            />
          )}
          {!props.offline && nav.nodeMenu && menuNode && reading && (
            <NodeMenu
              x={nav.nodeMenu.x}
              y={nav.nodeMenu.y}
              add={() => {
                nav.insert({ text: readableNote(menuNode.title, menuNode.summary, snapshot?.notes[menuNode.id] ?? ''), before: '', after: '' }, menuNode.id, 'node')
                nav.closeNodeMenu()
              }}
              close={nav.closeNodeMenu}
            />
          )}
          {notice && (
            <div className={`notice ${noticeFading ? 'is-fading' : ''}`} role="status">
              <span>{notice}</span>
              <button aria-label="关闭提示" onClick={() => setNotice('')}>×</button>
            </div>
          )}
          {nav.pendingAutoOpen && (
            <div className="status-region" role="status">
              <span>AI 已完成导图更新。</span>
              <button className="btn" onClick={nav.acceptPendingAutoOpen}>查看更新</button>
              <button className="btn" onClick={() => nav.setPendingAutoOpen(undefined)}>忽略</button>
            </div>
          )}
          {nav.reference && (!snapshot || !snapshot.map.nodes.some(n => n.id === nav.reference!.nodeId) || !sameWorkspaceKey(snapshot.workspaceKey, nav.reference.workspaceKey)) && (
            <aside className="reference-fallback">
              <strong>引用原文快照</strong>
              <blockquote>{nav.reference.text}</blockquote>
              <p>{nav.reference.mapTitle} / {nav.reference.nodeTitle}</p>
              <button className="btn" onClick={() => nav.setReference(undefined)}>关闭快照</button>
            </aside>
          )}
        </div>
        <div ref={vp.measurements} className="measure-nodes" aria-hidden="true">
          {snapshot?.map.views.flatMap(v =>
            v.occurrences.map(o => (
              <NodeCard
                key={`${v.id}/${o.nodeId}`}
                measure
                node={snapshot.map.nodes.find(n => n.id === o.nodeId)!}
                viewId={v.id}
                layout={snapshot.layout?.views.find(x => x.viewId === v.id)?.nodes.find(n => n.nodeId === o.nodeId)}
              />
            )),
          )}
        </div>
      </div>
      </div>
    </AtlasThemeProvider>
  )
}
