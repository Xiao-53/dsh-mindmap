import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceFileScope } from '@deepseek-ai/dsh-api-workspace-files'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { AtlasError, createHostFiles, inspectCreatePlaceholder } from './map-files.ts'
import { transactionPort } from './tools/storage.ts'
import { sameWorkspaceKey } from '../shared/workspace-path.ts'
import { evictEditMemory } from './edit-service.ts'

// UI与DSH共用；调用方必须已取得用户的清理意图，并持有本图的会话队列。
export async function cleanupCreate(ctx: Context, scope: WorkspaceFileScope, mapId: string, operationId: string, policy: SandboxExecutionPolicy, signal: AbortSignal) {
  signal.throwIfAborted()
  if (policy.mode === 'read-only') throw new AtlasError('permission_denied', '只读会话不能清理创建记录')
  if (!sameWorkspaceKey(policy.workspaceRoot, scope.workspaceRoot)) throw new AtlasError('workspace_changed', '清理工作区已变化')
  // 作废标记落盘后继续完成清理，取消请求不能让旧请求重新生效。
  const files = createHostFiles(ctx, scope, new AbortController().signal, policy)
  const metadata = transactionPort(ctx, scope, mapId, policy)
  const prior = await inspectCreatePlaceholder(files, mapId)
  if (!prior || prior.operationId !== operationId) throw new AtlasError('cleanup_refused', '只能清理已识别且没有活动事务的未完成创建；完整地图、未知内容及待恢复资料保留')
  if (prior.state === 'discarded') return {status:'success',mapId,operationId,summary:'该创建记录已清理，旧请求已作废'}
  const lockText = JSON.stringify({kind:'create-cleanup',owner:randomUUID(),operationId,request:prior.request})
  signal.throwIfAborted()
  await metadata.put('.transactions/active.json', lockText, null)
  try {
    const current = await inspectCreatePlaceholder(files, mapId, lockText)
    if (!current || current.operationId !== operationId || current.request !== prior.request) throw new AtlasError('cleanup_refused', '创建状态已变化，未删除资料')
    const marker = '.transactions/discarded-create.json'
    if (!await metadata.read(marker)) await metadata.put(marker,JSON.stringify({kind:'discarded_create',mapId,operationId,request:current.request}),null)
    // 先作废，再逐项条件删除；中途失败可重复同一清理操作继续完成。
    for (const name of ['reservation.json','failed.json']) {
      const path = `.transactions/${operationId}/${name}`
      const record = await metadata.read(path)
      if (!record) continue
      const request = name === 'reservation.json' ? record.text : JSON.parse(record.text).request
      if (request !== current.request) throw new AtlasError('operation_conflict', '创建记录已变化，停止清理')
      await metadata.remove(path,record.version)
    }
    const after = await inspectCreatePlaceholder(files, mapId, lockText)
    if (after?.state !== 'discarded') throw new AtlasError('cleanup_incomplete', '请求已作废，发现额外内容或状态变化，保留现场')
    evictEditMemory(scope.workspaceRoot, mapId)
    return {status:'success',mapId,operationId,summary:'未完成创建已清理，旧请求已作废'}
  } finally {
    const lock = await metadata.read('.transactions/active.json')
    if (lock?.text === lockText) await metadata.remove('.transactions/active.json',lock.version)
  }
}
