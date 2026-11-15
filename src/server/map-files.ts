import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceFileScope } from '@deepseek-ai/dsh-api-workspace-files'
import type { FsTarget, FsVersion } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { posix } from 'node:path'
import { Lexer, walkTokens } from 'marked'
import { digest, fingerprint } from '../shared/fingerprint.ts'
import { validateMap } from '../shared/validate-map.ts'
import { validateLayout } from '../shared/validate-layout.ts'
import type {
  MapSnapshot,
  MapListing,
  ReadFile,
  Diagnostic,
  MapLayout,
} from '../shared/map-types.ts'

export const DATA_ROOT = 'dsh-knowledge-maps'
export class AtlasError extends Error {
  code: string
  diagnostics: Diagnostic[]
  constructor(code: string, message: string, diagnostics: Diagnostic[] = []) {
    super(message)
    this.code = code
    this.diagnostics = diagnostics
  }
}
export interface FileRecord {
  bytes: Uint8Array
  version: string
  identity: string
}
export interface MapFilePort {
  workspaceKey: string
  read(path: string, mapId: string, assetsOnly?: boolean): Promise<FileRecord>
  absent(path: string): Promise<boolean>
  list(): Promise<string[]>
  listEntries?(mapId: string, relative: string): Promise<readonly { name: string; type: string }[]>
  writeLayout(
    mapId: string,
    text: string,
    expectedVersion?: string,
  ): Promise<void>
}
export const errorCode = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e
    ? String(e.code)
    : e instanceof SyntaxError || (e instanceof Error && e.name === 'ZodError')
      ? 'invalid_data'
      : 'storage_failure'
const missing = (e: unknown) =>
  ['workspace-file/not-found', 'FS_NOT_FOUND'].includes(errorCode(e))
export function localPath(path: string): string {
  const raw = path.replaceAll('\\', '/')
  if (
    !raw ||
    raw.includes('\0') ||
    raw.startsWith('/') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)
  )
    throw new AtlasError('path_outside_map', `拒绝非相对路径：${path}`)
  const normalized = posix.normalize(raw)
  if (normalized === '..' || normalized.startsWith('../'))
    throw new AtlasError('path_outside_map', `路径越界：${path}`)
  return normalized
}
export function mapPath(id: string, path: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    throw new AtlasError('invalid_data', '地图身份非法')
  return `${DATA_ROOT}/${id}/${localPath(path)}`
}
export function createHostFiles(
  ctx: Context,
  scope: WorkspaceFileScope,
  signal: AbortSignal,
  policy?: SandboxExecutionPolicy,
): MapFilePort {
  const targets = new Map<string, FsTarget>()
  async function boundary(
    path: string,
    mapId: string,
    assetsOnly = false,
  ): Promise<FsTarget> {
    const root = await ctx.fs.resolve(scope.workspaceRoot, { signal })
    const data = await ctx.fs.resolve(DATA_ROOT, {
      cwd: scope.workspaceRoot,
      signal,
    })
    const map = await ctx.fs.resolve(`${DATA_ROOT}/${mapId}`, {
      cwd: scope.workspaceRoot,
      signal,
    })
    const target = await ctx.fs.resolve(path, {
      cwd: scope.workspaceRoot,
      signal,
    })
    if (
      !ctx.fs.contains(root, data) ||
      !ctx.fs.contains(data, map) ||
      !ctx.fs.contains(map, target) ||
      target.targetKey === map.targetKey
    )
      throw new AtlasError('path_outside_map', `真实路径越过地图边界：${path}`)
    if (assetsOnly) {
      const assets = await ctx.fs.resolve(`${DATA_ROOT}/${mapId}/assets`, {
        cwd: scope.workspaceRoot,
        signal,
      })
      if (!ctx.fs.contains(map, assets) || !ctx.fs.contains(assets, target))
        throw new AtlasError('path_outside_map', `资源不在本图 assets：${path}`)
    }
    targets.set(path, target)
    return target
  }
  return {
    workspaceKey: scope.workspaceRoot,
    async read(path, mapId, assetsOnly) {
      const target = await boundary(path, mapId, assetsOnly)
      const chunks: Uint8Array[] = []
      let version: string | undefined
      let offset = 0
      while (true) {
        const page = await ctx.workspaceFiles.readBytes(
          scope,
          path,
          { range: { offset, length: 1024 * 1024 } },
          signal,
        )
        if (version !== undefined && version !== page.version)
          throw new AtlasError('version_conflict', `${path} 在读取中发生变化`)
        version = page.version
        chunks.push(page.data)
        offset += page.data.length
        if (offset > 64 * 1024 * 1024)
          throw new AtlasError(
            'too_large',
            `${path} 超过插件单文件 64 MiB 上限`,
          )
        if (page.eof) break
        if (page.data.length === 0)
          throw new AtlasError('storage_failure', `${path} 分页读取没有前进`)
      }
      const bytes = new Uint8Array(offset)
      let cursor = 0
      for (const chunk of chunks) {
        bytes.set(chunk, cursor)
        cursor += chunk.length
      }
      const after = await ctx.workspaceFiles.stat(scope, path, signal)
      if (
        after.version !== version ||
        (await boundary(path, mapId, assetsOnly)).targetKey !== target.targetKey
      )
        throw new AtlasError(
          'version_conflict',
          `${path} 读取期间身份或版本变化`,
        )
      return {
        bytes,
        version: after.version,
        identity: String(target.targetKey),
      }
    },
    async absent(path) {
      const id = path.split('/')[1]
      if (id) await boundary(path, id)
      try {
        await ctx.workspaceFiles.stat(scope, path, signal)
        return false
      } catch (e) {
        if (missing(e)) return true
        throw e
      }
    },
    async list() {
      try {
        const root = await ctx.fs.resolve(scope.workspaceRoot, { signal })
        const data = await ctx.fs.resolve(DATA_ROOT, {
          cwd: scope.workspaceRoot,
          signal,
        })
        if (!ctx.fs.contains(root, data))
          throw new AtlasError('path_outside_map', '地图数据目录越过工作区')
        const listing = await ctx.workspaceFiles.list(scope, DATA_ROOT, signal)
        if (listing.truncated)
          throw new AtlasError(
            'too_large',
            '地图目录列举被宿主截断，请减少目录数量后重试',
          )
        return listing.entries
          .filter((e) => e.type === 'directory')
          .map((e) => e.name)
      } catch (e) {
        if (missing(e)) return []
        throw e
      }
    },
    async listEntries(id, relative) {
      // boundary要求文件目标；用目录内固定哨兵验证真实目录归属，不读取/创建哨兵。
      const path = mapPath(id, relative)
      await boundary(`${path}/.boundary`, id)
      const entry = await ctx.fs.lstat(path, { cwd: scope.workspaceRoot }, signal)
      if (!entry || entry.type !== 'directory') throw new AtlasError('invalid_data', '占位目录必须为普通目录')
      const listing = await ctx.workspaceFiles.list(scope, path, signal)
      if (listing.truncated) throw new AtlasError('too_large', '占位目录列举被截断，保留原资料')
      for (const child of listing.entries) {
        const info = await ctx.fs.lstat(`${path}/${child.name}`, { cwd: scope.workspaceRoot }, signal)
        if (!info || info.type !== child.type) throw new AtlasError('version_conflict', '占位目录含链接或读取期间发生变化')
      }
      return listing.entries
    },
    async writeLayout(id, text, expectedVersion) {
      const path = mapPath(id, 'layout.json')
      const target = await boundary(path, id)
      const entry = await ctx.fs.lstat(
        path,
        { cwd: scope.workspaceRoot },
        signal,
      )
      if (entry && entry.type !== 'file')
        throw new AtlasError('path_outside_map', '布局目标必须是普通文件')
      const info = await ctx.fs.stat(target, signal)
      if ((info?.version ?? undefined) !== expectedVersion)
        throw new AtlasError('version_conflict', '布局文件已变化')
      await ctx.fs.writeText(
        target,
        text,
        info
          ? { kind: 'replaceIfVersion', version: info.version as FsVersion }
          : { kind: 'createIfAbsent' },
        signal,
        policy,
      )
    },
  }
}

const decode = (bytes: Uint8Array) =>
  new TextDecoder('utf-8', { fatal: true }).decode(bytes)

// 只识别插件可证明归属的创建占位；未知文件、成功结果、活动/恢复记录均不隐藏。
export async function inspectCreatePlaceholder(port: MapFilePort, id: string, cleanupLock?: string) {
  if (!port.listEntries || !await port.absent(mapPath(id, 'map.json'))) return undefined
  const root = await port.listEntries(id, '.')
  if (!root.some(e => e.name === '.transactions' && e.type === 'directory')) return undefined
  if (root.some(e => e.name !== '.transactions' && !(e.name === 'notes' && e.type === 'directory'))) return undefined
  if (root.some(e => e.name === 'notes') && (await port.listEntries(id, 'notes')).length) return undefined
  const transactions = await port.listEntries(id, '.transactions')
  const operations = transactions.filter(e => e.type === 'directory' && /^[A-Za-z0-9_-]+$/.test(e.name))
  const discarded = transactions.some(e => e.name === 'discarded-create.json' && e.type === 'file')
  if (operations.length !== 1 || transactions.length !== operations.length + (cleanupLock ? 1 : 0) + (discarded ? 1 : 0)) return undefined
  if (cleanupLock) {
    if (!transactions.some(e => e.name === 'active.json' && e.type === 'file')) return undefined
    if (decode((await port.read(mapPath(id, '.transactions/active.json'), id)).bytes) !== cleanupLock) return undefined
  }
  const operationId = operations[0].name
  const expectedId = 'map-' + (await digest(new TextEncoder().encode(JSON.stringify({operationId})))).slice(0, 32)
  if (id !== expectedId) return undefined
  const prefix = `.transactions/${operationId}`
  const entries = await port.listEntries(id, prefix)
  if (!entries.length && !discarded || entries.some(e => e.type !== 'file' || !['reservation.json', 'failed.json'].includes(e.name))) return undefined
  let request: string | undefined
  let state: 'reserved' | 'failed' | 'cleanup_pending' | 'discarded' = 'reserved'
  if (discarded) {
    const record = JSON.parse(decode((await port.read(mapPath(id, '.transactions/discarded-create.json'), id)).bytes))
    if (!record || record.kind !== 'discarded_create' || record.mapId !== id || record.operationId !== operationId || typeof record.request !== 'string' || !/^[a-f0-9]{64}$/.test(record.request)) return undefined
    request = record.request
  }
  for (const entry of entries) {
    const raw = decode((await port.read(mapPath(id, `${prefix}/${entry.name}`), id)).bytes)
    let value = raw
    if (entry.name === 'failed.json') {
      const failure = JSON.parse(raw)
      if (!failure || failure.kind !== 'failed_create' || failure.operationId !== operationId || typeof failure.code !== 'string') return undefined
      value = failure.request
      state = 'failed'
    }
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value) || request !== undefined && request !== value) return undefined
    request = value
  }
  // 中断在“写失败记录→删占位”之间时，不能声称占位已释放。
  if (entries.some(e => e.name === 'reservation.json')) state = 'reserved'
  if (discarded) state = entries.length ? 'cleanup_pending' : 'discarded'
  if (!await port.absent(mapPath(id, 'map.json')) || !await port.absent(mapPath(id, '.transactions/purge.json'))) return undefined
  if (!cleanupLock && !await port.absent(mapPath(id, '.transactions/active.json'))) return undefined
  return { mapId: id, operationId, request: request!, state }
}

async function listedPlaceholder(port: MapFilePort, id: string) {
  try { return await inspectCreatePlaceholder(port, id) } catch { return undefined }
}
export async function readSnapshot(
  port: MapFilePort,
  mapId: string,
): Promise<MapSnapshot> {
  const files: ReadFile[] = []
  const records = new Map<string, FileRecord>()
  async function read(relative: string, assetsOnly = false) {
    const path = mapPath(mapId, relative)
    const cached = records.get(path)
    if (cached) return cached
    const record = await port.read(path, mapId, assetsOnly)
    records.set(path, record)
    files.push({
      path,
      version: record.version,
      digest: await digest(record.bytes),
    })
    return record
  }
  const structure = validateMap(
    JSON.parse(decode((await read('map.json')).bytes)),
    mapId,
  )
  if (!structure.ok)
    throw new AtlasError(
      'invalid_data',
      '地图结构校验失败',
      structure.diagnostics,
    )
  const map = structure.value
  // 正在进行或尚未恢复的受控提交不作为正常地图开放。
  if (!(await port.absent(mapPath(mapId, '.transactions/active.json'))))
    throw new AtlasError(
      'recovery_required',
      '地图存在活动或待恢复操作，暂不开放',
    )
  if (!(await port.absent(mapPath(mapId, '.transactions/purge.json'))))
    throw new AtlasError('purge_pending', '地图正在永久删除或已删除；请在回收站重试未完成的删除')
  const layoutAbsent = await port.absent(mapPath(mapId, 'layout.json'))
  const layoutInput = layoutAbsent
    ? undefined
    : JSON.parse(decode((await read('layout.json')).bytes))
  const layout = validateLayout(layoutInput, map)
  if (!layout.ok)
    throw new AtlasError(
      'invalid_layout',
      '布局文件校验失败',
      layout.diagnostics,
    )
  const notes: Record<string, string> = Object.create(null)
  const resources: Record<string, string> = Object.create(null)
  const noteIdentities = new Set<string>()
  for (const node of map.nodes) {
    notes[node.id] = ''
    if (!node.notePath) continue
    const path = localPath(node.notePath)
    if (
      !/\.md$/i.test(path) ||
      /(^|\/)(exports|\.transactions)(\/|$)/.test(path)
    )
      throw new AtlasError(
        'invalid_data',
        `${node.id} 的 notePath 必须是地图内 Markdown 文件`,
      )
    const record = await read(path)
    if (noteIdentities.has(record.identity))
      throw new AtlasError(
        'invalid_data',
        `不同节点引用了同一笔记文件：${path}`,
      )
    noteIdentities.add(record.identity)
    const text = decode(record.bytes)
    notes[node.id] = text
    const local = new Set<string>()
    walkTokens(Lexer.lex(text), (token) => {
      if (
        (token.type === 'image' || token.type === 'link') &&
        'href' in token &&
        typeof token.href === 'string' &&
        !/^(https?:|mailto:|#)/i.test(token.href)
      )
        local.add(token.href)
    })
    for (const href of local) {
      const clean = decodeURIComponent(href.split(/[?#]/)[0])
      const relative = localPath(posix.join(posix.dirname(path), clean))
      if (!relative.startsWith('assets/'))
        throw new AtlasError(
          'path_outside_map',
          `本地资源必须位于 assets：${href}`,
        )
      const asset = await read(relative, true)
      const mime = (
        {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          webp: 'image/webp',
          pdf: 'application/pdf',
          txt: 'text/plain',
        } as Record<string, string>
      )[posix.extname(relative).slice(1).toLowerCase()]
      if (!mime)
        throw new AtlasError(
          'invalid_data',
          `资源类型不受支持：${href}；支持 png/jpg/gif/webp/pdf/txt`,
        )
      resources[`${node.id}:${href}`] =
        `data:${mime};base64,${Buffer.from(asset.bytes).toString('base64')}`
    }
  }
  // 复读整个实际读集，拒绝混合版本，包含布局缺失这一依赖。
  for (const file of files) {
    const again = await port.read(
      file.path,
      mapId,
      file.path.startsWith(`${DATA_ROOT}/${mapId}/assets/`),
    )
    if (
      again.version !== file.version ||
      (await digest(again.bytes)) !== file.digest ||
      again.identity !== records.get(file.path)?.identity
    )
      throw new AtlasError('version_conflict', `${file.path} 加载期间已变化`)
  }
  if (layoutAbsent && !(await port.absent(mapPath(mapId, 'layout.json'))))
    throw new AtlasError('version_conflict', '加载期间新增了布局')
  if (!(await port.absent(mapPath(mapId, '.transactions/active.json'))))
    throw new AtlasError('recovery_required', '读取期间地图开始提交')
  return {
    map,
    layout: layout.value,
    notes,
    resources,
    files,
    fingerprint: await fingerprint(files),
    workspaceKey: port.workspaceKey,
  }
}
// 管理目录只校验结构和活动标记；正文、资源及布局留到打开目标地图时完整加载。
export async function listMapHeaders(port: MapFilePort, excluded: ReadonlySet<string> = new Set()): Promise<MapListing> {
  const ids = (await port.list()).filter(id => !excluded.has(id))
  const entries: (MapListing['maps'][number] | Diagnostic | undefined)[] = new Array(ids.length)
  const incompleteCreates: NonNullable<MapListing['incompleteCreates']> = []
  let next = 0
  const worker = async () => {
    while (next < ids.length) {
      const index = next++; const id = ids[index]
      try {
        const placeholder = await listedPlaceholder(port, id)
        if (placeholder) {
          if (placeholder.state !== 'discarded') incompleteCreates.push({mapId:id,operationId:placeholder.operationId,state:placeholder.state})
          continue
        }
        const inactive = async () => {
          if (!await port.absent(mapPath(id, '.transactions/active.json'))) throw new AtlasError('recovery_required', '地图正在提交或待恢复')
          if (!await port.absent(mapPath(id, '.transactions/purge.json'))) throw new AtlasError('purge_pending', '地图正在永久删除或已删除')
        }
        await inactive()
        const record = await port.read(mapPath(id, 'map.json'), id)
        const checked = validateMap(JSON.parse(decode(record.bytes)), id)
        if (!checked.ok) throw new AtlasError('invalid_data', '地图结构校验失败', checked.diagnostics)
        await inactive()
        entries[index] = { id, title: checked.value.title }
      } catch (e) {
        entries[index] = { path: `${DATA_ROOT}/${id}`, code: errorCode(e), message: e instanceof Error ? e.message : String(e) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker))
  return { maps: entries.filter((entry): entry is MapListing['maps'][number] => !!entry && 'id' in entry), diagnostics: entries.filter((entry): entry is Diagnostic => !!entry && 'path' in entry), incompleteCreates: incompleteCreates.sort((a,b) => a.mapId.localeCompare(b.mapId)) }
}
export async function listMaps(port: MapFilePort): Promise<MapListing> {
  const result: MapListing = { maps: [], diagnostics: [], incompleteCreates: [] }
  for (const id of await port.list()) {
    try {
      const placeholder = await listedPlaceholder(port, id)
      if (placeholder) {
        if (placeholder.state !== 'discarded') result.incompleteCreates!.push({mapId:id,operationId:placeholder.operationId,state:placeholder.state})
        continue
      }
      const snap = await readSnapshot(port, id)
      result.maps.push({ id, title: snap.map.title })
    } catch (e) {
      result.diagnostics.push({
        path: `${DATA_ROOT}/${id}`,
        code: errorCode(e),
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }
  return result
}
export async function saveLayout(
  port: MapFilePort,
  mapId: string,
  expectedFingerprint: string,
  layout: MapLayout,
  allowManual = false,
): Promise<MapSnapshot> {
  const current = await readSnapshot(port, mapId)
  if (current.fingerprint !== expectedFingerprint)
    throw new AtlasError('version_conflict', '内容已变化，请刷新后重试保存布局')
  const validated = validateLayout(layout, current.map)
  if (!validated.ok)
    throw new AtlasError(
      'invalid_layout',
      '拒绝保存无效布局',
      validated.diagnostics,
    )
  if (
    layout.views.length !== current.map.views.length ||
    current.map.views.some((v) => {
      const positioned = layout.views.find((p) => p.viewId === v.id)
      return (
        !positioned ||
        positioned.nodes.length !== v.occurrences.length ||
        positioned.groups.length !== v.groups.length ||
        positioned.nodes.some(
          (n) => !v.occurrences.some((o) => o.nodeId === n.nodeId),
        ) ||
        positioned.groups.some(
          (g) => !v.groups.some((item) => item.id === g.groupId),
        )
      )
    })
  )
    throw new AtlasError(
      'invalid_layout',
      '保存的布局必须与当前视图、出现位置和分组一一对应',
    )
  for (const view of allowManual ? [] : current.layout?.views ?? [])
    for (const node of view.nodes) {
      const next = layout.views
        .find((v) => v.viewId === view.viewId)
        ?.nodes.find((n) => n.nodeId === node.nodeId)
      if (
        next &&
        (next.x !== node.x ||
          next.y !== node.y ||
          next.width !== node.width ||
          next.manual !== node.manual)
      )
        throw new AtlasError(
          'invalid_layout',
          '首期补位不能改动已有节点的位置、宽度或手动标记',
        )
    }
  await port.writeLayout(
    mapId,
    `${JSON.stringify(layout, null, 2)}\n`,
    current.files.find((f) => f.path === mapPath(mapId, 'layout.json'))
      ?.version,
  )
  return readSnapshot(port, mapId)
}
