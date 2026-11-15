import type { KnowledgeMap } from '../../src/shared/map-types.ts'
export function benchmarkMap(): KnowledgeMap {
  const nodes: KnowledgeMap['nodes'] = Array.from({ length: 100 }, (_, i) => ({
    id: `n-${i}`,
    title: i % 7 === 0 ? '同名知识' : `知识 ${i}`,
    summary: `概念摘要 ${i}`,
    category: 'blue',
    icon: 'book',
    ...(i < 9 ? { childViewId: `view-${i + 1}` } : {}),
  }))
  const views: KnowledgeMap['views'] = Array.from({ length: 10 }, (_, i) => ({
    id: i === 0 ? 'root' : `view-${i}`,
    title: `视图 ${i}`,
    parentViewId: i === 0 ? null : i < 5 && i > 1 ? `view-${i - 1}` : 'root',
    ...(i > 0 ? { centerNodeId: `n-${i - 1}` } : {}),
    groups: [
      { id: 'g1', title: '第一组', number: '01', category: 'blue' },
      { id: 'g2', title: '第二组', number: '02', category: 'sage' },
    ],
    occurrences: Array.from({ length: 30 }, (_, j) => ({
      nodeId: `n-${(i * 10 + j) % 100}`,
      groupId: j < 15 ? 'g1' : 'g2',
    })),
    relationIds: [],
  }))
  return {
    schemaVersion: 1,
    id: 'map-a',
    title: '验收基准',
    rootViewId: 'root',
    nodes,
    views,
    relations: [],
  }
}
