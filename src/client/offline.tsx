import { createRoot } from 'react-dom/client'
import { useSyncExternalStore } from 'react'
import { ReadingPane } from './AtlasPane.tsx'
import type { AtlasPaneProps } from './AtlasPane.tsx'
import type { MapSnapshot } from '../shared/map-types.ts'
import type { ReadingStore } from './reading-state.ts'
import { initialReading, readingKey } from './reading-state.ts'
import type { HostAdapter } from './host-adapter.ts'
import atlasCss from './styles/atlas.css'
import prototypeCss from './styles/prototype.css'

const data = JSON.parse(document.getElementById('atlas-data')!.textContent!)
let snapshot: MapSnapshot = { ...data, files: [], workspaceKey: 'offline', fingerprint: 'offline' }
const key = readingKey('offline', snapshot.map.id)
let state: ReadingStore = { selectedMapId: snapshot.map.id, pending: {}, maps: {
  [key]: { ...initialReading('offline', 'offline', snapshot.map), viewId: data.viewId },
} }
const listeners = new Set<() => void>()
const update = (next: ReadingStore) => { state = next; listeners.forEach(fn => fn()) }
const host: HostAdapter = {
  rename: async () => { throw new Error('离线阅读不修改地图名称') },
  list: async () => ({ maps: [{ id: snapshot.map.id, title: snapshot.map.title }], diagnostics: [] }),
  read: async () => snapshot,
  saveLayout: async (_, layout) => { snapshot = { ...snapshot, layout }; return snapshot },
  watch: () => () => {},
  create: async () => { throw new Error('离线阅读不创建工作区文件') },
  saveLibrary: async () => { throw new Error('离线阅读不修改目录') },
}
const style = document.createElement('style')
style.textContent = atlasCss + '\n' + prototypeCss
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
const props = {
  host, sessionId: 'offline', actions,
  useStore: (selector: (s: ReadingStore) => unknown) => selector(useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn) } }, () => state)),
  useTabInfo: () => ({ tab: { visible: true, navigation: { revision: 0, params: { mapId: snapshot.map.id } }, actions: { close: () => {} } } }),
  inputActions: { captureInsertion: () => ({ start: 0, end: 0, draftRev: 0 }) },
  insertReference: () => false,
} as unknown as AtlasPaneProps
createRoot(document.getElementById('root')!).render(<ReadingPane {...props} offline onLibrary={() => {}} />)
