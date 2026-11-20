import { createRoot } from 'react-dom/client'
import { useSyncExternalStore } from 'react'
import { ReadingPane } from './AtlasPane.tsx'
import type { ReadingPaneProps } from './AtlasPane.tsx'
import type { OfflineMapData } from './export-html.ts'
import type { MapSnapshot } from '../shared/map-types.ts'
import type { ReadingStore } from './reading-state.ts'
import { initialReading, readingKey } from './reading-state.ts'
declare const __NOTE_MATH_CSS__: string
import atlasCss from './styles/atlas.css'
import prototypeCss from './styles/prototype.css'
import darkCss from './styles/dark.css'

const data = JSON.parse(document.getElementById('atlas-data')!.textContent!) as OfflineMapData
const snapshot: MapSnapshot = { ...data, files: [], workspaceKey: 'offline', fingerprint: 'offline', writable: false }
const key = readingKey('offline', snapshot.map.id)
let state: ReadingStore = { selectedMapId: snapshot.map.id, pending: {}, maps: {
  [key]: { ...initialReading('offline', 'offline', snapshot.map), viewId: data.viewId },
} }
const listeners = new Set<() => void>()
const update = (next: ReadingStore) => { state = next; listeners.forEach(fn => fn()) }
const host = {
  list: async () => ({ maps: [{ id: snapshot.map.id, title: snapshot.map.title }], diagnostics: [] }),
  read: async () => snapshot,
}
const style = document.createElement('style')
style.textContent = atlasCss + '\n' + prototypeCss + '\n' + darkCss + '\n' + __NOTE_MATH_CSS__
document.head.append(style)
const actions = {
  selectMap: (id: string) => update({ ...state, selectedMapId: id }),
  setReading: (key: string, value: ReadingStore['maps'][string]) => update({ ...state, maps: { ...state.maps, [key]: value } }),
  setPending: () => {},
  setCamera: (key: string, seed: ReadingStore['maps'][string], viewId: string, camera: { x: number; y: number; zoom: number }) => {
    const reading = state.maps[key] ?? seed
    actions.setReading(key, { ...reading, cameras: { ...reading.cameras, [viewId]: camera } })
  },
}
const props: ReadingPaneProps = {
  host, sessionId: 'offline', actions,
  useStore: selector => selector(useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn) } }, () => state)),
  useTabInfo: () => ({ tab: { visible: true, navigation: { revision: 0, params: { mapId: snapshot.map.id } }, actions: { close: () => {} } } }),
  offline: true, onLibrary: () => {},
}
createRoot(document.getElementById('root')!).render(<ReadingPane {...props} />)
