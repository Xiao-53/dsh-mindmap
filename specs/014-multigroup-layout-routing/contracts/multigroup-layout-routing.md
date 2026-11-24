# Contracts: 多分组跨组卡片排版与连线路由深度优化

**Feature**: `014-multigroup-layout-routing` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

---

## 1. 共享排版引擎契约（`src/shared/layout.ts`）

### 1.1 向后兼容与新增导出签名

```ts
// 现有导出 100% 保持签名与既有行为兼容
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

// 新增局部整理接口与选项
export interface PartialRelayoutOptions {
  scope: 'unlocked' | { groupId: string }
  refitTargetGroup?: boolean
}

export function relayoutViewPartial(
  map: KnowledgeMap,
  current: ViewLayout,
  heights: Heights,
  options: PartialRelayoutOptions,
): ViewLayout
```

### 1.2 核心行为契约
1. **旧布局零漂移与离散网格延续（`FR-001`, `FR-014`）**：
   - `fillLayout` 在读取 `previous` 时必须 100% 原样保留所有已存 `old.nodes`（无论 `manual` 值）与 `old.groups`；
   - `placeBucketNodes`、`placeFreshBuckets`、`relayoutView` 对外签名零破坏，保持严格三列离散网格（`(x - 66) % 327 === 0`）、`views[].groups[]` 原有叙事顺序及统一分组宽（1 卡组宽 `284`，2 卡组宽 `611`，3 卡全宽 `938`）。
2. **全视图实高求解与回路处理（`FR-001`–`FR-004`, `FR-013`）**：
   - 彻底移除硬编码 `162` 行高与 `130px` 卡高，全部行坐标与穿卡预测均基于 `nodeHeight(heights, viewId, id)` + `ROW_GAP(32)` 实时重建；
   - 启用双向预分离 + Tarjan SCC + 加权边界感知 GreedyFAS + 极小 FAS 清洗与 `evalProxyQ25Q75` 全局评分，跨组回边与跳组边优先引导至外边界列；
   - 100% 确定性（相同输入 10 次结果完全相同），`<= 20` 节点视图单次求解瞬时完成。
3. **框内优先补位与局部整理（`FR-011`, `FR-012`）**：
   - `placeNearNeighbors` 在 `oldGroup` 存在且邻居已脱框时枚举 `oldGroup` 内全部空闲标准网格槽位，应用 `outOfGroupPenalty = 420` 与 `distCoeff = 0.5`，使新节点优先落回所属分组框内最近空槽；
   - `relayoutViewPartial` 在 `scope: 'unlocked'` 下钉死所有 `manual: true` 节点与全部分组框（位移 `0`），在 `scope: { groupId }` 下钉死其余全部分组及其成员（位移 `0`），并严格保证零卡片重叠。

---

## 2. 连线几何与路由引擎契约（`src/shared/edge-routing.ts` & `src/shared/edge-geometry.ts`）

### 2.1 `src/shared/edge-routing.ts` 导出签名与兼容规则

```ts
export const BIDIR_SLOPE_ENTER = 24
export const BIDIR_SLOPE_EXIT = 12
export const ARCH_LANE_STEP = 24

export interface EdgeRouteHint {
  sourceSide: Port['side']
  targetSide: Port['side']
  archActive?: boolean
  bidirFlipped?: boolean
}

export interface RoutingOptions {
  hints?: ReadonlyMap<string, EdgeRouteHint>
  dragging?: boolean
  outHints?: Map<string, EdgeRouteHint>
  groups?: readonly Rect[]
}

export interface PillPlacement {
  x: number
  y: number
  maxWidth?: number
}

export function selectInlineBlockedSides(
  specs: InlineArchSpec[],
  nodes: Record<string, Rect>,
  options?: RoutingOptions,
): void

export function buildEdgeCurve(
  a: Port,
  b: Port,
  self?: boolean,
  archClearance?: number,
  options?: {
    archLane?: number
    hsBias?: number
    heBias?: number
    groups?: readonly Rect[]
    sourceRect?: Rect
    targetRect?: Rect
  },
): { curve: EdgeCurve; straightDir?: Point }

export function pickPillAnchor(
  curve: Pick<EdgeCurve, 'segments' | 'defaultLabel'>,
  labelText: string | undefined,
  rects: readonly Rect[],
  placedPills?: PlacedPillBox[],
  options?: PillPlacementOptions,
): PillPlacement
```

- **向后兼容约束**：
  - 保留全部现有导出常量（`SINGLE_SIDE_TOP_OFFSET = 43`、`STRAIGHT_DEADZONE = 16` 等）；
  - `pickPillAnchor` 在未传 `options` 或未命中水平短边收窄时，返回对象严格仅含 `{ x, y }`，不附带 `maxWidth: undefined` 属性；
  - `buildEdgeCurve` 未传入第 5 参数时走既有几何（`archLane = 0`、无偏置、无标题护栏）。

### 2.2 `src/shared/edge-geometry.ts` 路由行为契约
1. **斜率感知双向端口配对（`FR-005`）**：
   - 对面对面双向边，以 `BIDIR_SLOPE_ENTER = 24` 与拖拽滞回 `BIDIR_SLOPE_EXIT = 12` 判断并更新 `EdgeRouteHint.bidirFlipped`，在 `projectedOrder` 并列时注入 `bidirRank` 使中段张开，维持 `>= 16px` 分离、0 交叉；
2. **LIFO 嵌套拱桥与彩虹分层（`FR-007`, `FR-008`）**：
   - `selectInlineBlockedSides` 启用跨度感知外卡检测与区间图着色分配 `archLane`，并结合 `groups` 执行 `top`（`yCeil = group.y + 36`）与 `left`（`xCeil = max(10, adjLeftGroupRight + 6)`）护栏钳位；
   - 同侧端口排序中对 `archActive` 拱桥采用反号投影 `-(axis - center) / 24` 确保长拱外端口、短拱内端口；
3. **平行斜线反相偏置（`FR-006`）**：
   - 同节点对同向面对面平行斜线（$k \ge 2, |d_{\text{axis}}| \ge 32$）使用与 `place()` 增序一致的 `axisDelta` 符号计算 `hsBias` / `heBias` 并写入 `RoutedSegment`；
4. **两趟胶囊四维避让（`FR-010`）**：
   - `routeSegments` 先构建全图 3 段闭式弦（`t = 0, 1/3, 2/3, 1`）与全端口/箭头保护盒（`±5px`），再逐条调用 `pickPillAnchor` 择优放置并支持水平短边居中收窄与竖向短边侧鞍悬停。

---

## 3. 客户端组件与样式契约（`src/client/`）

1. **`src/client/animate-ports.ts`**：
   - `useAnimatedPorts(target, nodes, viewId, options?)` 在 `options` 中接收入参 `groups?: readonly Rect[]`；
   - 插值重排 `interpolated` 必须保留每条源 `segment` 的 `archLane`、`hsBias`、`heBias`、`bidirFlipped`，并把 `options` 原样透传给 `routeSegments`。
2. **`src/client/components/MapScene.tsx` & `atlas.css` / `dark.css`**：
   - `createConnections` 与 `useAnimatedPorts` 均传入 `groups: visualLayout.groups`；
   - `SceneEdge` 仅当 `focused === true`（`focusRole !== 'default' && focusRole !== 'dimmed'`）时，在主路径之前追加：
     `<path className="edge-focus-halo" d={d} />`（CSS 控制 `fill: none`, `stroke: var(--canvas, #faf7ef)`, `stroke-width: 5`, `opacity: 0.72`, `stroke-linecap: butt`, `stroke-dasharray: none`）；悬停节点/连线/胶囊绝不挂载 `.edges-focus` 或光晕；
   - `ScenePill` 渲染 `style={maxWidth ? { left: x, top: y, maxWidth } : { left: x, top: y }}`。
3. **`src/client/hooks/useViewportLayout.ts`、`MapHeader.tsx` & `AtlasPane.tsx`**：
   - `useViewportLayout` 新增 `relayoutPartial(options: PartialRelayoutOptions)`：前置条件与 `changeLayout` 对齐（`measured === snapshot.fingerprint && !navigationBusy.current`），调用 `relayoutViewPartial(active?.working.map ?? snapshot.map, currentView, heights, options)`，非离线经 `active?.setLayout(next, old)` 接入自动保存与 30 步撤销重做栈；
   - `MapHeader` 新增可选 prop `onTidyUnlocked?: () => void`，在 `onReset` 按钮紧邻位置渲染轻量图标按钮（`aria-label="整理未锁定节点"`, `title="整理未锁定节点"`）；
   - `AtlasPane` 仅在 `!props.offline` 时传入 `onTidyUnlocked={() => vp.relayoutPartial({ scope: 'unlocked' })}`；`src/client/offline.tsx` 零修改。

---

## 4. 验收测试契约（`tests/`）

1. **`tests/shared/edge-routing.test.ts`**：
   - 既有全部测试继续 100% 通过；
   - 新增：
     - `dy ∈ [24, 162]` 面对面双向斜线 0 交叉且采样最小净空 `>= 16px`，`dx = +200` 垂直双向斜线 0 交叉且净空 `>= 16px`，慢速拖拽过 `dy = 0` 临界区翻转 `<= 1` 次；
     - 同端嵌套外侧拱桥 `r1→r3` 与 `r1→r5` 0 交叉、最小净空 `>= 6px` 且外层拱顶明显高于内层；
     - 首行顶拱接入 `groups` 时全曲线 `min_y > group.y + 34`（不压标题）、左拱 `min_x >= 10`（不越左边界）且田字双列右列左拱不侵入左列标题；
     - 同向平行斜线（$k = 2, dy = \pm 162$ 及四向）中段最小净空 `>= 14px`、0 交叉；
     - 8 边多组标注场景（含斜线交叉、91px 水平短边、32px 竖向短边）胶囊压卡/相互重叠/压他线/压端口箭头冲突全部归 `0`，且水平短边返回收窄 `maxWidth`；
     - 40 节点 / 65 边单次 `createConnections` 在 V8 下稳定远低于 `16ms`。
2. **`tests/shared/layout-navigation.test.ts`**：
   - 既有全部回归断言 100% 通过；
   - 新增：
     - 极端变高卡片（86–260px）跨组/同组纵向无实高错位穿卡；
     - 2×2 强耦合田字结构（`grid`）穿刺显著压降且同排左右组靠内列对齐；
     - 组内双向/多节点环路与跨多组反馈回边（优先引导至外侧边界列）确定性收敛；
     - `placeNearNeighbors` 邻居拖至组框外时新增同组节点精准落回框内最近空槽；
     - `relayoutViewPartial`（`'unlocked'` 与 `{ groupId }`）锁定节点/他组零位移、全图零重叠；
     - 20 节点 / 30+ 边满载重排瞬时完成且 10 次 100% 确定。
3. **`tests/integration/dom.test.ts`**：
   - 验证点击选中节点挂载 `.edges-focus` 内包含 `.edge-focus-halo`；
   - 验证水平短边胶囊透传 `maxWidth` 内联样式；
   - 验证顶部工具栏存在 `aria-label="整理未锁定节点"` 按钮，点击后调用局部整理并保持已手动拖动节点坐标不变且支持撤销，离线模式下不渲染该按钮。
