import { validateMap } from '../../shared/validate-map.ts'
import type { KnowledgeMap, MapSnapshot } from '../../shared/map-types.ts'
import { AtlasError } from '../map-files.ts'
import { changesSchema } from './schemas.ts'
import { notePlots } from '../../shared/note-markdown.ts'

// 历史坏块允许原样读写；只有新增或被修改的无效块阻止本次提交。
export function validateCandidatePlots(
  before: MapSnapshot['notes'], after: MapSnapshot['notes'], map: KnowledgeMap,
): string[] {
  const removals: string[] = []
  for (const nodeId of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const previousText = Object.hasOwn(before, nodeId) ? before[nodeId] : ''
    const nextText = Object.hasOwn(after, nodeId) ? after[nodeId] : ''
    if (previousText === nextText) continue
    const previous = notePlots(previousText)
    const next = notePlots(nextText)
    const priorErrors = new Map<string, number>()
    const errorKey = (plot: (typeof previous)[number]) => JSON.stringify([plot.error, plot.source])
    for (const plot of previous) if (plot.error) {
      const key = errorKey(plot)
      priorErrors.set(key, (priorErrors.get(key) ?? 0) + 1)
    }
    for (const plot of next) if (plot.error) {
      const key = errorKey(plot)
      const count = priorErrors.get(key) ?? 0
      if (!count) {
        const notePath = map.nodes.find(node => node.id === nodeId)?.notePath ?? `notes/${nodeId}.md`
        throw new AtlasError('invalid_data', '图块候选无效', [{
          path: notePath, code: 'invalid_plot', message: plot.id ? `图块 ${plot.id}：${plot.error}` : plot.error,
        }])
      }
      priorErrors.set(key, count - 1)
    }
    const remainingIds = new Map<string, number>()
    for (const { id } of next) if (id) remainingIds.set(id, (remainingIds.get(id) ?? 0) + 1)
    for (const plot of previous) {
      if (!plot.id) continue
      const count = remainingIds.get(plot.id) ?? 0
      if (!count) removals.push(`图块 ${nodeId}/${plot.id}`)
      else remainingIds.set(plot.id, count - 1)
    }
    // 解析失败、没有可识别 ID 的旧块也可能被移除。
    for (const [key, count] of priorErrors) {
      if (count && previous.some(plot => !plot.id && errorKey(plot) === key))
        removals.push(`笔记 ${nodeId} 中的无效图块 × ${count}`)
    }
  }
  return [...new Set(removals)]
}

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
      case 'insert_note_content': throw new AtlasError('invalid_data', '正文位置须先在当前笔记中核验')
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
