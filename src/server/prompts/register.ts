import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import { mindmapAuthoring, mindmapDescription } from './authoring.ts'
export function registerAuthoring(ctx: Context) {
  ctx.skills.register({name:'mindmap',description:mindmapDescription,source:'bundled',content:mindmapAuthoring})
}
