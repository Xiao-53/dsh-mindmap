import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceFileScope } from '@deepseek-ai/dsh-api-workspace-files'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { FsVersion } from '@deepseek-ai/dsh-fs'
import { AtlasError, mapPath } from '../map-files.ts'
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
