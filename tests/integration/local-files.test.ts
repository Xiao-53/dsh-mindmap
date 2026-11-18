import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { WorkspaceFiles } from '@deepseek-ai/dsh-api-workspace-files'
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  readFile,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import {
  createHostFiles,
  readSnapshot,
  saveLayout,
} from '../../src/server/map-files.ts'
import { fillLayout } from '../../src/shared/layout.ts'
import { sampleMap } from '../support/maps.ts'
import { libraryFiles } from '../../src/server/library-files.ts'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { pathToFileURL } from 'node:url'
test('真实官方文件服务：分页、条件布局保存及 junction 越界防护', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-atlas-files-'))
  const ctx = new Context()
  try {
    new LocalFileSystem(ctx, { cwd: directory, diffBasisMaxBytes: 1048576 })
    new WorkspaceFiles(ctx, {
      maxBytes: 2097152,
      maxFileBytes: 33554432,
      maxLines: 5000,
      maxEntries: 2000,
      search: {
        maxResults: 512,
        maxEntries: 100000,
        graceMs: 3000,
        timeoutMs: 30000,
        stderrMaxBytes: 65536,
      },
    })
    const firstLibrary = libraryFiles(ctx, { workspaceRoot: directory, sessionId: 's1' as any }, new AbortController().signal)
    assert.equal((await firstLibrary.read()).version, null)
    const initialId = await firstLibrary.create('首次创建')
    assert.ok(JSON.parse(await readFile(join(directory, 'dsh-knowledge-maps', initialId, 'map.json'), 'utf8')).id === initialId)
    const mapDir = join(directory, 'dsh-knowledge-maps', 'map-a')
    await mkdir(join(mapDir, 'notes'), { recursive: true })
    const map = sampleMap()
    map.nodes[0].notePath = 'notes/a.md'
    await writeFile(join(mapDir, 'map.json'), JSON.stringify(map))
    const text = `## 核心理解\n${'实际分页内容\n'.repeat(100000)}`
    await writeFile(join(mapDir, 'notes/a.md'), text)
    const port = createHostFiles(
      ctx,
      { workspaceRoot: directory, sessionId: 's1' as any },
      new AbortController().signal,
    )
    const snapshot = await readSnapshot(port, 'map-a')
    assert.equal(snapshot.notes.a, text)
    const layout = fillLayout(snapshot.map, undefined, {})
    const saved = await saveLayout(port, 'map-a', snapshot.fingerprint, layout)
    assert.deepEqual(saved.layout, layout)
    assert.equal(await readFile(join(mapDir, 'notes/a.md'), 'utf8'), text)
    // 通过实际 Host 服务写入：部署默认根不同，仍须携带来源会话的工作区策略。
    new TypertRegistry(ctx)
    const liveSession = { id: 's1', header: { cwd: directory } }
    let mode: 'workspace-write' | 'read-only' = 'workspace-write'
    ctx.provide('sessions', { get: () => liveSession } as any)
    ctx.provide('sandboxPolicy', { workspaceRoot: 'wrong-deployment-root', resolve: ({ session }: any) => {
      assert.equal(session, liveSession)
      return { mode, workspaceRoot: session.header.cwd, sessionId: session.id }
    } } as any)
    const originalWrite = ctx.fs.writeText.bind(ctx.fs)
    const policies: any[] = []
    ctx.fs.writeText = async (...args) => { policies.push(args[4]); return originalWrite(...args) }
    const plugin = await import(pathToFileURL(resolve('lib/index.js')).href)
    plugin.apply(ctx)
    const moved = structuredClone(layout)
    moved.views[0].nodes[0].x += 120
    moved.views[0].nodes[0].manual = true
    const req = { op:'saveLayout', mapId:'map-a', expectedWorkspaceKey:directory, expectedFingerprint:saved.fingerprint, layout:moved, manual:true }
    const scope = { workspaceRoot:directory, sessionId:'s1' as any }
    const signal = new AbortController().signal
    const result = JSON.parse(await ctx.dshAtlas.request(scope, JSON.stringify(req), signal))
    assert.equal(result.ok, true, result.message)
    assert.deepEqual(result.value.layout, moved)
    assert.equal(policies.at(-1).workspaceRoot, directory)
    assert.equal(policies.at(-1).sessionId, 's1')
    assert.equal(policies.at(-1).mode, 'workspace-write')
    const unchanged = await readFile(join(mapDir, 'map.json'), 'utf8')
    const stale = JSON.parse(await ctx.dshAtlas.request(scope, JSON.stringify(req), signal))
    assert.equal(stale.code, 'version_conflict')
    mode = 'read-only'
    const denied = JSON.parse(await ctx.dshAtlas.request(scope, JSON.stringify({ ...req, expectedFingerprint:result.value.fingerprint }), signal))
    assert.equal(denied.code, 'permission_denied')
    assert.equal(await readFile(join(mapDir, 'map.json'), 'utf8'), unchanged)
    assert.equal(await readFile(join(mapDir, 'notes/a.md'), 'utf8'), text)
    mode = 'workspace-write'
    const library = libraryFiles(ctx, { workspaceRoot: directory, sessionId: 's1' as any }, new AbortController().signal)
    const initial = await library.read()
    assert.equal(initial.version, null)
    const firstId = await library.create('同名导图')
    const secondId = await library.create('同名导图')
    assert.notEqual(firstId, secondId)
    const fresh = await readSnapshot(port, firstId)
    assert.equal(fresh.map.title, '同名导图')
    assert.equal(fresh.map.nodes.length, 0)
    const data = { schemaVersion: 1 as const, folders: [
      { id: 'physics', title: '物理', parentId: null },
      { id: 'chapter', title: '第一章', parentId: 'physics' },
    ], mapFolders: { [firstId]: 'chapter' } }
    const savedLibrary = await library.save(data, initial.version)
    assert.deepEqual(savedLibrary.data, data)
    await assert.rejects(library.save({ ...data, folders: [] }, savedLibrary.version))
    await assert.rejects(library.save(data, initial.version))
    await assert.rejects(library.save({ ...data, folders: data.folders.map(f => f.id === 'physics' ? { ...f, parentId: 'chapter' } : f) }, savedLibrary.version))
    assert.deepEqual((await library.read()).data, data)
    const orderedData = { ...data, rootMapOrder: [secondId], folderMapOrders: { chapter: [firstId] } }
    const savedOrdered = await library.save(orderedData, savedLibrary.version)
    assert.deepEqual(savedOrdered.data, orderedData)
    await assert.rejects(library.save({ ...orderedData, folderMapOrders: { missing: [firstId] } }, savedOrdered.version))
    await assert.rejects(library.save({ ...orderedData, rootMapOrder: [firstId] }, savedOrdered.version))
    assert.equal((await readSnapshot(port, firstId)).fingerprint, fresh.fingerprint)
    const outside = join(directory, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'secret.md'), '不可读取')
    await symlink(outside, join(mapDir, 'linked'), 'junction')
    map.nodes[0].notePath = 'linked/secret.md'
    await writeFile(join(mapDir, 'map.json'), JSON.stringify(map))
    await assert.rejects(readSnapshot(port, 'map-a'), /真实路径越过地图边界/)
  } finally {
    await ctx.fiber.dispose()
    // 测试创建的临时根已核实，清理完全位于该根；不触及用户目录。
    const target = resolve(directory)
    const parent = resolve(tmpdir())
    const rel = relative(parent, target)
    assert.ok(
      rel &&
        !rel.startsWith('..') &&
        !isAbsolute(rel) &&
        rel.startsWith('dsh-atlas-files-'),
    )
    await rm(target, { recursive: true, force: true })
  }
})
