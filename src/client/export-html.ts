import type { MapSnapshot, MapLayout } from '../shared/map-types.ts'
declare const __OFFLINE_VIEWER__: string
export type OfflineMapData = Pick<MapSnapshot, 'map' | 'notes' | 'resources'> & { layout: MapLayout; viewId: string }
export function createOfflineHtml(snapshot: MapSnapshot, layout: MapLayout, viewId: string, viewer = __OFFLINE_VIEWER__): string {
  const saved: OfflineMapData = { map: snapshot.map, notes: snapshot.notes, resources: snapshot.resources, layout, viewId }
  const data = JSON.stringify(saved)
    .replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
  const title = snapshot.map.title.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="root"></div><script id="atlas-data" type="application/json">${data}</script><script>${viewer.replaceAll('</script', '<\\/script')}</script></html>`
}
export function downloadHtml(snapshot: MapSnapshot, layout: MapLayout, viewId: string) {
  const url = URL.createObjectURL(new Blob([createOfflineHtml(snapshot, layout, viewId)], { type: 'text/html;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${snapshot.map.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0,100) || '思维导图'}.html`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
