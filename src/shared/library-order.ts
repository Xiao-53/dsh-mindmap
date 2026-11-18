import type { MapLibrary } from './library.ts'

export interface LibraryMapItem {
  id: string
  title: string
}

export type LibraryEntryRef = { kind: 'map' | 'folder'; id: string }

export type MapDropTarget =
  | { kind: 'map-insert'; folderId: string | null; targetMapId: string; position: 'before' | 'after' }
  | { kind: 'folder-into'; folderId: string }
  | { kind: 'root-into' }

export type FolderDropTarget =
  | { kind: 'folder-insert'; targetFolderId: string; position: 'before' | 'after' }
  | { kind: 'folder-end' }

export interface LibraryMutationResult {
  library: MapLibrary
  changed: boolean
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

/**
 * 返回单层展示顺序的文件夹列表（保留 folders 数组既有顺序）。
 */
export function getOrderedFolders(library: MapLibrary): MapLibrary['folders'] {
  return library.folders
}

/**
 * 返回指定层级（根目录 null 或某文件夹 ID）按手动顺序投影后的有效导图。
 * 未进入手动排序序列的导图按原列表先后追加至该层级末尾。
 */
export function getOrderedMapsInScope<T extends LibraryMapItem>(
  activeMaps: readonly T[],
  library: MapLibrary,
  folderId: string | null,
): T[] {
  const scoped = activeMaps.filter(map => (library.mapFolders[map.id] ?? null) === folderId)
  if (!scoped.length) return []
  const order = folderId ? (library.folderMapOrders?.[folderId] ?? []) : (library.rootMapOrder ?? [])
  if (!order.length) return scoped
  const byId = new Map(scoped.map(map => [map.id, map]))
  const ordered: T[] = []
  for (const id of order) {
    const found = byId.get(id)
    if (found) {
      ordered.push(found)
      byId.delete(id)
    }
  }
  for (const map of scoped) {
    if (byId.has(map.id)) ordered.push(map)
  }
  return ordered
}

/**
 * 按管理页完整视觉顺序返回全部有效导图（各文件夹内依次排在根目录导图前），
 * 用于在多选拖动时保持选中导图之间的原有相对顺序。
 */
export function getOrderedAllMaps<T extends LibraryMapItem>(
  activeMaps: readonly T[],
  library: MapLibrary,
): T[] {
  const ordered: T[] = []
  for (const folder of getOrderedFolders(library)) {
    ordered.push(...getOrderedMapsInScope(activeMaps, library, folder.id))
  }
  ordered.push(...getOrderedMapsInScope(activeMaps, library, null))
  return ordered
}

function stripIdsFromOrders(
  library: MapLibrary,
  excluded: ReadonlySet<string>,
): { rootMapOrder?: string[]; folderMapOrders?: Record<string, string[]> } {
  const rootMapOrder = library.rootMapOrder?.filter(id => !excluded.has(id))
  let folderMapOrders: Record<string, string[]> | undefined
  if (library.folderMapOrders) {
    const entries: [string, string[]][] = []
    for (const [folderId, list] of Object.entries(library.folderMapOrders)) {
      const next = list.filter(id => !excluded.has(id))
      if (next.length) entries.push([folderId, next])
    }
    if (entries.length) folderMapOrders = Object.fromEntries(entries)
  }
  return {
    ...(rootMapOrder?.length ? { rootMapOrder } : {}),
    ...(folderMapOrders ? { folderMapOrders } : {}),
  }
}

/**
 * 将一张或多张导图移动/重排到指定落点。
 * 当目标无效或移动前后所属层级与展示顺序无变化时返回 changed: false。
 */
export function moveMapsToTarget(
  library: MapLibrary,
  activeMaps: readonly LibraryMapItem[],
  rawMapIds: readonly string[],
  target: MapDropTarget,
): LibraryMutationResult {
  const requested = new Set(rawMapIds)
  const movingIds = getOrderedAllMaps(activeMaps, library)
    .map(map => map.id)
    .filter(id => requested.has(id))
  if (!movingIds.length) return { library, changed: false }
  const movingSet = new Set(movingIds)

  const folderIds = new Set(library.folders.map(f => f.id))
  let targetFolderId: string | null = null
  if (target.kind === 'map-insert') {
    if (movingSet.has(target.targetMapId)) return { library, changed: false }
    const targetMap = activeMaps.find(m => m.id === target.targetMapId)
    if (!targetMap) return { library, changed: false }
    targetFolderId = library.mapFolders[target.targetMapId] ?? null
    if (target.folderId !== targetFolderId) return { library, changed: false }
  } else if (target.kind === 'folder-into') {
    if (!folderIds.has(target.folderId)) return { library, changed: false }
    targetFolderId = target.folderId
  }

  const beforeTargetIds = getOrderedMapsInScope(activeMaps, library, targetFolderId).map(m => m.id)
  const remainingTargetIds = beforeTargetIds.filter(id => !movingSet.has(id))
  let afterTargetIds: string[]
  if (target.kind === 'map-insert') {
    const anchorIndex = remainingTargetIds.indexOf(target.targetMapId)
    if (anchorIndex < 0) return { library, changed: false }
    const insertAt = target.position === 'before' ? anchorIndex : anchorIndex + 1
    afterTargetIds = [
      ...remainingTargetIds.slice(0, insertAt),
      ...movingIds,
      ...remainingTargetIds.slice(insertAt),
    ]
  } else {
    afterTargetIds = [...remainingTargetIds, ...movingIds]
  }

  const folderChanged = movingIds.some(id => (library.mapFolders[id] ?? null) !== targetFolderId)
  if (!folderChanged && sameIds(beforeTargetIds, afterTargetIds)) {
    return { library, changed: false }
  }

  const nextMapFolders = { ...library.mapFolders }
  for (const id of movingIds) {
    if (targetFolderId) nextMapFolders[id] = targetFolderId
    else delete nextMapFolders[id]
  }

  // 从其他位置清除被移动导图与目标层最终序列的全部 ID，保证跨列表互斥。
  const cleared = new Set([...movingIds, ...afterTargetIds])
  const stripped = stripIdsFromOrders(library, cleared)
  const nextRootMapOrder = targetFolderId === null ? afterTargetIds : stripped.rootMapOrder
  const nextFolderMapOrders = { ...stripped.folderMapOrders }
  if (targetFolderId !== null) nextFolderMapOrders[targetFolderId] = afterTargetIds

  const nextLibrary: MapLibrary = {
    schemaVersion: library.schemaVersion,
    folders: library.folders,
    mapFolders: nextMapFolders,
    ...(nextRootMapOrder?.length ? { rootMapOrder: nextRootMapOrder } : {}),
    ...(Object.keys(nextFolderMapOrders).length ? { folderMapOrders: nextFolderMapOrders } : {}),
    ...(library.deletedMapIds ? { deletedMapIds: library.deletedMapIds } : {}),
    ...(library.deletedMapTitles ? { deletedMapTitles: library.deletedMapTitles } : {}),
    ...(library.purgedMapIds ? { purgedMapIds: library.purgedMapIds } : {}),
    ...(library.purgingMapIds ? { purgingMapIds: library.purgingMapIds } : {}),
  }
  return { library: nextLibrary, changed: true }
}

/**
 * 调整单层文件夹排序，禁止文件夹嵌套。
 */
export function reorderFolders(
  library: MapLibrary,
  rawFolderIds: readonly string[],
  target: FolderDropTarget,
): LibraryMutationResult {
  const requested = new Set(rawFolderIds)
  const moving = library.folders.filter(f => requested.has(f.id))
  if (!moving.length) return { library, changed: false }
  const movingSet = new Set(moving.map(f => f.id))
  if (target.kind === 'folder-insert' && movingSet.has(target.targetFolderId)) {
    return { library, changed: false }
  }

  const remaining = library.folders.filter(f => !movingSet.has(f.id))
  let insertAt = remaining.length
  if (target.kind === 'folder-insert') {
    const anchorIndex = remaining.findIndex(f => f.id === target.targetFolderId)
    if (anchorIndex < 0) return { library, changed: false }
    insertAt = target.position === 'before' ? anchorIndex : anchorIndex + 1
  }

  const reordered = [
    ...remaining.slice(0, insertAt),
    ...moving,
    ...remaining.slice(insertAt),
  ]
  const orderChanged = !sameIds(
    reordered.map(f => f.id),
    library.folders.map(f => f.id),
  )
  const normalizedSelected = moving.some(f => f.parentId !== null)
  if (!orderChanged && !normalizedSelected) return { library, changed: false }

  return {
    library: {
      ...library,
      folders: reordered.map(f => ({ ...f, parentId: null })),
    },
    changed: true,
  }
}

/**
 * 删除导图（移入回收站）或删除文件夹（内容移回根目录末尾）并保留未受影响项的手动顺序。
 */
export function removeEntriesFromLibrary(
  library: MapLibrary,
  activeMaps: readonly LibraryMapItem[],
  entries: readonly LibraryEntryRef[],
  titlesByMapId: ReadonlyMap<string, string>,
): MapLibrary {
  const folderSet = new Set(entries.filter(e => e.kind === 'folder').map(e => e.id))
  const deletedIds = entries.filter(e => e.kind === 'map').map(e => e.id)
  const deletedSet = new Set(deletedIds)

  const displacedFromDeletedFolders: string[] = []
  let deletedFolderHadManualOrder = false
  for (const folder of library.folders) {
    if (!folderSet.has(folder.id)) continue
    if (library.folderMapOrders?.[folder.id]?.length) deletedFolderHadManualOrder = true
    for (const map of getOrderedMapsInScope(activeMaps, library, folder.id)) {
      if (!deletedSet.has(map.id)) displacedFromDeletedFolders.push(map.id)
    }
  }

  const rootBase = getOrderedMapsInScope(activeMaps, library, null)
    .map(map => map.id)
    .filter(id => !deletedSet.has(id))

  const nextMapFolders = { ...library.mapFolders }
  for (const [mapId, folderId] of Object.entries(nextMapFolders)) {
    if (folderSet.has(folderId)) delete nextMapFolders[mapId]
  }

  const nextDeletedMapTitles = { ...library.deletedMapTitles }
  for (const id of deletedIds) {
    nextDeletedMapTitles[id] = titlesByMapId.get(id) ?? id
  }

  const nextFolders = library.folders
    .filter(f => !folderSet.has(f.id))
    .map(f => ({ ...f, parentId: f.parentId && folderSet.has(f.parentId) ? null : f.parentId }))

  const excludedFromOrders = new Set([...deletedSet, ...displacedFromDeletedFolders])
  const nextFolderMapOrders: Record<string, string[]> = {}
  for (const [folderId, list] of Object.entries(library.folderMapOrders ?? {})) {
    if (folderSet.has(folderId)) continue
    const filtered = list.filter(id => !excludedFromOrders.has(id))
    if (filtered.length) nextFolderMapOrders[folderId] = filtered
  }

  let nextRootMapOrder: string[] | undefined
  if (library.rootMapOrder || (deletedFolderHadManualOrder && displacedFromDeletedFolders.length)) {
    const combined = [...rootBase, ...displacedFromDeletedFolders]
    if (combined.length) nextRootMapOrder = combined
  }

  const nextLibrary: MapLibrary = {
    schemaVersion: library.schemaVersion,
    folders: nextFolders,
    mapFolders: nextMapFolders,
    ...(nextRootMapOrder?.length ? { rootMapOrder: nextRootMapOrder } : {}),
    ...(Object.keys(nextFolderMapOrders).length ? { folderMapOrders: nextFolderMapOrders } : {}),
    deletedMapIds: [...new Set([...(library.deletedMapIds ?? []), ...deletedIds])],
    deletedMapTitles: nextDeletedMapTitles,
    ...(library.purgedMapIds ? { purgedMapIds: library.purgedMapIds } : {}),
    ...(library.purgingMapIds ? { purgingMapIds: library.purgingMapIds } : {}),
  }
  return nextLibrary
}

/**
 * 从回收站还原导图，使其回到原所属文件夹（或根目录）末尾而不打乱已有排序。
 */
export function restoreMapsInLibrary(library: MapLibrary, mapIds: readonly string[]): MapLibrary {
  const restoreSet = new Set(mapIds)
  const stripped = stripIdsFromOrders(library, restoreSet)
  const nextDeletedIds = (library.deletedMapIds ?? []).filter(id => !restoreSet.has(id))
  const nextDeletedTitles = Object.fromEntries(
    Object.entries(library.deletedMapTitles ?? {}).filter(([id]) => !restoreSet.has(id)),
  )
  const nextLibrary: MapLibrary = {
    schemaVersion: library.schemaVersion,
    folders: library.folders,
    mapFolders: library.mapFolders,
    ...(stripped.rootMapOrder ? { rootMapOrder: stripped.rootMapOrder } : {}),
    ...(stripped.folderMapOrders ? { folderMapOrders: stripped.folderMapOrders } : {}),
    ...(nextDeletedIds.length ? { deletedMapIds: nextDeletedIds } : {}),
    ...(Object.keys(nextDeletedTitles).length ? { deletedMapTitles: nextDeletedTitles } : {}),
    ...(library.purgedMapIds ? { purgedMapIds: library.purgedMapIds } : {}),
    ...(library.purgingMapIds ? { purgingMapIds: library.purgingMapIds } : {}),
  }
  return nextLibrary
}

/**
 * 永久删除导图后清理排序列表中残留的导图 ID。
 */
export function prunePurgedFromOrders(
  library: MapLibrary,
  purgedIds: ReadonlySet<string>,
): Pick<MapLibrary, 'rootMapOrder' | 'folderMapOrders'> {
  return stripIdsFromOrders(library, purgedIds)
}
