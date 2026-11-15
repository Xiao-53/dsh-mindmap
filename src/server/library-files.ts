import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceFileScope } from '@deepseek-ai/dsh-api-workspace-files'
import type { FsVersion } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { randomUUID } from 'node:crypto'
import { DATA_ROOT, AtlasError } from './map-files.ts'
import { librarySchema, emptyLibrary } from '../shared/library.ts'
import type { MapLibrary, LibraryState } from '../shared/library.ts'
import type { KnowledgeMap } from '../shared/map-types.ts'
import { mapSchema } from '../shared/validate-map.ts'

export function libraryFiles(ctx: Context, scope: WorkspaceFileScope, signal: AbortSignal, policy?: SandboxExecutionPolicy) {
  async function targetFor(path: string) {
    const root = await ctx.fs.resolve(scope.workspaceRoot, { signal })
    const data = await ctx.fs.resolve(DATA_ROOT, { cwd: scope.workspaceRoot, signal })
    const target = await ctx.fs.resolve(path, { cwd: scope.workspaceRoot, signal })
    if (!ctx.fs.contains(root, data) || !ctx.fs.contains(data, target) || data.targetKey === target.targetKey)
      throw new AtlasError('path_outside_map', '目录索引或新导图越过工作区数据边界')
    const entry = await ctx.fs.lstat(path, { cwd: scope.workspaceRoot }, signal)
    if (entry && entry.type !== 'file') throw new AtlasError('invalid_data', '目标必须是普通文件')
    return target
  }
  async function read(): Promise<LibraryState> {
    const target = await targetFor(`${DATA_ROOT}/library.json`)
    const before = await ctx.fs.stat(target, signal)
    if (!before) return { data: emptyLibrary(), version: null, workspaceKey: scope.workspaceRoot }
    const data = librarySchema.parse(JSON.parse(await ctx.fs.readText(target, signal)))
    const after = await ctx.fs.stat(target, signal)
    if (before.version !== after?.version) throw new AtlasError('version_conflict', '目录已变化，请刷新')
    return { data, version: String(after.version), workspaceKey: scope.workspaceRoot }
  }
  return {
    read,
    async rename(map: KnowledgeMap, title: string, version: string) {
      const target = await targetFor(`${DATA_ROOT}/${map.id}/map.json`)
      const mapRoot = await ctx.fs.resolve(`${DATA_ROOT}/${map.id}`, { cwd: scope.workspaceRoot, signal })
      if (!ctx.fs.contains(mapRoot, target) || mapRoot.targetKey === target.targetKey)
        throw new AtlasError('path_outside_map', '名称写入越过地图边界')
      const checked = mapSchema.parse({ ...map, title, views: map.views.map(view => view.id === map.rootViewId && view.title === map.title ? { ...view, title } : view) })
      await ctx.fs.writeText(target, `${JSON.stringify(checked, null, 2)}\n`, { kind: 'replaceIfVersion', version: version as FsVersion }, signal, policy)
    },
    async save(data: MapLibrary, version: string | null) {
      const checked = librarySchema.parse(data)
      const target = await targetFor(`${DATA_ROOT}/library.json`)
      await ctx.fs.writeText(target, `${JSON.stringify(checked, null, 2)}\n`,
        version === null ? { kind: 'createIfAbsent' } : { kind: 'replaceIfVersion', version: version as FsVersion }, signal, policy)
      return read()
    },
    async create(title: string) {
      const id = randomUUID()
      const map = mapSchema.parse({ schemaVersion: 1, id, title, rootViewId: 'root', nodes: [],
        views: [{ id: 'root', title, parentViewId: null, groups: [], occurrences: [], relationIds: [] }], relations: [] })
      const target = await targetFor(`${DATA_ROOT}/${id}/map.json`)
      await ctx.fs.writeText(target, `${JSON.stringify(map, null, 2)}\n`, { kind: 'createIfAbsent' }, signal, policy)
      return id
    },
  }
}
