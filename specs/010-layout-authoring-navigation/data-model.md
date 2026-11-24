# Phase 1 Data Model: 导图四向邻接排版、生成质量与详情关系操控优化

**Feature**: `010-layout-authoring-navigation` | **Date**: 2026-11-22

---

## 1. 持久化存储模型影响（`map.json` & `layout.json`）

### 1.1 `map.json`（零 Schema 变更）
- 保持 `schemaVersion: 1` 及全部既有字段（`id`, `title`, `rootViewId`, `nodes`, `views`, `relations`）完全不变。
- 无需任何历史数据迁移。

### 1.2 `layout.json`（向后兼容精简 `columns` 模式）
- 保持 `schemaVersion: 1 | 2` 结构不变：
  - **读取与校验层（`src/shared/validate-layout.ts`）**：`mode` 枚举继续接受 `'vertical' | 'grid' | 'columns'`，确保历史保存过 `mode: "columns"` 的 `layout.json` 100% 通过校验并正常加载原坐标。
  - **交互与重排生成层（`src/shared/layout.ts`, `src/client/components/MapHeader.tsx`）**：
    - `availableModes(view)` 仅产出 `'vertical'`（单列纵向）和 `'grid'`（双列田字，当 `groupCount(view) >= 2` 时可用）；
    - 当对遗留 `mode === 'columns'` 的视图触发 `relayoutView` 或切换排列时，自动归一为 `groupCount(view) >= 2 ? 'grid' : 'vertical'`。

---

## 2. 四向邻接网格排版模型（`src/shared/layout.ts`）

### 2.1 `GridSlot`（组内二维网格槽位）
表示一个分组（或未分组桶）内部用于安置节点的离散二维网格位置：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `row` | `number` | 行号（$0 \le \text{row} < R$，$R = \lceil k / C \rceil$） |
| `col` | `number` | 列号（$0 \le \text{col} < C$，$C = \min(3, k)$） |
| `x` | `number` | 相对分组左上角的水平偏移：`24 + col * 327`（或初始布局 `x + 36 + col * 327`） |
| `y` | `number` | 相对分组左上角的垂直偏移：由前序各行的实际最大卡片高度累加 `+ 32` 行距得出 |

### 2.2 `AdjacencyScoreModel`（槽位分配评分项）
用于确定性求解组内节点到 `GridSlot` 的双射映射 $\pi: \text{NodeId} \to (r, c)$：

| 评分维度 | 触发条件 | 代价/奖励规则 |
| --- | --- | --- |
| **直接邻接与曼哈顿距离** | 组内两节点 $(u, v)$ 存在 `dependency`（权重 $1.0$）或 `supplement`（权重 $0.6$） | 距离 $d = |r_u - r_v| + |c_u - c_v|$；$d=1$（左右或上下直接相邻）代价为 $0$；$d > 1$ 按 $w \cdot (40 \cdot (d - 1)^2 + 25 \cdot |r_u - r_v| \cdot |c_u - c_v|)$ 递增，重罚跨行长对角斜线 |
| **同行/同列夹心穿卡惩罚** | 相连 $(u, v)$ 同行且 $|c_u - c_v| = 2$（中间格 $(r_u, 1)$ 有节点），或同列且 $|r_u - r_v| \ge 2$（中间行同列有节点） | 每次夹心穿卡增加 `+500` 惩罚，逼迫算法将相连节点移至相邻格或错开阻挡格 |
| **多度枢纽居中奖励** | 节点在组内关联边数 $\text{deg}(u) \ge 3$ | 若位于中间列（$C=3$ 时 $c_u = 1$）奖励 `-35 * deg(u)`，若同时位于中间行（$R \ge 3$ 时 $0 < r_u < R-1$）额外奖励 `-20 * deg(u)`，使连线分散至上/下/左/右四向端口 |
| **自然流向微偏向** | 有向依赖边 $u \to v$（`type === 'dependency'`） | 若 $r_u > r_v$（下游排在上游上方）施加 `+45` 逆流惩罚；同行内若非蛇形顺接且 $c_u > c_v$ 施加 `+15` 惩罚 |
| **网格线段交叉惩罚** | 两条组内边 $(u_1, v_1)$ 与 $(u_2, v_2)$ 不共享端点且其网格中心连线严格相交 | 每次交叉增加 `+180` 惩罚 |

### 2.3 紧凑分组包络（`CompactGroupBounds`）
- 对包含 $k \ge 1$ 个节点的分组：
  - `left = min(node.x) - 24`
  - `top = min(node.y) - 62`
  - `right = max(node.x + node.width) + 24`（彻底移除原 `x + 1058` 常量下限）
  - `bottom = max(node.y + nodeHeight) + 24`
  - `width = Math.max(284, right - left)`，`height = Math.max(178, bottom - top)`
- 对空分组（$k = 0$）：兜底 `width = 320, height = 178`。

---

## 3. 贝塞尔绕弧避让几何模型（`src/shared/edge-geometry.ts`）

### 3.1 `BezierObstacleDeflection`
- **输入**：源端口 `a: Port`、目标端口 `b: Port`、自环标记 `self: boolean`、当前视图节点矩形表 `nodes?: Record<string, Rect>`。
- **检测规则**：
  - 排除 `a.nodeId`、`b.nodeId` 及 `self === true` 的情形；
  - 对基础三次贝塞尔控制点 `(c1_0, c2_0)` 在 $t \in \{0.2, 0.35, 0.5, 0.65, 0.8\}$ 计算曲线点 $B(t)$；
  - 若存在其他节点矩形 $R$，使得 $B(t)$ 落入 $[R.x - 10, R.x + R.width + 10] \times [R.y - 10, R.y + R.height + 10]$，则判定为穿卡碰撞。
- **偏移规则**：
  - 沿弦法向 $\vec{n}_\perp = (-\Delta y, \Delta x) / \|\Delta\|$ 测试两侧候选偏移量 $\pm \delta$（按阻挡矩形到弦的投影跨度计算所需推开距离，限制在 $[48, 160]\text{ px}$ 内）；
  - 选择不再命中阻挡矩形（或离所有非端点矩形中心最远）的一侧，将 `c1` 与 `c2` 同步叠加法向偏移向量，生成平滑绕弧的 `d` 路径字符串。

---

## 4. 客户端阅读与关系操控状态模型（可独立拆分层）

### 4.1 `ReadingState` 扩展（`src/client/reading-state.ts`）
在内存态 `ReadingState`（及历史快照 `ReadingLocation`）中新增 1 个可选布尔字段：

```ts
export interface ReadingState {
  workspaceKey: string
  sessionId: string
  mapId: string
  viewId: string
  cameras: Record<string, Camera>
  selectedNodeId?: string
  detailHidden?: boolean // 新增：true 表示详情面板已收起，但画布仍保留 selectedNodeId 选中与关联边高亮
  detailScroll: number
  focusSource?: string
  history?: ReadingHistory
}
```

### 4.2 状态流转机（Selection & Inspector State Transitions）

```text
[未选中态: selectedNodeId = undefined, detailHidden = undefined]
   │
   ├─ 单击无子图节点 / 点击“本节笔记” / 搜索定位 ──► [选中且展开详情: selectedNodeId = X, detailHidden = false]
   │                                                      │
   │                                                      ├─ 点击详情内关系胶囊 Y ──► [同视图居中并切详情: selectedNodeId = Y, detailHidden = false]
   │                                                      │
   │                                                      ├─ 点击详情关闭(×) 或按 Escape ──► [选中但收起详情: selectedNodeId = X, detailHidden = true]
   │                                                      │                                        │
   │                                                      │                                        ├─ 再次单击无子图节点 X ──► [重新展开: selectedNodeId = X, detailHidden = false]
   │                                                      │                                        └─ 点击画布空白处 或 再按 Escape ──► [未选中态: selectedNodeId = undefined]
   └─ 单击有子图节点 ──► 保持 0.5s 跨视图子图下钻（原有行为不变）
```

### 4.3 `ViewNeighborGroup`（`src/client/components/NeighborPills.tsx`）
由当前视图 `view.relationIds` 实时派生，不持久化：

| 分类键 | 标题标签 | 筛选条件（需两端节点均存在于当前视图 `occurrences` 或 `centerNodeId`） |
| --- | --- | --- |
| `prerequisites` | `前置依赖` | `relation.type === 'dependency' && relation.toNodeId === currentNodeId`（展示 `fromNode`） |
| `dependents` | `后续节点` | `relation.type === 'dependency' && relation.fromNodeId === currentNodeId`（展示 `toNode`） |
| `supplements` | `补充关联` | `relation.type === 'supplement' && (relation.fromNodeId === currentNodeId \|\| relation.toNodeId === currentNodeId)`（展示对端节点，附可选 `relation.label`） |

### 4.4 `EdgeFocusRole`（`src/client/components/MapScene.tsx`）
当 `selected`（即 `reading.selectedNodeId`）存在时，当前视图每条边 `relation` 的视觉状态：

| 角色枚举 | 判定条件 | 视觉表现 |
| --- | --- | --- |
| `'default'` | `selected === undefined` | 原有默认样式（`dependency` 不透明度 `0.76`，`supplement` 不透明度 `0.58`） |
| `'incoming-dependency'` | `selected !== undefined && relation.type === 'dependency' && relation.toNodeId === selected` | 高亮前置入边（类名 `edge-focus-in`，不透明度 `0.96`，线宽 `2.4px`） |
| `'outgoing-dependency'` | `selected !== undefined && relation.type === 'dependency' && relation.fromNodeId === selected` | 高亮后续出边（类名 `edge-focus-out`，不透明度 `0.96`，线宽 `2.4px`） |
| `'connected-supplement'` | `selected !== undefined && relation.type === 'supplement' && (relation.fromNodeId === selected \|\| relation.toNodeId === selected)` | 高亮补充边（类名 `edge-focus-supplement`，不透明度 `0.88`，线宽 `2.1px`） |
| `'dimmed'` | `selected !== undefined` 且两端均不等于 `selected` | 降噪背景边（类名 `edge-dimmed`，不透明度降至 `0.2`） |
