import { useEffect, useRef, useState } from 'react'
export interface LayoutSaveStatus {
  state: 'saved' | 'saving' | 'unsaved' | 'error'
  detail?: string
  save: () => void
  discard: () => void
  canDiscard: boolean
  cleanupAssets?: () => Promise<void>
}
const labels = { saved: '已保存', saving: '正在保存', unsaved: '未保存', error: '保存未完成' }
export function SaveStatus({ status }: { status: LayoutSaveStatus }) {
  const [open,setOpen] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown',outside)
    document.addEventListener('keydown',escape,true)
    return () => { document.removeEventListener('pointerdown',outside); document.removeEventListener('keydown',escape,true) }
  },[open])
  return <div ref={root} className="layout-save-control">
    <button ref={trigger} className={`atlas-host-button layout-save-status is-${status.state}`} aria-label={labels[status.state]} title={labels[status.state]} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {status.state === 'saved' ? <><circle cx="12" cy="12" r="8"/><path d="m8 12 2.5 2.5L16 9"/></> : status.state === 'saving' ? <path className="save-spinner" d="M20 12a8 8 0 1 1-8-8"/> : status.state === 'error' ? <><path d="m12 3 10 18H2zM12 9v5"/><path d="M12 17h.01"/></> : <><path d="M5 3h12l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8"/><circle cx="18" cy="6" r="2.4" fill="currentColor" stroke="none"/></>}
      </svg>
    </button>
    {open && <div className="layout-save-popover" role="dialog" aria-label="保存状态">
      <strong>{labels[status.state]}</strong>
      <p>{status.detail || (status.state === 'saved' ? '当前已保存。' : status.state === 'saving' ? '保存完成后状态会自动更新。' : '修改已保留在本会话，可重试保存或放弃。')}</p>
      {status.state !== 'saved' && <div className="layout-save-actions">
        <button disabled={status.state === 'saving'} onClick={status.save}>{status.state === 'error' ? '重试保存' : '保存修改'}</button>
        {status.canDiscard && <button disabled={status.state === 'saving'} onClick={() => { status.discard(); setOpen(false) }}>放弃并重载</button>}
      </div>}
      {status.state === 'saved' && status.cleanupAssets && <div className="layout-save-actions">
        <button disabled={cleaning} onClick={() => {
          setCleaning(true)
          void status.cleanupAssets!().finally(() => { setCleaning(false); setOpen(false) })
        }}>{cleaning ? '正在清理…' : '清理未引用图片'}</button>
      </div>}
    </div>}
  </div>
}
