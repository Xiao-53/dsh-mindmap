# Contracts: 距离与规则混合初始排版 & 带子图节点单双击分离契约

**Feature**: `013-distance-aware-card-layout` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

---

## 1. 共享布局引擎契约（`src/shared/layout.ts`）

### 1.1 向后兼容的导出签名

```ts
export interface AnchorPoint {
  x: number
  y: number
  width: number
  height: number
}

export interface BucketPlacementOptions {
  anchors?: ReadonlyMap<string, AnchorPoint>
  allRelations?: readonly Relation[]
}

export function placeBucketNodes(
  memberIds: readonly string[],
  relations: readonly Relation[],
  heights: Heights,
  viewId: string,
  baseX: number,
  baseY: number,
  options?: BucketPlacementOptions,
): NodeLayout[]

export function fillLayout(
  map: KnowledgeMap,
  previous: MapLayout | undefined,
  heights: Heights,
): MapLayout

export function relayoutView(
  map: KnowledgeMap,
  viewId: string,
  mode: LayoutMode,
  heights: Heights,
): ViewLayout
```

### 1.2 核心行为契约
1. **既有 `layout.json` 零改动保护（`FR-008`）**：
   - 当 `fillLayout` 收到 `previous` 时，所有仍在当前视图 `occurrences` 中的已保存 `old.nodes` 坐标与 `manual` 标志必须原样保留，已保存的 `old.groups` 外框坐标与宽高必须原样保留。
2. **跨分组与组内联合距离排布（`FR-001`, `FR-002`）**：
   - 新建视图、缺失布局视图与 `relayoutView` 必须将当前视图内跨分组连线（通过 `anchors` + `allRelations`）纳入目标函数：即使分组内部无连线，只要存在与已定位跨组节点的连线，即按关联距离排序落位并向关联节点横向列位/重心靠拢；
   - 分组外框的水平起止位置 `left` 与 `right` 按组内节点最终坐标包络紧凑包裹（`left = min(baseGroupX, ...inside.x - 24)`, `right = max(...inside.x + width + 24)`），禁止强行拉宽撑回全宽空框。
3. **弹性层级行、重心对齐与直线吸附（`FR-003`, `FR-004`, `FR-006`）**：
   - 组内完全无内部连线且无跨组连线时，必须保持输入顺序从左到右、从上到下整齐平铺；
   - 存在连线时，开放完整 $R \times 3$ 候选槽位池支持分叉/汇合居中（如 `1→2→1`、`1→3`、`2→1`）；对不满 3 列的节点行按上下游邻居重心连续微调 `x`，偏差 $\le 48\text{px}$ 时在不冲突前提下精确对齐以生成垂直直线，同时严格保障同行/同列最小安全间距与零卡片重叠；
   - 相同输入下输出必须 **100% 确定**，20 节点满载单次计算保持瞬时完成。
4. **增量新增节点的邻居就近补位（`FR-005`）**：
   - 当视图已有已存节点且存在新增未定位节点时，若新节点存在已定位直接相连邻居，必须优先按依赖方向（下游往右/下、上游往左/上）在邻居周边最近无碰撞安全空位落位；无已定位邻居时才退回常规顺序空位补齐。

---

## 2. 客户端节点单/双击交互契约（`FR-009` / Q1 Option A）

### 2.1 `src/client/hooks/useReadingNavigation.ts`
新增轻量方法 `selectNode(id: string)`：
```ts
const selectNode = (id: string) => {
  const reading = latestRef.current.reading
  if (!reading || navigationBusy.current) return
  if (!(document.activeElement as HTMLElement | null)?.closest('.node-menu')) {
    focus.current = document.activeElement as HTMLElement
  }
  const next = {
    ...reading,
    selectedNodeId: id,
    detailHidden: true,
    focusSource: id,
  }
  latestRef.current.reading = next
  actions.setReading(readingKeyValue, next)
}
```
- **契约保证**：不改动 `viewId`，不触发相机跳动，通过 `detailHidden: true` 确保不弹出 `NoteInspector`（若之前已打开其他节点的详情面板则自动收起），同时令 `MapScene` 立即挂载 `.edges-focus` 高亮当前节点的直接关联连线与胶囊。

### 2.2 `src/client/components/NodeCard.tsx`、`MapScene.tsx` 与 `AtlasPane.tsx`
- `NodeCardProps` 新增可选回调 `onSelect?: () => void`，由 `MapScene` 的 `SceneHandlers` 从 `AtlasPane` 透传；
- 在 `AtlasPane.tsx` 中：
  - `onSelect={id => { void doc.guard(() => nav.selectNode(id)) }}`
  - `onOpen={id => ...}`（保持下钻子图 / 打开详情语义）；
- 在 `NodeCard.tsx` 内部（`drill = !!node.childViewId && node.childViewId !== viewId`）：
  - **`onClick`**：若 `drill` 且传入 `onSelect` 则触发 `onSelect()`，否则触发 `onOpen?.()`；
  - **`onDoubleClick`**：检查 `!locked && performance.now() >= suppressClickUntil.current`，若 `drill` 则触发 `onOpen?.()`；
  - **`onKeyDown`**：`Enter` 触发 `onOpen?.()`（带子图直接进入子图，叶子打开详情）；`Space` 在 `drill && onSelect` 时触发 `onSelect()`，否则触发 `onOpen?.()`；
  - **`aria-label` 与 `.node-hint` title**：`drill` 时标明双击进入子图（例如 `aria-label="选中节点，双击进入内部思维导图：${node.title}"`、`title="双击进入子图"`），叶子节点维持原有 `"查看节点详情：${node.title}"`。
- **`src/client/offline.tsx`**：零修改自动共享 `ReadingPane → MapScene → NodeCard`，确保离线导出 HTML 行为完全一致。

---

## 3. 测试校验契约（`tests/`）

1. **`tests/shared/layout-navigation.test.ts`**：
   - 保持全部既有回归断言继续通过（S 型长链折行、孤立节点原序、环路确定性、枢纽居中与防同行夹心、1/2 节点小分组紧凑宽 `284` / `611`、`columns` 无损读取与主动重排归一、既有 `previous` 布局 100% 保护）；
   - 新增覆盖：
     - 跨分组连线对齐：上游最右侧节点连向下游分组单/多节点时，下游节点就近对齐上游横向位置，分组框紧凑包裹；
     - 弹性行与重心对齐：`1→2→1` 菱形、`1→3` 一分三及末行 1～2 节点行向关联重心对齐与直线吸附；
     - 增量新增节点邻居就近补位：已有手动坐标视图新增相连节点落在邻居相邻顺向空位，老节点坐标 0 变化；
     - 20 节点 / 30 边满载确定性与耗时基准校验。
2. **`tests/integration/dom.test.ts`**：
   - 更新并新增带子图节点（`[data-node="a"]`）交互断言：
     - 单击 `[data-node="a"]` 后仍留在 `root` 视图，`.edges-focus` 高亮 `[data-relation="ab"][data-focus="out"]`，且 `.inspector` 不打开（即便之前已打开叶子 `b` 的详情面板也会随单击 `a` 自动收起）；
     - 双击 `[data-node="a"]`（`dblclick`）后平滑下钻进入 `child` 视图；
     - 单击叶子节点 `[data-node="b"]` 仍立即打开 `.inspector` 并高亮关联边；
     - 拖拽 `[data-node="a"]` 后 190ms 内紧跟 `click`/`dblclick` 不误触发下钻。
