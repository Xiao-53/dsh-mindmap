import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, PointerEvent } from 'react'
import type { KnowledgeNode, NodeLayout } from '../../shared/map-types.ts'
import { Icon } from './Icon.tsx'
const requestFrame = (cb: FrameRequestCallback): number =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(cb)
    : Number(setTimeout(() => cb(performance.now()), 16))
const cancelFrame = (id: number): void => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
  else clearTimeout(id)
}
export const palette = {
  terra: { border: 'var(--cat-terra-border, #e8caba)', color: 'var(--cat-terra-color, #a96a4c)', wash: 'var(--cat-terra-wash, #f8eae0)' },
  sage: { border: 'var(--cat-sage-border, #c6d6c7)', color: 'var(--cat-sage-color, #64866d)', wash: 'var(--cat-sage-wash, #ebf2e9)' },
  blue: { border: 'var(--cat-blue-border, #cad9e2)', color: 'var(--cat-blue-color, #5c8298)', wash: 'var(--cat-blue-wash, #ebf2f5)' },
  plum: { border: 'var(--cat-plum-border, #ddd0de)', color: 'var(--cat-plum-color, #927597)', wash: 'var(--cat-plum-wash, #f3ecf3)' },
  gold: { border: 'var(--cat-gold-border, #e3d5b7)', color: 'var(--cat-gold-color, #a18451)', wash: 'var(--cat-gold-wash, #f7f0df)' },
}
export function NodeCard({
  node,
  layout,
  viewId,
  selected,
  measure,
  onOpen,
  onNote,
  onMenu,
  children, onMove, onCommit, onDragStart, onDragEnd, locked,
}: {
  node: KnowledgeNode
  layout?: NodeLayout
  viewId: string
  selected?: boolean
  measure?: boolean
  onOpen?: () => void
  onNote?: () => void
  onMenu?: (x: number, y: number) => void
  children?: ReactNode
  onMove?: (x: number, y: number) => void
  onCommit?: () => void
  onDragStart?: () => void
  onDragEnd?: () => void
  locked?: boolean
}) {
  const drag = useRef<{ pointer: number; x: number; y: number; ox: number; oy: number; scale: number; active: boolean }>()
  const pendingMove = useRef<{x:number;y:number}>()
  const moveFrame = useRef(0)
  const moveHandler = useRef(onMove)
  moveHandler.current = onMove
  const flushMove = () => {
    cancelFrame(moveFrame.current); moveFrame.current = 0
    const point = pendingMove.current; pendingMove.current = undefined
    if (point) moveHandler.current?.(point.x,point.y)
  }
  useEffect(() => () => cancelFrame(moveFrame.current), [])
  const suppressClickUntil = useRef(0)
  const [dragging, setDragging] = useState(false)
  const stop = (e: PointerEvent<HTMLDivElement>, cancel = false) => {
    const d = drag.current
    if (!d || d.pointer !== e.pointerId) return
    if (cancel) { cancelFrame(moveFrame.current); moveFrame.current = 0; pendingMove.current = undefined }
    else {
      if (d.active) pendingMove.current = {x:Math.round(d.ox+(e.clientX-d.x)/d.scale),y:Math.round(d.oy+(e.clientY-d.y)/d.scale)}
      flushMove()
    }
    drag.current = undefined
    if (d.active) {
      suppressClickUntil.current = performance.now() + 190
      setDragging(false)
      if (cancel) onMove?.(d.ox, d.oy)
      else onCommit?.()
      onDragEnd?.()
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  const color = palette[node.category]
  const drill = !!node.childViewId && node.childViewId !== viewId
  return (
    <div
      className={`node ${drill ? '' : 'leaf'} ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''}`}
      role={measure ? undefined : 'button'}
      tabIndex={measure ? -1 : 0}
      data-node={node.id}
      data-view={viewId}
      data-measure-node={measure ? node.id : undefined}
      aria-label={`${drill ? '进入内部思维导图' : '查看节点详情'}：${node.title}`}
      style={
        {
          left: measure ? layout?.x : 0,
          top: measure ? layout?.y : 0,
          transform: measure ? undefined : `translate(${layout?.x ?? 0}px, ${layout?.y ?? 0}px)`,
          width: layout?.width ?? 236,
          '--node-border': color.border,
          '--node-accent': color.color,
          '--node-wash': color.wash,
        } as CSSProperties
      }
      onPointerDown={e => {
        if (measure || locked || !onMove || !layout || e.button !== 0 || (e.target as HTMLElement).closest('button')) return
        e.stopPropagation()
        drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, ox: layout.x, oy: layout.y, scale: e.currentTarget.getBoundingClientRect().width / layout.width || 1, active: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={e => {
        const d = drag.current
        if (!d || d.pointer !== e.pointerId) return
        const dx = e.clientX-d.x, dy = e.clientY-d.y
        if (!d.active && Math.hypot(dx,dy) > 7) { d.active = true; setDragging(true); onDragStart?.() }
        if (d.active) {
          pendingMove.current = {x:Math.round(d.ox+dx/d.scale),y:Math.round(d.oy+dy/d.scale)}
          if (!moveFrame.current) moveFrame.current = requestFrame(flushMove)
        }
      }}
      onPointerUp={e => stop(e)}
      onPointerCancel={e => stop(e, true)}
      onLostPointerCapture={e => stop(e, true)}
      onClick={event => { event.stopPropagation(); if (!locked && performance.now() >= suppressClickUntil.current) onOpen?.() }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (!locked) onOpen?.()
        }
        if (
          onMenu && ((event.shiftKey && event.key === 'F10') ||
          event.key === 'ContextMenu')
        ) {
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          onMenu?.(rect.left, rect.bottom)
        }
      }}
      onContextMenu={(event) => {
        if (!measure && onMenu) {
          event.preventDefault()
          event.stopPropagation()
          onMenu?.(event.clientX, event.clientY)
        }
      }}
    >
      <span className="node-icon">
        <Icon name={node.icon} />
      </span>
      <span className="node-copy">
        <span className="node-title">{node.title}</span>
        {node.summary && <span className="node-desc">{node.summary}</span>}
      </span>
      <span className={`node-hint ${drill ? 'has-subgraph' : 'has-detail'}`} title={drill ? '进入子图' : '查看详情'} aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{drill ? <path d="M3 12 12 3M5 3h7v7" /> : <><path d="M4 2.5h6l2.5 2.5v8.5H4zM10 2.5V5h2.5M6 8h4M6 10.5h3" /></>}</svg></span>
      {children}
    </div>
  )
}
