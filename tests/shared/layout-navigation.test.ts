import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fillLayout, nodeHeight, placeBucketNodes, relayoutView, availableModes } from '../../src/shared/layout.ts'
import { edgeGeometry } from '../../src/shared/edge-geometry.ts'
import {
  NavigationTransition,
  fitCameraForView,
  neighborFocusZoom,
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


test('邻接排版长链蛇形折行，孤立节点保持原序，环路结果确定', () => {
  const map = emptyMap(), ids = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']
  map.nodes = ids.map(id => ({ id, title: id, summary: '', category: 'blue', icon: 'book' }))
  map.views[0].groups = [{ id: 'g', title: '组', number: '1', category: 'blue' }]
  map.views[0].occurrences = ids.map(nodeId => ({ nodeId, groupId: 'g' }))
  map.relations = ids.slice(1).map((toNodeId, i) => ({ id: `e${i}`, fromNodeId: ids[i], toNodeId, type: 'dependency' }))
  map.views[0].relationIds = map.relations.map(e => e.id)
  for (const view of [fillLayout(map, undefined, {}).views[0], relayoutView(map, 'root', 'vertical', {})]) {
    const byId = new Map(view.nodes.map(n => [n.nodeId, n]))
    assert.equal(byId.get('n3')!.x, byId.get('n4')!.x)
    assert.equal(byId.get('n4')!.y - byId.get('n3')!.y, 162)
    for (let i = 1; i < ids.length; i++) {
      const a = byId.get(ids[i - 1])!, b = byId.get(ids[i])!
      assert.equal(Math.abs(a.x - b.x) / 327 + Math.abs(a.y - b.y) / 162, 1)
    }
  }
  const isolated = placeBucketNodes(ids, [], { 'root/n2': 240 }, 'root', 0, 0)
  assert.deepEqual(isolated.map(n => [n.x, n.y]), [[0,0],[327,0],[654,0],[0,272],[327,272],[654,272]])
  map.relations.push({ id: 'cycle', fromNodeId: 'n6', toNodeId: 'n1', type: 'dependency' })
  assert.deepEqual(placeBucketNodes(ids, map.relations, {}, 'root', 0, 0), placeBucketNodes(ids, map.relations, {}, 'root', 0, 0))
})

test('枢纽居中且直连节点不被同行第三卡片夹住', () => {
  const ids = ['hub', 'a', 'b', 'c', 'd']
  const edges = ids.slice(1).map(toNodeId => ({ id: toNodeId, fromNodeId: 'hub', toNodeId, type: 'dependency' as const }))
  const nodes = placeBucketNodes(ids, edges, {}, 'root', 0, 0)
  assert.equal(nodes[0].x, 327)
  const pair = placeBucketNodes(['a', 'middle', 'b'], [{ id: 'ab', fromNodeId: 'a', toNodeId: 'b', type: 'dependency' }], {}, 'root', 0, 0)
  assert.equal(Math.abs(pair[0].x - pair[2].x), 327)
})

test('小分组紧凑包裹，历史 columns 无损读取且主动重排归一', async () => {
  const { layoutSchema } = await import('../../src/shared/validate-layout.ts')
  const map = sampleMap(), view = map.views[0]
  view.groups = [{ id: 'g', title: '组', number: '1', category: 'blue' }]
  for (const count of [1, 2]) {
    view.occurrences = map.nodes.slice(0, count).map(n => ({ nodeId: n.id, groupId: 'g' }))
    for (const result of [fillLayout(map, undefined, {}).views[0], relayoutView(map, 'root', 'vertical', {})])
      assert.equal(result.groups[0].width, count === 1 ? 284 : 611)
  }
  const previous = fillLayout(map, undefined, {})
  previous.schemaVersion = 2
  previous.views.forEach(v => { v.mode = 'vertical' })
  previous.views[0].mode = 'columns'
  previous.views[0].nodes[0] = { ...previous.views[0].nodes[0], x: -200, y: 47, width: 280, manual: true }
  previous.views[0].groups[0].width = 1058
  assert.ok(layoutSchema.safeParse(previous).success)
  assert.deepEqual(fillLayout(map, previous, { 'root/a': 400 }), previous)
  assert.deepEqual(availableModes(view), ['vertical'])
  assert.equal(relayoutView(map, 'root', 'columns', {}).mode, 'vertical')
  view.groups.push({ id: 'empty', title: '空组', number: '2', category: 'sage' })
  assert.deepEqual(availableModes(view), ['vertical', 'grid'])
  assert.equal(relayoutView(map, 'root', 'columns', {}).mode, 'grid')
})

test('点击关系胶囊采用适配缩放加 10%，且不改变搜索和引用定位默认缩放', () => {
  const map = sampleMap()
  const layout = fillLayout(map, undefined, {})
  const reading = initialReading('workspace-a', 's1', map)
  const viewport = { width: 800, height: 600 }
  const fit = fitCameraForView(layout.views[0], {}, viewport)
  const neighborZoom = neighborFocusZoom(layout.views[0], {}, viewport)
  assert.ok(Math.abs(neighborZoom - Math.min(2.5, fit.zoom + 0.1)) < 1e-9)
  const focused = targetReading(reading, 'root', 'b', layout, {}, { width: 480, height: 600 }, neighborZoom)
  assert.ok(Math.abs(focused.cameras.root.zoom - neighborZoom) < 1e-9)
  assert.ok(focused.cameras.root.zoom < 1.05)
  assert.equal(neighborFocusZoom(layout.views[0], {}, { width: 5000, height: 4000 }), 1.25)
  assert.equal(targetReading(reading, 'root', 'b', layout, {}, viewport, 3).cameras.root.zoom, 2.5)
})

test('跨分组距离协同对齐、弹性分叉汇合居中与直线吸附（SC-001/SC-002）', () => {
  const map = emptyMap()
  map.nodes = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1'].map((id) => ({
    id, title: id, summary: '', category: 'blue', icon: 'book',
  }))
  map.views[0].groups = [
    { id: 'g1', title: '组一', number: '1', category: 'blue' },
    { id: 'g2', title: '组二', number: '2', category: 'sage' },
    { id: 'g3', title: '组三', number: '3', category: 'gold' },
  ]
  map.views[0].occurrences = [
    { nodeId: 'a1', groupId: 'g1' }, { nodeId: 'a2', groupId: 'g1' }, { nodeId: 'a3', groupId: 'g1' },
    { nodeId: 'b1', groupId: 'g2' }, { nodeId: 'b2', groupId: 'g2' }, { nodeId: 'b3', groupId: 'g2' },
    { nodeId: 'c1', groupId: 'g3' },
  ]
  // 组内完全无边，仅跨组平行连线且 g3 单节点连向 g2 最右侧关联节点 b1（对应 a3）
  map.relations = [
    { id: 'r1', fromNodeId: 'a1', toNodeId: 'b2', type: 'dependency' },
    { id: 'r2', fromNodeId: 'a2', toNodeId: 'b3', type: 'dependency' },
    { id: 'r3', fromNodeId: 'a3', toNodeId: 'b1', type: 'dependency' },
    { id: 'r4', fromNodeId: 'b1', toNodeId: 'c1', type: 'dependency' },
  ]
  map.views[0].relationIds = map.relations.map((r) => r.id)
  for (const view of [fillLayout(map, undefined, {}).views[0], relayoutView(map, 'root', 'vertical', {})]) {
    const byId = new Map(view.nodes.map((n) => [n.nodeId, n]))
    assert.equal(byId.get('b2')!.x, byId.get('a1')!.x)
    assert.equal(byId.get('b3')!.x, byId.get('a2')!.x)
    assert.equal(byId.get('b1')!.x, byId.get('a3')!.x)
    assert.equal(byId.get('c1')!.x, byId.get('b1')!.x)
    assert.equal(view.groups[2].x, 42)
    assert.equal(view.groups[2].width, view.groups[0].width)
  }

  // 1 -> 2 -> 1 菱形与 1 -> 3 一分三居中对齐
  const diamond = placeBucketNodes(
    ['top', 'left', 'right', 'bottom'],
    [
      { id: 'e1', fromNodeId: 'top', toNodeId: 'left', type: 'dependency' },
      { id: 'e2', fromNodeId: 'top', toNodeId: 'right', type: 'dependency' },
      { id: 'e3', fromNodeId: 'left', toNodeId: 'bottom', type: 'dependency' },
      { id: 'e4', fromNodeId: 'right', toNodeId: 'bottom', type: 'dependency' },
    ],
    {},
    'root',
    0,
    0,
  )
  const dById = new Map(diamond.map((n) => [n.nodeId, n]))
  assert.equal(dById.get('top')!.x, 327)
  assert.equal(dById.get('bottom')!.x, 327)
  assert.ok(dById.get('left')!.y > dById.get('top')!.y && dById.get('bottom')!.y > dById.get('left')!.y)

  const fanOut = placeBucketNodes(
    ['root', 'c1', 'c2', 'c3'],
    [
      { id: 'f1', fromNodeId: 'root', toNodeId: 'c1', type: 'dependency' },
      { id: 'f2', fromNodeId: 'root', toNodeId: 'c2', type: 'dependency' },
      { id: 'f3', fromNodeId: 'root', toNodeId: 'c3', type: 'dependency' },
    ],
    {},
    'root',
    0,
    0,
  )
  assert.equal(fanOut[0].x, 327)
  assert.equal(fanOut[1].y, fanOut[2].y)
})

test('增量新增节点围绕已定位邻居就近落位，满载 20 节点环路图确定性零重叠（SC-003/SC-004）', () => {
  const map = sampleMap()
  const base = fillLayout(map, undefined, {})
  base.views[0].nodes = base.views[0].nodes.map((n) =>
    n.nodeId === 'b' ? { ...n, x: 900, y: 400, manual: true } : n,
  )
  const keptB = { ...base.views[0].nodes[1] }
  map.nodes.push({ id: 'c', title: '丙', summary: '', category: 'plum', icon: 'spark' })
  map.views[0].occurrences.push({ nodeId: 'c' })
  map.relations.push({ id: 'bc', fromNodeId: 'b', toNodeId: 'c', type: 'dependency' })
  map.views[0].relationIds.push('bc')
  const updated = fillLayout(map, base, {})
  const uById = new Map(updated.views[0].nodes.map((n) => [n.nodeId, n]))
  assert.deepEqual(uById.get('b'), keptB)
  const placedC = uById.get('c')!
  assert.ok(Math.hypot(placedC.x - keptB.x, placedC.y - keptB.y) <= 1.5 * 327)

  // 20 节点 / 30 边含环路多分组视图重复执行 10 次结果完全一致且零重叠
  const big = emptyMap()
  big.nodes = Array.from({ length: 20 }, (_, i) => ({
    id: `n${i}`, title: `N${i}`, summary: '', category: 'blue', icon: 'book',
  }))
  big.views[0].groups = [
    { id: 'g1', title: '组1', number: '1', category: 'blue' },
    { id: 'g2', title: '组2', number: '2', category: 'sage' },
    { id: 'g3', title: '组3', number: '3', category: 'gold' },
  ]
  big.views[0].occurrences = big.nodes.map((n, i) => ({
    nodeId: n.id,
    groupId: i < 7 ? 'g1' : i < 14 ? 'g2' : 'g3',
  }))
  big.relations = Array.from({ length: 30 }, (_, i) => ({
    id: `e${i}`,
    fromNodeId: `n${i % 20}`,
    toNodeId: `n${(i * 3 + 1) % 20}`,
    type: i % 4 === 0 ? 'supplement' : 'dependency',
  }))
  big.views[0].relationIds = big.relations.map((r) => r.id)
  const firstRun = fillLayout(big, undefined, {})
  for (let i = 0; i < 9; i++) {
    assert.deepEqual(fillLayout(big, undefined, {}), firstRun)
  }
  for (const mode of ['vertical', 'grid'] as const) {
    const view = relayoutView(big, 'root', mode, {})
    for (let i = 0; i < view.nodes.length; i++) {
      for (let j = i + 1; j < view.nodes.length; j++) {
        const a = view.nodes[i], b = view.nodes[j]
        assert.equal(
          a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + 130 && a.y + 130 > b.y,
          false,
        )
      }
    }
  }
})

test('全视图严格对齐离散网格列、填满顶行并统一垂直分组框宽（截图1：斯大林结构）', () => {
  const map = emptyMap()
  map.nodes = [
    { id: 'struggle', title: '党内权力斗争', summary: '', category: 'amber', icon: 'book' },
    { id: 'secretary', title: '总书记之路', summary: '', category: 'gold', icon: 'split' },
    { id: 'nationalities', title: '民族事务人民委员', summary: '', category: 'amber', icon: 'book' },
    { id: 'five_year', title: '五年计划与工业化', summary: '', category: 'sage', icon: 'grid' },
    { id: 'collectivization', title: '农业集体化', summary: '', category: 'sage', icon: 'grid' },
    { id: 'purge', title: '大清洗', summary: '', category: 'coral', icon: 'alert' },
    { id: 'war', title: '卫国战争', summary: '', category: 'coral', icon: 'book' },
    { id: 'yalta', title: '雅尔塔体系', summary: '', category: 'plum', icon: 'link' },
  ]
  map.views[0].groups = [
    { id: 'g2', title: '2 掌权与改造', number: '2', category: 'amber' },
    { id: 'g3', title: '3 统治与战争', number: '3', category: 'sage' },
  ]
  map.views[0].occurrences = [
    { nodeId: 'struggle', groupId: 'g2' },
    { nodeId: 'secretary', groupId: 'g2' },
    { nodeId: 'nationalities', groupId: 'g2' },
    { nodeId: 'five_year', groupId: 'g3' },
    { nodeId: 'collectivization', groupId: 'g3' },
    { nodeId: 'purge', groupId: 'g3' },
    { nodeId: 'war', groupId: 'g3' },
    { nodeId: 'yalta', groupId: 'g3' },
  ]
  map.relations = [
    { id: 'r1', fromNodeId: 'nationalities', toNodeId: 'secretary', type: 'dependency' },
    { id: 'r2', fromNodeId: 'secretary', toNodeId: 'struggle', type: 'dependency' },
    { id: 'r3', fromNodeId: 'struggle', toNodeId: 'five_year', type: 'dependency' },
    { id: 'r4', fromNodeId: 'struggle', toNodeId: 'purge', type: 'dependency' },
    { id: 'r5', fromNodeId: 'five_year', toNodeId: 'collectivization', type: 'dependency' },
    { id: 'r6', fromNodeId: 'five_year', toNodeId: 'war', type: 'dependency' },
    { id: 'r7', fromNodeId: 'war', toNodeId: 'yalta', type: 'dependency' },
  ]
  map.views[0].relationIds = map.relations.map((r) => r.id)

  for (const view of [fillLayout(map, undefined, {}).views[0], relayoutView(map, 'root', 'vertical', {})]) {
    for (const node of view.nodes) {
      assert.equal((node.x - 66) % 327, 0)
    }
    const g3Nodes = ['five_year', 'collectivization', 'purge', 'war', 'yalta'].map(
      (id) => view.nodes.find((n) => n.nodeId === id)!,
    )
    const minY = Math.min(...g3Nodes.map((n) => n.y))
    assert.equal(g3Nodes.filter((n) => n.y === minY).length, 3)
    assert.equal(view.groups[0].x, 42)
    assert.equal(view.groups[1].x, 42)
    assert.equal(view.groups[0].width, 938)
    assert.equal(view.groups[1].width, 938)
  }
})

test('多分组跨段避让内列直穿与线段重合，消除首行空洞与参差框宽（截图2-3：一战结构）', () => {
  const map = emptyMap()
  map.nodes = [
    { id: 'rev', title: '第二次工业革命', summary: '', category: 'blue', icon: 'spark' },
    { id: 'imp', title: '帝国主义与殖民扩张', summary: '', category: 'coral', icon: 'grid' },
    { id: 'nat', title: '民族主义', summary: '', category: 'gold', icon: 'idea' },
    { id: 'mil', title: '军国主义与军备竞赛', summary: '', category: 'plum', icon: 'alert' },
    { id: 'bismarck', title: '俾斯麦体系与德国新路线', summary: '', category: 'blue', icon: 'book' },
    { id: 'alliance', title: '三国同盟', summary: '', category: 'coral', icon: 'link' },
    { id: 'entente', title: '三国协约', summary: '', category: 'sage', icon: 'link' },
    { id: 'bosnia', title: '波斯尼亚危机', summary: '', category: 'gold', icon: 'alert' },
    { id: 'morocco', title: '摩洛哥危机', summary: '', category: 'gold', icon: 'book' },
    { id: 'balkan_war', title: '巴尔干战争', summary: '', category: 'amber', icon: 'split' },
    { id: 'powder', title: '巴尔干火药桶', summary: '', category: 'coral', icon: 'alert' },
    { id: 'sarajevo', title: '萨拉热窝事件', summary: '', category: 'plum', icon: 'book' },
    { id: 'july', title: '七月危机与宣战', summary: '', category: 'plum', icon: 'split' },
  ]
  map.views[0].groups = [
    { id: 'g1', title: '1 根源与矛盾', number: '1', category: 'blue' },
    { id: 'g2', title: '2 联盟体系', number: '2', category: 'amber' },
    { id: 'g3', title: '3 危机与冲突', number: '3', category: 'gold' },
    { id: 'g4', title: '4 导火索', number: '4', category: 'plum' },
  ]
  map.views[0].occurrences = [
    { nodeId: 'rev', groupId: 'g1' },
    { nodeId: 'imp', groupId: 'g1' },
    { nodeId: 'nat', groupId: 'g1' },
    { nodeId: 'mil', groupId: 'g1' },
    { nodeId: 'bismarck', groupId: 'g2' },
    { nodeId: 'alliance', groupId: 'g2' },
    { nodeId: 'entente', groupId: 'g2' },
    { nodeId: 'bosnia', groupId: 'g3' },
    { nodeId: 'morocco', groupId: 'g3' },
    { nodeId: 'balkan_war', groupId: 'g3' },
    { nodeId: 'powder', groupId: 'g3' },
    { nodeId: 'sarajevo', groupId: 'g4' },
    { nodeId: 'july', groupId: 'g4' },
  ]
  map.relations = [
    { id: 'r1', fromNodeId: 'rev', toNodeId: 'imp', type: 'dependency' },
    { id: 'r2', fromNodeId: 'bismarck', toNodeId: 'alliance', type: 'dependency' },
    { id: 'r3', fromNodeId: 'alliance', toNodeId: 'entente', type: 'dependency' },
    { id: 'r4', fromNodeId: 'bosnia', toNodeId: 'powder', type: 'dependency' },
    { id: 'r5', fromNodeId: 'morocco', toNodeId: 'powder', type: 'dependency' },
    { id: 'r6', fromNodeId: 'balkan_war', toNodeId: 'powder', type: 'dependency' },
    { id: 'r7', fromNodeId: 'sarajevo', toNodeId: 'july', type: 'dependency' },
    { id: 'r8', fromNodeId: 'imp', toNodeId: 'alliance', type: 'dependency' },
    { id: 'r9', fromNodeId: 'nat', toNodeId: 'powder', type: 'dependency' },
    { id: 'r10', fromNodeId: 'mil', toNodeId: 'july', type: 'dependency' },
    { id: 'r11', fromNodeId: 'alliance', toNodeId: 'morocco', type: 'dependency' },
    { id: 'r12', fromNodeId: 'powder', toNodeId: 'sarajevo', type: 'dependency' },
  ]
  map.views[0].relationIds = map.relations.map((r) => r.id)

  const view = fillLayout(map, undefined, {}).views[0]
  const byId = new Map(view.nodes.map((n) => [n.nodeId, n]))
  for (const node of view.nodes) {
    assert.equal((node.x - 66) % 327, 0)
  }
  const g1Nodes = ['rev', 'imp', 'nat', 'mil'].map((id) => byId.get(id)!)
  const g1TopY = Math.min(...g1Nodes.map((n) => n.y))
  assert.equal(g1Nodes.filter((n) => n.y === g1TopY).length, 3)

  // 中间内列 x=393 不允许任何纵向连线直穿他卡或同列纵向段叠线
  const interiorSegs: { yLo: number; yHi: number }[] = []
  for (const r of map.relations) {
    const a = byId.get(r.fromNodeId)!
    const b = byId.get(r.toNodeId)!
    if (a.x !== 393 || b.x !== 393) continue
    const yLo = Math.min(a.y, b.y) + 130
    const yHi = Math.max(a.y, b.y)
    const pierced = view.nodes.some(
      (n) => n.nodeId !== a.nodeId && n.nodeId !== b.nodeId && n.x === 393 && n.y >= yLo && n.y < yHi,
    )
    assert.equal(pierced, false)
    interiorSegs.push({ yLo, yHi })
  }
  for (let i = 0; i < interiorSegs.length; i++) {
    for (let j = i + 1; j < interiorSegs.length; j++) {
      assert.equal(
        Math.min(interiorSegs[i].yHi, interiorSegs[j].yHi) - Math.max(interiorSegs[i].yLo, interiorSegs[j].yLo) > 10,
        false,
      )
    }
  }

  for (const g of view.groups) {
    assert.equal(g.x, 42)
    assert.equal(g.width, 938)
  }

  const gridView = relayoutView(map, 'root', 'grid', {})
  assert.equal(gridView.groups[0].x, gridView.groups[2].x)
  assert.equal(gridView.groups[0].width, gridView.groups[2].width)
  assert.equal(gridView.groups[1].x, gridView.groups[3].x)
  assert.equal(gridView.groups[1].width, gridView.groups[3].width)
})
