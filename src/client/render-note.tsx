import { useLayoutEffect, useMemo, useRef } from 'react'
import { isFormula, type FormulaToken } from '../shared/note-markdown.ts'
import { formulaElement } from './note-math.ts'
import { safeHref } from './note-rich-text.ts'
import type { Token, Tokens } from 'marked'
import type { ReactNode } from 'react'
import { noteSections } from '../shared/note-sections.ts'
import { isPlot, type PlotData } from '../shared/note-plot.ts'
import { NotePlot } from './components/NotePlot.tsx'
export { safeHref }
function Formula({ token }: { token: FormulaToken }) {
  const host = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (host.current) host.current.replaceChildren(formulaElement(host.current.ownerDocument, token))
  }, [token.raw, token.type])
  return token.type === 'formulaBlock'
    ? <div ref={element => { host.current = element }}/>
    : <span ref={element => { host.current = element }}/>
}
function renderTokens(
  tokens: Token[],
  nodeId: string,
  resources: Record<string, string>,
  onPlotReference?: (plot: PlotData) => void,
): ReactNode[] {
  return tokens.map((token, key) => {
    if (isPlot(token)) return <NotePlot key={token.data ? 'plot:' + token.data.id : key} token={token} onReference={onPlotReference}/>
    if (isFormula(token)) return <Formula key={key} token={token}/>
    const t = token as Token & { tokens?: Token[]; text?: string }
    const inner = t.tokens ? renderTokens(t.tokens, nodeId, resources) : t.text
    switch (t.type) {
      case 'space':
        return null
      case 'paragraph':
        return <p key={key}>{inner}</p>
      case 'text':
        return <span key={key}>{inner}</span>
      case 'strong':
        return <strong key={key}>{inner}</strong>
      case 'em':
        return <em key={key}>{inner}</em>
      case 'del':
        return <del key={key}>{inner}</del>
      case 'br':
        return <br key={key} />
      case 'hr':
        return <hr key={key} />
      case 'codespan':
        return <code key={key}>{t.text}</code>
      case 'code':
        return (
          <pre key={key}>
            <code>{t.text}</code>
          </pre>
        )
      case 'blockquote':
        return <blockquote key={key}>{inner}</blockquote>
      case 'heading': {
        const h = t as Tokens.Heading
        return h.depth <= 3 ? (
          <h3 key={key}>{inner}</h3>
        ) : (
          <h4 key={key}>{inner}</h4>
        )
      }
      case 'list': {
        const list = t as Tokens.List
        const items = list.items.map((item, i) => (
          <li key={i}>{renderTokens(item.tokens, nodeId, resources)}</li>
        ))
        return list.ordered ? (
          <ol key={key} start={list.start || 1}>
            {items}
          </ol>
        ) : (
          <ul key={key}>{items}</ul>
        )
      }
      case 'link': {
        const link = t as Tokens.Link
        const href = safeHref(link.href)
        return href ? (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {inner}
          </a>
        ) : (
          <span key={key}>{inner}（仅支持网络链接与本地图片）</span>
        )
      }
      case 'image': {
        const image = t as Tokens.Image
        const src = resources[`${nodeId}:${image.href}`]
        return src?.startsWith('data:image/') ? (
          <img key={key} src={src} alt={image.text} />
        ) : (
          <span key={key}>{image.text}（图片未载入）</span>
        )
      }
      case 'table': {
        const table = t as Tokens.Table
        return (
          <div key={key} className="note-table">
            <table>
              <thead>
                <tr>
                  {table.header.map((cell, i) => (
                    <th key={i}>
                      {renderTokens(cell.tokens, nodeId, resources)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>
                        {renderTokens(cell.tokens, nodeId, resources)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      // HTML 永远作为文字进入 React，不提供 HTML 注入出口。
      default:
        return <span key={key}>{t.text ?? t.raw}</span>
    }
  })
}
export function RenderNote({
  markdown,
  nodeId,
  resources,
  sectionFilter,
  onPlotReference,
}: {
  markdown: string
  nodeId: string
  resources: Record<string, string>
  sectionFilter?: 'intro' | 'body'
  onPlotReference?: (plot: PlotData) => void
}) {
  const sections = useMemo(() => noteSections(markdown), [markdown])
  return (
    <>
      {sections.filter(section => sectionFilter === 'intro' ? section.title === '简介' : sectionFilter === 'body' ? section.title !== '简介' : true).map((section, i) => (
        <section className="detail-section" key={i}>
          {section.title && sectionFilter !== 'intro' && <h3 className="detail-label">{section.title === '学习提醒' ? '注意事项' : section.titleTokens ? renderTokens(section.titleTokens, nodeId, resources) : section.title}</h3>}
          <div
            className={`detail-body ${section.title.includes('公式') ? 'formula' : section.title.includes('示例') ? 'example-card' : section.title.includes('提醒') ? 'note-card' : ''}`}
          >
            {renderTokens(section.tokens, nodeId, resources, onPlotReference)}
          </div>
        </section>
      ))}
    </>
  )
}
