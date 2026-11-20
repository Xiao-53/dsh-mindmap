import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchMap } from '../../src/shared/search.ts'
import { readableNote, copyNote } from '../../src/client/copy-note.ts'
import { sampleMap } from '../support/maps.ts'
import type { MapSnapshot } from '../../src/shared/map-types.ts'
test('跨层标题、摘要、正文、同名身份、无结果及超过 12 条命中均可访问', () => {
  const map = sampleMap()
  for (let i = 0; i < 15; i++) {
    map.nodes.push({
      id: `same-${i}`,
      title: '同名',
      summary: '摘要',
      category: 'blue',
      icon: 'book',
    })
    map.views[0].occurrences.push({ nodeId: `same-${i}` })
  }
  const snapshot: MapSnapshot = {
    map,
    notes: { a: '正文中的量子数' },
    resources: {},
    files: [],
    fingerprint: 'x',
    workspaceKey: 'workspace-a',
  }
  assert.equal(searchMap(snapshot, '同名').length, 15)
  assert.equal(
    new Set(searchMap(snapshot, '同名').map((r) => r.nodeId)).size,
    15,
  )
  assert.equal(searchMap(snapshot, '不存在').length, 0)
  assert.equal(searchMap(snapshot, ' ').length, 0)
  assert.equal(searchMap(snapshot, '量子数').length, 2)
  assert.ok(
    searchMap(snapshot, '量子数').some(
      (r) => r.path.join('/') === 'root/child',
    ),
  )
  assert.equal(searchMap(snapshot, '公式')[0].field, '摘要')
})
test('完整复制保留公式换行与示例，复制失败不触发其他动作', async () => {
  const text = readableNote(
    '标题',
    '摘要',
    '## 关键公式 / 规则\n\nE = mc²\n\n## 典型示例\n\n- **示例**：m = 1 kg\n- 提醒',
  )
  assert.ok(text.includes('E = mc²'))
  assert.ok(text.includes('示例：m = 1 kg'))
  assert.ok(text.indexOf('关键公式') < text.indexOf('典型示例'))
  const ordered = readableNote(
    '标题',
    '',
    '## 学习提醒\n先写的提醒\n\n## 核心理解\n后写的理解',
  )
  assert.ok(ordered.indexOf('学习提醒') < ordered.indexOf('核心理解'))
  let copied = ''
  assert.equal(
    (
      await copyNote(text, async (value) => {
        copied = value
      })
    ).ok,
    true,
  )
  assert.equal(copied, text)
  assert.equal(
    (
      await copyNote(text, async () => {
        throw new Error('clipboard denied')
      })
    ).ok,
    false,
  )
})
