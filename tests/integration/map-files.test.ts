import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createHostFiles,
  readNodeResources,
  readSnapshot,
  listMaps,
  saveLayout,
  localPath,
} from '../../src/server/map-files.ts'
import { MemoryFiles } from '../support/files.ts'
import { sampleMap } from '../support/maps.ts'
import { fillLayout } from '../../src/shared/layout.ts'
test('只列有效地图，未知目录不接管，跨工作区快照独立', async () => {
  const a = new MemoryFiles('a')
  const b = new MemoryFiles('b')
  const found = await listMaps(a)
  assert.deepEqual(
    found.maps.map((m) => m.id),
    ['map-a'],
  )
  assert.equal(found.diagnostics.length, 1)
  assert.notEqual(
    (await readSnapshot(a, 'map-a')).workspaceKey,
    (await readSnapshot(b, 'map-a')).workspaceKey,
  )
  assert.equal(a.files.size, 1)
})
test('缺失笔记与读取中途变化不发布快照', async () => {
  const p = new MemoryFiles()
  const m = sampleMap()
  m.nodes[0].notePath = 'notes/a.md'
  p.put('map.json', JSON.stringify(m))
  await assert.rejects(readSnapshot(p, 'map-a'), /缺少/)
  p.put('notes/a.md', '原始笔记')
  let count = 0
  p.onRead = (path) => {
    if (path.endsWith('map.json') && ++count === 2) p.put('notes/a.md', '变化')
  }
  await assert.rejects(readSnapshot(p, 'map-a'), /变化/)
})
test('笔记和资源纳入真实读集，layout 条件保存失败不改源文件', async () => {
  const p = new MemoryFiles()
  const m = sampleMap()
  m.nodes[0].notePath = 'notes/a.md'
  p.put('map.json', JSON.stringify(m))
  p.put('notes/a.md', '![图](../assets/a.png)')
  p.put('assets/a.png', 'bytes')
  const snap = await readSnapshot(p, 'map-a')
  assert.equal(snap.files.length, 3)
  assert.ok(snap.resources['a:../assets/a.png'])
  p.failWrite = true
  await assert.rejects(
    saveLayout(
      p,
      'map-a',
      snap.fingerprint,
      fillLayout(snap.map, undefined, {}),
    ),
    /权限/,
  )
  assert.equal(p.files.size, 3)
  p.failWrite = false
  p.put('notes/a.md', '变化')
  await assert.rejects(
    saveLayout(p, 'map-a', snap.fingerprint, {
      schemaVersion: 1,
      mapId: 'map-a',
      views: [],
    }),
    /内容已变化/,
  )
})
test('拒绝越界路径与指向其他工作区的符号链接真实目标', async () => {
  for (const path of [
    '../other',
    '/etc/passwd',
    'C:\\secret',
    'file:///secret',
    'a/../../b',
  ])
    assert.throws(() => localPath(path), /越界|非相对/)
  const fake = {
    fs: {
      resolve: async (path: string) => ({
        targetKey: path.includes('notes') ? '/outside/secret' : `/work/${path}`,
      }),
      contains: (a: any, b: any) =>
        b.targetKey.startsWith(a.targetKey + '/') ||
        a.targetKey === b.targetKey,
    },
  }
  // 工作区本身规范化成 /work；notes 模拟 resolve 已跟随越界符号链接。
  fake.fs.resolve = async (path) => ({
    targetKey:
      path === '/work'
        ? '/work'
        : path.includes('notes')
          ? '/outside/secret'
          : `/work/${path}`,
  })
  const port = createHostFiles(
    fake as any,
    { workspaceRoot: '/work', sessionId: 's' as any },
    new AbortController().signal,
  )
  await assert.rejects(
    port.read('dsh-knowledge-maps/map-a/notes/a.md', 'map-a'),
    /真实路径越过地图边界/,
  )
})
test('未恢复操作、错误布局禁止正常读取及自动覆盖', async () => {
  const p = new MemoryFiles()
  p.put('layout.json', '{wrong')
  await assert.rejects(readSnapshot(p, 'map-a'))
  assert.equal(
    p.files.get('dsh-knowledge-maps/map-a/layout.json')?.text,
    '{wrong',
  )
  p.files.delete('dsh-knowledge-maps/map-a/layout.json')
  p.put('.transactions/active.json', '{}')
  await assert.rejects(readSnapshot(p, 'map-a'), /待恢复/)
})
test('首期布局写入要求完整对应，禁止改动已有手动坐标', async () => {
  const port = new MemoryFiles()
  const snapshot = await readSnapshot(port, 'map-a')
  await assert.rejects(
    saveLayout(port, 'map-a', snapshot.fingerprint, {
      schemaVersion: 1,
      mapId: 'map-a',
      views: [],
    }),
    /一一对应/,
  )
  const initial = fillLayout(snapshot.map, undefined, {})
  initial.views[0].nodes[0].manual = true
  const saved = await saveLayout(port, 'map-a', snapshot.fingerprint, initial)
  const moved = structuredClone(initial)
  moved.views[0].nodes[0].x += 1
  await assert.rejects(
    saveLayout(port, 'map-a', saved.fingerprint, moved),
    /不能改动/,
  )
  assert.deepEqual((await readSnapshot(port, 'map-a')).layout, initial)
})

test('非图片本地链接不内联读取且已压实空目录静默忽略并统计容量', async () => {
  const port = new MemoryFiles()
  const map = sampleMap()
  map.nodes[0].notePath = 'notes/a.md'
  port.put('map.json', JSON.stringify(map))
  port.put('notes/a.md', '[PDF文档](../assets/doc.pdf)')
  const snap = await readSnapshot(port, 'map-a')
  assert.deepEqual({ ...snap.resources }, {})
  const listed = await listMaps(port, new Set(['unknown']))
  assert.deepEqual(listed.maps.map(m => m.id), ['map-a'])
  assert.equal(listed.diagnostics.length, 0)
  assert.equal(listed.capacity?.directoryCount, 2)
  assert.equal(listed.capacity?.retiredCount, 1)
  assert.equal(listed.capacity?.warningThreshold, 500)
})

test('omitResources 快照保留一致指纹并支持 readNodeResources 按节点懒加载图片', async () => {
  const port = new MemoryFiles()
  const map = sampleMap()
  map.nodes[0].notePath = 'notes/a.md'
  map.nodes[1].notePath = 'notes/b.md'
  port.put('map.json', JSON.stringify(map))
  port.put('notes/a.md', '![A图](../assets/a.png)')
  port.put('notes/b.md', '![B图](../assets/b.png)')
  port.put('assets/a.png', 'bytes-a')
  port.put('assets/b.png', 'bytes-b')
  const full = await readSnapshot(port, 'map-a', true)
  const lite = await readSnapshot(port, 'map-a', true, { omitResources: true })
  assert.equal(lite.fingerprint, full.fingerprint)
  assert.deepEqual(lite.files, full.files)
  assert.deepEqual({ ...lite.resources }, {})
  const onlyA = await readNodeResources(port, 'map-a', ['a'])
  assert.equal(onlyA.diagnostics.length, 0)
  assert.equal(onlyA.resources['a:../assets/a.png'], full.resources['a:../assets/a.png'])
  assert.equal(onlyA.resources['b:../assets/b.png'], undefined)
  const all = await readNodeResources(port, 'map-a')
  assert.deepEqual({ ...all.resources }, { ...full.resources })
})
