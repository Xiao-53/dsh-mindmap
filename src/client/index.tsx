import { registerCompletedMapNavigation } from './open-completed-map.ts'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { atlasRemote } from '../shared/rpc.ts'
import { createReferenceSource } from './reference-source.ts'
import { registerSidebar, ATLAS_KIND } from './register-sidebar.tsx'
import { MarkdownNoteEditor } from './components/MarkdownNoteEditor.tsx'
declare const __NOTE_MATH_CSS__: string
import atlasCss from './styles/atlas.css'
import prototypeCss from './styles/prototype.css'
export const inject = [
  'slots',
  'sidebarRight',
  'sidebarRightTabs',
  'remote',
  'remote.workspaceFiles',
  'inputTriggers',
  'conversation',
  'sessions',
]
export async function apply(ctx: Context): Promise<void> {
  await ctx.remote.$mount(atlasRemote)
  // 命名空间由上一步创建，不能作为顶层启动依赖等待自身挂载。
  await ctx.inject(['remote.dshAtlas'], registerClient)
}
function registerClient(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = atlasCss + '\n' + prototypeCss + '\n' + __NOTE_MATH_CSS__
    document.head.append(style)
    return () => style.remove()
  })
  ctx.effect(() =>
    ctx.inputTriggers.registerSource(
      createReferenceSource((reference, sessionId) => {
        if (
          reference.sessionId !== sessionId ||
          ctx.sidebarRight.mounted.getSnapshot() !== sessionId
        )
          return false
        ctx.sidebarRight.openTab(ATLAS_KIND, {
          params: { mapId: reference.mapId, reference },
        })
        return true
      }),
    ),
  )
  registerSidebar(ctx, MarkdownNoteEditor)
  registerCompletedMapNavigation(ctx)
}
