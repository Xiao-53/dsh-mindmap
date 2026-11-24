# Phase 1 Data Model: 简化节点连线路由、焦点提层与自适应关系胶囊标签

**Feature**: `012-simplified-edge-routing` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

---

## 1. 持久化存储模型影响（零变更）

- **`map.json`（`schemaVersion: 1`）**：保持现有全部字段不变，不新增或修改任何节点、视图或关系字段。
- **`layout.json`（`schemaVersion: 1 | 2`）**：保持现有全部字段不变。所有单端口顶距基准、投影对齐、直线拉直、隔卡拱桥、胶囊避卡坐标与拖拽滞回提示均属视图实时呈现状态，**绝不写回 `layout.json`**，也不改写任何历史已保存的节点或分组坐标（`FR-011`、`SC-006`）。
- **离线导出载荷（`OfflineMapData`）**：保持不变；离线独立阅读页通过 `ReadingPane → MapScene` 与内置样式自动获得完全一致的路由、焦点提层与胶囊效果（`FR-012`）。

---

## 2. 运行期核心常量与实体模型（`src/shared/edge-routing.ts` & `edge-geometry.ts`）

### 2.1 几何与视觉常量

| 常量 | 值 | 用途与对应需求 |
| --- | --- | --- |
| `SINGLE_SIDE_TOP_OFFSET` | `43` | 左右侧单端口默认距卡片顶部固定高度基准（匹配标准 86px 卡片中线，`FR-002` / Q2） |
| `PORT_INSET_Y` | `18` | 左右侧投影对齐安全内边距（实际取 `min(height / 4, 18)` 兼容极矮卡片） |
| `PORT_INSET_X` | `20` | 上下侧投影对齐安全内边距（实际取 `min(width / 4, 20)`） |
| `STRAIGHT_DEADZONE` | `16` | 面对面连线小错位拉直阈值（`\|dPerp\| <= 16` 时直连拉直，`FR-002` / Q3） |
| `MIN_STRAIGHT_SPAN` | `24` | 触发面对面直线拉直所需的最小轴向净距 |
| `MAX_BEZIER_HANDLE` | `110` | 正向对边与邻边转角曲线最大控制臂长度，防止跨列长边大鼓包（`FR-003`） |
| `MAX_ARCH_HANDLE` | `148` | 同排/同列隔卡拱桥单段对称曲线的最大抬高控制臂上限（`FR-004`） |
| `HEAD_ON_ENTER_DEPTH` | `18` | 触发隔卡拱桥评估的中间卡片最小直连侵入深度（`min(18, 0.25 * obsDim)`） |
| `HEAD_ON_EXIT_DEPTH` | `6` | 拖拽已启用拱桥状态时的退出迟滞阈值，防止临界来回闪跳（`FR-009`） |
| `ARCH_HYSTERESIS` | `24` | 拖拽期间隔卡拱桥在上下/左右竞争侧之间保持原侧的等效缓冲代价 |
| `PILL_MAX_WIDTH` | `132` | 关系胶囊最大视觉宽度，超出时省略截断并由 `title` 悬停展示全文（`FR-007`） |
| `PILL_HEIGHT` | `22` | 关系胶囊包围盒估算高度，用于 AABB 避卡碰撞检测 |
| `PILL_CARD_MARGIN` | `4` | 胶囊放置与节点卡片之间的最小呼吸留白 |
| `PILL_CANDIDATE_T` | `[0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8]` | 沿线由中心向两侧依次探测的无压卡参数序列（`FR-007`） |

### 2.2 轻量数据结构

- **`Point` / `Box` / `Cubic`**：基础二维坐标 `{ x: number; y: number }`、AABB 包围盒 `{ x0, y0, x1, y1 }` 与单段三次贝塞尔四点元组 `[Point, Point, Point, Point]`。
- **`EdgeCurve`（取代冗杂的 `SplineCurve`）**：
  - `kind: 'straight' | 'cubic' | 'self'`
  - `segments: readonly Cubic[]`（直线为单退化段或起止线段表示，常规曲线为 `1` 段，仅自环为 `2` 段）
  - `d: string`（直线 `M.. L..`；单段曲线 `M.. C..`；自环 `M.. C.. C..`）
  - `defaultLabel: Point`（中点默认值：直线 `(ps + pe)/2`，贝塞尔 $t=0.5$，自环外环顶点）
- **`PortEndpoints`**：
  - `ps: Point`、`pe: Point`、`us: Point`、`ut: Point`
  - `arrow: string`、`stem: string`（普通/曲线模式沿目标端口外法线 `ut` 对准 `4px` 外沿；直线模式顺沿直线方向 `normalize(b - a)` 对准 `4px` 外沿，实现零折角）
- **`EdgeRouteHint` & `RoutingOptions`（客户端瞬态内存态，不落盘）**：
  - `EdgeRouteHint = { sourceSide: Port['side']; targetSide: Port['side']; archActive?: boolean }`
  - `RoutingOptions = { hints?: ReadonlyMap<string, EdgeRouteHint>; dragging?: boolean; outHints?: Map<string, EdgeRouteHint> }`
- **`PlacedPillBox`**：Pass-1 计算中用于同一视图多条带标签连线（含双向互连与相邻边）避免胶囊相互完全重合的已放置包围盒列表。
- **`RoutedSegment`**：对外保持兼容的视图边渲染输出：
  `{ relation, source, target, vertical, self, d, arrow, stem, label: Point }`

---

## 3. 核心不变量与轻量化状态流转

### 3.1 几何与性能不变量
1. **端切向与箭头零折角**：所有曲线边（`kind === 'cubic' | 'self'`）首末控制点严格落在对应端口外法线射线上；直线边（`kind === 'straight'`）整条线段、`3px stem` 与箭头三角形严格共线并对准输入圆外沿 `4px` 处。
2. **最高段数不变量**：非自环连线绝不超过 1 段（直线 1 条线段，曲线 1 段三次贝塞尔）；自环固定 2 段平滑外环；彻底零多段蛇形波浪。
3. **有限数值兜底**：当节点宽高为 0/非法值或两端重合时，所有坐标经 `finite()` 保护，绝不产生 `NaN` 或 `Infinity`。
4. **严格 $O(E)$ 主干复杂度**：无全图离散网格采样，拖拽期间每帧 40 节点 / 60 边耗时控制在 `< 1ms`。

### 3.2 隔卡拱桥拖拽滞回状态机（`FR-009`）

```text
[静止态: dragging = false 或 hints 为空]
   │  仅当同排/同列对边直连中心被中间卡侵入深度 >= min(18, 0.25 * obsDim) 且至少一侧为外侧空边时切同侧拱桥
   ▼  记录 hints[relationId] = { sourceSide, targetSide, archActive }
[拖拽态: dragging = true]
   ├─ prevHint.archActive === true（当前已为拱桥）
   │    ├─ 中间卡直连侵入深度仍 >= 6px（处于进入/退出缓冲带内）
   │    │     ──► 维持拱桥状态；且原拱桥侧仅在竞争侧净优 > ARCH_HYSTERESIS(24) 时才翻侧
   │    └─ 中间卡侵入深度 < 6px（已明显离开直挡区）
   │          ──► 平滑收回到普通面对面直连/单段曲线（archActive = false）
   └─ prevHint.archActive !== true（当前为直连/普通曲线）
        ├─ 中间卡直连侵入深度 >= min(18, 0.25 * obsDim)
        │     ──► 启用同侧拱桥（archActive = true）并选择较优外侧
        └─ 否则保持普通直连或穿底单段曲线
```

### 3.3 焦点提层状态流转（Q1 Option A）
- `selected === undefined`：全部边在 `.edges-base`（`z-index: 1`），全部胶囊在 `.edge-labels`（`z-index: 6`），鼠标悬停卡片/边/胶囊**不改变层级**。
- `selected === nodeId`：直接与 `nodeId` 相连的边（`in` / `out` / `supplement`）渲染于 `.edges-focus`（`z-index: 5`，卡片之上），其对应胶囊挂 `.is-focused`（`z-index: 7`）；其余 `dimmed` 边留在 `.edges-base`（opacity `0.2`），对应胶囊挂 `.is-dimmed`（opacity `0.22`）。
