import type { KnowledgeMap, View } from '../../shared/map-types.ts'

export interface NeighborItem {
  nodeId: string
  title: string
  relationId: string
  label?: string
}
export interface ViewNeighbors {
  prerequisites: NeighborItem[]
  dependents: NeighborItem[]
  supplements: NeighborItem[]
}
export function computeViewNeighbors(map: KnowledgeMap, view: View, nodeId: string): ViewNeighbors {
  const result: ViewNeighbors = { prerequisites: [], dependents: [], supplements: [] }
  const visible = new Set(view.occurrences.map(o => o.nodeId))
  if (view.centerNodeId) visible.add(view.centerNodeId)
  const relations = new Map(map.relations.map(r => [r.id, r]))
  const nodes = new Map(map.nodes.map(n => [n.id, n]))
  for (const id of view.relationIds) {
    const r = relations.get(id)
    if (!r || !visible.has(r.fromNodeId) || !visible.has(r.toNodeId)) continue
    if (r.fromNodeId !== nodeId && r.toNodeId !== nodeId) continue
    const target = r.fromNodeId === nodeId ? r.toNodeId : r.fromNodeId
    const node = nodes.get(target)
    if (!node || target === nodeId) continue
    const role = r.type === 'supplement' ? 'supplements' : r.toNodeId === nodeId ? 'prerequisites' : 'dependents'
    if (!result[role].some(item => item.nodeId === target))
      result[role].push({ nodeId: target, title: node.title, relationId: id, label: r.label })
  }
  return result
}
export function NeighborPills({ map, view, nodeId, onSelect }: {
  map: KnowledgeMap; view: View; nodeId: string; onSelect: (nodeId: string) => void
}) {
  const neighbors = computeViewNeighbors(map, view, nodeId)
  const roles = ['prerequisites', 'dependents', 'supplements'] as const
  const titles = { prerequisites: '前置依赖', dependents: '后续节点', supplements: '补充关联' }
  if (roles.every(role => !neighbors[role].length)) return null
  return <section className="neighbor-pills" aria-label="当前视图关联节点">
    {roles.filter(role => neighbors[role].length).map(role => <div className="neighbor-pill-group" key={role}>
      <h4>{titles[role]}</h4>
      <div>{neighbors[role].map(item => <button key={item.nodeId} type="button" className="neighbor-pill"
        data-neighbor-node={item.nodeId} data-neighbor-role={role} title={item.label}
        onClick={() => onSelect(item.nodeId)}>{item.title}</button>)}</div>
    </div>)}
  </section>
}
