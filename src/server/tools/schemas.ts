import { z } from 'zod'
import { mapSchema, idSchema } from '../../shared/validate-map.ts'
const node = mapSchema.shape.nodes.element.omit({ notePath: true, childViewId: true })
const view = mapSchema.shape.views.element
const relation = mapSchema.shape.relations.element
const group = view.shape.groups.element
const op = (name: string, fields: Record<string, z.ZodType>) => z.strictObject({ op: z.literal(name), ...fields })
export const changesSchema = z.array(z.union([
  op('set_map_title', { title: z.string().trim().min(1) }),
  op('add_node', { node }), op('update_node', { nodeId: idSchema, fields: node.omit({ id: true }).partial() }),
  op('set_note', { nodeId: idSchema, markdown: z.string() }), op('remove_note', { nodeId: idSchema }),
  op('add_view', { view }), op('update_view', { viewId: idSchema, fields: view.pick({ title: true, parentViewId: true, centerNodeId: true }).partial() }),
  op('set_child_view', { nodeId: idSchema, viewId: idSchema.nullable() }),
  op('add_group', { viewId: idSchema, group }), op('update_group', { viewId: idSchema, groupId: idSchema, fields: group.omit({ id: true }).partial() }),
  op('remove_group', { viewId: idSchema, groupId: idSchema }),
  op('put_occurrence', { viewId: idSchema, nodeId: idSchema, groupId: idSchema.optional() }),
  op('remove_occurrence', { viewId: idSchema, nodeId: idSchema }),
  op('add_relation', { relation }), op('update_relation', { relationId: idSchema, fields: relation.omit({ id: true }).partial() }),
  op('remove_relation', { relationId: idSchema }), op('set_view_relations', { viewId: idSchema, relationIds: z.array(idSchema) }),
  op('delete_node', { nodeId: idSchema }), op('delete_view', { viewId: idSchema }),
])).min(1)
export const contentSchema = mapSchema.omit({ id: true, schemaVersion: true }).extend({ nodes: z.array(node.extend({ childViewId: idSchema.optional() })) })
export const createSchema = z.strictObject({ operationId: idSchema, content: contentSchema, notes: z.record(idSchema, z.string()) })
export const readSchema = z.strictObject({ mapId: idSchema, nodeIds: z.array(idSchema).optional(), viewIds: z.array(idSchema).optional(), query: z.string().optional(), cursor: z.string().optional() })
export const previewSchema = z.strictObject({ mapId: idSchema, expectedFingerprint: z.string().min(1), changes: changesSchema })
export const applySchema = previewSchema.extend({ operationId: idSchema, previewToken: z.string().optional() })
