# Contracts: 节点连线曲线弧度与避让逻辑优化

**Feature**: `011-edge-curve-avoidance` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

---

## 1. 公开几何与批量路由契约（`src/shared/edge-geometry.ts`）

### 1.1 保持不变的视觉规范导出
以下常量与数据结构完全保留，确保与 HTML v17 端口圆点、箭头及旧引用方 100% 兼容：

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
export function edgeGeometry(from: Rect, to: Rect, self?: boolean): { start: Point; end: Point; d: string }
```

### 1.2 向后兼容扩展的连线生成与批量路由契约

```ts
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

/**
 * 视图级全图端口分配、智能直挡换边与连线路由入口。
 * - order 未传入且非正面直挡时：100% 沿用既有四向动态选边与同侧防交叉排序。
 * - 仅当同排/同列默认对边端口正前方被中间卡片深度直挡时：允许自动改选更顺畅的侧边（Q1 Option B）。
 * - 返回的 hints 供客户端在拖拽期间维持中线临界滞回（不落盘）。
 */
export function createConnections(
  nodes: Record<string, Rect>,
  edges: { id: string; fromNodeId: string; toNodeId: string; type: string; label?: string }[],
  order?: readonly Port[],
  options?: RoutingOptions,
): { ports: Port[]; segments: RoutedSegment[]; hints: Map<string, EdgeRouteHint> }

/**
 * 供 createConnections 与 useAnimatedPorts 动画帧共用的视图级曲线路由入口：
 * 执行 1～3 段 $G^1$ 自适应避让（Pass-1）、共路与双向分层（Pass-2）及标签避卡择优。
 */
export function routeSegments(
  segments: readonly { relation: RoutedSegment['relation']; source: Port; target: Port; vertical: boolean; self: boolean }[],
  nodes?: Record<string, Rect>,
  options?: RoutingOptions,
): { segments: RoutedSegment[]; hints: Map<string, EdgeRouteHint> }

/**
 * 单边曲线几何入口（向后兼容历史单边调用）：
 * - 不传 nodes 时：返回经端口 $G^1$ 锁定与弧度收敛后的基础 1 段曲线（或平滑自环）；
 * - 传入 nodes 时：执行含自身防回穿、6～8px 安全留白（最小绕行改动）与 1～3 段封顶避让的完整求解。
 */
export function connectionGeometry(
  a: Port,
  b: Port,
  self?: boolean,
  nodes?: Record<string, Rect>,
  options?: RoutingOptions,
): { d: string; arrow: string; stem: string; label: { x: number; y: number } }
```

---

## 2. 内部路由引擎模块化契约（`src/shared/edge-routing.ts`）

为保持 `edge-geometry.ts` 接口简洁且便于单测覆盖，将几何求解核心内聚于共享模块 `src/shared/edge-routing.ts`（零外部依赖，宿主机与浏览器/离线环境通用）：

| 导出函数 | 职责 | 核心不变量 |
| --- | --- | --- |
| `createCardEnvelopes(nodes)` | 构建非端点 `card` / `pad(7px)` / `core` 与自身防穿边界 | 不修改传入 `Rect`；忽略非法非正尺寸 |
| `buildBaseSpline(a, b, self)` | 构造 $G^1$ 锁定的 1 段基础曲线或平滑自环 | `segments.length === 1`（自环允许 2 段外环），端切向严格对齐端口外法线 |
| `buildCentripetalSpline(ps, pe, us, ut, waypoints)` | 按 1 或 2 个航点构造向心弦长加权 $G^1$ 平滑多段样条 | `segments.length === waypoints.length + 1`（≤ 3 段），连接点手柄严格反向共线 |
| `evaluateSpline(spline, envelopes, aId, bId, baseArcLength)` | 凸包剪枝 + 按控制折线长 `clamp(ceil(L/12), 8, 48)` 采样评估 | 采样步长 $\le 12\text{ px}$；精确统计 `selfHits` / `cardHits` / `padHits` / `maxCardDepth` 及 `detourExcess` |
| `selectHeadOnPortSides(segments, envelopes, options)` | 检测同排/同列正面直挡并评估同侧拱桥换边是否净优 | 仅对边正面直挡触发；无阻挡与轻度擦边绝不换边 |
| `routeSingleEdge(a, b, edgeId, envelopes, options)` | 执行 Stage 0 → 1 → 2 → 3 渐进避让、最小改动收敛与极端降级 | 严格封顶 3 段；轻微擦边仅施以最小脱边偏移；有解时不穿 `card` 与自身卡片 |
| `separateSharedCorridors(routed, envelopes, nodes)` | Pass-2 按共路簇与双向关系分组分层并计算曲线 | 宽敞区默认 `10px` 间隔，窄缝按净空收紧至 `4~10px`，绝不挤去卡片对侧绕大圈 |
| `pickLabelAnchor(spline, labelText, envelopes)` | 在总弧长 `25%~75%` 区间寻找避开全图卡片且平缓的标签锚点 | 仅在 `labelText` 非空时运行；计入 `y - 8` 居中绘图框 |

---

## 3. 客户端渲染与端口动画协作契约（`src/client/`）

### 3.1 `src/client/animate-ports.ts`
```ts
export function useAnimatedPorts(
  target: ReturnType<typeof createConnections>,
  nodes: Record<string, Rect>,
  viewId: string,
  options?: Pick<RoutingOptions, 'dragging' | 'hints'>,
): ReturnType<typeof createConnections>
```
- 在每次 180ms 端口边缘滑动动画帧内，按当前插值后的 `ports` 组装分段数组后**统一调用 `routeSegments(..., nodes, options)`**（替代原逐条调用 `connectionGeometry`），并保持返回 `{ ports, segments, hints }`（即 `ReturnType<typeof createConnections>`），确保：
  1. 动画过渡中的智能换边与圆点沿边滑动、曲线、箭头 100% 同步贴合；
  2. 动画帧内多条共路连线同样保持清晰分层，标签锚点平滑随动；
  3. 拖拽过程中的滞回 `hints` 在动画帧与静态帧间一致生效，无闪回。

### 3.2 `src/client/components/MapScene.tsx`
- 维护视图隔离的瞬态引用 `const routeHintsRef = useRef<{ viewId: string; map: Map<string, EdgeRouteHint> }>({ viewId: view.id, map: new Map() })`；
- 在渲染期按 `const prevHints = routeHintsRef.current.viewId === view.id ? routeHintsRef.current.map : undefined` 读取上一帧同视图提示，避免切换 `view.id` 首帧误读旧视图同名 `relation.id` 的提示；
- 计算 `const connections = createConnections(rects, edges, undefined, { hints: prevHints, dragging })`；
- 向 `useAnimatedPorts(connections, rects, view.id, { dragging, hints: connections.hints })` 直接传入本帧产出的最新 `connections.hints`，避免发生翻侧/换边的首帧使用上一帧旧提示；
- 通过 `useLayoutEffect` 在提交后回写 `routeHintsRef.current = { viewId: view.id, map: connections.hints }`，既保证 React 渲染纯度，又在切换 `view.id` 或拖拽结束时刷新瞬态缓存；
- `<SceneEdge>` 组件、`classifyEdgeFocus` 焦点分类、`.edge` / `.edge.secondary` / `.edge-label` CSS 类名、端圆与箭头颜色变量以及 `src/client/offline.tsx` 离线独立阅读器**全部保持零接口变更**。

---

## 4. 校验与原型对齐契约（`tests/shared/`）

1. **`tests/shared/edge-routing.test.ts`（新增核心测试集）**：
   - 覆盖 ≥ 15 种无阻挡方位组合（水平、垂直、轻微错位、斜向、四组邻边转角、极近紧贴、跨组远距、自环），断言端切向与对应外法线夹角误差 $< 0.01^\circ$（$G^1$ 严格共线）、无回穿起终点自身卡片、无过度鼓包；
   - 覆盖 ≥ 12 个阻挡与避让场景：同排正面直挡拱桥换边、同列正面直挡拱桥换边、轻微擦边仅做最小微调（不绕大圈也不换边）、高卡片/宽卡片避让、多张交错阻挡 1～3 段平滑绕过、绝对段数 $\le 3$、极端卡片重叠时确定性最小遮挡降级且无 `NaN`/飞线；
   - 覆盖共路 2～4 条线绕过同一卡片同侧与双向互连，断言任意两条共路曲线中段最小法向间隔 $\ge 3.5\text{ px}$ 且在窄走廊中自适应收紧不翻到对侧；
   - 覆盖带标签绕行边，断言标签包围盒与卡片重叠率满足指标（$\ge 90\%$ 场景零卡片重叠）；
   - 覆盖连续步进拖过障碍中线（每次移动 `2px` 穿过中线），断言 `bypassSide` 切换次数 $\le 1$；
   - 覆盖 20 节点、30+ 边复杂视图批量耗时基准（`createConnections` 执行耗时远低于动画帧预算）。
2. **`tests/shared/prototype-parity.test.ts`（精确区分原型基线与直挡增强）**：
   - 对 v17 全视图中**无中间卡片阻挡**的所有连线，继续严格校验端口选边、分布及平滑曲线无折角；
   - 对 v17 中**存在正面阻挡的 5 条隔卡边**，显式校验新版 `createConnections(nodes, edges)` 不再穿过中间障碍卡片外框，且端圆点、箭头、标签与端口分布保持合法无交叉。
