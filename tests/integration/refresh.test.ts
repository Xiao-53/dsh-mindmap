import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SnapshotLoader } from '../../src/client/refresh-map.ts'
import {
  initialReading,
  reconcileReading,
} from '../../src/client/reading-state.ts'
import { readSnapshot } from '../../src/server/map-files.ts'
import { watchPaths } from '../../src/server/watch-map.ts'
import { MemoryFiles } from '../support/files.ts'
test('10 次有效、10 次无效更新；仅完整有效候选替换，源文件不被改写', async () => {
  const files = new MemoryFiles()
  const loader = new SnapshotLoader()
  let valid = await loader.load(() => readSnapshot(files, 'map-a'))
  assert.ok(valid?.snapshot)
  for (let i = 0; i < 10; i++) {
    const map = structuredClone(valid!.snapshot!.map)
    map.title = `更新${i}`
    files.put('map.json', JSON.stringify(map))
    const start = performance.now()
    valid = await loader.load(() => readSnapshot(files, 'map-a'))
    assert.equal(valid?.snapshot?.map.title, `更新${i}`)
    assert.ok(performance.now() - start < 2000)
    const before = valid!.snapshot!.fingerprint
    files.put('map.json', '{invalid')
    const failed = await loader.load(() => readSnapshot(files, 'map-a'))
    assert.equal(failed?.stale, true)
    assert.equal(failed?.snapshot?.fingerprint, before)
    assert.ok(failed?.error)
    assert.equal(
      files.files.get('dsh-knowledge-maps/map-a/map.json')?.text,
      '{invalid',
    )
  }
})
test('初次失败无伪造快照，旧异步加载不能覆盖新图，取消后不发布', async () => {
  const loader = new SnapshotLoader()
  const result = await loader.load(async () => {
    throw new Error('无权限')
  })
  assert.equal(result?.snapshot, undefined)
  const snap = await readSnapshot(new MemoryFiles(), 'map-a')
  let finish!: (s: typeof snap) => void
  const old = loader.load(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const fresh = await loader.load(async () => ({ ...snap, fingerprint: 'new' }))
  finish(snap)
  assert.equal(await old, undefined)
  assert.equal(fresh?.snapshot?.fingerprint, 'new')
  const pending = loader.load(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  loader.cancel()
  finish(snap)
  assert.equal(await pending, undefined)
})
test('读取位置与手动相机保持，删除当前对象说明后降级，嵌套笔记逐级观察', async () => {
  const snapshot = await readSnapshot(new MemoryFiles(), 'map-a')
  const state = initialReading('workspace-a', 's1', snapshot.map)
  state.viewId = 'child'
  state.selectedNodeId = 'a'
  state.cameras.root = { x: 12, y: 40, zoom: 0.8 }
  state.detailScroll = 42
  assert.deepEqual(reconcileReading(state, snapshot.map).state, state)
  snapshot.map.views.pop()
  snapshot.map.nodes.shift()
  const next = reconcileReading(state, snapshot.map)
  assert.equal(next.state.viewId, 'root')
  assert.deepEqual(next.state.cameras, state.cameras)
  assert.ok(next.notice)
  snapshot.files.push({
    path: 'dsh-knowledge-maps/map-a/notes/deep/a.md',
    digest: 'x',
    version: '1',
  })
  assert.ok(
    watchPaths(snapshot).includes('dsh-knowledge-maps/map-a/notes/deep'),
  )
  assert.ok(watchPaths(snapshot).includes('dsh-knowledge-maps/map-a/notes'))
})
