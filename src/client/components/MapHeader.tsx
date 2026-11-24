import { availableModes } from '../../shared/layout.ts'
import type { LayoutMode } from '../../shared/map-types.ts'
import { SaveStatus } from './SaveStatus.tsx'
import type { LayoutSaveStatus } from './SaveStatus.tsx'
import type { KnowledgeMap, View, MapEntry } from '../../shared/map-types.ts'
import { viewPath } from '../navigation.ts'
import { Breadcrumbs } from './Breadcrumbs.tsx'
import { ToolIcon } from './ToolIcon.tsx'
import { useAtlasThemeContext } from '../theme.ts'
export function MapHeader({ map, view, navigate, search, refresh, library, exportMap, offline, saveStatus, layoutMode, onLayout, onReset }: {
  layoutMode?:LayoutMode; onLayout?:(mode:LayoutMode)=>void; onReset?:()=>void
  map: KnowledgeMap; view: View; maps: MapEntry[]; selectMap: (id: string) => void
  navigate: (id: string) => void; search: () => void
  refresh: () => void; library: () => void
  exportMap?: () => void; offline?: boolean; saveStatus?: LayoutSaveStatus
}) {
  const theme = useAtlasThemeContext()
  const modes=availableModes(view)
  const current=layoutMode === 'grid' && modes.includes('grid') ? 'grid' : 'vertical'
  const next=modes[(modes.indexOf(current)+1)%modes.length] as 'vertical' | 'grid'
  const canCycle = next !== current
  const names={vertical:'纵向',grid:'田字型'}
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
    <div className="atlas-path-row"><Breadcrumbs map={map} viewId={view.id} navigate={navigate}/><div className="atlas-host-tools">
      {!offline && <button className="atlas-host-button" onClick={library} title="全部导图"><ToolIcon name="library"/>全部导图</button>}
      {onLayout && <button className="atlas-host-button atlas-quiet-icon" disabled={!canCycle} aria-label={canCycle?`当前${names[current]}排列，切换为${names[next]}`:`${names[current]}排列`} title={!canCycle?`${names[current]}排列`:`${names[current]} · 点击切换为${names[next]}`} onClick={()=>onLayout(next)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          {current==='vertical'?<><rect x="5" y="4" width="14" height="6" rx="1.5"/><rect x="5" y="14" width="14" height="6" rx="1.5"/></>:<>{[4,14].flatMap(x=>[4,14].map(y=><rect key={`${x}/${y}`} x={x} y={y} width="6" height="6" rx="1.2"/>))}</>}
        </svg>
      </button>}
      {onReset && <button className="atlas-host-button atlas-quiet-icon" onClick={onReset} aria-label="重置为纵向排列" title="重置排列"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 8h9a6 6 0 1 1 0 12h-3M5 8l4-4M5 8l4 4"/></svg></button>}
      <button type="button" className="atlas-host-button atlas-quiet-icon" aria-label={theme.dark ? '切换浅色模式' : '切换深色模式'} title={theme.dark ? '切换浅色模式' : '切换深色模式'} onClick={theme.toggle}><ToolIcon name={theme.dark ? 'sun' : 'moon'}/></button>
      {!offline && <button className="atlas-host-button atlas-refresh" aria-label="刷新地图" title="刷新地图" onClick={refresh}><ToolIcon name="refresh"/></button>}
      {saveStatus && <SaveStatus status={saveStatus}/>}
    </div></div>
  </header>
}
