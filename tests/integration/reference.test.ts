import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reference } from '../support/reference.ts'
import { MemoryFiles } from '../support/files.ts'
import { readSnapshot } from '../../src/server/map-files.ts'
import {
  encodeReference,
  decodeReference,
  serializeReference,
  createReferenceSource,
} from '../../src/client/reference-source.ts'
import { insertPending } from '../../src/client/insert-reference.ts'
import {
  resolveReference,
  uniqueSelection,
} from '../../src/client/reference-navigation.ts'
test('引用自包含保存、重载解码，发送序列化只含原文与可读来源', async () => {
  const ref = reference()
  const encoded = encodeReference(ref)
  assert.deepEqual(decodeReference(encoded), ref)
  const text = serializeReference(encoded)
  assert.ok(text.includes('E = mc²'))
  assert.ok(text.includes('物理 / 甲'))
  assert.ok(!text.includes('resource://'))
  assert.ok(!text.includes('workspace-a'))
  const source = createReferenceSource(() => true)
  assert.equal(
    await source.codec!.serialize(encoded, new AbortController().signal),
    text,
  )
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(source.codec!.serialize(encoded, controller.signal))
})
test('插入拒绝、会话切换、生命周期结束均保留原文；没有发送接口', () => {
  const pending = {
    snapshot: reference(),
    sessionId: 's1',
    span: { start: 3, end: 3, draftRev: 2 },
  }
  let calls = 0
  for (const target of [
    { sessionId: 's2', alive: true },
    { sessionId: 's1', alive: false },
    { sessionId: 's1', alive: true },
  ]) {
    const result = insertPending(pending, {
      ...target,
      insert: () => {
        calls++
        return false
      },
    })
    assert.equal(result.ok, false)
    assert.equal(result.pending?.snapshot.text, pending.snapshot.text)
  }
  assert.equal(calls, 1)
  const accepted = insertPending(pending, {
    sessionId: 's1',
    alive: true,
    insert: (ref, span) => {
      assert.equal(decodeReference(ref.ref).text, pending.snapshot.text)
      assert.equal(span.draftRev, 2)
      return true
    },
  })
  assert.equal(accepted.pending, undefined)
})
test('重复文字仅上下文唯一匹配才高亮，正文变化不改快照', () => {
  const ref = reference()
  assert.ok(uniqueSelection(`公式：${ref.text}。`, ref))
  assert.equal(
    uniqueSelection(`公式：${ref.text}。公式：${ref.text}。`, ref),
    undefined,
  )
  assert.equal(uniqueSelection('公式已改写', ref), undefined)
  assert.equal(ref.text, reference().text)
  assert.throws(() => decodeReference(encodeReference({ ...ref, text: '' })))
})
test('回跳优先原视图，同节点降级，节点/工作区失效不按标题猜测', async () => {
  const snap = await readSnapshot(new MemoryFiles(), 'map-a')
  const ref = reference()
  assert.equal(resolveReference(ref, snap).viewId, 'root')
  snap.map.views[0].occurrences = snap.map.views[0].occurrences.filter(
    (o) => o.nodeId !== 'a',
  )
  const fallback = resolveReference(ref, snap)
  assert.equal(fallback.viewId, 'child')
  assert.ok(fallback.message)
  snap.map.nodes[0].id = 'another'
  assert.equal(resolveReference(ref, snap).nodeId, undefined)
  assert.equal(
    resolveReference({ ...ref, workspaceKey: 'different' }, snap).nodeId,
    undefined,
  )
})
