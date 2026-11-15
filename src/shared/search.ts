import type { MapSnapshot } from './map-types.ts'
import { viewPath } from '../client/navigation.ts'
export interface SearchResult {
  nodeId: string
  viewId: string
  path: string[]
  field: '标题' | '摘要' | '正文'
  snippet: string
}
export function searchMap(
  snapshot: MapSnapshot,
  query: string,
): SearchResult[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const results: SearchResult[] = []
  for (const node of snapshot.map.nodes) {
    const fields = [
      ['标题', node.title],
      ['摘要', node.summary],
      ['正文', snapshot.notes[node.id] ?? ''],
    ] as const
    const hit = fields.find(([, text]) =>
      text.toLocaleLowerCase().includes(needle),
    )
    if (!hit) continue
    const at = hit[1].toLocaleLowerCase().indexOf(needle)
    const snippet = hit[1].slice(Math.max(0, at - 24), at + needle.length + 65)
    const occurrences = snapshot.map.views.filter((v) =>
      v.occurrences.some((o) => o.nodeId === node.id),
    )
    const centers = snapshot.map.views.filter((v) => v.centerNodeId === node.id)
    for (const v of occurrences.length
      ? occurrences
      : centers.length
        ? centers
        : snapshot.map.views.filter((v) => v.id === snapshot.map.rootViewId))
      results.push({
        nodeId: node.id,
        viewId: v.id,
        path: viewPath(snapshot.map, v.id),
        field: hit[0],
        snippet,
      })
  }
  return results
}
