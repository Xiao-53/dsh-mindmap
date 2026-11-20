import { commitEdit, commitEditSchema, editStatus, editStatusSchema, evictEditMemory } from './edit-service.ts'
import { purgeMap } from './purge-map.ts'
import { cleanupCreate } from './cleanup-create.ts'
import { serializeMap } from './map-queue.ts'
import { transactionPort } from './tools/storage.ts'
import { validateImage } from '../shared/image-resource.ts'
import { collectLocalImageHrefs } from '../shared/note-markdown.ts'
import { workspaceComparisonKey, sameWorkspaceKey } from '../shared/workspace-path.ts'
import { posix } from 'node:path'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceFileScope } from '@deepseek-ai/dsh-api-workspace-files'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  createHostFiles,
  inspectCreatePlaceholder,
  isNotFoundError,
  listMapHeaders,
  localPath,
  mapPath,
  readNodeResources,
  readSnapshot,
  saveLayout,
  errorCode,
  AtlasError,
} from './map-files.ts'
import { idSchema } from '../shared/validate-map.ts'
import { layoutSchema } from '../shared/validate-layout.ts'
import { librarySchema, type LibraryState, type MapLibrary } from '../shared/library.ts'
import { prunePurgedFromOrders } from '../shared/library-order.ts'
import { libraryFiles } from './library-files.ts'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session'
const requestSchema = z.discriminatedUnion('op', [
  commitEditSchema,
  editStatusSchema,
  z.strictObject({ op: z.literal('list') }),
  z.strictObject({ op: z.literal('cleanupCreate'), mapId: idSchema, operationId: idSchema, expectedWorkspaceKey: z.string().min(1) }),
  z.strictObject({ op: z.literal('cleanupOrphanAssets'), mapId: idSchema, expectedFingerprint: z.string().min(1), expectedWorkspaceKey: z.string().min(1), assetIds: z.array(idSchema).optional() }),
  z.strictObject({ op: z.literal('compactRetired'), expectedWorkspaceKey: z.string().min(1), keepRecent: z.number().int().min(0).optional() }),
  z.strictObject({ op: z.literal('purge'), mapIds: z.array(idSchema).min(1), version: z.string().nullable(), expectedWorkspaceKey: z.string().min(1) }),
  z.strictObject({ op: z.literal('rename'), mapId: idSchema, title: z.string().trim().min(1).max(120), previousTitle: z.string(), expectedWorkspaceKey: z.string().min(1) }),
  z.strictObject({ op: z.literal('create'), title: z.string().trim().min(1).max(120), expectedWorkspaceKey: z.string().min(1) }),
  z.strictObject({ op: z.literal('saveLibrary'), data: librarySchema, version: z.string().nullable(), expectedWorkspaceKey: z.string().min(1) }),
  z.strictObject({
    op: z.literal('read'),
    mapId: idSchema,
    expectedWorkspaceKey: z.string().min(1).optional(),
    omitResources: z.boolean().optional(),
  }),
  z.strictObject({
    op: z.literal('readResources'),
    mapId: idSchema,
    nodeIds: z.array(idSchema).min(1).max(64).optional(),
    expectedWorkspaceKey: z.string().min(1).optional(),
  }),
  z.strictObject({
    op: z.literal('saveLayout'),
    mapId: idSchema,
    expectedFingerprint: z.string().min(1),
    expectedWorkspaceKey: z.string().min(1),
    layout: layoutSchema,
    manual: z.boolean().optional(),
    omitResources: z.boolean().optional(),
  }),
])

async function updateLibraryWithRetry(
  library: ReturnType<typeof libraryFiles>,
  mutator: (current: LibraryState) => MapLibrary | null,
  maxRetries = 5,
): Promise<LibraryState> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const current = await library.read()
    const next = mutator(current)
    if (!next) return current
    try {
      return await library.save(next, current.version)
    } catch (e) {
      if (errorCode(e) !== 'version_conflict' || attempt === maxRetries - 1) throw e
    }
  }
  return library.read()
}
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
    let operationId:string|undefined
    try {
      if(new TextEncoder().encode(payload).length>24*1024*1024)throw new AtlasError('resource_too_large','请求超过 24 MiB')
      const req = requestSchema.parse(JSON.parse(payload))
      operationId='operationId' in req?req.operationId:undefined
      if (
        req.op !== 'list' &&
        req.expectedWorkspaceKey !== undefined &&
        !sameWorkspaceKey(req.expectedWorkspaceKey, workspaceFileScope.workspaceRoot)
      )
        throw new AtlasError(
          'workspace_changed',
          '来源会话的工作区已变化，拒绝读取或保存到另一个工作区',
        )
      const wsKey = workspaceComparisonKey(workspaceFileScope.workspaceRoot)
      const libraryQueueKey = `${wsKey}\0__library__`
      const key =
        req.op === 'saveLibrary' || req.op === 'create' || req.op === 'compactRetired'
          ? libraryQueueKey
          : req.op === 'purge'
            ? `${wsKey}\0__purge__`
            : `${wsKey}\0${'mapId' in req ? req.mapId : ''}`
      const run = async () => {
        signal.throwIfAborted()
        const writes = req.op === 'commitEdit' || req.op === 'cleanupCreate' || req.op === 'cleanupOrphanAssets' || req.op === 'compactRetired' || req.op === 'purge' || req.op === 'rename' || req.op === 'create' || req.op === 'saveLibrary' || req.op === 'saveLayout'
        const session = writes ? this.ctx.sessions.get(workspaceFileScope.sessionId) : undefined
        if (writes && !session) throw new AtlasError('session_unavailable', '来源会话未加载，无法保存')
        const policy = writes ? this.ctx.sandboxPolicy.resolve({ session }) : undefined
        if (policy?.mode === 'read-only') throw new AtlasError('permission_denied', '当前会话为只读，布局保留在内存；切换到允许工作区写入的会话后可重试')
        if (policy && !sameWorkspaceKey(policy.workspaceRoot, workspaceFileScope.workspaceRoot))
          throw new AtlasError('workspace_changed', '会话写入工作区已变化')
        const port = createHostFiles(this.ctx, workspaceFileScope, signal, policy)
        const library = libraryFiles(this.ctx, workspaceFileScope, signal, policy)
        if (req.op === 'cleanupCreate') return cleanupCreate(this.ctx, workspaceFileScope, req.mapId, req.operationId, policy!, signal)
        if (req.op === 'compactRetired') {
          const ids = await port.list()
          const retiredCreates: string[] = []
          const retiredPurges: string[] = []
          for (const id of ids) {
            if (!/^[A-Za-z0-9_-]+$/.test(id)) continue
            const placeholder = await (async () => { try { return await inspectCreatePlaceholder(port, id) } catch { return undefined } })()
            if (placeholder?.state === 'discarded') {
              retiredCreates.push(id)
              continue
            }
            if (!await port.absent(mapPath(id, 'map.json')) || !await port.absent(mapPath(id, '.transactions/active.json'))) continue
            const txPort = transactionPort(this.ctx, workspaceFileScope, id, policy!)
            const purgeRecord = await txPort.read('.transactions/purge.json')
            if (!purgeRecord) continue
            let parsedPurge: { mapId?: string; state?: string; files?: { path: string }[] }
            try { parsedPurge = JSON.parse(purgeRecord.text) } catch { continue }
            if (parsedPurge.mapId !== id || parsedPurge.state !== 'completed') continue
            if (Array.isArray(parsedPurge.files)) {
              let allAbsent = true
              for (const f of parsedPurge.files) {
                if (!await port.absent(mapPath(id, f.path))) { allAbsent = false; break }
              }
              if (!allAbsent) continue
            }
            if (port.listEntries) {
              const rootEntries = await port.listEntries(id, '.')
              const txEntries = await port.listEntries(id, '.transactions')
              const cleanRoot = rootEntries.every(e => e.type === 'directory' && ['.transactions', 'notes', 'assets'].includes(e.name))
              const cleanTx = txEntries.length === 1 && txEntries[0].name === 'purge.json' && txEntries[0].type === 'file'
              if (!cleanRoot || !cleanTx) continue
              if (rootEntries.some(e => e.name === 'notes') && (await port.listEntries(id, 'notes')).some(e => e.type !== 'directory')) continue
              if (rootEntries.some(e => e.name === 'assets') && (await port.listEntries(id, 'assets')).some(e => e.type !== 'directory')) continue
            }
            retiredPurges.push(id)
          }
          const candidates = [
            ...retiredCreates.map(id => ({ kind: 'create' as const, id })),
            ...retiredPurges.map(id => ({ kind: 'purge' as const, id })),
          ].sort((a, b) => a.id.localeCompare(b.id))
          const keepRecent = req.keepRecent ?? 0
          const targets = keepRecent > 0 ? candidates.slice(0, Math.max(0, candidates.length - keepRecent)) : candidates
          if (!targets.length) return { compactedIds: [], library: await library.read() }
          const targetCreates = targets.filter(t => t.kind === 'create').map(t => t.id)
          const targetPurges = targets.filter(t => t.kind === 'purge').map(t => t.id)
          const nextLibrary = await updateLibraryWithRetry(library, current => {
            const purged = new Set([...(current.data.purgedMapIds ?? []), ...targetPurges])
            const retiredCreateIds = [...new Set([...(current.data.retiredCreateIds ?? []), ...targetCreates])]
            const orders = prunePurgedFromOrders(current.data, purged)
            const { rootMapOrder: _r, folderMapOrders: _f, ...base } = current.data
            return {
              ...base,
              ...orders,
              ...(retiredCreateIds.length ? { retiredCreateIds } : {}),
              ...(purged.size ? { purgedMapIds: [...purged] } : {}),
              deletedMapIds: current.data.deletedMapIds?.filter(id => !purged.has(id)),
              purgingMapIds: current.data.purgingMapIds?.filter(id => !purged.has(id)),
              deletedMapTitles: Object.fromEntries(Object.entries(current.data.deletedMapTitles ?? {}).filter(([id]) => !purged.has(id))),
              mapFolders: Object.fromEntries(Object.entries(current.data.mapFolders).filter(([id]) => !purged.has(id))),
            }
          })
          const compactedIds: string[] = []
          for (const target of targets) {
            const marker = target.kind === 'create' ? '.transactions/discarded-create.json' : '.transactions/purge.json'
            const txPort = transactionPort(this.ctx, workspaceFileScope, target.id, policy!)
            const record = await txPort.read(marker)
            if (record) {
              await txPort.remove(marker, record.version)
              compactedIds.push(target.id)
            }
          }
          return { compactedIds, library: nextLibrary }
        }
        if (req.op === 'purge') {
          const ids = [...new Set(req.mapIds)]
          const pre = await serializeMap(libraryQueueKey, async () => {
            const current = await library.read()
            if (current.version !== req.version) throw new AtlasError('version_conflict', '目录已变化，请重新载入后再删除')
            if (ids.some(id => !current.data.deletedMapIds?.includes(id) && !current.data.purgingMapIds?.includes(id)))
              throw new AtlasError('invalid_data', '只允许永久删除当前回收站中的导图')
            const titles = { ...current.data.deletedMapTitles }
            for (const id of ids) if (!titles[id]) {
              try { titles[id] = (await readSnapshot(port, id, false, { omitResources: true })).map.title } catch { /* 已中断删除的旧记录仍按稳定ID展示。 */ }
            }
            return library.save({ ...current.data, deletedMapTitles: titles, purgingMapIds: [...new Set([...(current.data.purgingMapIds ?? []), ...ids])] }, current.version)
          })
          const deletedIds: string[] = []; const failures: { id: string; message: string }[] = []
          for (const id of ids) {
            try {
              await serializeMap(`${wsKey}\0${id}`, () => purgeMap(this.ctx, workspaceFileScope, id, policy!, signal))
              evictEditMemory(workspaceFileScope.workspaceRoot, id)
              deletedIds.push(id)
            } catch(e) { failures.push({ id, message: String(e) }); if (signal.aborted) break }
          }
          const state = deletedIds.length
            ? await serializeMap(libraryQueueKey, () => updateLibraryWithRetry(library, current => {
                const purged = new Set([...(current.data.purgedMapIds ?? []), ...deletedIds])
                const orders = prunePurgedFromOrders(current.data, purged)
                const { rootMapOrder: _rootOrder, folderMapOrders: _folderOrders, ...baseLibrary } = current.data
                return {
                  ...baseLibrary,
                  ...orders,
                  purgedMapIds: [...purged],
                  deletedMapIds: current.data.deletedMapIds?.filter(id => !purged.has(id)),
                  purgingMapIds: current.data.purgingMapIds?.filter(id => !purged.has(id)),
                  deletedMapTitles: Object.fromEntries(Object.entries(current.data.deletedMapTitles ?? {}).filter(([id]) => !purged.has(id))),
                  mapFolders: Object.fromEntries(Object.entries(current.data.mapFolders).filter(([id]) => !purged.has(id))),
                }
              }))
            : pre
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
          const purgedIds = state?.data.purgedMapIds ?? []
          const purgingIds = state?.data.purgingMapIds ?? []
          const retiredCreates = state?.data.retiredCreateIds ?? []
          const listing = await listMapHeaders(
            port,
            new Set([...purgedIds, ...purgingIds]),
            new Set([...purgedIds, ...retiredCreates]),
          )
          listing.library = state
          if (libraryError) listing.diagnostics.push({ path: 'library.json', code: errorCode(libraryError), message: String(libraryError) })
          return listing
        }
        const currentLibrary = (await library.read()).data
        if (currentLibrary.deletedMapIds?.includes(req.mapId) || currentLibrary.purgedMapIds?.includes(req.mapId)) throw new AtlasError('map_deleted', '此导图已在回收站，请先恢复')
        if (req.op === 'cleanupOrphanAssets') {
          const snapshot = await readSnapshot(port, req.mapId, false, { omitResources: true })
          if (snapshot.fingerprint !== req.expectedFingerprint)
            throw new AtlasError('version_conflict', '地图已变化，取消清理孤立图片')
          const referencedIds = new Set<string>()
          for (const node of snapshot.map.nodes) {
            if (!node.notePath) continue
            const markdown = snapshot.notes[node.id] ?? ''
            const noteDir = posix.dirname(localPath(node.notePath))
            for (const href of collectLocalImageHrefs(markdown)) {
              try {
                const clean = decodeURIComponent(href.split(/[?#]/)[0])
                const rel = localPath(posix.join(noteDir, clean))
                if (rel.startsWith('assets/') && rel.endsWith('.image.json')) {
                  referencedIds.add(rel.slice('assets/'.length, -'.image.json'.length))
                }
              } catch { /* 忽略无法解码的非法引用 */ }
            }
          }
          if (await port.absent(mapPath(req.mapId, 'assets'))) return { deletedAssetIds: [], skipped: [] }
          let entries: readonly { name: string; type: string }[] = []
          try {
            entries = port.listEntries ? await port.listEntries(req.mapId, 'assets') : []
          } catch (e) {
            if (isNotFoundError(e) || errorCode(e) === 'invalid_data') return { deletedAssetIds: [], skipped: [] }
            throw e
          }
          const targetFilter = req.assetIds ? new Set(req.assetIds) : undefined
          const txPort = transactionPort(this.ctx, workspaceFileScope, req.mapId, policy!)
          const deletedAssetIds: string[] = []
          const skipped: { id: string; reason: string }[] = []
          for (const entry of entries) {
            if (entry.type !== 'file') continue
            const matched = /^([A-Za-z0-9_-]{1,128})\.image\.json$/.exec(entry.name)
            if (!matched) continue
            const assetId = matched[1]
            if (targetFilter && !targetFilter.has(assetId)) continue
            if (referencedIds.has(assetId)) {
              skipped.push({ id: assetId, reason: 'in_use' })
              continue
            }
            const relPath = `assets/${entry.name}`
            const record = await txPort.read(relPath)
            if (!record) {
              skipped.push({ id: assetId, reason: 'not_found' })
              continue
            }
            try {
              const validated = await validateImage(JSON.parse(record.text))
              if (validated.id !== assetId) {
                skipped.push({ id: assetId, reason: 'invalid_identity' })
                continue
              }
            } catch {
              skipped.push({ id: assetId, reason: 'invalid_image' })
              continue
            }
            await txPort.remove(relPath, record.version)
            deletedAssetIds.push(assetId)
          }
          return { deletedAssetIds, skipped }
        }
        if (req.op === 'editStatus') return editStatus(this.ctx,workspaceFileScope,req,signal)
        if (req.op === 'commitEdit') return commitEdit(this.ctx,workspaceFileScope,req,policy!,signal)
        if (req.op === 'rename') {
          const snapshot = await readSnapshot(port, req.mapId, false, { omitResources: true })
          if (snapshot.map.title !== req.previousTitle) throw new AtlasError('version_conflict', '导图名称已变化，请刷新后重试')
          const file = snapshot.files.find(file => file.path === `dsh-knowledge-maps/${req.mapId}/map.json`)!
          await library.rename(snapshot.map, req.title, file.version)
          return null
        }
        if (req.op === 'readResources') return readNodeResources(port, req.mapId, req.nodeIds)
        return req.op === 'read'
            ? readSnapshot(port, req.mapId, true, { omitResources: req.omitResources })
            : saveLayout(port, req.mapId, req.expectedFingerprint, req.layout, req.manual, { omitResources: req.omitResources })
      }
      return JSON.stringify({ ok: true, value: await (req.op === 'list' ? run() : serializeMap(key,run)) })
    } catch (e) {
      signal.throwIfAborted()
      return JSON.stringify({
        ok: false,
        operationId,
        commitState: errorCode(e)==='failed_rolled_back'?'rolled_back':['verification_required','permission_denied','invalid_data','resource_too_large','workspace_changed','session_unavailable'].includes(errorCode(e))?'not_applied':'unknown',
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
