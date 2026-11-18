import { closeEditSessions, disposeEditSessions } from './edit-session.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {
  ReferenceInsert,
  TokenSpan,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { ReadingStore, ReadingState, Camera } from './reading-state.ts'
import { createHostAdapter } from './host-adapter.ts'
import { AtlasPane } from './AtlasPane.tsx'
import type { NoteBodyEditor } from './components/NodeEditor.tsx'
import type { ReferenceSnapshot } from './reference-source.ts'
import type { PendingInsertion } from './insert-reference.ts'
export const ATLAS_KIND = 'dsh-mindmap'
export const ATLAS_ID = 'dsh-mindmap/atlas'
export interface AtlasNavigation {
  mapId?: string
  reference?: ReferenceSnapshot
}
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    'dsh-mindmap': AtlasNavigation
  }
}
export function createReadingStore() {
  return defineStore({
    init: (): ReadingStore => ({ maps: {}, pending: {} }),
    actions: {
      selectMap: (draft, id: string) => {
        draft.selectedMapId = id
      },
      setReading: (draft, key: string, value: ReadingState) => {
        draft.maps[key] = value
      },
      setPending: (draft, key: string, value: PendingInsertion | undefined) => {
        draft.pending[key] = value
      },
      setCamera: (
        draft,
        key: string,
        seed: ReadingState,
        viewId: string,
        camera: Camera,
      ) => {
        const reading = draft.maps[key] ?? seed
        draft.maps[key] = {
          ...reading,
          cameras: { ...reading.cameras, [viewId]: camera },
        }
      },
    },
  })
}
export function registerSidebar(ctx: Context, bodyEditor: NoteBodyEditor): void {
  ctx.effect(() => () => disposeEditSessions())
  ctx.effect(() => ctx.sidebarRight.registerCloseHandler(ATLAS_KIND, sessionId => closeEditSessions(sessionId)))
  ctx.effect(() =>
    ctx.sidebarRightTabs.register({
      id: ATLAS_ID,
      kind: ATLAS_KIND,
      keepMounted: true,
      title: () => '思维导图',
      guide: [
        {
          id: 'atlas',
          order: 50,
          title: () => '思维导图',
          description: () => '选择、收纳与阅读工作区中的思维导图',
        },
      ],
    }),
  )
  const store = createReadingStore()
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register(
      {
        name: 'sidebar.right.pane.tab',
        key: ATLAS_ID,
        store,
        inject: (sessionId) => {
          // 客户端和服务端共享 Context 声明，此入口由客户端 Session 服务提供。
          const sessions = ctx.sessions as unknown as Pick<ISessions, 'binding'>
          const binding = sessions.binding(sessionId)
          return {
            bodyEditor,
            host: createHostAdapter(ctx, sessionId),
            insertReference: (ref: ReferenceInsert, span: TokenSpan) => {
              if (
                !binding ||
                sessions.binding(sessionId) !== binding ||
                ctx.sidebarRight.mounted.getSnapshot() !== sessionId
              )
                return false
              return ctx.conversation.input
                .for(binding.ctx)
                .insertReference(ref, span)
            },
            insertText: (text: string, span: TokenSpan) => {
              if (!binding || sessions.binding(sessionId) !== binding || ctx.sidebarRight.mounted.getSnapshot() !== sessionId) return false
              return binding.ctx.bail('slash/input-insert-text', { text, span }) === true
            },
          }
        },
      },
      AtlasPane,
    ),
  )
}
