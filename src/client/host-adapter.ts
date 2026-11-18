import type { EditRequest, EditStatusRequest, EditStatusResult } from '../server/edit-service.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import { requestMethod } from '../shared/rpc.ts'
import type { MapSnapshot, MapLayout, MapListing } from '../shared/map-types.ts'
import { watchPaths } from '../server/watch-map.ts'
import type { LibraryState, MapLibrary } from '../shared/library.ts'
export interface HostAdapter {
  editStatus?(request: EditStatusRequest, signal: AbortSignal): Promise<EditStatusResult>
  commitEdit?(request: EditRequest, signal: AbortSignal): Promise<{snapshot:MapSnapshot; committedFingerprint:string; noChange:boolean}>
  cleanupCreate?(mapId: string, operationId: string, workspaceKey: string, signal: AbortSignal): Promise<void>
  watchLibrary?(listing: MapListing, changed: (externalChange?: boolean) => void, signal: AbortSignal): () => void
  purge(mapIds: string[], previous: LibraryState, signal: AbortSignal): Promise<{ deletedIds: string[]; failures: { id: string; message: string }[]; library: LibraryState }>
  rename(mapId: string, title: string, previousTitle: string, workspaceKey: string, signal: AbortSignal): Promise<void>
  create(title: string, workspaceKey: string, signal: AbortSignal): Promise<string>
  saveLibrary(data: MapLibrary, previous: LibraryState, signal: AbortSignal): Promise<LibraryState>
  list(signal: AbortSignal): Promise<MapListing>
  read(
    mapId: string,
    signal: AbortSignal,
    expectedWorkspaceKey?: string,
  ): Promise<MapSnapshot>
  saveLayout(
    snapshot: MapSnapshot,
    layout: MapLayout,
    signal: AbortSignal,
    manual?: boolean,
  ): Promise<MapSnapshot>
  watch(
    snapshot: MapSnapshot,
    changed: () => void,
    failed: (message: string) => void,
    signal: AbortSignal,
  ): () => void
}
export function createHostAdapter(
  ctx: Context,
  sessionId: SessionId,
): HostAdapter {
  async function call<T>(payload: object, signal: AbortSignal): Promise<T> {
    const result = await requestMethod.invoke(
      ctx.remote,
      { workspaceFileScopeId: sessionId, payload: JSON.stringify(payload) },
      signal,
    )
    if (!result.ok) throw new Error(result.error.message)
    const body = JSON.parse(result.value)
    if (!body.ok)
      throw Object.assign(new Error(
        [
          body.message,
          ...(body.diagnostics ?? []).map(
            (d: { path: string; message: string }) => `${d.path}：${d.message}`,
          ),
        ].join('\n'),
      ), { code: body.code, diagnostics: body.diagnostics, operationId:body.operationId, commitState:body.commitState })
    return body.value
  }
  return {
    editStatus: (request, signal) => call(request, signal),
    commitEdit: (request, signal) => call(request, signal),
    cleanupCreate: async (mapId, operationId, expectedWorkspaceKey, signal) => { await call({op:'cleanupCreate',mapId,operationId,expectedWorkspaceKey},signal) },
    watchLibrary(listing, changed, signal) {
      const controller = new AbortController()
      const stop = () => controller.abort()
      signal.addEventListener('abort', stop, { once: true })
      if (signal.aborted) stop()
      let timer: ReturnType<typeof setTimeout> | undefined
      let initialCheck = false
      let contentChanged = false
      const ids = new Set([...listing.maps.map(map => map.id), ...(listing.incompleteCreates ?? []).map(item => item.mapId), ...listing.diagnostics.map(d => d.path.split('/')[1]).filter(id => id && /^[A-Za-z0-9_-]+$/.test(id))])
      const paths = new Set(['.', 'dsh-knowledge-maps', 'dsh-knowledge-maps/library.json'])
      for (const id of ids) for (const path of ['', '/map.json', '/.transactions', '/.transactions/active.json', '/.transactions/purge.json']) paths.add(`dsh-knowledge-maps/${id}${path}`)
      for (const path of paths) void (async () => {
        const stream = ctx.remote.workspaceFiles.changes(sessionId, path, controller.signal)
        try {
          for await (const frame of stream) {
            if (frame.kind === 'ready') { if (initialCheck) continue; initialCheck = true }
            else if (frame.kind === 'change') contentChanged = true
            else continue
            clearTimeout(timer)
            timer = setTimeout(() => {
              if (!controller.signal.aborted) { const dirty = contentChanged; contentChanged = false; changed(dirty) }
            }, 120)
          }
        } catch { /* 目录不存在或宿主不支持该观察时，返回页签/窗口聚焦仍会重新载入。 */ }
        finally { stream.dispose() }
      })()
      return () => { stop(); clearTimeout(timer); signal.removeEventListener('abort', stop) }
    },
    purge: (mapIds, previous, signal) => call({ op: 'purge', mapIds, version: previous.version, expectedWorkspaceKey: previous.workspaceKey }, signal),
    rename: (mapId, title, previousTitle, expectedWorkspaceKey, signal) => call({ op: 'rename', mapId, title, previousTitle, expectedWorkspaceKey }, signal),
    create: (title, expectedWorkspaceKey, signal) => call({ op: 'create', title, expectedWorkspaceKey }, signal),
    saveLibrary: (data, previous, signal) => call({ op: 'saveLibrary', data, version: previous.version, expectedWorkspaceKey: previous.workspaceKey }, signal),
    list: (signal) => call({ op: 'list' }, signal),
    read: (mapId, signal, expectedWorkspaceKey) =>
      call({ op: 'read', mapId, expectedWorkspaceKey }, signal),
    saveLayout: (snapshot, layout, signal, manual) =>
      call(
        {
          op: 'saveLayout',
          mapId: snapshot.map.id,
          expectedFingerprint: snapshot.fingerprint,
          expectedWorkspaceKey: snapshot.workspaceKey,
          layout,
          manual,
        },
        signal,
      ),
    watch(snapshot, changed, failed, signal) {
      const controller = new AbortController()
      const stop = () => controller.abort()
      signal.addEventListener('abort', stop, { once: true })
      let timer: ReturnType<typeof setTimeout> | undefined
      const invalidate = () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          if (!controller.signal.aborted) changed()
        }, 80)
      }
      for (const path of watchPaths(snapshot)) {
        void (async () => {
          const stream = ctx.remote.workspaceFiles.changes(
            sessionId,
            path,
            controller.signal,
          )
          try {
            // ready 之后复核一次快照，弥合初次读取与订阅建立之间的窗口。
            for await (const frame of stream) {
              if (frame.kind === 'ready' || frame.kind === 'change')
                invalidate()
            }
            if (!controller.signal.aborted)
              failed(`文件观察已结束：${path}。请手动刷新。`)
          } catch (e) {
            if (!controller.signal.aborted)
              failed(
                `文件观察不可用：${path}；${e instanceof Error ? e.message : String(e)}。请手动刷新。`,
              )
          } finally {
            stream.dispose()
          }
        })()
      }
      return () => {
        stop()
        clearTimeout(timer)
        signal.removeEventListener('abort', stop)
      }
    },
  }
}
