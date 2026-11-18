import { useRef, useLayoutEffect, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import type { Camera } from '../reading-state.ts'
import type { ViewLayout } from '../../shared/map-types.ts'
import type { Heights } from '../../shared/layout.ts'
import { viewBounds } from '../../shared/layout.ts'
export function MapViewport({
  children,
  camera,
  onCamera,
  layout,
  heights,
  phase,
  exitMotion,
  centerNodeId,
}: {
  children: ReactNode
  camera?: Camera
  onCamera: (camera: Camera) => void
  layout: ViewLayout
  heights: Heights
  phase: string
  exitMotion?: { ratio: number; x: number; y: number }
  centerNodeId?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 360, height: 500 })
  const sizeMeasured = useRef(false)
  const keyboardFocus = useRef(false)
  const drag = useRef<{ x: number; y: number; camera: Camera }>()
  const [direct, setDirect] = useState(false)
  const wheelTimer = useRef<ReturnType<typeof setTimeout>>()
  const bounds = viewBounds(layout, heights)
  const initial = layout.nodes.find(n => n.nodeId === centerNodeId) ?? layout.nodes[0]
  const fitCamera = () => {
    const width = Math.max(1140, bounds.x + bounds.width + 40)
    const height = Math.max(800, bounds.y + bounds.height + 40)
    const scale = Math.max(.02, Math.min(1.15, (size.width-70)/width, (size.height-75)/height))
    return { zoom: scale, x: (size.width-width*scale)/2, y: (size.height-height*scale)/2 }
  }
  const initialZoom = size.width < 440 ? .77 : .88
  const current = camera ?? (size.width >= 620 ? fitCamera() : {
    x: size.width * .49 - ((initial?.x ?? 0)+(initial?.width ?? 236)/2)*initialZoom,
    y: size.height * .46 - ((initial?.y ?? 0)+44)*initialZoom,
    zoom: initialZoom,
  })
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      sizeMeasured.current = true
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  // 将实际首屏相机记入会话，历史返回不受后续布局补位影响。
  useLayoutEffect(() => {
    if (!camera && sizeMeasured.current && size.width > 0 && size.height > 0)
      onCamera(current)
  }, [camera, size.width, size.height, layout.viewId])
  const zoom = (factor: number, x = size.width / 2, y = size.height / 2) => {
    const next = Math.max(0.02, Math.min(2.5, current.zoom * factor))
    onCamera({
      zoom: next,
      x: x - ((x - current.x) * next) / current.zoom,
      y: y - ((y - current.y) * next) / current.zoom,
    })
  }
  const fit = () => {
    onCamera(fitCamera())
  }
  const displayed =
    phase === 'out' && exitMotion
      ? {
          zoom: current.zoom * exitMotion.ratio,
          x: exitMotion.x - (exitMotion.x - current.x) * exitMotion.ratio,
          y: exitMotion.y - (exitMotion.y - current.y) * exitMotion.ratio,
        }
      : current
  const wheelHandler = useRef<(event: WheelEvent) => void>(() => {})
  wheelHandler.current = (e) => {
    if (phase !== 'idle') return
    e.preventDefault()
    setDirect(true)
    clearTimeout(wheelTimer.current)
    wheelTimer.current = setTimeout(() => setDirect(false), 140)
      const rect = root.current!.getBoundingClientRect()
      zoom(
        e.deltaY < 0 ? 1.10 : .9,
        e.clientX - rect.left,
        e.clientY - rect.top,
      )
  }
  useEffect(() => {
    const element = root.current
    if (!element) return
    const wheel = (e: WheelEvent) => wheelHandler.current(e)
    element.addEventListener('wheel', wheel, { passive: false })
    return () => { element.removeEventListener('wheel', wheel); clearTimeout(wheelTimer.current) }
  }, [])
  return (
    <div
      ref={root}
      className={`map-wrap ${drag.current ? 'grabbing' : ''} ${phase !== 'idle' ? 'transitioning' : ''}`}
      tabIndex={0}
      aria-label="思维导图画布；方向键平移，加减缩放，Home 适配"
      onPointerDownCapture={() => { keyboardFocus.current = false }}
      onPointerDown={(e) => {
        if (
          phase !== 'idle' || (e.button !== 0 && e.button !== 1) ||
          (e.target as HTMLElement).closest(
            'button,[role="button"],.inspector,.search-overlay,.node-menu,.canvas-tools',
          )
        )
          return
        e.currentTarget.focus({preventScroll:true})
        drag.current = { x: e.clientX, y: e.clientY, camera: current }
        setDirect(true)
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (d)
          onCamera({
            ...d.camera,
            x: d.camera.x + e.clientX - d.x,
            y: d.camera.y + e.clientY - d.y,
          })
      }}
      onPointerUp={() => {
        drag.current = undefined
        setDirect(false)
      }}
      onPointerCancel={() => {
        drag.current = undefined
        setDirect(false)
      }}
      onFocusCapture={(e) => {
        if (!keyboardFocus.current) return
        const card = (e.target as HTMLElement).closest<HTMLElement>(
          '[data-node]',
        )
        const box = root.current
        if (!card || !box) return
        const rect = card.getBoundingClientRect()
        const clip = box.getBoundingClientRect()
        const position = layout.nodes.find(
          (n) => n.nodeId === card.dataset.node,
        )
        if (
          position &&
          (rect.left < clip.left ||
            rect.right > clip.right ||
            rect.top < clip.top ||
            rect.bottom > clip.bottom - 64)
        )
          onCamera({
            ...current,
            x:
              size.width / 2 - (position.x + position.width / 2) * current.zoom,
            y:
              (size.height - 64) / 2 -
              (position.y +
                (heights[`${layout.viewId}/${position.nodeId}`] ?? 130) / 2) *
                current.zoom,
          })
      }}
      onKeyDownCapture={() => { keyboardFocus.current = true }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        const shifts: Record<string, [number, number]> = {
          ArrowLeft: [60, 0],
          ArrowRight: [-60, 0],
          ArrowUp: [0, 60],
          ArrowDown: [0, -60],
        }
        if (shifts[e.key]) {
          e.preventDefault()
          const [x, y] = shifts[e.key]
          onCamera({ ...current, x: current.x + x, y: current.y + y })
        }
        if (e.key === '+' || e.key === '=') {
          e.preventDefault()
          zoom(1.2)
        }
        if (e.key === '-') {
          e.preventDefault()
          zoom(1 / 1.2)
        }
        if (e.key === 'Home') {
          e.preventDefault()
          fit()
        }
      }}
    >
      <div
        className={`map-scene phase-${phase}`}
        style={{
          transform: `translate(${displayed.x}px,${displayed.y}px) scale(${displayed.zoom})`,
          ...(direct ? { transition: 'none' } : {}),
        }}
      >
        {children}
      </div>
      {!layout.nodes.length && (
        <div className="empty-canvas">此视图尚无节点</div>
      )}
      <div className="legend" aria-label="关系图例">
        <span className="legend-item">
          <span className="legend-line" />
          依赖关系
        </span>
        <span className="legend-item">
          <span className="legend-line secondary" />
          补充 / 对比
        </span>
      </div>
      <div className="canvas-tools" aria-label="画布操作">
        <button aria-label="缩小" onClick={() => zoom(1 / 1.2)}>
          −
        </button>
        <span className="zoom-label">{Math.round(current.zoom * 100)}%</span>
        <button aria-label="放大" onClick={() => zoom(1.2)}>
          ＋
        </button>
        <span className="separator" />
        <button onClick={fit}>适配</button>
      </div>
    </div>
  )
}
