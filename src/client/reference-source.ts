import { z } from 'zod'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { noteAnchorSchema } from '../shared/note-position.ts'
import { idSchema } from '../shared/validate-map.ts'
import type { MapSnapshot, KnowledgeNode } from '../shared/map-types.ts'
export const SOURCE_NAME = 'dsh-mindmap'
const referenceSchema = z.strictObject({
  version: z.literal(1),
  kind: z.enum(['node', 'selection', 'plot', 'note-position']).optional(),
  anchor: noteAnchorSchema.optional(),
  plotId: idSchema.optional(),
  plotContent: z.string().min(1).max(128 * 1024).optional(),
  mapId: idSchema,
  nodeId: idSchema,
  originViewId: idSchema,
  text: z.string().min(1),
  before: z.string(),
  after: z.string(),
  fingerprint: z.string(),
  noteDigest: z.string(),
  mapTitle: z.string(),
  nodeTitle: z.string(),
  sessionId: z.string().min(1),
  workspaceKey: z.string().min(1),
  resourceAddress: z.string().min(1),
}).refine(ref => (ref.kind === 'plot' ? !!ref.plotId && !!ref.plotContent : !ref.plotId && !ref.plotContent) &&
  (ref.kind === 'note-position' ? ref.anchor?.mapId === ref.mapId && ref.anchor.nodeId === ref.nodeId : !ref.anchor))
export type ReferenceSnapshot = z.infer<typeof referenceSchema>
export function referenceContentDigest(
  snapshot: MapSnapshot,
  node: KnowledgeNode,
): string {
  return JSON.stringify([
    node.title,
    node.summary,
    node.notePath
      ? (snapshot.files.find(
          (f) =>
            f.path ===
            `dsh-knowledge-maps/${snapshot.map.id}/${node.notePath!.replaceAll('\\', '/')}`,
        )?.digest ?? '')
      : '',
  ])
}
export const encodeReference = (snapshot: ReferenceSnapshot): string =>
  JSON.stringify(referenceSchema.parse(snapshot))
export const decodeReference = (ref: string): ReferenceSnapshot =>
  referenceSchema.parse(JSON.parse(ref))
export function serializeReference(ref: string): string {
  const s = decodeReference(ref)
  const plot = s.kind === 'plot' ? `，图块 ${s.plotId}` : ''
  const anchor = s.anchor ? '\n正文位置 anchor：' + JSON.stringify(s.anchor) : ''
  const text = s.kind === 'plot' ? `图块内容快照：${s.plotContent}` : s.text
  return `来源：${s.mapTitle} / ${s.nodeTitle}（地图 ${s.mapId}，节点 ${s.nodeId}${plot}）\n${text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')}${anchor}`
}
export function referenceInsert(snapshot: ReferenceSnapshot): ReferenceInsert {
  return {
    source: SOURCE_NAME,
    ref: encodeReference(snapshot),
    label: `${snapshot.nodeTitle} · ${snapshot.kind === 'plot' ? '图块 ' + snapshot.plotId : snapshot.kind === 'node' ? '节点' : snapshot.kind === 'note-position' ? '正文位置' : '选文'}`,
    appearance: 'file',
    clipboardText: snapshot.text,
  }
}
export function createReferenceSource(
  open: (snapshot: ReferenceSnapshot, sessionId: string) => boolean,
): InputTriggerSource {
  return {
    trigger: '@',
    name: SOURCE_NAME,
    candidates: async () => [],
    onPick: () => undefined,
    codec: {
      clipboardText: (ref) => decodeReference(ref).text,
      serialize: async (ref, signal) => {
        signal.throwIfAborted()
        return serializeReference(ref)
      },
    },
    openReference(session, reference) {
      try {
        return open(decodeReference(reference.ref), session.sessionId)
      } catch {
        return false
      }
    },
  }
}
