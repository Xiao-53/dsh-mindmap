import { z } from 'zod'
import { idSchema } from './validate-map.ts'
import type { MapLayout, KnowledgeMap, Validation } from './map-types.ts'
const finite = z.number().finite()
export const layoutSchema = z.strictObject({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  mapId: idSchema,
  views: z.array(
    z.strictObject({
      viewId: idSchema,
      mode: z.enum(['vertical', 'grid', 'columns']).optional(),
      nodes: z.array(
        z.strictObject({
          nodeId: idSchema,
          x: finite,
          y: finite,
          width: finite.positive(),
          manual: z.boolean(),
        }),
      ),
      groups: z.array(
        z.strictObject({
          groupId: idSchema,
          x: finite,
          y: finite,
          width: finite.positive(),
          height: finite.positive(),
        }),
      ),
    }),
  ),
})
export function validateLayout(
  input: unknown,
  map: KnowledgeMap,
): Validation<MapLayout | undefined> {
  if (input === undefined) return { ok: true, value: undefined }
  const p = layoutSchema.safeParse(input)
  if (!p.success)
    return {
      ok: false,
      diagnostics: p.error.issues.map((i) => ({
        path: ['layout.json', ...i.path].join('.'),
        message: i.message,
        code: 'invalid_layout',
      })),
    }
  const errors: string[] = []
  if (p.data.schemaVersion === 1 && p.data.views.some(v => v.mode !== undefined)) errors.push('v1 布局不能包含排列模式')
  if (p.data.schemaVersion === 2 && p.data.views.some(v => !v.mode)) errors.push('v2 布局必须包含排列模式')
  if (p.data.mapId !== map.id) errors.push('mapId 必须与地图一致')
  const check = (ids: string[], path: string) => {
    if (new Set(ids).size !== ids.length) errors.push(`${path} 包含重复身份`)
  }
  check(
    p.data.views.map((v) => v.viewId),
    'views',
  )
  for (const v of p.data.views) {
    check(
      v.nodes.map((n) => n.nodeId),
      `views.${v.viewId}.nodes`,
    )
    check(
      v.groups.map((g) => g.groupId),
      `views.${v.viewId}.groups`,
    )
  }
  // 已删除的派生记录由补位步骤清理；缺少的记录由实际尺寸补齐。
  return errors.length
    ? {
        ok: false,
        diagnostics: errors.map((message) => ({
          path: 'layout.json',
          message,
          code: 'invalid_layout',
        })),
      }
    : { ok: true, value: p.data }
}
