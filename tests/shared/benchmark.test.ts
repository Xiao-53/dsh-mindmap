import { test } from 'node:test'
import assert from 'node:assert/strict'
import { benchmarkMap } from '../support/benchmark.ts'
import { searchMap } from '../../src/shared/search.ts'
import { fillLayout, heightKey, nodeHeight } from '../../src/shared/layout.ts'
import { validateMap } from '../../src/shared/validate-map.ts'
import { viewPath } from '../../src/client/navigation.ts'
test('100 节点/10 视图/5000 字笔记：20 次搜索定位及分组布局', () => {
  const map = benchmarkMap()
  assert.equal(validateMap(map).ok, true)
  const snapshot = {
    map,
    notes: Object.fromEntries(
      map.nodes.map((n) => [
        n.id,
        n.id === 'n-0' ? `正文关键词${'长笔记'.repeat(2500)}` : '正文关键词',
      ]),
    ),
    resources: {},
    files: [],
    fingerprint: 'benchmark',
    workspaceKey: 'test',
  }
  const timings: number[] = []
  for (let i = 0; i < 20; i++) {
    const start = performance.now()
    const results = searchMap(snapshot, i % 2 ? '正文关键词' : '同名')
    assert.ok(results.length > 12)
    results.forEach((r) => assert.ok(viewPath(map, r.viewId).length > 0))
    timings.push(performance.now() - start)
  }
  assert.ok(timings.filter((t) => t <= 1000).length >= 19)
  const heights = Object.fromEntries(
    map.views.flatMap((v) =>
      v.occurrences.map((o, i) => [
        heightKey(v.id, o.nodeId),
        100 + (i % 4) * 30,
      ]),
    ),
  )
  const layout = fillLayout(map, undefined, heights)
  for (const view of layout.views)
    for (const [i, a] of view.nodes.entries())
      for (const b of view.nodes.slice(i + 1))
        assert.equal(
          a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + nodeHeight(heights, view.viewId, b.nodeId) &&
            a.y + nodeHeight(heights, view.viewId, a.nodeId) > b.y,
          false,
        )
  console.log(
    `纯逻辑基准：20 次搜索/路径计算最大 ${Math.max(...timings).toFixed(2)} ms；节点重叠 0。该结果不代表宿主端到端耗时。`,
  )
})
