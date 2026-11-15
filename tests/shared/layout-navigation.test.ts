import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fillLayout, nodeHeight } from '../../src/shared/layout.ts'
import { edgeGeometry } from '../../src/shared/edge-geometry.ts'
import {
  NavigationTransition,
  viewPath,
  nodeDestination,
  targetReading,
} from '../../src/client/navigation.ts'
import { validateMap } from '../../src/shared/validate-map.ts'
import { emptyMap, sampleMap } from '../support/maps.ts'
import { initialReading } from '../../src/client/reading-state.ts'
test('共享子图采用目标父级路径，关系循环不干扰导航', () => {
  const map = sampleMap()
  assert.deepEqual(viewPath(map, 'child'), ['root', 'child'])
  assert.equal(nodeDestination(map.nodes[0], 'root'), 'child')
  assert.equal(nodeDestination(map.nodes[0], 'child'), undefined)
  assert.equal(validateMap(map).ok, true)
})
test('20 层路径完整，无固定业务层数上限', () => {
  const map = emptyMap()
  let parent = 'root'
  for (let i = 1; i <= 20; i++) {
    const id = `view-${i}`
    const nodeId = `node-${i}`
    map.nodes.push({
      id: nodeId,
      title: id,
      summary: '',
      category: 'blue',
      icon: 'book',
      childViewId: id,
    })
    map.views.push({
      id,
      title: id,
      parentViewId: parent,
      centerNodeId: nodeId,
      occurrences: [],
      groups: [],
      relationIds: [],
    })
    parent = id
  }
  assert.equal(validateMap(map).ok, true)
  assert.equal(viewPath(map, parent).length, 21)
})
test('缺失布局补位无重叠、保留 manual 坐标，清理删除记录，空图合法', () => {
  const map = sampleMap()
  const heights = { 'root/a': 300, 'root/b': 180 }
  let layout = fillLayout(map, undefined, heights)
  const root = layout.views[0]
  root.nodes[0] = { ...root.nodes[0], x: -42, y: 117, manual: true }
  const kept = { ...root.nodes[0] }
  map.nodes.push({
    id: 'c',
    title: '丙',
    summary: '',
    category: 'terra',
    icon: 'formula',
  })
  map.views[0].occurrences.push({ nodeId: 'c' })
  layout = fillLayout(map, layout, heights)
  assert.deepEqual(layout.views[0].nodes[0], kept)
  const list = layout.views[0].nodes
  for (const [i, a] of list.entries())
    for (const b of list.slice(i + 1))
      assert.equal(
        a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + nodeHeight(heights, 'root', b.nodeId) &&
          a.y + nodeHeight(heights, 'root', a.nodeId) > b.y,
        false,
      )
  map.views[0].occurrences = map.views[0].occurrences.filter(
    (o) => o.nodeId !== 'b',
  )
  assert.equal(
    fillLayout(map, layout, heights).views[0].nodes.some(
      (n) => n.nodeId === 'b',
    ),
    false,
  )
  assert.deepEqual(fillLayout(emptyMap(), undefined, {}).views[0].nodes, [])
})
test('连线端点在边界，循环与零间距不会产生非法几何', () => {
  const a = { x: 0, y: 0, width: 200, height: 100 }
  const b = { x: 300, y: 0, width: 200, height: 100 }
  const edge = edgeGeometry(a, b)
  assert.equal(edge.start.x, 200)
  assert.equal(edge.end.x, 300)
  assert.ok(!edgeGeometry(a, a, true).d.includes('NaN'))
})
test('退出 180ms 后切图，进入 320ms，连续导航只提交最新目标，卸载取消', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const nav = new NavigationTransition()
  const phases: string[] = []
  const commits: string[] = []
  nav.navigate(
    'a',
    false,
    (p) => phases.push(p),
    (id) => commits.push(id),
  )
  t.mock.timers.tick(179)
  assert.deepEqual(commits, [])
  nav.navigate(
    'b',
    false,
    (p) => phases.push(p),
    (id) => commits.push(id),
  )
  t.mock.timers.tick(1)
  assert.deepEqual(commits, ['b'])
  assert.equal(phases.at(-1), 'in')
  t.mock.timers.tick(320)
  assert.equal(phases.at(-1), 'idle')
  nav.navigate(
    'c',
    false,
    (p) => phases.push(p),
    (id) => commits.push(id),
  )
  nav.dispose()
  t.mock.timers.tick(500)
  assert.deepEqual(commits, ['b'])
})
test('减少动态效果立即导航', () => {
  let selected = ''
  const nav = new NavigationTransition()
  nav.navigate(
    'child',
    true,
    () => {},
    (id) => {
      selected = id
    },
  )
  assert.equal(selected, 'child')
  nav.dispose()
})
test('搜索和引用定位居中目标节点，保留其他视图相机', () => {
  const map = sampleMap()
  const layout = fillLayout(map, undefined, {})
  const reading = initialReading('workspace-a', 's1', map)
  reading.cameras.root = { x: -100, y: -200, zoom: 0.7 }
  const next = targetReading(
    reading,
    'child',
    'a',
    layout,
    {},
    { width: 480, height: 600 },
  )
  assert.equal(next.viewId, 'child')
  assert.equal(next.selectedNodeId, 'a')
  assert.deepEqual(next.cameras.root, reading.cameras.root)
  assert.ok(next.cameras.child.zoom >= 1.05)
})
