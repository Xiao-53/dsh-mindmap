import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ATLAS_KIND as AtlasKindType } from './register-sidebar.tsx'

const ATLAS_KIND: typeof AtlasKindType = 'dsh-mindmap'

const completedListeners = new Set<() => void>()
export function onCompletedMapChange(listener: () => void): () => void {
  completedListeners.add(listener)
  return () => { completedListeners.delete(listener) }
}
const notifyCompletedChange = () => {
  for (const listener of completedListeners) {
    try { listener() } catch { /* ignore listener failure */ }
  }
}

// 订阅当前会话的实时工具结果；历史加载、预览、失败和其他会话均不触发打开。
export function registerCompletedMapNavigation(ctx: Context): void {
  ctx.effect(() => {
    const sessions = ctx.sessions as unknown as Pick<ISessions, 'binding' | 'list'> | undefined
    if (!sessions || typeof sessions.binding !== 'function' || typeof sessions.list?.subscribe !== 'function' || !ctx.sidebarRight?.mounted) {
      ctx.logger?.warn?.('会话事件服务不可用，跳过导图自动打开监听')
      return () => {}
    }
    let owner: SessionBinding | undefined
    let unsubscribe = () => {}
    const bind = () => {
      const id = ctx.sidebarRight.mounted.getSnapshot()
      const binding = id ? sessions.binding(id) : undefined
      if (binding === owner) return
      unsubscribe(); owner = binding
      const source = binding?.eventSource
      if (!binding || !source || typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function') {
        unsubscribe = () => {}
        return
      }
      let revision = source.getSnapshot()?.revision
      const calls = new Map<string, string>()
      const opened = new Set<string>()
      const rememberCall = (callId: unknown, name: unknown) => {
        if (typeof callId !== 'string' || typeof name !== 'string') return
        calls.set(callId, name)
        while (calls.size > 256) calls.delete(calls.keys().next().value!)
      }
      const indexCalls = (entries: unknown) => {
        if (!Array.isArray(entries)) return
        for (const entry of entries) {
          if (entry?.type === 'event' && entry.event?.type === 'tool/call') {
            rememberCall(entry.event.data?.callId, entry.event.data?.name)
          }
        }
      }
      indexCalls(source.getSnapshot()?.entries)
      unsubscribe = source.subscribe(() => {
        try {
          const window = source.getSnapshot()
          if (!window || window.revision === revision) return
          revision = window.revision
          if (window.change?.kind !== 'append') { indexCalls(window.entries); return }
          if (!Array.isArray(window.change.entries)) return
          let mapId: string | undefined
          let completedAny = false
          for (const entry of window.change.entries) {
            if (entry?.type !== 'event' || !entry.event) continue
            const event = entry.event
            if (event.type === 'tool/call') { rememberCall(event.data?.callId, event.data?.name); continue }
            if (event.type !== 'tool/result') continue
            const message = event.data?.message
            if (!message) continue
            const name = calls.get(message.toolCallId)
            calls.delete(message.toolCallId)
            if (message.isError || (name !== 'atlas_create' && name !== 'atlas_apply' && name !== 'atlas_cleanup_create')) continue
            if (!Array.isArray(message.content)) continue
            for (const block of message.content) {
              if (block?.type !== 'text' || typeof block.text !== 'string') continue
              try {
                const result = JSON.parse(block.text)
                if (result?.status !== 'success') continue
                completedAny = true
                if (name === 'atlas_cleanup_create') continue
                if (typeof result.mapId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(result.mapId) || typeof result.operationId !== 'string' || opened.has(result.operationId)) continue
                opened.add(result.operationId)
                if (opened.size > 256) opened.delete(opened.values().next().value!)
                mapId = result.mapId
              } catch { /* 只有插件成功结果的规范JSON可触发导航。 */ }
            }
          }
          if (completedAny) notifyCompletedChange()
          if (mapId && sessions.binding(binding.sessionId) === binding && ctx.sidebarRight.mounted.getSnapshot() === binding.sessionId) {
            try { ctx.sidebarRight.openTab(ATLAS_KIND, { params: { mapId, autoOpen: true } }) }
            catch (error) { ctx.logger?.warn?.('导图已保存，但自动打开失败', error) }
          }
        } catch (error) {
          ctx.logger?.warn?.('解析导图工具事件流失败', error)
        }
      })
    }
    const unmount = ctx.sidebarRight.mounted.subscribe(bind)
    const unlist = sessions.list.subscribe(bind)
    bind()
    return () => { unmount(); unlist(); unsubscribe() }
  })
}
