import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceFileScope } from '@deepseek-ai/dsh-api-workspace-files'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { AtlasError, createHostFiles, localPath, mapPath, readSnapshot } from './map-files.ts'
import { transactionPort } from './tools/storage.ts'

// 永久删除是不可逆操作。持久化文件清单后逐项条件删除，失败保留清单供重试；不承诺回退已删除文件。
const manifestSchema = z.strictObject({
  mapId: z.string(), state: z.enum(['deleting', 'completed']),
  files: z.array(z.strictObject({ path: z.string(), version: z.string().min(1) })).min(1).refine(files => files.some(file => file.path === 'map.json') && new Set(files.map(file => file.path)).size === files.length, '删除清单必须包含结构文件且路径唯一'),
})
const MANIFEST = '.transactions/purge.json'
export async function purgeMap(ctx: Context, scope: WorkspaceFileScope, id: string, policy: SandboxExecutionPolicy, signal: AbortSignal) {
  const port = createHostFiles(ctx, scope, signal, policy)
  const metadata = transactionPort(ctx, scope, id, policy)
  if (!(await port.absent(mapPath(id, '.transactions/active.json')))) throw new AtlasError('recovery_required', '存在待恢复内容操作，请先恢复后再永久删除')
  const lockText = JSON.stringify({ kind: 'purge', mapId: id, owner: randomUUID() })
  let claimed = false
  let stored = await metadata.read(MANIFEST)
  let manifest
  if (stored) {
    manifest = manifestSchema.parse(JSON.parse(stored.text))
    if (manifest.mapId !== id) throw new AtlasError('invalid_data', '删除清单身份不匹配')
  } else {
    const snapshot = await readSnapshot(port, id)
    const prefix = mapPath(id, 'map.json').slice(0, -'map.json'.length)
    manifest = { mapId: id, state: 'deleting' as const, files: snapshot.files.map(file => ({ path: file.path.slice(prefix.length), version: file.version })).sort((a, b) => Number(a.path === 'map.json') - Number(b.path === 'map.json')) }

  }
  for (const file of manifest.files) {
    if (file.path !== localPath(file.path) || /(^|\/)(exports|\.transactions)(\/|$)/.test(file.path) || !['map.json', 'layout.json'].includes(file.path) && !file.path.endsWith('.md') && !file.path.startsWith('assets/')) throw new AtlasError('invalid_data', '删除清单含非内容文件，拒绝执行')
  }
  try {
    await metadata.put('.transactions/active.json', lockText, null)
    claimed = true
    if (!stored) {
      await metadata.put(MANIFEST, JSON.stringify(manifest), null)
      stored = await metadata.read(MANIFEST)
    }
    if (manifest.state === 'completed') {
      for (const file of manifest.files) if (!await port.absent(mapPath(id, file.path))) throw new AtlasError('version_conflict', '已删除地图出现新内容，保留新文件并停止')
      return
    }
    const root = await ctx.fs.resolve(scope.workspaceRoot, { signal })
    const map = await ctx.fs.resolve(mapPath(id, '.'), { cwd: scope.workspaceRoot, signal })
    if (!ctx.fs.contains(root, map)) throw new AtlasError('path_outside_map', '删除目标越过工作区')
    // 先复核所有仍存在的文件，避免已知冲突下开始不可逆操作。
    const targetFor = async (file: typeof manifest.files[number]) => {
      const relative = mapPath(id, file.path)
      const target = await ctx.fs.resolve(relative, { cwd: scope.workspaceRoot, signal })
      if (!ctx.fs.contains(map, target) || target.targetKey === map.targetKey) throw new AtlasError('path_outside_map', '删除目标越过地图边界')
      const entry = await ctx.fs.lstat(relative, { cwd: scope.workspaceRoot }, signal)
      if (entry && entry.type !== 'file') throw new AtlasError('path_outside_map', '拒绝删除符号链接或非普通文件')
      const info = await ctx.fs.stat(target, signal)
      if (info && String(info.version) !== file.version) throw new AtlasError('version_conflict', `文件已变化，未覆盖：${file.path}`)
      return { target, info }
    }
    for (const file of manifest.files) await targetFor(file)
    for (const file of manifest.files) {
      signal.throwIfAborted()
      const { target, info } = await targetFor(file)
      if (info) await ctx.fs.deleteFile(target, { version: info.version }, signal, policy)
    }
    for (const file of manifest.files) if (!await port.absent(mapPath(id, file.path))) throw new AtlasError('version_conflict', '删除期间出现新内容，保留新文件并停止')
    await metadata.put(MANIFEST, JSON.stringify({ ...manifest, state: 'completed' }), stored!.version)
  } finally {
    // 普通失败释放本次运行的认领，保留清单供重试；进程中断残留锁须显式确认原操作已终止。
    const lock = claimed ? await metadata.read('.transactions/active.json') : null
    if (lock && lock.text === lockText) await metadata.remove('.transactions/active.json', lock.version)
  }
}

