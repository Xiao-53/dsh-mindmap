import { registerTools } from './server/tools/index.ts'
import { registerAuthoring } from './server/prompts/register.ts'
import type { Context } from '@deepseek-ai/cordis'
import { MapService } from './server/map-service.ts'

export const name = 'dsh-mindmap'
export const inject = ['fs', 'workspaceFiles', 'typert', 'sessions', 'sandboxPolicy']
export function apply(ctx: Context): void {
  new MapService(ctx)
  ctx.inject(['tools', 'skills', 'approval'], api => { registerTools(api); registerAuthoring(api) })
}
