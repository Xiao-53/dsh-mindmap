import { useEffect, useRef, useState } from 'react'
import { trapFocus } from '../focus-management.ts'
export function QuestionDraft({ title, quote, sendToInput, close }: {
  title: string; quote: string; sendToInput: (text: string) => boolean; close: () => void
}) {
  const [question, setQuestion] = useState(`请解释“${title}”的核心含义，并结合下面的内容举例说明。`)
  const [error, setError] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => input.current?.focus(), [])
  return <div className="search-overlay question-overlay" onClick={e => { if (e.target === e.currentTarget) close() }}>
    <form className="search-modal question-draft" role="dialog" aria-modal="true" aria-label="问题草稿" onKeyDown={e => { trapFocus(e); if(e.key === 'Escape') { e.stopPropagation(); close() } }} onSubmit={e => {
      e.preventDefault()
      if (sendToInput(`${question.trim()}\n\n来源：${title}\n${quote.split('\n').map(line => `> ${line}`).join('\n')}`)) close()
      else setError('输入框暂不可写或原会话已变化；草稿已保留，请回原会话重试。')
    }}>
      <div className="search-modal-head"><strong>问题草稿</strong><button type="button" className="btn" aria-label="关闭问题草稿" onClick={close}>×</button></div>
      <div className="question-body"><label>想问什么<textarea ref={input} required value={question} onChange={e => setQuestion(e.target.value)}/></label><blockquote>{quote}</blockquote><p>加入输入框后可继续编辑，由你手动发送。</p>{error && <p role="alert">{error}</p>}</div>
      <div className="detail-footer"><button className="btn primary" disabled={!question.trim()}>加入输入框</button><button type="button" className="btn" onClick={close}>取消</button></div>
    </form>
  </div>
}
