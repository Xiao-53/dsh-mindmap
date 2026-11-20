import { z } from 'zod'
import { categories, icons } from './map-types.ts'
import type { KnowledgeMap, Validation, Diagnostic } from './map-types.ts'
import { normalizeNotePathKey } from './workspace-path.ts'
export const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, '身份只能包含字母、数字、下划线或短横线')
const title = z.string().trim().min(1, '标题不能为空')
export const mapSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: idSchema,
  title,
  rootViewId: idSchema,
  nodes: z.array(
    z.strictObject({
      id: idSchema,
      title,
      summary: z.string(),
      category: z.enum(categories),
      icon: z.enum(icons),
      notePath: z.string().min(1).optional(),
      childViewId: idSchema.optional(),
    }),
  ),
  views: z.array(
    z.strictObject({
      id: idSchema,
      title,
      parentViewId: idSchema.nullable(),
      centerNodeId: idSchema.optional(),
      groups: z.array(
        z.strictObject({
          id: idSchema,
          title,
          number: z.string(),
          category: z.enum(categories),
        }),
      ),
      occurrences: z.array(
        z.strictObject({ nodeId: idSchema, groupId: idSchema.optional() }),
      ),
      relationIds: z.array(idSchema),
    }),
  ),
  relations: z.array(
    z.strictObject({
      id: idSchema,
      fromNodeId: idSchema,
      toNodeId: idSchema,
      type: z.enum(['dependency', 'supplement']),
      label: z.string().optional(),
    }),
  ),
})
export function validateMap(
  input: unknown,
  directoryId?: string,
): Validation<KnowledgeMap> {
  const parsed = mapSchema.safeParse(input)
  if (!parsed.success)
    return {
      ok: false,
      diagnostics: parsed.error.issues.map((i) => ({
        path: ['map.json', ...i.path].join('.'),
        code: 'invalid_data',
        message: i.message,
      })),
    }
  const map = parsed.data
  const diagnostics: Diagnostic[] = []
  const fail = (path: string, message: string) =>
    diagnostics.push({
      path: `map.json.${path}`,
      message,
      code: 'invalid_data',
    })
  const unique = (ids: string[], path: string) => {
    const seen = new Set<string>()
    ids.forEach((id) => {
      if (seen.has(id)) fail(path, `重复身份 ${id}`)
      seen.add(id)
    })
  }
  unique(
    map.nodes.map((n) => n.id),
    'nodes',
  )
  unique(
    map.views.map((v) => v.id),
    'views',
  )
  unique(
    map.relations.map((r) => r.id),
    'relations',
  )
  if (directoryId !== undefined && map.id !== directoryId)
    fail('id', '地图身份与目录名不一致')
  const nodes = new Map(map.nodes.map((n) => [n.id, n]))
  const views = new Map(map.views.map((v) => [v.id, v]))
  const relations = new Map(map.relations.map((r) => [r.id, r]))
  const root = views.get(map.rootViewId)
  if (
    !root ||
    root.parentViewId !== null ||
    map.views.filter((v) => v.parentViewId === null).length !== 1
  )
    fail('rootViewId', '必须指向唯一根视图，根父级为 null')
  const paths = new Set<string>()
  for (const n of map.nodes) {
    if (n.notePath) {
      const p = normalizeNotePathKey(n.notePath)
      if (paths.has(p))
        fail(`nodes.${n.id}.notePath`, '一份笔记不能属于不同节点')
      paths.add(p)
    }
    if (n.childViewId && views.get(n.childViewId)?.centerNodeId !== n.id)
      fail(`nodes.${n.id}.childViewId`, '子图不存在或中心节点未指回当前节点')
  }
  for (const v of map.views) {
    unique(
      v.groups.map((g) => g.id),
      `views.${v.id}.groups`,
    )
    unique(
      v.occurrences.map((o) => o.nodeId),
      `views.${v.id}.occurrences`,
    )
    unique(v.relationIds, `views.${v.id}.relationIds`)
    const seen = new Set<string>()
    let cursor: typeof v | undefined = v
    while (cursor && cursor.id !== map.rootViewId) {
      if (seen.has(cursor.id)) {
        fail(`views.${v.id}.parentViewId`, '视图父级成环')
        break
      }
      seen.add(cursor.id)
      cursor =
        cursor.parentViewId === null
          ? undefined
          : views.get(cursor.parentViewId)
    }
    if (!cursor) fail(`views.${v.id}.parentViewId`, '父级路径未到达根视图')
    if (v.centerNodeId && nodes.get(v.centerNodeId)?.childViewId !== v.id)
      fail(`views.${v.id}.centerNodeId`, '中心节点与 childViewId 不一致')
    const present = new Set(v.occurrences.map((o) => o.nodeId))
    const groups = new Set(v.groups.map((g) => g.id))
    for (const o of v.occurrences) {
      if (!nodes.has(o.nodeId))
        fail(`views.${v.id}.occurrences.${o.nodeId}`, '节点不存在')
      if (o.groupId && !groups.has(o.groupId))
        fail(
          `views.${v.id}.occurrences.${o.nodeId}.groupId`,
          '分组不属于此视图',
        )
    }
    for (const rid of v.relationIds) {
      const r = relations.get(rid)
      if (!r || !present.has(r.fromNodeId) || !present.has(r.toNodeId))
        fail(
          `views.${v.id}.relationIds.${rid}`,
          '关系不存在或视图未包含两个端点',
        )
    }
  }
  for (const r of map.relations)
    if (!nodes.has(r.fromNodeId) || !nodes.has(r.toNodeId))
      fail(`relations.${r.id}`, '关系端点不存在')
  return diagnostics.length
    ? { ok: false, diagnostics }
    : { ok: true, value: map }
}
