import { useEffect, useRef, useState } from 'react'
import { JSXGraph, type Board } from 'jsxgraph'
import { plotExpressionTex, plotFraction, plotInterpolate, samplePlot, type PlotPoint, type PlotRange } from '../../shared/plot-expression.ts'
import { type PlotData, type PlotToken } from '../../shared/note-plot.ts'
import { mathMarkup } from '../note-math.ts'

const colors = ['#39668e', '#ab5365', '#437d62']
const dashes = [0, 2, 4] as const
const shapes = ['circle', 'square', 'diamond'] as const
const fixed = { fixed: true, highlight: false, withLabel: false }
const labelNumber = (value: number) => {
  if (value === 0) return '0'
  return Math.abs(value) >= 0.01 && Math.abs(value) < 10000
    ? String(Number(value.toPrecision(4))) : value.toExponential(1)
}

function drawPlot(board: Board, plot: PlotData, expressions: NonNullable<PlotToken['expressions']>): boolean {
  const segment = (a: [number, number], b: [number, number], strokeColor: string, strokeWidth = 1) =>
    board.create('segment', [a, b], { ...fixed, strokeColor, strokeWidth, point1: { visible: false }, point2: { visible: false } })
  const label = (x: number, y: number, value: string, anchorX: 'right' | 'middle') =>
    board.create('text', [x, y, value], { ...fixed, anchorX, fontSize: 10, strokeColor: '#596575', display: 'internal', parse: false })
  const drawLine = (pieces: readonly PlotPoint[][], series: number, showPoints = false) => {
    const x: number[] = [], y: number[] = []
    const points: [number, number][] = []
    for (const piece of pieces) {
      if (!piece.length) continue
      if (piece.length === 1 || showPoints) for (const [px, py] of piece) points.push([px, py])
      if (piece.length < 2) continue
      if (x.length) { x.push(NaN); y.push(NaN) }
      for (const [px, py] of piece) { x.push(px); y.push(py) }
    }
    const color = colors[series]
    if (x.length) board.create('curve', [x, y], { ...fixed, strokeColor: color, strokeWidth: 2, dash: dashes[series] })
    for (const point of points.slice(0, 160)) board.create('point', point, {
      ...fixed, face: shapes[series], size: 2, showInfobox: false, strokeColor: color, fillColor: color,
    })
  }
  const axisPosition = (r: PlotRange) => r[0] >= 0 ? 0 : r[1] <= 0 ? 1 : plotFraction(0, ...r)
  const frame = (yRange: PlotRange, xRange?: PlotRange) => {
    const yAxis = xRange ? axisPosition(xRange) : 0
    const xAxis = xRange || plot.kind === 'bar' ? axisPosition(yRange) : 0
    for (let i = 0; i <= 4; i++) {
      const t = i / 4
      segment([0, t], [1, t], '#e0e6ee')
      label(-0.024, t, labelNumber(plotInterpolate(...yRange, t)), 'right')
      if (xRange) {
        segment([t, 0], [t, 1], '#e0e6ee')
        label(t, -0.074, labelNumber(plotInterpolate(...xRange, t)), 'middle')
      }
    }
    segment([yAxis, 0], [yAxis, 1], '#778395', 1.35)
    segment([0, xAxis], [1, xAxis], '#778395', 1.35)
    if (xRange) {
      label(1.035, xAxis, 'x', 'middle')
      label(yAxis, 1.052, 'y', 'middle')
    }
    return xAxis
  }

  if (plot.kind === 'function') {
    frame(plot.yRange, plot.xRange)
    let hasPoints = false
    expressions.forEach((expression, index) => {
      const pieces = samplePlot(expression, plot.xRange, plot.yRange)
      hasPoints ||= pieces.length > 0
      drawLine(pieces.map(piece => piece.map(([x, y]) => [
        plotFraction(x, ...plot.xRange), plotFraction(y, ...plot.yRange),
      ])), index)
    })
    return hasPoints
  }

  const values = plot.series.flatMap(item => item.values).filter((value): value is number => value !== null)
  let yRange: PlotRange = values.length
    ? [Math.min(...values), Math.max(...values)] : [0, 1]
  if (plot.kind === 'bar') yRange = [Math.min(0, yRange[0]), Math.max(0, yRange[1])]
  if (yRange[0] === yRange[1]) {
    const value = yRange[0]
    yRange = value > 0 ? [0, value] : value < 0 ? [value, 0] : [0, 1]
  }
  const baseline = frame(yRange)
  const count = plot.categories.length
  plot.series.forEach((item, index) => {
    const pieces: PlotPoint[][] = [[]]
    item.values.forEach((value, i) => {
      if (value === null) {
        if (pieces.at(-1)?.length) pieces.push([])
        return
      }
      const x = (i + 0.5) / count, y = plotFraction(value, ...yRange)
      if (plot.kind === 'line') {
        pieces.at(-1)!.push([x, y])
      } else {
        const width = 0.76 / (count * plot.series.length)
        const start = x - width * plot.series.length / 2 + width * index + width * 0.07
        const end = start + width * 0.86
        if (y === baseline) {
          segment([start, baseline], [end, baseline], colors[index], 2)
        } else {
          board.create('polygon', [[start, baseline], [end, baseline], [end, y], [start, y]], {
            ...fixed, fillColor: colors[index], fillOpacity: 0.72,
            vertices: { visible: false, fixed: true },
            borders: { strokeColor: colors[index], strokeWidth: 0.75, dash: dashes[index], highlight: false },
          })
        }
      }
    })
    if (plot.kind === 'line') drawLine(pieces, index, true)
  })
  return values.length > 0
}

function PlotSurface({ token }: { token: PlotToken }) {
  const host = useRef<HTMLDivElement>(null)
  const [message, setMessage] = useState('')
  const plot = token.data!
  useEffect(() => {
    const element = host.current
    if (!element) return
    const win = element.ownerDocument.defaultView
    let board: Board | undefined
    let width = 0, height = 0
    let visible = !win?.IntersectionObserver, failed = false
    const dispose = () => {
      if (!board) return
      const instance = board
      board = undefined
      JSXGraph.freeBoard(instance)
    }
    const refresh = () => {
      if (!visible || failed) return
      const w = element.clientWidth, h = element.clientHeight
      if (!w || !h || (width === w && height === h && board)) return
      try {
        if (board) board.resizeContainer(w, h, true)
        else {
          board = JSXGraph.initBoard(element, {
            boundingbox: [-0.23, 1.105, 1.065, -0.12],
            keepaspectratio: false, renderer: 'svg', axis: false,
            showCopyright: false, showNavigation: false, showInfobox: false,
            registerEvents: false, pan: { enabled: false }, zoom: { wheel: false },
            resize: { enabled: false, throttle: 0 },
          })
          board.suspendUpdate()
          const hasPoints = drawPlot(board, plot, token.expressions ?? [])
          board.unsuspendUpdate()
          setMessage(hasPoints ? '' : plot.kind === 'function' ? '此范围内没有可绘制的点' : '此图暂无可绘制的数据')
        }
        width = w; height = h
      } catch {
        failed = true
        dispose()
        setMessage('图块暂时无法绘制')
      }
    }
    const resize = win?.ResizeObserver && new win.ResizeObserver(refresh)
    const intersection = win?.IntersectionObserver && new win.IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting)
      refresh()
    })
    resize?.observe(element)
    intersection?.observe(element)
    refresh()
    return () => { resize?.disconnect(); intersection?.disconnect(); dispose() }
  }, [plot, token.expressions])
  const labels = plot.kind === 'function' ? [] : plot.categories
  const step = Math.ceil(labels.length / 6)
  return <>
    <div className="note-plot-surface" data-plot-art aria-hidden="true">
      <div className="note-plot-board" ref={host} />
      {!!labels.length && <div className="note-plot-categories">
        {labels.map((label, index) => index % step === 0 && <span key={index} title={label}
          style={{ left: (index + 0.5) / labels.length * 100 + '%' }}>{label}</span>)}
      </div>}
    </div>
    {message && <p className="note-plot-status" role="status">{message}</p>}
    {message === '图块暂时无法绘制' && <pre><code>{token.source}</code></pre>}
  </>
}

export function NotePlot({ token, onReference }: { token: PlotToken; onReference?: (data: PlotData) => void }) {
  const root = useRef<HTMLElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
  useEffect(() => { if (menu) button.current?.focus({ preventScroll: true }) }, [menu])
  const { data } = token
  if (!data) return <figure className="note-plot note-plot-invalid">
    <figcaption>{token.error ?? '图块无法读取'}</figcaption>
    <pre><code>{token.source}</code></pre>
  </figure>
  const title = data.title ?? ({ function: '函数图', bar: '柱状图', line: '折线图' })[data.kind]
  const close = () => { setMenu(false); root.current?.focus({ preventScroll: true }) }
  const open = () => {
    const selection = root.current?.ownerDocument.getSelection()
    if (selection?.anchorNode && root.current?.closest('.inspector')?.contains(selection.anchorNode))
      selection.removeAllRanges()
    setMenu(true)
  }
  return <figure className="note-plot" ref={root} data-note-plot={data.id} tabIndex={onReference ? 0 : undefined} aria-label={title}
    onContextMenu={onReference ? event => { event.preventDefault(); event.stopPropagation(); open() } : undefined}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setMenu(false) }}
    onKeyDown={onReference ? event => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault(); event.stopPropagation(); open()
      } else if (menu && event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close()
      }
    } : undefined}>
    <figcaption>{title}</figcaption>
    <PlotSurface token={token}/>
    <ul className="note-plot-legend">
      {data.kind === 'function' ? data.series.map((item, i) => {
        const formula = token.expressions?.[i]
        const html = formula && mathMarkup('y=' + plotExpressionTex(formula), false)
        return <li key={i}><span className="note-plot-key" style={{ color: colors[i] }} data-plot-art aria-hidden="true">{['━', '┄', '┅'][i]}</span>
          {item.label && <span>{item.label}</span>}
          <span className="note-plot-formula" data-note-formula={'y = ' + item.expression}
            dangerouslySetInnerHTML={html ? { __html: html } : undefined}>{html ? undefined : 'y = ' + item.expression}</span>
        </li>
      }) : data.series.map((item, i) => <li key={i}>
        <span className="note-plot-key" style={{ color: colors[i] }} data-plot-art aria-hidden="true">{['●', '■', '◆'][i]}</span>
        <span>{item.label}{item.unit && '（' + item.unit + '）'}</span>
      </li>)}
    </ul>
    {data.kind === 'function'
      ? <p className="note-plot-range">x ∈ [{data.xRange.join(', ')}]，y ∈ [{data.yRange.join(', ')}]</p>
      : <details className="note-plot-data"><summary>数据</summary><table>
        <thead><tr><th scope="col">类目</th>{data.series.map((item, index) => <th scope="col" key={index}>{item.label}{item.unit && '（' + item.unit + '）'}</th>)}</tr></thead>
        <tbody>{data.categories.map((label, index) => <tr key={index}><th scope="row">{label}</th>
          {data.series.map((item, series) => <td key={series}>{item.values[index] ?? '缺值'}</td>)}</tr>)}</tbody>
      </table></details>}
    {menu && onReference && <div className="note-plot-menu" role="menu" aria-label="图块操作">
      <button type="button" role="menuitem" ref={button} onClick={() => { close(); onReference(data) }}>添加到 DSH 提问框</button>
    </div>}
  </figure>
}
