# Phase 1 Data Model: 多分组跨组卡片排版与连线路由深度优化

**Feature**: `014-multigroup-layout-routing` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

---

## 1. 持久化存储契约影响（零变更）

- **`map.json`（`schemaVersion: 1`）**：零字段增删或校验规则修改。
- **`layout.json`（`schemaVersion: 1 | 2`）**：零 Schema 修改（`src/shared/validate-layout.ts` 保持原样）。
  - 既有已保存的 `nodes[]`（`{ nodeId, x, y, width, manual }`）与 `groups[]`（`{ groupId, x, y, width, height }`）在打开视图或仅编辑正文时 100% 保持原样；
  - 连线控制点、拱桥通道号 `archLane`、斜线平行偏置 `hsBias`/`heBias`、双向翻转滞回 `bidirFlipped`、关系胶囊坐标/收窄宽度均为客户端/共享层实时计算的瞬态值，**绝不写入磁盘**。

---

## 2. 模块常量定义

### 2.1 `src/shared/layout.ts` 布局与评分常量

| 常量 | 数值 | 状态 | 职责说明 |
| --- | --- | --- | --- |
| `CARD_WIDTH` | `236` | 保留 | 默认卡片宽 |
| `COL_STEP` | `327` | 保留 | 标准列步距（`236px` 卡片 + `91px` 列间隙） |
| `ROW_GAP` | `32` | 保留 | 同分组行间垂直间距（结合实测行最高卡片动态累加 `rowY`） |
| `GROUP_PAD_X` | `24` | 保留 | 分组容器水平内边距 |
| `GROUP_PAD_TOP` | `62` | 保留 | 分组容器顶部标题预留高度 |
| `GROUP_PAD_BOTTOM` | `24` | 保留 | 分组容器底部内边距 |
| `DEPENDENCY_WEIGHT` | `1.0` | 保留 | `dependency` 边在布局距离和穿卡惩罚中的权重 |
| `SUPPLEMENT_WEIGHT` | `0.6` | 保留 | `supplement` 边在布局距离和穿卡惩罚中的权重 |
| `SNAP_STRAIGHT_THRESHOLD` | `48` | 保留 | 跨组垂直同列对齐阈值 |
| `OUTER_FEEDBACK_BONUS` | `-75` | 新增 | 跨组逆向回边及纵向跳组（`\|Δbucket\| >= 2`）落在外边界列的通道奖励（乘以 `w`） |
| `INTRA_SCC_COHESION_WEIGHT` | `18` | 新增 | 同非平凡 SCC 相连边的紧凑引力系数 `+18 * (dr + dc - 1)` |
| `BOUNDARY_PROXIMITY_WEIGHT` | `14` | 新增 | 正向跨组边引导上游靠底行、下游靠顶行的边界距离罚 `+14 * w * distToBoundary` |
| `PIERCE_INNER_VERT_PENALTY` | `750` | 新增 | 非拱桥代理折线内列垂直直穿非端点卡惩罚 |
| `PIERCE_HORIZ_PENALTY` | `620` | 新增 | 非拱桥代理折线水平同排直穿非端点卡惩罚 |
| `PIERCE_DIAG_PENALTY` | `520` | 新增 | 非拱桥代理折线斜向穿非端点卡惩罚 |
| `LEGAL_OUTER_ARCH_PENALTY` | `115` | 新增 | 合法外侧拱桥每阻挡 1 张中间卡的轻罚 |
| `STRAIGHT_PROXY_BONUS` | `-42` | 新增 | 代理触发真实直线拉直（`across <= 16 && along >= 24`）奖励（乘以 `w`） |
| `PROXY_CROSS_PENALTY` | `260` | 新增 | 非共端点代理折线交叉惩罚 |
| `SAME_COL_VERT_OVERLAP_PENALTY` | `800` | 新增 | 同列同拱桥状态竖段重叠惩罚 |
| `SAME_ROW_HORIZ_OVERLAP_PENALTY` | `600` | 新增 | 同行同拱桥状态横段重叠惩罚 |
| `SAME_SIDE_ARCH_OVERLAP_PENALTY` | `140` | 新增 | 同侧重叠外侧拱桥引导分摊至左右两侧的轻罚 |
| `OUT_OF_GROUP_PENALTY` | `420` | 升级 | `placeNearNeighbors` 候选落点超出 `oldGroup` 外框的惩罚（原 `150`） |
| `PINNED_OVERLAP_PENALTY` | `5000` | 新增 | `relayoutViewPartial` 未锁定节点与钉死卡片重叠的硬隔离惩罚 |
| `DIRTY_BBOX_EXPAND` | `24` | 新增 | 脏边增量重算时围绕移动节点旧/新包围盒外扩边距 |

### 2.2 `src/shared/edge-routing.ts` 路由与胶囊常量

| 常量 | 数值 | 状态 | 职责说明 |
| --- | --- | --- | --- |
| `SINGLE_SIDE_TOP_OFFSET` | `43` | 保留 | 左右侧单端口距顶基准（高矮卡串联共线） |
| `PORT_INSET_Y` / `PORT_INSET_X` | `18` / `20` | 保留 | 端口安全内边距 |
| `STRAIGHT_DEADZONE` / `MIN_STRAIGHT_SPAN` | `16` / `24` | 保留 | 小错位拉直死区与最小顺向跨度 |
| `MAX_BEZIER_HANDLE` / `MAX_ARCH_HANDLE` | `110` / `148` | 保留 | 常规与单拱桥控制臂上限 |
| `HEAD_ON_ENTER_DEPTH` / `HEAD_ON_EXIT_DEPTH` | `18` / `6` | 保留 | 隔卡直挡进入/退出滞回深度 |
| `ARCH_HYSTERESIS` | `24` | 保留 | 拖拽期间拱桥选侧切换滞回代价 |
| `PILL_MAX_WIDTH` / `PILL_HEIGHT` / `PILL_CARD_MARGIN` | `132` / `22` / `4` | 保留 | 胶囊默认尺寸上限与卡片外扩边距 |
| `PILL_CANDIDATE_T` | `[0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8, 0.14, 0.86]` | 扩展 | 9 点沿线探测序列（扩展 `0.14`, `0.86`） |
| `BIDIR_SLOPE_ENTER` | `24` | 新增 | 斜率感知双向斜线端口翻转启用门槛 |
| `BIDIR_SLOPE_EXIT` | `12` | 新增 | 拖拽期间双向槽位翻转退出滞回门槛 |
| `ARCH_LANE_STEP` | `24` | 新增 | 同侧彩虹通道每层递进高度增量 |
| `MAX_ARCH_LANE_HANDLE` | `180` | 新增 | 彩虹多层拱桥控制臂封顶上限 |
| `ARCH_LANE_SPAN_MARGIN` | `8` | 新增 | 同侧拱桥区间图着色跨度冲突裕量 |
| `OUTER_SPAN_MARGIN` | `16` | 新增 | 跨度感知 `hasOuterCard` 主轴投影范围扩展裕量 |
| `PARALLEL_BIAS_MIN_PERP` | `32` | 新增 | 启用同向平行斜线反相控制臂偏置的最小垂直偏移 |
| `PARALLEL_BIAS_MAX` | `18` | 新增 | 平行斜线单侧反相偏置封顶幅值 |
| `TOP_ARCH_GROUP_PROXIMITY` | `80` | 新增 | 卡顶距所属分组顶边过近优先让道 `bottom` 的阈值 |
| `TOP_ARCH_GROUP_PENALTY` | `60` | 新增 | 顶拱临近分组顶边时的惩罚代价 |
| `TOP_ARCH_TITLE_CLEARANCE` | `36` | 新增 | 顶拱天花板距分组顶边最小安全留空（`group.y + 36`） |
| `CANVAS_TOP_ARCH_MARGIN` | `14` | 新增 | 无所属分组时顶拱距画布顶边最小边距 |
| `CANVAS_LEFT_ARCH_MARGIN` | `10` | 新增 | 左侧外拱桥距画布左边缘最小边距 |
| `PILL_PORT_MARGIN` | `5` | 新增 | 端口圆点与输入箭头三角形保护盒外扩边距 |
| `SHORT_HORIZ_MIN_SPAN` / `SHORT_HORIZ_MAX_SPAN` | `40` / `120` | 新增 | 水平短边净空居中与收窄触发区间 `[40, 120)` |
| `SHORT_VERT_MAX_SPAN` | `60` | 新增 | 竖向短边侧鞍悬停触发上限 `span < 60` |
| `SIDE_SADDLE_GAP` | `10` | 新增 | 竖向短边胶囊相对连线轴的横向侧鞍间距 |

---

## 3. 核心运行时实体与类型定义

### 3.1 `src/shared/layout.ts` 新增与内部数据结构

```ts
export interface PartialRelayoutOptions {
  scope: 'unlocked' | { groupId: string }
  /** 单组整理时是否按新卡片紧凑重建该组外框（默认 false，保持组外框稳定） */
  refitTargetGroup?: boolean
}

interface CycleDecomposition {
  order: number[]
  layer: number[]
  isAcyclic: boolean
  sccId: number[]
  /** 所有需切断的回边标记集合（含双向逆边 + 组内 GreedyFAS 非冗余回边） */
  backEdgeIndices: Set<number>
  /** 非双向逆边的组内回边标记（免除逆流惩罚） */
  intraFeedbackIndices: Set<number>
}

interface ProxyEdgeGeometry {
  isStraight: boolean
  isArch: boolean
  archSide?: 'left' | 'right' | 'top' | 'bottom'
  /** [P0, Q0.25, Q0.75, P3] 或直线段复用折线端点 */
  points: [Point, Point, Point, Point]
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

interface IncrementalEvalCache {
  rects: { x: number; y: number; width: number; height: number }[]
  groupTops: number[]
  groupBottoms: number[]
  proxyEdges: ProxyEdgeGeometry[]
  /** 对称 M×M 扁平矩阵（Float64Array），存放边对交叉与共线重叠代价 */
  pairCostMat: Float64Array
}
```

### 3.2 `src/shared/edge-routing.ts` 与 `edge-geometry.ts` 扩展类型

```ts
export interface EdgeRouteHint {
  sourceSide: Port['side']
  targetSide: Port['side']
  archActive?: boolean
  /** 拖拽期间斜率感知双向槽位翻转滞回记忆 */
  bidirFlipped?: boolean
}

export interface RoutingOptions {
  hints?: ReadonlyMap<string, EdgeRouteHint>
  dragging?: boolean
  outHints?: Map<string, EdgeRouteHint>
  /** 视图内真实分组矩形列表，用于顶拱防压分组标题与双列左拱边界护栏 */
  groups?: readonly Rect[]
}

export interface PillPlacement extends Point {
  /** 仅水平短边按净空收窄时设置，常规边省略该键以保持向后兼容 */
  maxWidth?: number
}

export interface PillPlacementOptions {
  otherChords?: readonly (readonly [Point, Point, Point, Point])[]
  portBoxes?: readonly Box[]
  sourcePort?: Port
  targetPort?: Port
  edgeId?: string
}

export interface InlineArchSpec {
  relation: RoutedSegment['relation']
  fromNodeId: string
  toNodeId: string
  sourceSide: Port['side']
  targetSide: Port['side']
  vertical: boolean
  self: boolean
  edgeIndex: number
  archClearance?: number
  archLane?: number
}

export interface RoutedSegment {
  relation: { id: string; fromNodeId: string; toNodeId: string; type: string; label?: string }
  source: Port
  target: Port
  vertical: boolean
  self: boolean
  archClearance?: number
  archLane?: number
  hsBias?: number
  heBias?: number
  bidirFlipped?: boolean
  d: string
  arrow: string
  stem: string
  label: PillPlacement
}
```

---

## 4. 关键数学模型与状态流转

### 4.1 闭式四分位曲线代理（`evalProxyQ25Q75`）与穿卡/交叉判定
- 对于对边 S 形与常规单段曲线 $(P_0, C_1, C_2, P_3)$：
  $$Q_{0.25} = \frac{27 P_0 + 27 C_1 + 9 C_2 + P_3}{64}, \qquad Q_{0.75} = \frac{P_0 + 9 C_1 + 27 C_2 + 27 P_3}{64}$$
- 三段折线 $P_0 \to Q_{0.25} \to Q_{0.75} \to P_3$：
  - 若触发直连（`along >= 24 && across <= 16`）或为同侧合法外拱桥（走外围通道，仅计 `+115/阻挡卡` 与同侧重叠检测），对应调节其参与穿卡或共线重叠项；
  - 对非拱桥折线每段调用 Liang-Barsky 解析判定是否穿过任意非端点卡片内缩 `4px` 的核心区（`x+4..x+w-4`, `y+4..y+h-4`），区分内列垂直 `+750`、同排水平 `+620` 与斜向 `+520`。

### 4.2 拱桥精确边界护栏与同向平行斜线反相偏置
- **顶拱 / 左拱精确钳位**：
  - `top` 拱桥：$\text{baseH}_{\max} = \max\left(18,\; \frac{p_{s,y} + p_{e,y} + 6\min(p_{s,y}, p_{e,y}) - 8\, y_{\text{ceil}}}{6}\right)$
    - `yCeil` 判定：若端卡命中 `options?.groups` 中某个分组 $g$，取 `g.y + 36`；若未命中任何分组，且 `Math.min(ps.y, pe.y) > 14`，取 `14`（否则保留自然 `baseH` 以不破坏合成原点单测）。
  - `left` 拱桥：$\text{baseH}_{\max} = \max\left(18,\; \frac{p_{s,x} + p_{e,x} + 6\min(p_{s,x}, p_{e,x}) - 8\, x_{\text{ceil}}}{6}\right)$
    - `xCeil` 判定：取 `Math.max(10, adjLeftGroupRight + 6)`，其中 `adjLeftGroupRight` 为与当前拱桥纵跨度重叠且在当前卡/组左侧的相邻分组右边界最大值（无左邻分组且卡片位于画布左侧 `<= 10` 时才跳过）。
- **平行斜线反相偏置**：
  - 仅对满足 `fromNodeId === e0.fromNodeId && toNodeId === e0.toNodeId && sourceSide === e0.sourceSide && targetSide === e0.targetSide` 且 `facing`（`dotN < -0.5`）的 $k \ge 2$ 条边分组；
  - 令一致正轴偏移 $d_{\text{axis}} = (s === \text{'left'} \lor s === \text{'right'}) ? (p_{e,y} - p_{s,y}) : (p_{e,x} - p_{s,x})$；
  - 当 $|d_{\text{axis}}| \ge 32$ 时，第 $i \in [0, k-1]$ 条边取 $\delta_i = \text{clamp}(0.08 |d_{\text{axis}}|, 0, 18) \cdot (i - \frac{k-1}{2}) \cdot \text{sign}(d_{\text{axis}})$，$h'_s = \max(18, h - \delta_i),\; h'_e = \max(18, h + \delta_i)$。

### 4.3 `relayoutViewPartial` 状态不变量与收敛预算
- **`scope === 'unlocked'`**：
  - 全部 `manual: true` 节点置 `isPinned[i] = true` 且输出坐标与 `current.nodes` 完全恒等（漂移 $= 0.0\text{px}$）；`groups` 沿用 `current.groups` 零改动；
  - 若全部节点均已锁定，直接返回原视图浅拷贝；否则未锁定节点参与全局实高 Sifting，并在每一步加上对全部锁定卡碰撞（含安全间隔 `24px` 净空）的 `+5000` 硬惩罚（若网格离散槽位仍冲突，末步安全顺延避免物理重叠）。
- **`scope === { groupId }`**：
  - 非目标分组的全部节点及全视图 `groups` 置为钉死状态（其余组零漂移）；仅目标分组内节点重排（默认保留目标分组外框 `refitTargetGroup: false`，仅在显式 `true` 时按新包络更新目标分组尺寸）。
- **自适应寻优轮次预算**：
  - `totalNodes <= 25`：Stage 4 全局循环上限 `4` 轮、桶内 Sifting `2` 趟；
  - `totalNodes > 25`：Stage 4 全局循环上限 `2` 轮、桶内 Sifting `1` 趟。
