import { test } from 'node:test'
import assert from 'node:assert/strict'
import { librarySchema } from '../../src/shared/library.ts'
import type { MapLibrary } from '../../src/shared/library.ts'
import {
  getOrderedFolders,
  getOrderedMapsInScope,
  moveMapsToTarget,
  prunePurgedFromOrders,
  removeEntriesFromLibrary,
  reorderFolders,
  restoreMapsInLibrary,
} from '../../src/shared/library-order.ts'

const activeMaps = [
  { id: 'a', title: '导图 A' },
  { id: 'b', title: '导图 B' },
  { id: 'c', title: '导图 C' },
  { id: 'm1', title: '内部 1' },
  { id: 'm2', title: '内部 2' },
]

function sampleLibrary(): MapLibrary {
  return {
    schemaVersion: 1,
    folders: [
      { id: 'f1', title: '文件夹 1', parentId: null },
      { id: 'f2', title: '文件夹 2', parentId: null },
    ],
    mapFolders: { m1: 'f1', m2: 'f1' },
  }
}

test('schema 校验拒绝重复或跨列表排序及不存在文件夹键', () => {
  assert.equal(librarySchema.safeParse({
    ...sampleLibrary(),
    rootMapOrder: ['a', 'b'],
    folderMapOrders: { f1: ['m1', 'm2'] },
  }).success, true)
  assert.equal(librarySchema.safeParse({
    ...sampleLibrary(),
    rootMapOrder: ['a', 'a'],
  }).success, false)
  assert.equal(librarySchema.safeParse({
    ...sampleLibrary(),
    rootMapOrder: ['a', 'm1'],
    folderMapOrders: { f1: ['m1'] },
  }).success, false)
  assert.equal(librarySchema.safeParse({
    ...sampleLibrary(),
    folderMapOrders: { missing: ['m1'] },
  }).success, false)
})

test('投影排序与同级上下插队、跨文件夹移入移出及无变化跳过', () => {
  const base = sampleLibrary()
  assert.deepEqual(getOrderedMapsInScope(activeMaps, base, null).map(m => m.id), ['a', 'b', 'c'])

  // 拖动 c 到 a 下方 -> a, c, b
  const r1 = moveMapsToTarget(base, activeMaps, ['c'], {
    kind: 'map-insert', folderId: null, targetMapId: 'a', position: 'after',
  })
  assert.equal(r1.changed, true)
  assert.deepEqual(getOrderedMapsInScope(activeMaps, r1.library, null).map(m => m.id), ['a', 'c', 'b'])

  // 再把 c 拖到 a 下方（原位无变化）-> changed: false
  const noop = moveMapsToTarget(r1.library, activeMaps, ['c'], {
    kind: 'map-insert', folderId: null, targetMapId: 'a', position: 'after',
  })
  assert.equal(noop.changed, false)

  // 从文件夹 f1 拖出 m2 到根目录 c 下方 -> a, c, m2, b
  const r2 = moveMapsToTarget(r1.library, activeMaps, ['m2'], {
    kind: 'map-insert', folderId: null, targetMapId: 'c', position: 'after',
  })
  assert.equal(r2.changed, true)
  assert.equal(r2.library.mapFolders.m2, undefined)
  assert.deepEqual(getOrderedMapsInScope(activeMaps, r2.library, null).map(m => m.id), ['a', 'c', 'm2', 'b'])
  assert.deepEqual(getOrderedMapsInScope(activeMaps, r2.library, 'f1').map(m => m.id), ['m1'])

  // 从根目录拖入已展开文件夹 f1 内 m1 上方 -> [b, m1]
  const r3 = moveMapsToTarget(r2.library, activeMaps, ['b'], {
    kind: 'map-insert', folderId: 'f1', targetMapId: 'm1', position: 'before',
  })
  assert.equal(r3.changed, true)
  assert.equal(r3.library.mapFolders.b, 'f1')
  assert.deepEqual(getOrderedMapsInScope(activeMaps, r3.library, 'f1').map(m => m.id), ['b', 'm1'])
  assert.deepEqual(getOrderedMapsInScope(activeMaps, r3.library, null).map(m => m.id), ['a', 'c', 'm2'])

  // 新增未录入排序的导图追加到末尾
  const extended = [...activeMaps, { id: 'n1', title: '新导图' }]
  assert.deepEqual(getOrderedMapsInScope(extended, r3.library, null).map(m => m.id), ['a', 'c', 'm2', 'n1'])
})

test('多选保留原有相对顺序且拒绝自身目标；文件夹排序不嵌套', () => {
  const base: MapLibrary = {
    ...sampleLibrary(),
    rootMapOrder: ['c', 'a', 'b'],
    folders: [
      { id: 'f1', title: '文件夹 1', parentId: null },
      { id: 'f2', title: '文件夹 2', parentId: 'f1' },
    ],
  }
  const multi = moveMapsToTarget(base, activeMaps, ['b', 'c'], {
    kind: 'map-insert', folderId: null, targetMapId: 'a', position: 'after',
  })
  assert.equal(multi.changed, true)
  // 原视觉顺序为 c, a, b，故多选保持 c 在 b 前
  assert.deepEqual(getOrderedMapsInScope(activeMaps, multi.library, null).map(m => m.id), ['a', 'c', 'b'])

  const selfTarget = moveMapsToTarget(base, activeMaps, ['b', 'c'], {
    kind: 'map-insert', folderId: null, targetMapId: 'b', position: 'after',
  })
  assert.equal(selfTarget.changed, false)

  const reordered = reorderFolders(base, ['f2'], {
    kind: 'folder-insert', targetFolderId: 'f1', position: 'before',
  })
  assert.equal(reordered.changed, true)
  assert.deepEqual(getOrderedFolders(reordered.library).map(f => f.id), ['f2', 'f1'])
  assert.ok(reordered.library.folders.every(f => f.parentId === null))
})

test('删除、还原、删文件夹与永久清理保留其余手动顺序', () => {
  const lib: MapLibrary = {
    schemaVersion: 1,
    folders: [{ id: 'f1', title: 'F1', parentId: null }],
    mapFolders: { m1: 'f1', m2: 'f1' },
    rootMapOrder: ['c', 'a', 'b'],
    folderMapOrders: { f1: ['m2', 'm1'] },
  }
  const titles = new Map(activeMaps.map(m => [m.id, m.title]))

  // 删除 m2 -> 从 folderMapOrders 移除，但保留 mapFolders.m2；还原后回到 f1 末尾
  const trashed = removeEntriesFromLibrary(lib, activeMaps, [{ kind: 'map', id: 'm2' }], titles)
  assert.deepEqual(trashed.deletedMapIds, ['m2'])
  assert.equal(trashed.mapFolders.m2, 'f1')
  assert.deepEqual(trashed.folderMapOrders?.f1, ['m1'])

  const restored = restoreMapsInLibrary(trashed, ['m2'])
  assert.equal(restored.deletedMapIds, undefined)
  assert.deepEqual(getOrderedMapsInScope(activeMaps, restored, 'f1').map(m => m.id), ['m1', 'm2'])

  // 删除文件夹 f1 -> m2, m1 按原文件夹顺序追加到根目录末尾
  const folderRemoved = removeEntriesFromLibrary(lib, activeMaps, [{ kind: 'folder', id: 'f1' }], titles)
  assert.equal(folderRemoved.folders.length, 0)
  assert.deepEqual(folderRemoved.rootMapOrder, ['c', 'a', 'b', 'm2', 'm1'])
  assert.equal(folderRemoved.folderMapOrders, undefined)

  // 永久清理移除残留排序 ID
  const pruned = prunePurgedFromOrders(lib, new Set(['a', 'm2']))
  assert.deepEqual(pruned.rootMapOrder, ['c', 'b'])
  assert.deepEqual(pruned.folderMapOrders, { f1: ['m1'] })
})
