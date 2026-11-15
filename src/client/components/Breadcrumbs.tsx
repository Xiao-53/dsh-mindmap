import type { KnowledgeMap } from '../../shared/map-types.ts'
import { viewPath } from '../navigation.ts'
export function Breadcrumbs({
  map,
  viewId,
  navigate,
}: {
  map: KnowledgeMap
  viewId: string
  navigate: (id: string) => void
}) {
  return (
    <nav className="crumbbar" aria-label="视图路径">
      {viewPath(map, viewId).map((id, i) => (
        <span key={id}>
          {i > 0 && (
            <span className="chev" aria-hidden="true">
              ›
            </span>
          )}
          <button
            className={`crumb ${id === viewId ? 'current' : ''}`}
            aria-current={id === viewId ? 'page' : undefined}
            onClick={() => navigate(id)}
          >
            {String(i+1).padStart(2, '0')} {i === 0 ? '导图总览' : map.views.find((v) => v.id === id)?.title}
          </button>
        </span>
      ))}
    </nav>
  )
}
