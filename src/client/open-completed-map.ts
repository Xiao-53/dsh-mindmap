import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { ATLAS_KIND } from './register-sidebar.tsx'

// 订阅当前会话的实时工具结果；历史加载、预览、失败和其他会话均不触发打开。
export function registerCompletedMapNavigation(ctx: Context): void {
  ctx.effect(() => {
    const sessions = ctx.sessions as unknown as Pick<ISessions, 'binding' | 'list'>
    let owner: SessionBinding | undefined
    let unsubscribe = () => {}
    const bind = () => {
      const id = ctx.sidebarRight.mounted.getSnapshot()
      const binding = id ? sessions.binding(id) : undefined
      if (binding === owner) return
      unsubscribe(); owner = binding
      if (!binding) { unsubscribe = () => {}; return }
      const source = binding.eventSource
      let revision = source.getSnapshot().revision
      const calls = new Map<string, string>()
      const opened = new Set<string>()
      const indexCalls = (entries: ReturnType<typeof source.getSnapshot>['entries']) => {
        for (const entry of entries) if (entry.type === 'event' && entry.event.type === 'tool/call') calls.set(entry.event.data.callId, entry.event.data.name)
      }
      indexCalls(source.getSnapshot().entries)
      unsubscribe = source.subscribe(() => {
        const window = source.getSnapshot()
        if (window.revision === revision) return
        revision = window.revision
        if (window.change.kind !== 'append') { indexCalls(window.entries); return }
        let mapId: string | undefined
        for (const entry of window.change.entries) {
          if (entry.type !== 'event') continue
          const event = entry.event
          if (event.type === 'tool/call') { calls.set(event.data.callId, event.data.name); continue }
          if (event.type !== 'tool/result') continue
          const message = event.data.message
          const name = calls.get(message.toolCallId)
          calls.delete(message.toolCallId)
          if (message.isError || (name !== 'atlas_create' && name !== 'atlas_apply')) continue
          for (const block of message.content) {
            if (block.type !== 'text') continue
            try {
              const result = JSON.parse(block.text)
              if (result.status !== 'success' || typeof result.mapId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(result.mapId) || typeof result.operationId !== 'string' || opened.has(result.operationId)) continue
              opened.add(result.operationId)
              if (opened.size > 256) opened.delete(opened.values().next().value!)
              mapId = result.mapId
            } catch { /* 只有插件成功结果的规范JSON可触发导航。 */ }
          }
        }
        if (mapId && sessions.binding(binding.sessionId) === binding && ctx.sidebarRight.mounted.getSnapshot() === binding.sessionId) {
          try { ctx.sidebarRight.openTab(ATLAS_KIND, { params: { mapId } }) }
          catch (error) { ctx.logger.warn('导图已保存，但自动打开失败', error) }
        }
      })
    }
    const unmount = ctx.sidebarRight.mounted.subscribe(bind)
    const unlist = sessions.list.subscribe(bind)
    bind()
    return () => { unmount(); unlist(); unsubscribe() }
  })
}
