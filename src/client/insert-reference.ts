import type {
  TokenSpan,
  ReferenceInsert,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ReferenceSnapshot } from './reference-source.ts'
import { referenceInsert } from './reference-source.ts'
export interface PendingInsertion {
  snapshot: ReferenceSnapshot
  sessionId: string
  span: TokenSpan
}
export function insertPending(
  pending: PendingInsertion,
  target: {
    sessionId: string
    alive: boolean
    insert: (ref: ReferenceInsert, span: TokenSpan) => boolean
  },
): { ok: boolean; pending?: PendingInsertion; message: string } {
  const kind = pending.snapshot.kind === 'plot' ? '图块引用' : pending.snapshot.kind === 'note-position' ? '正文位置引用' : '选文'
  if (!target.alive || target.sessionId !== pending.sessionId)
    return {
      ok: false,
      pending,
      message: `原会话已切换或关闭；${kind}已保留，请回原会话重试。`,
    }
  try {
    const span = { ...pending.span, start: pending.span.end }
    if (target.insert(referenceInsert(pending.snapshot), span))
      return { ok: true, message: `${kind}已加入输入框，请自行编辑并发送。` }
  } catch {
    /* 宿主拒绝时保留原文与原会话，不向其他会话兜底。 */
  }
  return {
    ok: false,
    pending,
    message: `输入框暂不可写或草稿已变化；${kind}已保留，可在原会话重试。`,
  }
}
