import { SaveStatus } from './SaveStatus.tsx'
import type { LayoutSaveStatus } from './SaveStatus.tsx'
import type { KnowledgeMap, View, MapEntry } from '../../shared/map-types.ts'
import { viewPath } from '../navigation.ts'
import { Breadcrumbs } from './Breadcrumbs.tsx'
import { ToolIcon } from './ToolIcon.tsx'
export function MapHeader({ map, view, navigate, search, refresh, library, exportMap, offline, saveStatus }: {
  map: KnowledgeMap; view: View; maps: MapEntry[]; selectMap: (id: string) => void
  navigate: (id: string) => void; search: () => void
  refresh: () => void; library: () => void
  exportMap?: () => void; offline?: boolean; saveStatus?: LayoutSaveStatus
}) {
  const depth = viewPath(map, view.id).length
  const total = Math.max(...map.views.map(v => viewPath(map, v.id).length))
  return <header className="map-header">
    <div className="head-top"><div className="head-title"><h1>{view.title}</h1></div>
      <div className="head-tools">
        <button className="btn search-action" aria-label="搜索当前地图" title="搜索节点（Ctrl/⌘+K）" onClick={search}><ToolIcon name="search"/><span className="button-caption">查找节点</span></button>
        {exportMap && <button className="btn" title="导出离线 HTML" aria-label="导出离线 HTML" onClick={exportMap}><ToolIcon name="export"/><span className="button-caption">导出</span></button>}
        <span className="depth-pill">第 {depth} / {total} 层 · {view.occurrences.length} 节点</span>
      </div>
    </div>
    <div className="atlas-path-row"><Breadcrumbs map={map} viewId={view.id} navigate={navigate}/><div className="atlas-host-tools">{!offline && <>
      <button className="atlas-host-button" onClick={library} title="全部导图"><ToolIcon name="library"/>全部导图</button>
      <button className="atlas-host-button atlas-refresh" aria-label="刷新地图" title="刷新地图" onClick={refresh}><ToolIcon name="refresh"/></button>
      {saveStatus && <SaveStatus status={saveStatus}/>}
    </>}</div></div>
  </header>
}
