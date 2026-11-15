import { useEffect, useRef, useState, useMemo } from 'react'
import type { MapSnapshot } from '../../shared/map-types.ts'
import { searchMap } from '../../shared/search.ts'
import type { SearchResult } from '../../shared/search.ts'
import { trapFocus } from '../focus-management.ts'
import { ToolIcon } from './ToolIcon.tsx'
import { Icon } from './Icon.tsx'
import { palette } from './NodeCard.tsx'
import { viewPath } from '../navigation.ts'
export function SearchOverlay({
  snapshot,
  choose,
  close,
}: {
  snapshot: MapSnapshot
  choose: (result: SearchResult) => void
  close: () => void
}) {
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const results = useMemo(() => query.trim() ? searchMap(snapshot, query) : snapshot.map.nodes.map(node => {
    const viewId = node.childViewId ?? snapshot.map.views.find(v => v.occurrences.some(o => o.nodeId === node.id))?.id ?? snapshot.map.rootViewId
    return { nodeId: node.id, viewId, path: viewPath(snapshot.map, viewId), field: '摘要' as const, snippet: node.summary }
  }), [snapshot, query])
  useEffect(() => {
    input.current?.focus()
  }, [])
  return (
    <div
      className="search-overlay open"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <section
        className="search-modal"
        role="dialog"
        aria-modal="true"
        aria-label="搜索思维导图"
        onKeyDown={trapFocus}
      >
        <div className="search-modal-head">
          <ToolIcon name="search"/>
          <input
            ref={input}
            aria-label="搜索标题、摘要和正文"
            placeholder="搜索标题、摘要和正文…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn" aria-label="关闭搜索" onClick={close}>
            ESC
          </button>
        </div>
        <div className="search-count" aria-live="polite">
          {query.trim()
            ? `${results.length} 个出现位置`
            : '输入关键词搜索全部层级'}
        </div>
        <div className="search-list">
          {query.trim() && !results.length && (
            <div className="search-empty">无匹配结果</div>
          )}
          {results.map((result) => (
            <button
              className="search-item"
              key={`${result.viewId}/${result.nodeId}`}
              onClick={() => choose(result)}
            >
              <span className="search-result-icon" style={{ background: palette[snapshot.map.nodes.find(n => n.id === result.nodeId)!.category].wash, color: palette[snapshot.map.nodes.find(n => n.id === result.nodeId)!.category].color }}><Icon name={snapshot.map.nodes.find(n => n.id === result.nodeId)!.icon}/></span>
              <span>
                <strong>
                  {
                    snapshot.map.nodes.find((n) => n.id === result.nodeId)
                      ?.title
                  }
                </strong>
                <small>
                  {result.path
                    .map(
                      (id) =>
                        snapshot.map.views.find((v) => v.id === id)?.title,
                    )
                    .join(' › ')}{' '}
                  · {result.nodeId}
                </small>
                <small>
                  {result.field}：{result.snippet}
                </small>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
