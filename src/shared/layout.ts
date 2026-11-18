import type {
  KnowledgeMap,
  MapLayout,
  ViewLayout,
  GroupLayout,
  NodeLayout,
} from './map-types.ts'
export type Heights = Record<string, number>
export const heightKey = (viewId: string, nodeId: string) =>
  `${viewId}/${nodeId}`
export const nodeHeight = (h: Heights, viewId: string, nodeId: string) =>
  h[heightKey(viewId, nodeId)] ?? 130
export function fillLayout(
  map: KnowledgeMap,
  previous: MapLayout | undefined,
  heights: Heights,
): MapLayout {
  return {
    schemaVersion: previous?.schemaVersion ?? 1,
    mapId: map.id,
    views: map.views.map((view) => {
      const old = previous?.views.find((v) => v.viewId === view.id)
      const nodes = (old?.nodes ?? [])
        .filter((n) => view.occurrences.some((o) => o.nodeId === n.nodeId))
        .map((n) => ({ ...n }))
      let groupY = 48
      const groups: GroupLayout[] = []
      const buckets = [...view.groups.map((g) => g.id), undefined]
      for (const groupId of buckets) {
        const members = view.occurrences.filter((o) => o.groupId === groupId)
        const oldGroup = old?.groups.find((g) => g.groupId === groupId)
        const x = oldGroup?.x ?? 42
        const y = oldGroup?.y ?? groupY
        for (const [index, occurrence] of members.entries()) {
          if (nodes.some((n) => n.nodeId === occurrence.nodeId)) continue
          const n: NodeLayout = {
            nodeId: occurrence.nodeId,
            x: x + 36 + (index % 3) * 327,
            y: y + 56,
            width: 236,
            manual: false,
          }
          const height = nodeHeight(heights, view.id, n.nodeId)
          // 保留所有已存坐标，为新增对象寻找空位；有限节点数保证搜索结束。
          while (
            nodes.some(
              (other) =>
                n.x < other.x + other.width + 24 &&
                n.x + n.width + 24 > other.x &&
                n.y <
                  other.y + nodeHeight(heights, view.id, other.nodeId) + 24 &&
                n.y + height + 24 > other.y,
            )
          )
            n.y += height + 32
          nodes.push(n)
        }
        const inside = nodes.filter((n) =>
          members.some((o) => o.nodeId === n.nodeId),
        )
        if (groupId) {
          if (oldGroup) {
            groups.push({ ...oldGroup })
            groupY = oldGroup.y + oldGroup.height + 19
            continue
          }
          const left = Math.min(x, ...inside.map((n) => n.x - 24))
          const top = Math.min(y, ...inside.map((n) => n.y - 62))
          const right = Math.max(
            x + 1058,
            ...inside.map((n) => n.x + n.width + 24),
          )
          const bottom = Math.max(
            y + 178,
            ...inside.map(
              (n) => n.y + nodeHeight(heights, view.id, n.nodeId) + 24,
            ),
          )
          groups.push({
            groupId,
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
          })
          groupY = bottom + 19
        }
      }
      return { viewId: view.id, nodes, groups, ...(previous?.schemaVersion===2 ? { mode: old?.mode??'vertical' } : {}) }
    }),
  }
}
export function viewBounds(
  view: ViewLayout,
  heights: Heights,
): { x: number; y: number; width: number; height: number } {
  const rects = [
    ...view.groups,
    ...view.nodes.map((n) => ({
      ...n,
      height: nodeHeight(heights, view.viewId, n.nodeId),
    })),
  ]
  if (!rects.length) return { x: 0, y: 0, width: 320, height: 240 }
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return {
    x,
    y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  }
}

export function groupCount(view: import('./map-types.ts').View): number {
  return view.groups.length + (view.occurrences.some(o => !o.groupId) ? 1 : 0)
}
export function availableModes(view: import('./map-types.ts').View): import('./map-types.ts').LayoutMode[] {
  const count = groupCount(view)
  return ['vertical', ...(count >= 2 ? ['grid'] : []), ...(count >= 7 ? ['columns'] : [])] as import('./map-types.ts').LayoutMode[]
}
export function relayoutView(map: KnowledgeMap, viewId: string, mode: import('./map-types.ts').LayoutMode, heights: Heights): ViewLayout {
  const view = map.views.find(v => v.id === viewId)
  if (!view || !availableModes(view).includes(mode)) throw new Error('当前视图不支持此排列方式')
  const buckets = [...view.groups.map(g => g.id), ...(view.occurrences.some(o => !o.groupId) ? [undefined] : [])]
  const boxes = buckets.map(groupId => {
    const members = view.occurrences.filter(o => o.groupId === groupId)
    const nodes: NodeLayout[] = []
    let y = 62
    for (let i = 0; i < members.length; i += 3) {
      const row = members.slice(i, i + 3)
      row.forEach((o, col) => nodes.push({ nodeId:o.nodeId, x:24 + col*327, y, width:236, manual:false }))
      y += Math.max(...row.map(o => nodeHeight(heights,viewId,o.nodeId))) + 32
    }
    return { groupId, nodes, width:Math.max(320, Math.min(3,members.length)*327 + 24), height:Math.max(178,y) }
  })
  const columns = mode === 'vertical' ? 1 : mode === 'grid' ? 2 : groupCount(view) <= 12 ? 3 : 4
  const widths = Array.from({length:columns},(_,col) => Math.max(0,...boxes.filter((_,i)=>i%columns===col).map(b=>b.width)))
  const nodes: NodeLayout[] = [], groups: GroupLayout[] = []
  let top = 48
  for (let i=0;i<boxes.length;i+=columns) {
    const row=boxes.slice(i,i+columns); let left=42
    row.forEach((box,col)=>{
      nodes.push(...box.nodes.map(n=>({...n,x:n.x+left,y:n.y+top})))
      if(box.groupId) groups.push({groupId:box.groupId,x:left,y:top,width:box.width,height:box.height})
      left+=widths[col]+48
    })
    top+=Math.max(...row.map(b=>b.height))+48
  }
  return {viewId,mode,nodes,groups}
}
