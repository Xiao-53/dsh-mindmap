import { registerTools } from './server/tools/index.ts'
import { registerAuthoring } from './server/prompts/register.ts'
import type { Context } from '@deepseek-ai/cordis'
import { MapService } from './server/map-service.ts'

export const name = 'dsh-mindmap'
export const inject = ['fs', 'workspaceFiles', 'typert', 'sessions', 'sandboxPolicy']
export function apply(ctx: Context): void {
  new MapService(ctx)
  ctx.inject(['tools', 'approval'], api => {
    try {
      registerTools(api)
    } catch (error) {
      api.logger?.warn?.('思维导图工具注册失败，已降级跳过', error)
    }
  })
  ctx.inject(['skills'], api => {
    try {
      registerAuthoring(api)
    } catch (error) {
      api.logger?.warn?.('思维导图 skill 注册失败，已降级跳过', error)
    }
  })
}
