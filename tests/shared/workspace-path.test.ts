import { test } from 'node:test'
import assert from 'node:assert/strict'
import { workspaceComparisonKey, sameWorkspaceKey, normalizeNotePathKey } from '../../src/shared/workspace-path.ts'

test('workspaceComparisonKey 与 sameWorkspaceKey 规范化 Windows 与 POSIX 路径边界', () => {
  assert.equal(workspaceComparisonKey('C:\\Work\\Repo\\'), 'c:/work/repo')
  assert.equal(workspaceComparisonKey('c:/work/repo///'), 'c:/work/repo')
  assert.equal(workspaceComparisonKey('C:\\'), 'c:/')
  assert.equal(workspaceComparisonKey('\\\\Server\\Share\\Repo\\'), '//server/share/repo')
  assert.equal(workspaceComparisonKey('/Users/Alice/Repo/'), '/Users/Alice/Repo')
  assert.equal(workspaceComparisonKey('/'), '/')
  assert.equal(sameWorkspaceKey('C:\\Work\\Repo\\', 'c:/work/repo'), true)
  assert.equal(sameWorkspaceKey('/Users/Alice/Repo', '/Users/alice/Repo'), false)
  assert.equal(sameWorkspaceKey('', '/work'), false)
  assert.equal(sameWorkspaceKey(undefined, '/work'), false)
})

test('normalizeNotePathKey 统一分隔符、重复斜杠与大小写', () => {
  assert.equal(normalizeNotePathKey('notes\\\\Sub\\NodeA.MD'), 'notes/sub/nodea.md')
  assert.equal(normalizeNotePathKey(' notes/NodeA.md '), 'notes/nodea.md')
})
