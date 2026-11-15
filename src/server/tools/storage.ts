import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import type { WorkspaceFileScope } from '@deepseek-ai/dsh-api-workspace-files'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { FsVersion } from '@deepseek-ai/dsh-fs'
import { AtlasError, createHostFiles, inspectCreatePlaceholder, mapPath } from '../map-files.ts'
import type { TransactionPort } from '../transaction.ts'
export function transactionPort(ctx: Context, scope: WorkspaceFileScope, mapId: string, policy: SandboxExecutionPolicy): TransactionPort {
  // 回退必须在调用取消后仍能完成，不复用已取消的工具signal。
  const signal = new AbortController().signal
  async function target(path: string) {
    const relative = mapPath(mapId,path)
    const root = await ctx.fs.resolve(scope.workspaceRoot,{signal})
    const data = await ctx.fs.resolve('dsh-knowledge-maps',{cwd:scope.workspaceRoot,signal})
    const map = await ctx.fs.resolve(mapPath(mapId,'.'),{cwd:scope.workspaceRoot,signal})
    const file = await ctx.fs.resolve(relative,{cwd:scope.workspaceRoot,signal})
    if(!ctx.fs.contains(root,data) || !ctx.fs.contains(data,map) || !ctx.fs.contains(map,file) || map.targetKey === file.targetKey) throw new AtlasError('path_outside_map','真实路径越过地图边界')
    const entry = await ctx.fs.lstat(relative,{cwd:scope.workspaceRoot},signal)
    if(entry && entry.type !== 'file') throw new AtlasError('path_outside_map','写入目标必须为普通文件')
    return file
  }
  return {
    async read(path) { const t = await target(path); const before = await ctx.fs.stat(t,signal); if(!before) return null; const text = await ctx.fs.readText(t,signal); if((await ctx.fs.stat(t,signal))?.version !== before.version) throw new AtlasError('version_conflict','文件读取中变化'); return {text,version:String(before.version)} },
    async put(path,text,version) { await ctx.fs.writeText(await target(path),text,version === null ? {kind:'createIfAbsent'} : {kind:'replaceIfVersion',version:version as FsVersion},signal,policy) },
    async remove(path,version) { await ctx.fs.deleteFile(await target(path),{version:version as FsVersion},signal,policy) },
  }
}

// 在已回退或尚未提交的创建失败后，释放占位文件，保留必要请求指纹供重试/冲突检查。
export async function releaseFailedCreate(ctx: Context, scope: WorkspaceFileScope, mapId: string, operationId: string, request: string, policy: SandboxExecutionPolicy, code: string) {
  const signal = new AbortController().signal
  const files = createHostFiles(ctx, scope, signal, policy)
  const metadata = transactionPort(ctx, scope, mapId, policy)
  const matches = (state: Awaited<ReturnType<typeof inspectCreatePlaceholder>>) => state?.operationId === operationId && state.request === request
  if (!await metadata.read(`.transactions/${operationId}/reservation.json`) && !await metadata.read(`.transactions/${operationId}/failed.json`)) return true
  const state = await inspectCreatePlaceholder(files, mapId)
  if (!matches(state)) return false
  if (state?.state === 'discarded') return true
  const lockText = JSON.stringify({kind:'create-cleanup', owner:randomUUID(), operationId, request})
  // createIfAbsent与正常提交共用认领；不能接管另一Host的活动操作。
  await metadata.put('.transactions/active.json', lockText, null)
  try {
    const current = await inspectCreatePlaceholder(files, mapId, lockText)
    if (!matches(current)) return false
    const prefix = `.transactions/${operationId}`
    if (current?.state === 'cleanup_pending' || current?.state === 'discarded') {
      // 用户清理可能与尚未提交的旧请求交错；只能释放晚到的占位，不能恢复已作废请求。
      for (const name of ['reservation.json','failed.json']) {
        const path = `${prefix}/${name}`
        const record = await metadata.read(path)
        if (!record) continue
        const binding = name === 'reservation.json' ? record.text : JSON.parse(record.text).request
        if (binding !== request) throw new AtlasError('operation_conflict','创建资料已变化，停止清理')
        await metadata.remove(path, record.version)
      }
      return true
    }
    const failed = await metadata.read(`${prefix}/failed.json`)
    if (!failed) await metadata.put(`${prefix}/failed.json`, JSON.stringify({kind:'failed_create',operationId,request,code}), null)
    const reservation = await metadata.read(`${prefix}/reservation.json`)
    if (reservation) {
      if (reservation.text !== request) throw new AtlasError('operation_conflict', '创建占位已改变，保留资料')
      await metadata.remove(`${prefix}/reservation.json`, reservation.version)
    }
    return true
  } finally {
    const lock = await metadata.read('.transactions/active.json')
    if (lock?.text === lockText) await metadata.remove('.transactions/active.json', lock.version)
  }
}
