export const categories = ['blue', 'sage', 'plum', 'gold', 'terra'] as const
export const icons = [
  'book',
  'atom',
  'layers',
  'branch',
  'target',
  'spark',
  'flask',
  'check',
  'alert',
  'formula',
  'link',
  'grid',
  'idea',
  'arrows',
] as const
export type Category = (typeof categories)[number]
export type Icon = (typeof icons)[number]
export interface KnowledgeNode {
  id: string
  title: string
  summary: string
  category: Category
  icon: Icon
  notePath?: string
  childViewId?: string
}
export interface Group {
  id: string
  title: string
  number: string
  category: Category
}
export interface Occurrence {
  nodeId: string
  groupId?: string
}
export interface View {
  id: string
  title: string
  parentViewId: string | null
  centerNodeId?: string
  groups: Group[]
  occurrences: Occurrence[]
  relationIds: string[]
}
export interface Relation {
  id: string
  fromNodeId: string
  toNodeId: string
  type: 'dependency' | 'supplement'
  label?: string
}
export interface KnowledgeMap {
  schemaVersion: 1
  id: string
  title: string
  rootViewId: string
  nodes: KnowledgeNode[]
  views: View[]
  relations: Relation[]
}
export interface NodeLayout {
  nodeId: string
  x: number
  y: number
  width: number
  manual: boolean
}
export interface GroupLayout {
  groupId: string
  x: number
  y: number
  width: number
  height: number
}
export interface ViewLayout {
  viewId: string
  nodes: NodeLayout[]
  groups: GroupLayout[]
}
export interface MapLayout {
  schemaVersion: 1
  mapId: string
  views: ViewLayout[]
}
export interface Diagnostic {
  path: string
  message: string
  code: string
}
export type Validation<T> =
  | { ok: true; value: T }
  | { ok: false; diagnostics: Diagnostic[] }
export interface ReadFile {
  path: string
  version: string
  digest: string
}
export interface MapSnapshot {
  map: KnowledgeMap
  layout?: MapLayout
  notes: Record<string, string>
  resources: Record<string, string>
  files: ReadFile[]
  fingerprint: string
  workspaceKey: string
}
export interface MapEntry {
  id: string
  title: string
}
export interface MapListing {
  maps: MapEntry[]
  diagnostics: Diagnostic[]
  incompleteCreates?: { mapId: string; operationId: string; state: 'reserved' | 'failed' | 'cleanup_pending' }[]
  library?: import('./library.ts').LibraryState
}
