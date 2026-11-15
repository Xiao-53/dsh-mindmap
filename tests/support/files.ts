import { sampleMap } from './maps.ts'
import type { MapFilePort, FileRecord } from '../../src/server/map-files.ts'
import { AtlasError, mapPath } from '../../src/server/map-files.ts'
export class MemoryFiles implements MapFilePort {
  workspaceKey: string
  files = new Map<
    string,
    { text: string; version: number; identity?: string }
  >()
  failWrite = false
  onRead?: (path: string) => void
  constructor(workspace = 'workspace-a') {
    this.workspaceKey = workspace
    this.put('map.json', JSON.stringify(sampleMap()))
  }
  put(path: string, text: string) {
    const key = mapPath('map-a', path)
    this.files.set(key, {
      text,
      version: (this.files.get(key)?.version ?? 0) + 1,
    })
  }
  async read(path: string): Promise<FileRecord> {
    this.onRead?.(path)
    const f = this.files.get(path)
    if (!f) throw new AtlasError('workspace-file/not-found', `缺少 ${path}`)
    return {
      bytes: new TextEncoder().encode(f.text),
      version: String(f.version),
      identity: f.identity ?? `${this.workspaceKey}/${path}`,
    }
  }
  async absent(path: string) {
    return !this.files.has(path)
  }
  async list() {
    return ['map-a', 'unknown']
  }
  async writeLayout(id: string, text: string, expected?: string) {
    if (this.failWrite) throw new AtlasError('permission_denied', '权限失败')
    if (
      String(this.files.get(mapPath(id, 'layout.json'))?.version ?? '') !==
      (expected ?? '')
    )
      throw new AtlasError('version_conflict', '布局已变')
    this.put('layout.json', text)
  }
}
