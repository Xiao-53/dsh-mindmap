import { useEffect, useLayoutEffect, useRef } from 'react'
import { trapFocus } from '../focus-management.ts'
export function NodeMenu({
  x,
  y,
  close,
  add,
}: {
  x: number
  y: number
  close: () => void
  add?: () => void
}) {
  const first = useRef<HTMLButtonElement>(null)
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = root.current
    if (!el?.parentElement) return
    el.style.left = `${Math.max(8, Math.min(x, el.parentElement.clientWidth-el.offsetWidth-8))}px`
    el.style.top = `${Math.max(8, Math.min(y, el.parentElement.clientHeight-el.offsetHeight-8))}px`
  }, [x,y])
  useEffect(() => {
    first.current?.focus()
  }, [])
  return (
    <div
      ref={root}
      className="node-menu node-action-dock visible"
      role="menu"
      aria-label="节点操作"
      style={{ left: x, top: y }}
      onKeyDown={(e) => {
        trapFocus(e)
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          close()
        }
      }}
    >
      {add && <button ref={first} role="menuitem" onClick={add}><span>＋</span>添加到正文</button>}
    </div>
  )
}
