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
  deletedMapIds: z.array(idSchema).optional(),
  deletedMapTitles: z.record(idSchema, z.string()).optional(),
  purgedMapIds: z.array(idSchema).optional(),
  purgingMapIds: z.array(idSchema).optional(),
}).superRefine((library, ctx) => {
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
})
export type MapLibrary = z.infer<typeof librarySchema>
export interface LibraryState {
  data: MapLibrary
  version: string | null
  workspaceKey: string
}
export const emptyLibrary = (): MapLibrary => ({ schemaVersion: 1, folders: [], mapFolders: {} })
