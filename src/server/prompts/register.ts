import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import { mindmapAuthoring, mindmapDescription } from './authoring.ts'
export function registerAuthoring(ctx: Context) {
  if (typeof ctx.skills?.register !== 'function') return
  try {
    ctx.skills.register({ name: 'mindmap', description: mindmapDescription, source: 'bundled', content: mindmapAuthoring })
  } catch (error) {
    ctx.logger?.warn?.('注册 mindmap skill 失败（可能存在同名冲突），已跳过', error)
  }
}
