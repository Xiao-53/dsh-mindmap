import type { KnowledgeMap } from '../../src/shared/map-types.ts'
export function emptyMap(): KnowledgeMap {
  return {
    schemaVersion: 1,
    id: 'map-a',
    title: '知识地图',
    rootViewId: 'root',
    nodes: [],
    relations: [],
    views: [
      {
        id: 'root',
        title: '总览',
        parentViewId: null,
        groups: [],
        occurrences: [],
        relationIds: [],
      },
    ],
  }
}
export function sampleMap(): KnowledgeMap {
  const m = emptyMap()
  m.nodes = [
    {
      id: 'a',
      title: '甲',
      summary: '',
      category: 'blue',
      icon: 'book',
      childViewId: 'child',
    },
    { id: 'b', title: '乙', summary: '公式', category: 'sage', icon: 'atom' },
  ]
  m.views[0].occurrences = [{ nodeId: 'a' }, { nodeId: 'b' }]
  m.views[0].relationIds = ['ab', 'ba']
  m.views.push({
    id: 'child',
    title: '子图',
    parentViewId: 'root',
    centerNodeId: 'a',
    groups: [],
    occurrences: [{ nodeId: 'a' }],
    relationIds: [],
  })
  m.relations = [
    { id: 'ab', fromNodeId: 'a', toNodeId: 'b', type: 'dependency' },
    { id: 'ba', fromNodeId: 'b', toNodeId: 'a', type: 'supplement' },
  ]
  return m
}
