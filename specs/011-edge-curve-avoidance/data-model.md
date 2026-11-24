# Phase 1 Data Model: 节点连线曲线弧度与避让逻辑优化

**Feature**: `011-edge-curve-avoidance` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

---

## 1. 持久化存储模型影响（零变更）

- **`map.json`（`schemaVersion: 1`）**：保持现有全部字段不变，不新增或修改任何节点、视图或关系属性。
- **`layout.json`（`schemaVersion: 1 | 2`）**：保持现有全部字段不变。所有端口微调、曲线弧度、绕行航点、共路轨道分离、标签动态定位与拖拽滞回均属于视图实时计算状态，**绝对不写回 `layout.json`**，也不改写任何已保存的节点坐标或分组容器边界（`FR-011`、`SC-005`）。
- **离线导出载荷（`OfflineMapData`）**：无需扩展序列化字段；离线阅读器通过复用 `ReadingPane` / `MapScene` 自动获得完全一致的实时连线计算能力。

---

## 2. 几何实体与运行期状态模型（`src/shared/edge-geometry.ts` & `edge-routing.ts`）

### 2.1 `CardEnvelope` 与 `SelfCardGuard`（卡片安全包络）
由视图当前实际节点矩形表 `nodes: Record<string, Rect>` 在每次路由开始时实时构造：

| 字段 | 类型 | 规则与含义 |
| --- | --- | --- |
| `id` | `string` | 节点唯一身份，与 `nodes` 键一致 |
| `card` | `Box` | 可见外框：`{ x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height }`（0px 接触视为硬碰撞） |
| `pad` | `Box` | 克制安全留白外框：`card` 四周外扩 `CLEARANCE_PAD = 7` px（符合 `6～8px` 约定，触发避让并作为常规避让净空目标） |
| `core` | `Box` | 内部核心区：`card` 四周内缩 `min(10, dim / 4)` px，仅在极端密集无法绕开 `card` 时用于最小化文字区遮挡 |
| `selfA` | `Box` | 起点卡片防回穿框：内缩 `1px`，首段 $t \le 0.03$ 豁免、首段 $t > 0.03$ 及后续段禁止进入 |
| `selfB` | `Box` | 终点卡片防回穿框：等同 `card` 完整边框；因曲线终点位于输入圆与箭头外沿（距边框 `15px`），全程禁止进入 |

### 2.2 `ObstacleCluster`（障碍簇）
当某条边遇到多张彼此间隙过窄（无法容纳平滑曲线及留白穿行）的卡片时，动态合并的临时包围结构：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `key` | `string` | 成员卡片 ID 排序拼接的稳定标识（用作 Pass-2 共路聚合与 Q5 滞回键） |
| `ids` | `readonly string[]` | 属于同一不可分障碍簇的卡片 ID 集合 |
| `card` | `Box` | 簇内成员 `card` 外接合并矩形 |
| `pad` | `Box` | `card` 外扩 `CLEARANCE_PAD`（7px）后的走廊生成基准包络 |

- **聚类规则**：当两张非端点卡片在水平或垂直方向存在投影重叠，且两卡外框间净距 `< 2 * CLEARANCE_PAD`（14px）并挡住同一连线路径时，将其合并为一个 `ObstacleCluster`，防止曲线钻入不可通行的窄缝。

### 2.3 `SplineCurve`（内部 1～3 段 $G^1$ 平滑样条）与输出视图

`SplineCurve` 为路由内核内部几何载体：

| 字段 | 类型 | 含义与约束 |
| --- | --- | --- |
| `segments` | `readonly Cubic[]` | 组成连线的三次贝塞尔分段，数量严格约束为 `1 | 2 | 3` |
| `waypoints` | `readonly Point[]` | 内部衔接航点数组，长度为 `segments.length - 1`（`0 | 1 | 2`） |
| `d` | `string` | SVG 路径字符串：1 段 `M.. C..` 或 2/3 段连续 `M.. C.. C.. [C..]` |
| `label` | `Point` | 关系标签锚点 `{ x, y }`（`MapScene` 在 `y - 8` 处居中绘制 `<text>`） |

对外输出接口（`RoutedSegment` 与 `connectionGeometry` 返回值）在 `d` 与 `label` 之外统一附带终端几何字段：

| 字段 | 类型 | 含义与约束 |
| --- | --- | --- |
| `arrow` | `string` | 箭头三角形路径（顶点停靠输入圆外沿 `inputPortOuterRadius = 4px`） |
| `stem` | `string` | 严格轴向的 `3px` 直线段（连接曲线终点 $P_e$ 与箭头底边中点） |

### 2.4 `PathMetrics` & `CandidateRoute`（路径评估与最小绕行代价）

| 字段 | 类型 | 含义与择优序 |
| --- | --- | --- |
| `selfHits` | `number` | 采样点落入起终点自身卡片防回穿边界的次数（优先级 1：必须优先为 0） |
| `cardHits` | `number` | 采样点落入非端点卡片 `card` 外框的次数（优先级 2：存在可通行走廊时必须为 0） |
| `coreHits` | `number` | 采样点落入 `core` 核心区的次数（优先级 3：极端拥挤降级时保护文字核心） |
| `maxCardDepth` | `number` | 对任意 `card` 外框的最大侵入像素深度（优先级 4：极端降级时切边优于穿心） |
| `padHits` | `number` | 采样点落入 `7px` 留白区 `pad` 的次数 |
| `maxPadDepth` | `number` | 对 `pad` 留白区最大侵入深度（软代价权重 `2.5`：宽缝自动留满 `7px`，窄缝允许最小改动贴外框通过） |
| `minClearance` | `number` | 整条曲线与最近非端点 `card` 外框的最小外距 |
| `arcLength` | `number` | 样条多段总估算弧长 |
| `detourExcess` | `number` | 相对基础直顺曲线弧长增加量 `max(0, arcLength - baseArcLength)` |
| `bendEnergy` | `number` | 各段弦向转角与拐点弯曲能量累计值 |
| `bypassClusterKey` | `string \| undefined` | 所绕主要障碍簇或走廊标识（空表示未绕行） |
| `bypassSide` | `'top' \| 'bottom' \| 'left' \| 'right' \| '+' \| '-' \| undefined` | 绕行方向标记（供 Pass-2 共路分层与 Q5 滞回使用） |

- **路由代价与换边常量约定**：
  - `SWITCH_MARGIN = 16`：正面直挡换边评估时的原侧轻度偏好阈值（避免临界微小优势就跳边）；
  - `LAMBDA_BEND = 0.32`：最小绕行综合代价与极端降级中的弯曲能量权重系数；
  - `segmentPenalty = segments.length - 1`（取值 `0 | 1 | 2`，对应 1/2/3 段，乘以权重 `8` 防止无收益升段）。

### 2.5 `EdgeRouteHint` & `RoutingOptions`（客户端瞬态内存态）

```ts
export type BypassSide = 'top' | 'bottom' | 'left' | 'right' | '+' | '-'

export interface EdgeRouteHint {
  sourceSide: Port['side']
  targetSide: Port['side']
  bypassSide?: BypassSide
}

export interface RoutingOptions {
  /** 上一帧记忆的各边端口侧与绕行方向（仅在客户端 MapScene 按 viewId 内存维护） */
  hints?: ReadonlyMap<string, EdgeRouteHint>
  /** 当前是否处于用户鼠标拖拽节点状态；仅 true 时启用障碍中线临界区滞回 */
  dragging?: boolean
  /** 输出本帧每条边的最新路由提示，供下一帧继承 */
  outHints?: Map<string, EdgeRouteHint>
}
```

### 2.6 `CorridorGroup`（Pass-2 共路与双向边分层组）

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `key` | `string` | 聚合键：绕行组为 `corridor:${bypassClusterKey}:${bypassSide}`；双向/多边组为 `pair:${minId}|${maxId}:${sideKey}` |
| `normal` | `Point` | 分离法向单位向量（由通道外侧或弦法向确定） |
| `availableWidth` | `number` | 该走廊内两旁卡片内壁之间的净空宽度（外侧无挡卡片时为 `Infinity`） |
| `gap` | `number` | 自适应层距：`clamp((availableWidth - 2 * 4) / (k - 1), 4, 10)`，宽敞区默认 `10px`，窄缝缩至 `4px` 以上 |
| `memberIndices` | `readonly number[]` | 组内边在 `segments` 中的下标（按空间位置与 `relation.id` 稳定排序） |

---

## 3. 核心不变量与状态流转（Invariants & State Transitions）

### 3.1 几何不变量（每次路由必须满足）
1. **端点法向锁死（$G^1$ 端切向）**：所有输出 `segments[0]` 的第一控制点严格在 $P_s + h_s\vec{u}_s$（$h_s > 0$）；最末段 `segments[m-1]` 的第二控制点严格在 $P_e + h_e\vec{u}_t$（$h_e > 0$）。
2. **段数封顶与连接连续**：$1 \le \text{segments.length} \le 3$；当段数 $\ge 2$ 时，任意连接点 $Q_i$ 处左侧手柄方向 $Q_i - C_{i,2}$ 与右侧手柄方向 $C_{i+1,1} - Q_i$ 严格共线同向（均为 $\hat{\tau}_i$），且线段终点与下一段起点坐标完全相等。
3. **有效数值保证**：当任意两点间距接近 0 或两卡片完全重叠时，输出路径字符串与 `label` 不得包含 `NaN`、`Infinity` 或超出有限包围盒的失控坐标。
4. **双端一致与无副作用**：所有实体计算均只读传入的 `nodes` 与 `edges`，在宿主侧栏与离线阅读器中执行同一函数，零 DOM 测量假设、零持久文件写入。

### 3.2 拖拽临界区滞回状态机（Q5 Option A）

```text
[静止初始态: hints 为空或 dragging = false]
   │  按零滞回代价求出当前绝对最优 (portSides, bypassSide)，并写入 hints[relationId]
   ▼
[用户开始拖拽节点: dragging = true]
   │  每帧传入上一帧 hints 与当前实时节点矩形 rects
   ├─ 原侧仍无碰撞 (selfHits === 0 && cardHits === 0)
   │    ├─ 新侧净优势 <= 24px 等效代价（处于障碍中线缓冲带内）
   │    │     ──► 维持原 bypassSide / portSides 不翻转（零闪烁），实时重算样条弧度
   │    └─ 新侧净优势 > 24px（明确越过障碍中线缓冲带）
   │          ──► 一次性平滑切换到新侧，并更新 hints[relationId]
   └─ 原侧已开始发生穿卡 (cardHits > 0 或 selfHits > 0)
        ──► 立即忽略滞回缓冲，实时切换至无碰撞/最小遮挡侧并更新 hints[relationId]
   │
   ▼ [松手结束拖拽: dragging = false，或切换视图 viewId 变更]
   ├─ 结束拖拽：以无滞回纯静态最优收口（与直接打开导图完全一致）并刷新 hints
   └─ 切换视图：清空当前 viewId 对应的 hints 映射
```
