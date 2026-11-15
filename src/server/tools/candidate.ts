import { validateMap } from '../../shared/validate-map.ts'
import type { KnowledgeMap, MapSnapshot } from '../../shared/map-types.ts'
import { AtlasError } from '../map-files.ts'
import { changesSchema } from './schemas.ts'
export function candidate(snapshot: MapSnapshot, input: unknown) {
  const changes = changesSchema.parse(input) as any[]
  const map: KnowledgeMap = structuredClone(snapshot.map)
  const notes = { ...snapshot.notes }
  const affected = new Set<string>()
  const removals: string[] = []
  const find = (items: any[], id: string, key = 'id'): any => {
    const found = items.find(x => x[key] === id)
    if (!found) throw new AtlasError('invalid_data', `对象不存在：${id}`)
    return found
  }
  const prune = () => { for (const v of map.views) v.relationIds = v.relationIds.filter(id => { const r = map.relations.find(r => r.id === id); return r && [r.fromNodeId, r.toNodeId].every(n => v.occurrences.some(o => o.nodeId === n)) }) }
  for (const c of changes) {
    for (const id of [c.nodeId, c.viewId, c.relationId, c.groupId, c.node?.id, c.view?.id, c.relation?.id, c.group?.id]) if (id) affected.add(id)
    const v = c.viewId ? find(map.views, c.viewId) : undefined
    switch(c.op) {
      case 'set_map_title': map.title = c.title; break
      case 'add_node': map.nodes.push(c.node); notes[c.node.id] = ''; break
      case 'update_node': Object.assign(find(map.nodes,c.nodeId),c.fields); break
      case 'set_note': case 'remove_note': {
        const n = find(map.nodes,c.nodeId); const text = c.op === 'set_note' ? c.markdown : ''
        notes[n.id] = text
        if (text) n.notePath ??= `notes/${n.id}.md`; else { if(n.notePath) removals.push(`笔记 ${n.id}`); delete n.notePath }
        break
      }
      case 'add_view': map.views.push(c.view); break
      case 'update_view': Object.assign(v,c.fields); break
      case 'set_child_view': {
        const n = find(map.nodes,c.nodeId)
        if (n.childViewId && n.childViewId !== c.viewId) throw new AtlasError('invalid_data','已有子图必须复用；先显式解除原关联')
        if (c.viewId) { n.childViewId = c.viewId; v.centerNodeId = n.id }
        else { if (n.childViewId) delete find(map.views,n.childViewId).centerNodeId; delete n.childViewId }
        break
      }
      case 'add_group': v.groups.push(c.group); break
      case 'update_group': Object.assign(find(v.groups,c.groupId),c.fields); break
      case 'remove_group': find(v.groups,c.groupId); v.groups = v.groups.filter((g: any) => g.id !== c.groupId); removals.push(`分组 ${c.viewId}/${c.groupId}`); break
      case 'put_occurrence': { find(map.nodes,c.nodeId); const old = v.occurrences.find((o: any) => o.nodeId === c.nodeId); const next = {nodeId:c.nodeId,...c.groupId ? {groupId:c.groupId}: {}}; if(old) Object.assign(old, {groupId:undefined}, next); else v.occurrences.push(next); break }
      case 'remove_occurrence': find(v.occurrences,c.nodeId,'nodeId'); v.occurrences = v.occurrences.filter((o: any) => o.nodeId !== c.nodeId); removals.push(`出现位置 ${c.viewId}/${c.nodeId}`); prune(); break
      case 'add_relation': map.relations.push(c.relation); break
      case 'update_relation': Object.assign(find(map.relations,c.relationId),c.fields); break
      case 'remove_relation': find(map.relations,c.relationId); map.relations = map.relations.filter(r => r.id !== c.relationId); removals.push(`关系 ${c.relationId}`); prune(); break
      case 'set_view_relations': v.relationIds = c.relationIds; break
      case 'delete_node': {
        const n = find(map.nodes,c.nodeId)
        removals.push(`节点 ${n.id}`, ...(n.notePath ? [`笔记 ${n.id}`] : []), ...map.views.filter(v => v.occurrences.some(o => o.nodeId === n.id)).map(v => `出现位置 ${v.id}/${n.id}`), ...map.relations.filter(r => r.fromNodeId === n.id || r.toNodeId === n.id).map(r => `关系 ${r.id}`))
        if(n.childViewId) throw new AtlasError('invalid_data','请先处理关联子图，再删除节点')
        map.nodes = map.nodes.filter(x => x.id !== n.id); delete notes[n.id]
        for(const v of map.views) v.occurrences = v.occurrences.filter(o => o.nodeId !== n.id)
        map.relations = map.relations.filter(r => r.fromNodeId !== n.id && r.toNodeId !== n.id); prune(); break
      }
      case 'delete_view': find(map.views,c.viewId); removals.push(`视图 ${c.viewId}`, ...v.groups.map((g:any)=>`分组 ${v.id}/${g.id}`), ...v.occurrences.map((o:any)=>`出现位置 ${v.id}/${o.nodeId}`), ...v.relationIds.map((id:string)=>`视图关系引用 ${v.id}/${id}`)); map.views = map.views.filter(x => x.id !== c.viewId); break
    }
  }
  const checked = validateMap(map,map.id)
  if(!checked.ok) throw new AtlasError('invalid_data','候选结构无效',checked.diagnostics)
  return {map:checked.value,notes,affectedIds:[...affected],removals}
}
