import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateMap } from '../../src/shared/validate-map.ts'
import { validateLayout } from '../../src/shared/validate-layout.ts'
import { emptyMap, sampleMap } from '../support/maps.ts'

test('合法空图、共享节点和知识关系环', () => {
  assert.equal(validateMap(emptyMap(), 'map-a').ok, true)
  assert.equal(validateMap(sampleMap(), 'map-a').ok, true)
})
for (const [label, mutate] of [
  ['重复节点', (m: any) => m.nodes.push(m.nodes[0])],
  ['非法类别', (m: any) => (m.nodes[0].category = 'red')],
  ['缺少摘要', (m: any) => delete m.nodes[0].summary],
  ['未知格式', (m: any) => (m.schemaVersion = 2)],
  ['父级循环', (m: any) => (m.views[1].parentViewId = 'child')],
  ['悬空端点', (m: any) => (m.relations[0].toNodeId = 'missing')],
  ['子图反向不一致', (m: any) => (m.views[1].centerNodeId = 'b')],
  ['视图出现重复', (m: any) => m.views[0].occurrences.push({ nodeId: 'a' })],
  ['视图关系缺端点', (m: any) => m.views[1].relationIds.push('ab')],
  [
    '共用笔记文件',
    (m: any) => {
      m.nodes[0].notePath = 'notes/a.md'
      m.nodes[1].notePath = 'notes/a.md'
    },
  ],
  ['非法身份', (m: any) => (m.nodes[0].id = '../a')],
] as const)
  test(`拒绝${label}并返回字段诊断`, () => {
    const m = sampleMap()
    mutate(m)
    const result = validateMap(m, 'map-a')
    assert.equal(result.ok, false)
    if (!result.ok)
      assert.ok(result.diagnostics.every((d) => d.path && d.message))
  })
test('目录身份、错图布局、缺少布局与错误布局', () => {
  assert.equal(validateMap(emptyMap(), 'other').ok, false)
  assert.equal(validateLayout(undefined, emptyMap()).ok, true)
  assert.equal(
    validateLayout({ schemaVersion: 1, mapId: 'other', views: [] }, emptyMap())
      .ok,
    false,
  )
  assert.equal(
    validateLayout(
      {
        schemaVersion: 1,
        mapId: 'map-a',
        views: [
          {
            viewId: 'root',
            nodes: [{ nodeId: 'a', x: NaN, y: 0, width: -1, manual: 'yes' }],
            groups: [],
          },
        ],
      },
      sampleMap(),
    ).ok,
    false,
  )
})
