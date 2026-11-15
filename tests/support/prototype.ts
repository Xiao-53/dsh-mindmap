import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import type { MapSnapshot, KnowledgeMap, MapLayout } from '../../src/shared/map-types.ts'

export async function loadPrototype() {
  const html = await readFile('docs/knowledge_atlas_demo_v17.html', 'utf8')
  const start = html.indexOf('const N=')
  const end = html.indexOf('const WIDTH=', start)
  const data = runInNewContext(`${html.slice(start, end)}; ({ N, VIEW })`)
  const map: KnowledgeMap = { schemaVersion: 1, id: 'prototype-v17-test', title: data.VIEW.root.title, rootViewId: 'root', nodes: [], views: [], relations: [] }
  const layout: MapLayout = { schemaVersion: 1, mapId: map.id, views: [] }
  const notes: Record<string, string> = {}
  const used = new Set<string>(Object.values(data.VIEW).flatMap((v: any) => v.nodes.map((n: any) => n[0])))
  for (const id of used) {
    const n = data.N[id]
    map.nodes.push({ id, title: n.title, summary: n.short, category: n.type, icon: n.icon, notePath: `notes/${id}.md`, ...(data.VIEW[n.drill] ? { childViewId: n.drill } : {}) })
    notes[id] = `## 简介\n${n.intro}\n\n## 核心理解\n${n.body}\n\n## 关键公式 / 规则\n${n.formula}\n\n## 典型示例\n${n.example}\n\n## 学习提醒\n${n.tip}`
  }
  for (const [id, v] of Object.entries(data.VIEW) as [string, any][]) {
    const groups = v.groups.map((g: any, i: number) => ({ id: `${id}-g${i}`, title: g.name, number: g.index, category: g.tone }))
    const relationIds: string[] = []
    for (const [from, to, type, label] of v.edges) {
      const relationId = `${id}-r${relationIds.length}`
      map.relations.push({ id: relationId, fromNodeId: from, toNodeId: to, type: type === 'sub' ? 'supplement' : 'dependency', ...(label ? { label } : {}) })
      relationIds.push(relationId)
    }
    map.views.push({ id, title: v.title, parentViewId: v.parent ?? null, ...(v.center ? { centerNodeId: v.center } : {}), groups, relationIds,
      occurrences: v.nodes.map(([nodeId, , y]: any) => ({ nodeId, groupId: groups[Math.max(0, v.groups.findIndex((g: any) => y >= g.y && y < g.y+g.h))].id })) })
    layout.views.push({ viewId: id, nodes: v.nodes.map(([nodeId,x,y,width]: any) => ({ nodeId,x,y,width,manual:false })),
      groups: v.groups.map((g: any,i:number) => ({ groupId: groups[i].id, x: 42, y: g.y, width: 1058, height: g.h })) })
  }
  const snapshot: MapSnapshot = { map, layout, notes, resources: {}, files: [], fingerprint: 'v17-fixture', workspaceKey: 'test-only' }
  return { html, data, snapshot }
}
