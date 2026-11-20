import { z } from 'zod'
import { idSchema } from './validate-map.ts'

export const librarySchema = z.strictObject({
  schemaVersion: z.literal(1),
  folders: z.array(z.strictObject({
    id: idSchema,
    title: z.string().trim().min(1).max(120),
    parentId: idSchema.nullable(),
  })),
  mapFolders: z.record(idSchema, idSchema),
  rootMapOrder: z.array(idSchema).optional(),
  folderMapOrders: z.record(idSchema, z.array(idSchema)).optional(),
  deletedMapIds: z.array(idSchema).optional(),
  deletedMapTitles: z.record(idSchema, z.string()).optional(),
  purgedMapIds: z.array(idSchema).optional(),
  purgingMapIds: z.array(idSchema).optional(),
  retiredCreateIds: z.array(idSchema).optional(),
}).superRefine((library, ctx) => {
  if (library.retiredCreateIds && new Set(library.retiredCreateIds).size !== library.retiredCreateIds.length)
    ctx.addIssue({ code: 'custom', message: '作废创建记录存在重复身份' })
  const ids = new Set(library.folders.map(f => f.id))
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (ids.size !== library.folders.length) fail('文件夹身份重复')
  for (const folder of library.folders) {
    const seen = new Set([folder.id])
    let parent = folder.parentId
    while (parent) {
      if (!ids.has(parent)) { fail('父文件夹不存在'); break }
      if (seen.has(parent)) { fail('文件夹层级不能循环'); break }
      seen.add(parent)
      parent = library.folders.find(f => f.id === parent)!.parentId
    }
  }
  for (const folderId of Object.values(library.mapFolders))
    if (!ids.has(folderId)) fail('导图所属文件夹不存在')
  const orderedMaps = new Set<string>()
  const checkOrder = (list: string[]) => {
    const local = new Set<string>()
    for (const mapId of list) {
      if (local.has(mapId)) { fail('导图排序存在重复身份'); return false }
      if (orderedMaps.has(mapId)) { fail('导图不能同时出现在多个排序列表中'); return false }
      local.add(mapId)
      orderedMaps.add(mapId)
    }
    return true
  }
  if (library.rootMapOrder) checkOrder(library.rootMapOrder)
  for (const [folderId, list] of Object.entries(library.folderMapOrders ?? {})) {
    if (!ids.has(folderId)) { fail('导图排序所属文件夹不存在'); break }
    if (!checkOrder(list)) break
  }
})
export type MapLibrary = z.infer<typeof librarySchema>
export interface LibraryState {
  data: MapLibrary
  version: string | null
  workspaceKey: string
}
export const emptyLibrary = (): MapLibrary => ({ schemaVersion: 1, folders: [], mapFolders: {} })
