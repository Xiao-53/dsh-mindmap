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
import darkCss from './styles/dark.css'
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
  try {
    await ctx.remote.$mount(atlasRemote)
  } catch (error) {
    ctx.logger?.warn?.('挂载思维导图远端服务失败', error)
    return
  }
  // 命名空间由上一步创建，不能作为顶层启动依赖等待自身挂载。
  try {
    await ctx.inject(['remote.dshAtlas'], registerClient)
  } catch (error) {
    ctx.logger?.warn?.('初始化思维导图客户端插件失败', error)
  }
}
function registerClient(ctx: Context): void {
  if (typeof document !== 'undefined' && document.head) {
    ctx.effect(() => {
      const style = document.createElement('style')
      style.textContent = atlasCss + '\n' + prototypeCss + '\n' + darkCss + '\n' + __NOTE_MATH_CSS__
      document.head.append(style)
      return () => style.remove()
    })
  }
  try {
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
  } catch (error) {
    ctx.logger?.warn?.('注册思维导图引用触发源失败，已降级跳过', error)
  }
  try {
    registerSidebar(ctx, MarkdownNoteEditor)
  } catch (error) {
    ctx.logger?.warn?.('注册思维导图侧栏失败', error)
  }
  try {
    registerCompletedMapNavigation(ctx)
  } catch (error) {
    ctx.logger?.warn?.('注册思维导图自动导航监听器失败，已降级跳过', error)
  }
}
