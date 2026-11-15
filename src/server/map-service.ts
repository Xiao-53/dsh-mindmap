import { purgeMap } from './purge-map.ts'
import { serializeMap } from './map-queue.ts'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceFileScope } from '@deepseek-ai/dsh-api-workspace-files'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  createHostFiles,
  listMapHeaders,
  readSnapshot,
  saveLayout,
  errorCode,
  AtlasError,
} from './map-files.ts'
import { idSchema } from '../shared/validate-map.ts'
import { layoutSchema } from '../shared/validate-layout.ts'
import { librarySchema } from '../shared/library.ts'
import { libraryFiles } from './library-files.ts'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session'
const requestSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('list') }),
  z.strictObject({ op: z.literal('purge'), mapIds: z.array(idSchema).min(1), version: z.string().nullable(), expectedWorkspaceKey: z.string().min(1) }),
  z.strictObject({ op: z.literal('rename'), mapId: idSchema, title: z.string().trim().min(1).max(120), previousTitle: z.string(), expectedWorkspaceKey: z.string().min(1) }),
  z.strictObject({ op: z.literal('create'), title: z.string().trim().min(1).max(120), expectedWorkspaceKey: z.string().min(1) }),
  z.strictObject({ op: z.literal('saveLibrary'), data: librarySchema, version: z.string().nullable(), expectedWorkspaceKey: z.string().min(1) }),
  z.strictObject({
    op: z.literal('read'),
    mapId: idSchema,
    expectedWorkspaceKey: z.string().min(1).optional(),
  }),
  z.strictObject({
    op: z.literal('saveLayout'),
    mapId: idSchema,
    expectedFingerprint: z.string().min(1),
    expectedWorkspaceKey: z.string().min(1),
    layout: layoutSchema,
    manual: z.boolean().optional(),
  }),
])
declare module '@deepseek-ai/cordis' {
  interface Context {
    dshAtlas: MapService
  }
}
export class MapService extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'dshAtlas')
  }
  @Remote
  async request(
    workspaceFileScope: WorkspaceFileScope,
    payload: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const req = requestSchema.parse(JSON.parse(payload))
      if (
        req.op !== 'list' &&
        req.expectedWorkspaceKey !== undefined &&
        req.expectedWorkspaceKey !== workspaceFileScope.workspaceRoot
      )
        throw new AtlasError(
          'workspace_changed',
          '来源会话的工作区已变化，拒绝读取或保存到另一个工作区',
        )
      const key = `${workspaceFileScope.workspaceRoot}\0${'mapId' in req ? req.mapId : ''}`
      const run = async () => {
        signal.throwIfAborted()
        const writes = req.op === 'purge' || req.op === 'rename' || req.op === 'create' || req.op === 'saveLibrary' || req.op === 'saveLayout'
        const session = writes ? this.ctx.sessions.get(workspaceFileScope.sessionId) : undefined
        if (writes && !session) throw new AtlasError('session_unavailable', '来源会话未加载，无法保存')
        const policy = writes ? this.ctx.sandboxPolicy.resolve({ session }) : undefined
        if (policy?.mode === 'read-only') throw new AtlasError('permission_denied', '当前会话为只读，布局保留在内存；切换到允许工作区写入的会话后可重试')
        if (policy && policy.workspaceRoot !== workspaceFileScope.workspaceRoot)
          throw new AtlasError('workspace_changed', '会话写入工作区已变化')
        const port = createHostFiles(this.ctx, workspaceFileScope, signal, policy)
        const library = libraryFiles(this.ctx, workspaceFileScope, signal, policy)
        if (req.op === 'purge') {
          let current = await library.read()
          if (current.version !== req.version) throw new AtlasError('version_conflict', '目录已变化，请重新载入后再删除')
          const ids = [...new Set(req.mapIds)]
          if (ids.some(id => !current.data.deletedMapIds?.includes(id))) throw new AtlasError('invalid_data', '只允许永久删除当前回收站中的导图')
          const titles = { ...current.data.deletedMapTitles }
          for (const id of ids) if (!titles[id]) {
            try { titles[id] = (await readSnapshot(port, id)).map.title } catch { /* 已中断删除的旧记录仍按稳定ID展示。 */ }
          }
          current = await library.save({ ...current.data, deletedMapTitles: titles, purgingMapIds: [...new Set([...(current.data.purgingMapIds ?? []), ...ids])] }, current.version)
          const deletedIds: string[] = []; const failures: { id: string; message: string }[] = []
          for (const id of ids) {
            try {
              await serializeMap(`${workspaceFileScope.workspaceRoot}\0${id}`, () => purgeMap(this.ctx, workspaceFileScope, id, policy!, signal))
              deletedIds.push(id)
            } catch(e) { failures.push({ id, message: String(e) }); if (signal.aborted) break }
          }
          const purged = new Set([...(current.data.purgedMapIds ?? []), ...deletedIds])
          const state = deletedIds.length ? await library.save({ ...current.data, purgedMapIds: [...purged],
            deletedMapIds: current.data.deletedMapIds?.filter(id => !purged.has(id)),
            purgingMapIds: current.data.purgingMapIds?.filter(id => !purged.has(id)),
            deletedMapTitles: Object.fromEntries(Object.entries(current.data.deletedMapTitles ?? {}).filter(([id]) => !purged.has(id))),
            mapFolders: Object.fromEntries(Object.entries(current.data.mapFolders).filter(([id]) => !purged.has(id))),
          }, current.version) : current
          return { deletedIds, failures, library: state }
        }
        if (req.op === 'create') return library.create(req.title)
        if (req.op === 'saveLibrary') {
          const previous = await library.read()
          if ((previous.data.purgingMapIds ?? []).some(id => !req.data.deletedMapIds?.includes(id) || !req.data.purgingMapIds?.includes(id)) || (previous.data.purgedMapIds ?? []).some(id => !req.data.purgedMapIds?.includes(id))) throw new AtlasError('purge_pending', '永久删除已开始，不能还原该导图；请在回收站继续删除')
          return library.save(req.data, req.version)
        }
        if (req.op === 'list') {
          let state
          let libraryError: unknown
          try { state = await library.read() } catch (e) { libraryError = e }
          const listing = await listMapHeaders(port, new Set([...(state?.data.purgedMapIds ?? []), ...(state?.data.purgingMapIds ?? [])]))
          listing.library = state
          if (libraryError) listing.diagnostics.push({ path: 'library.json', code: errorCode(libraryError), message: String(libraryError) })
          return listing
        }
        const currentLibrary = (await library.read()).data
        if (currentLibrary.deletedMapIds?.includes(req.mapId) || currentLibrary.purgedMapIds?.includes(req.mapId)) throw new AtlasError('map_deleted', '此导图已在回收站，请先恢复')
        if (req.op === 'rename') {
          const snapshot = await readSnapshot(port, req.mapId)
          if (snapshot.map.title !== req.previousTitle) throw new AtlasError('version_conflict', '导图名称已变化，请刷新后重试')
          const file = snapshot.files.find(file => file.path === `dsh-knowledge-maps/${req.mapId}/map.json`)!
          await library.rename(snapshot.map, req.title, file.version)
          return null
        }
        return req.op === 'read'
            ? readSnapshot(port, req.mapId)
            : saveLayout(port, req.mapId, req.expectedFingerprint, req.layout, req.manual)
      }
      return JSON.stringify({ ok: true, value: await (req.op === 'list' ? run() : serializeMap(key,run)) })
    } catch (e) {
      signal.throwIfAborted()
      return JSON.stringify({
        ok: false,
        code: errorCode(e),
        message: e instanceof Error ? e.message : String(e),
        diagnostics:
          typeof e === 'object' && e !== null && 'diagnostics' in e
            ? e.diagnostics
            : [],
      })
    }
  }
}
