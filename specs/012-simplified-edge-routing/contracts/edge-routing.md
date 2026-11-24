# Contracts: 简化节点连线路由、焦点提层与自适应关系胶囊标签

**Feature**: `012-simplified-edge-routing` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

---

## 1. 公开几何与批量路由契约（`src/shared/edge-geometry.ts`）

### 1.1 保持不变的视觉规范与数据结构
完全保留既有外部常量与数据结构，确保与 HTML v17 端口圆点、箭头及既有调用方 100% 兼容：

```ts
export const PORT_RADIUS = 3.5          // 端点圆半径
export const INPUT_PORT_STROKE = 1      // 输入雾霾蓝实心圆描边宽度
export const OUTPUT_PORT_STROKE = 2     // 输出灰豆沙空心圆描边宽度（2px）
export const ARROW_LENGTH = 8           // 箭头三角形长度
export const ARROW_HALF_WIDTH = 3.5     // 箭头半宽
export interface Rect { x: number; y: number; width: number; height: number }
export interface Port {
  nodeId: string
  side: 'left' | 'right' | 'top' | 'bottom'
  other: string
  edgeIndex: number
  role: 'in' | 'out'
  x: number
  y: number
}
export interface RoutedSegment {
  relation: { id: string; fromNodeId: string; toNodeId: string; type: string; label?: string }
  source: Port
  target: Port
  vertical: boolean
  self: boolean
  d: string
  arrow: string
  stem: string
  label: { x: number; y: number }
}
```

### 1.2 核心入口函数行为变更（向后兼容签名）

```ts
export function createConnections(
  nodes: Record<string, Rect>,
  edges: { id: string; fromNodeId: string; toNodeId: string; type: string; label?: string }[],
  order?: readonly Port[],
  options?: RoutingOptions,
): { ports: Port[]; segments: RoutedSegment[]; hints: Map<string, EdgeRouteHint> }

export function routeSegments(
  segments: readonly {
    relation: RoutedSegment['relation']
    source: Port
    target: Port
    vertical: boolean
    self: boolean
    archClearance?: number
  }[],
  nodes?: Record<string, Rect>,
  options?: RoutingOptions,
): { segments: RoutedSegment[]; hints: Map<string, EdgeRouteHint> }

export function connectionGeometry(
  a: Port,
  b: Port,
  self?: boolean,
  nodes?: Record<string, Rect>,
  options?: RoutingOptions,
): { d: string; arrow: string; stem: string; label: { x: number; y: number } }

export function edgeGeometry(from: Rect, to: Rect, self?: boolean): { start: Point; end: Point; d: string }
```

- **`createConnections` 端口分配规则**：
  1. 若 `!order`，先执行轻量同排/同列隔卡直连判定 `selectInlineBlockedSides(specs, nodes, options)`，仅对正面被整卡完全堵死的面对面边切换同侧端口并写入 `archClearance`；
  2. 分组排序后通过 `place(group)` 放置端口：当 `group.length === 1` 且 `side === 'left' | 'right'` 时，默认取距顶固定高度基准 `clamp(43, insetY, height - insetY)`（Q2 Option A）；
  3. 若 `!order`，紧接执行单端口轴向投影对齐 `alignSinglePorts(segments, groups, nodes)`：面对面（`left↔right` 或 `top↔bottom`）边中 `group.length === 1` 的一侧端口，当对端坐标落在己方安全内边距区间 `[min + inset, max - inset]` 内时，直接投影对齐（Q2 Option A）；
  4. 最终调用 `routeSegments(segments, nodes, options)` 生成直线/受控曲线路径与自动避卡胶囊坐标。

---

## 2. 极简内部路由引擎契约（`src/shared/edge-routing.ts`）

将模块从 `011` 的 1,980 行彻底缩减为 **~280～340 行**，**移除** `createCardEnvelopes`、`evaluateSpline`、`buildCentripetalSpline`、`routeSingleEdge`、`separateSharedCorridors`、`ObstacleCluster`、`SelfCardGuard`、`CorridorGroup`、`PathMetrics` 等所有重度全局采样/多段避让符号，仅保留以下精简导出：

| 导出函数 / 常量 | 职责 | 核心不变量 |
| --- | --- | --- |
| 常量集合 | `SINGLE_SIDE_TOP_OFFSET=43`, `STRAIGHT_DEADZONE=16`, `MAX_BEZIER_HANDLE=110`, `MAX_ARCH_HANDLE=148`, `HEAD_ON_ENTER_DEPTH=18`, `HEAD_ON_EXIT_DEPTH=6`, `ARCH_HYSTERESIS=24`, `PILL_MAX_WIDTH=132`, `PILL_HEIGHT=22`, `PILL_CARD_MARGIN=4` | 零冗余试探参数 |
| `sideNormal(side)` | 返回端口四向单位外法线 | 纯映射，无分配 |
| `computePortEndpoints(a, b, straightDir?)` | 计算 `ps`、`pe`、`arrow`、`stem`；`straightDir` 存在时沿直线方向顺接箭头（Q3 Option A） | 箭头尖端永远停在输入圆 `r = 4px` 外沿，零折角 |
| `buildEdgeCurve(a, b, self, archClearance?)` | 生成直线、限幅单段 $G^1$ 曲线、同侧拱桥或自环，返回 `EdgeCurve` 及是否触发直线模式的 `straightDir` | 非自环至多 1 段；长边句柄封顶 `110px` |
| `evalCurvePoint(curve, t)` | 在直线或单/双段三次贝塞尔上按参数 $t \in [0, 1]$ 求坐标 | $O(1)$ 求值，防 `NaN` |
| `selectInlineBlockedSides(specs, nodes, options)` | 基于纯矩形区间的同排/同列外侧隔卡直挡检测与拱桥换边，含拖拽进出滞回 | 零曲线采样；斜向、擦边及内部列/行（两侧均有他卡）绝不换边 |
| `pickPillAnchor(curve, labelText, rects, placedPills?)` | 按 `t ∈ [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8]` 探测避开全图卡片与已放胶囊的位置，极短边回退 `0.5` | 无标签时跳过；永不飞离曲线 |

---

## 3. 客户端渲染、分层与胶囊样式契约（`src/client/`）

### 3.1 `src/client/animate-ports.ts`
- 保持 `useAnimatedPorts(target, nodes, viewId, options?): ReturnType<typeof createConnections>` 签名与 180ms 边缘滑动动画不变；
- 保护 `rect.width <= 0 || rect.height <= 0`（不产生 `NaN` 除以零）；
- 动画帧调用轻量 `routeSegments(interpolated, nodes, options)` 返回 `{ ports, segments, hints }`，因单边仅 $O(1)$ 计算，每帧平滑无卡顿。

### 3.2 `src/client/components/MapScene.tsx`
- 保留 `routeHintsRef` 渲染期按 `view.id` 读取 `prevHints` 并在 `useLayoutEffect` 回写 `connections.hints` 的纯度时序，供隔卡拱桥拖拽滞回使用；
- **拆分层级结构（Q1 Option A，严禁鼠标悬停触发提层）**：
  1. `<svg className="edges edges-base" aria-hidden="true">`（`z-index: 1`）：当未选中节点时渲染全部 `segments`；当 `selected` 非空时仅渲染 `focusRole === 'default' || focusRole === 'dimmed'` 的底层连线；
  2. `{visualLayout.nodes.map(... <SceneNode ... />)}`（`z-index: 2`）；
  3. `{selected && focusSegments.length > 0 && <svg className="edges edges-focus" aria-hidden="true">`（`z-index: 5`）：仅渲染 `focusRole === 'in' | 'out' | 'supplement'` 的高亮连线，其中 `<SceneEdge>` 可附带浅色/暗色底板描边光晕（halo）以提升跨卡与文字区边界穿透对比度；
  4. `<div className="edge-labels" aria-hidden="true">`（`z-index: 6`）：仅对 `segment.relation.label?.trim()` 非空的边渲染 `<ScenePill>`（`memo` 包裹的 `<span className="edge-pill ...">`）：
     - 属性：`data-relation={r.id}`、`data-focus={focusRole === 'default' ? undefined : focusRole}`、`title={r.label}`；
     - 定位：`style={{ left: `${labelX}px`, top: `${labelY}px` }}`（CSS `transform: translate(-50%, -50%)` 中心对齐）；
     - 样式类：`edge-pill` + `secondary?` + `is-focused`（当 `in`/`out`/`supplement` 时升至 `z-index: 7`）或 `is-dimmed`（透明度 `0.22`、`pointer-events: none`）；
  5. `<svg className="atlas-ports" aria-hidden="true">`（`z-index: 9`）：保持现有输入/输出端口圆点及配色（`#8699aa` / `#b38c97` 2px 描边）不变。

### 3.3 `src/client/styles/atlas.css` & `src/client/styles/dark.css`
- 确认规则不被 `src/client/styles/prototype.css` 覆盖（`prototype.css` 仅设置了 `.edges` 位置、未设 `z-index`，在 `atlas.css` 与 `dark.css` 中设置 `.edges-base` / `.edges-focus` / `.edge-labels` / `.edge-pill` 样式即可安全生效）：
  - `.dsh-atlas .edges-base { z-index: 1; }`
  - `.dsh-atlas .edges-focus { z-index: 5; }`
  - `.dsh-atlas .edge-labels { position: absolute; inset: 0; pointer-events: none; overflow: visible; z-index: 6; }`
  - `.dsh-atlas .edge-pill`：圆角胶囊样式（暖纸浅色 `#fffdf8` / `#dfd6c7` 边框，暗色 `#25231f` / `#443e35` 边框），`max-width: 132px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transform: translate(-50%, -50%); pointer-events: auto; cursor: default;`；
  - `.dsh-atlas .edge-pill.is-focused`：`z-index: 7; border-color: var(--edge-primary); color: var(--edge-primary);`（`secondary` 时用 `var(--edge-secondary)`）；
  - `.dsh-atlas .edge-pill.is-dimmed`：`opacity: 0.22; pointer-events: none;`。
- `src/client/offline.tsx`：**零代码修改**，自动打包上述组件与样式，实现双端 100% 一致。

---

## 4. 校验与测试重写契约（`tests/`）

1. **`tests/shared/edge-routing.test.ts`（重写为对齐新规范的轻量核心回归）**：
   - **直线化与顶距对齐（`SC-001`）**：覆盖 ≥ 12 组同排高度不一串联卡片、多端口对单端口、16px 内小错位直连，断言连线均为纯直线 `M.. L..` 且箭头方向与直线完全共线（夹角误差 `< 0.01°`）；验证跨行大斜边绝不被强吸进卡片角落；
   - **受控单段曲线与自环（`SC-002`）**：覆盖 ≥ 15 组跨行、跨列、长距、反向回环、穿无关卡片斜连与自环，断言非自环分段数严格为 1（0 条多段蛇形波浪），端切向垂直卡片边缘（误差 `< 0.01°`），正向控制臂 $\le 110\text{px}$；
   - **隔卡直连拱桥与滞回（`SC-003`, `SC-005`）**：覆盖同排/同列隔卡正面堵死转同侧单段拱桥、普通斜连穿底不换边、拖拽进出临界线滞回切换次数 $\le 1$；
   - **关系胶囊定位与短边兜底（`SC-004`）**：覆盖常规跨距边胶囊 7 点自动避开卡片及多胶囊错位、极短边居中回退；
   - **大图 40 节点 / 60+ 边性能与防 `NaN`（`SC-005`, `SC-006`）**：零尺寸/重叠卡片安全不崩溃，40 节点 60 边单次 `createConnections` 耗时远低于帧预算，且零改写传入节点坐标。
2. **`tests/shared/prototype-parity.test.ts`（适配新策略）**：
   - 更新原依赖旧 `createCardEnvelopes` / `evaluateSpline` 与“跨卡绝不穿框”的断言：保留 v17 端口选边、自环分离与箭头/`stem` 合法性校验；对跨卡普通斜边验证其保持简洁单段、不产生多段波浪，对同排/同列正面直挡边验证其转为平滑单段拱桥越过阻塞卡片。
3. **`tests/integration/dom.test.ts`（补充轻量 UI 断言）**：
   - 验证渲染的 `MapScene` / 离线 HTML 导出包含 `.edges-base`、`.edge-labels` 及 `.edge-pill`（含 `title`），且选中节点时正确挂载 `.edges-focus` 将关联边与胶囊提至卡片上层、未选中及悬停时不触发 `.edges-focus`。
