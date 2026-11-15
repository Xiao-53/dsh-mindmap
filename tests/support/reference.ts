import type { ReferenceSnapshot } from '../../src/client/reference-source.ts'
export function reference(): ReferenceSnapshot {
  return {
    version: 1,
    mapId: 'map-a',
    nodeId: 'a',
    originViewId: 'root',
    text: 'E = mc²\n条件：静止质量',
    before: '公式：',
    after: '。',
    fingerprint: 'version1',
    noteDigest: 'note1',
    mapTitle: '物理',
    nodeTitle: '甲',
    sessionId: 's1',
    workspaceKey: 'workspace-a',
    resourceAddress:
      'dsh-resource://file/session/s1/dsh-knowledge-maps/map-a/map.json',
  }
}
