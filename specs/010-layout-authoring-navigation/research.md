# Phase 0 Research: 导图四向邻接排版、生成质量与详情关系操控优化

**Feature**: `010-layout-authoring-navigation` | **Date**: 2026-11-22

---

## 1. 四向动态端口下的二维网格邻接排布 vs 传统自上而下分层树

### Decision
在分组内部（及无分组区域）保持最大 3 列的紧凑二维网格形态，采用**四向端口感知的二维网格邻接排布算法（4-Port 2D Grid Adjacency Placement）**：
1. **无连线退化保护**：若当前分组内部节点之间不存在任何视图内可见关系，保持原有按 `occurrences` 顺序从左到右、从上到下的排布，确保 100% 确定性与向后一致。
2. **有连线时的 S 型拓扑种子 + 局部槽位交换寻优**：
   - 先基于组内 `dependency` 有向边执行确定性拓扑排序（Kahn 算法，多入度为 0 节点按度数与原 `occurrences` 下标破平局；若存在环路，按原下标确定性破环），并按 **S 型蛇形（Boustrophedon：偶数行 `0→1→2`，奇数行 `2→1→0`）** 填入 $R \times C$ 网格（$C = \min(3, k)$，$R = \lceil k / C \rceil$）作为初始种子；
   - 再在 $R \times C$ 槽位上以固定代价函数执行确定性成对槽位交换（Steepest-Descent Pairwise Swap，最多 6 轮）：
     - **邻接距离代价**：相连节点在网格中的曼哈顿距离越短代价越低（上下相邻走 `bottom↔top`、左右相邻走 `left↔right` 代价最低；跨行大对角斜跨代价最高）；
     - **同行/同列夹心穿卡重罚（Colinear Sandwiching Penalty）**：若相连两端位于同一行第 0、2 列且第 1 列有节点，或位于同一列相隔 $\ge 2$ 行且中间行同列有节点，施加高额惩罚（`+500`）；
     - **多连线枢纽居中奖励（Hub Centering Bonus）**：组内关联度 $\ge 3$ 的节点落入中间列（`col === 1`）或内部行时获得负代价奖励，使连线自然向 `top / right / bottom / left` 四条边分散；
     - **流向微偏向与网格线段交叉惩罚**：`dependency` 边满足 $r_{\text{from}} \le r_{\text{to}}$ 或同行顺向时给微奖励，两连线槽位线段相交施加交叉惩罚（`+180`）。

### Rationale
- `dsh-mindmap` 的 `createConnections`（`src/shared/edge-geometry.ts`）与 `useAnimatedPorts`（`src/client/animate-ports.ts`）已经实现了四边动态端口分配与同侧投影防交叉排序，节点卡片又是宽扁形（宽 `236px`、高约 `110px`）。
- 若照搬 MapFlow 的“一个拓扑深度占一行”的自上而下树状分层，会废掉左右两侧动态端口、把串联流程拉成细长“单列竹竿”，且跨层竖线极易劈穿下方 `236px` 宽的卡片。
- 采用二维网格邻接排布，在单视图 $\le 20$ 节点的规模下，$R \times C \le 21$，单轮成对交换仅需检查 $\le 210$ 对槽位，耗时 $< 0.2\text{ ms}$，既能消除“行尾到次行首超长回车斜线”和“隔山打牛穿卡”，又能保持画布紧凑并发挥四向动态端口优势。

### Alternatives Considered
- **方案 B（严格按拓扑深度自上而下分层）**：因卡片宽扁且组与组之间本身纵向叠放，会导致画布过长、左右端口闲置及跨层竖向穿卡，已排除。
- **方案 C（引入外部力导向或 Dagre/ELK 图布局库）**：违反项目宪章第 IV 条“不额外引入图形库”的最小实现约束，且力导向布局缺乏像素级网格对齐感。

---

## 2. 分组外框紧凑化、排列模式精简与既有 `layout.json` 保护

### Decision
1. **移除 `1058px` 硬编码最小组宽**：在 `fillLayout`（针对无已存外框的新分组）与 `relayoutView` 中，分组外框按组内实际节点列数与节点包络紧凑包裹（`left = min(node.x) - 24`，`right = max(node.x + node.width) + 24`，空组兜底 `320px`），使 1 节点组宽约 `284px`、2 节点组宽约 `611px`、3 节点组宽约 `938px`。
2. **移除新建/切换中的 `columns`（多列）模式，保持旧文件兼容读取**：
   - `availableModes(view)` 仅返回 `['vertical', ...(groupCount(view) >= 2 ? ['grid'] : [])]`；
   - `MapHeader.tsx` 仅在 `vertical`（纵向）与 `grid`（田字型）之间循环切换；
   - `validate-layout.ts` 的 `layoutSchema` 仍保留 `'columns'` 枚举以允许无损打开历史保存过 `mode: "columns"` 的 `layout.json`，在 `relayoutView` 中若收到 `'columns'` 则自动归一到 `groupCount(view) >= 2 ? 'grid' : 'vertical'`。
3. **既有 `layout.json` 零静默重排（Clarification Q1）**：
   - `fillLayout` 在 `previous` 已包含该 `viewId` 的节点与分组坐标时，原样保留所有已存 `old.nodes` 和 `old.groups`；
   - 仅当新建导图（`previous === undefined`）、新增视图（`old === undefined`）或用户主动点击“重置排列 / 切换排列模式”（调用 `relayoutView`）时，才对整视图执行二维网格邻接排布与紧凑分组外框计算。

### Rationale
- 单视图限制 $\le 20$ 个节点后，已不可能出现 $\ge 7$ 个分组，`columns` 模式成为无法触发的死分支；
- 保守兼容既有 `layout.json` 符合宪章第 II 条“内容修改不得重置已有布局”及用户确认的 Option A。

### Alternatives Considered
- **打开旧图时自动重排未手动拖拽的节点**：会导致老导图在升级插件后画面位置突变，不符合布局稳定性预期。

---

## 3. 三次贝塞尔连线穿卡检测与控制点绕弧避让

### Decision
保留 HTML v17 基准的三次贝塞尔曲线（`M a C c1 c2 end`）与 `useAnimatedPorts` 的端口滑动动画；在 `connectionGeometry(a, b, self, obstacles)` 中增加轻量级的**中间卡片碰撞检测与控制点法向偏移（Bezier Control-Point Deflection）**：
1. 传入当前视图所有节点矩形 `nodes: Record<string, Rect>`，过滤掉当前连线的起点卡片 `a.nodeId` 与终点卡片 `b.nodeId`。
2. 对默认控制点 `(c1, c2)` 生成的三次贝塞尔曲线在参数 $t \in \{0.2, 0.35, 0.5, 0.65, 0.8\}$ 处采样，检测采样点是否落入任一非端点卡片矩形外扩 `10px` 的包围盒内。
3. 若检测到阻挡卡片：
   - 计算连线弦向量 $\vec{v} = \text{end} - a$ 的单位法向量 $\vec{n}_\perp$；
   - 比较向法向正方向与负方向偏移时远离阻挡卡片中心的净空，选择净空更大（或绕行距离更短）的一侧方向 $s \in \{+1, -1\}$，将 `c1` 与 `c2` 沿 $s \cdot \vec{n}_\perp$ 施加有界法向偏移 $\delta \in [48, 160]\text{ px}$，使曲线从阻挡卡片外侧平滑绕过。
4. `createConnections` 与 `useAnimatedPorts` 均向 `connectionGeometry` 传入 `nodes`，保证静态渲染与端口补间动画帧共用同一条避障弧线，不产生动画跳变。

### Rationale
- 二维网格邻接排布已从源头消除了绝大多数组内穿卡；对于跨组连线或用户手动拖拽后产生的穿卡，控制点法向绕弧能在不破坏 v17 柔和曲线审美的前提下避开卡片文字核心区。

### Alternatives Considered
- **正交圆角折线网格路由（A* 寻路）**：与 v17 的贝塞尔圆润视觉风格不一致，且在拖拽节点实时补间时折线拐点跳变明显。

---

## 4. `/mindmap` 运行时提示词的生成质量加固

### Decision
在不修改 `atlas_*` 工具 Schema 与 `map.json` 字段的前提下，精炼更新 `src/server/prompts/authoring.ts`（并同步 `docs/mindmap-authoring-prompts.md`）：
1. **无前置节点独立性核查（防单根强迫症与防伪连线）**：明确要求建图与扩图时逐个检查入度为 0 的节点（确属独立入口、基础在范围外，还是漏连了关系），允许多个并列起始节点共存，严禁为了凑“唯一根节点”或把图连满而编造 `dependency`。
2. **跨主题“去虚词”质量判据与正反例**：
   - 禁止在 `summary` 和笔记正文中使用“了解 XX / 理解原理 / 掌握用法 / 负责相关处理 / 进行下一步”等不可检验的空话；
   - 按主题给出浓缩正反对比：架构节点写明“职责 + 接口/上下游约束”，流程节点写明“触发条件 + 动作/分支产出”，学习/知识节点写明“核心机制边界 + 可观察的检验标准（如能自己画出/能排查某类典型错误）”。
3. **范围边界与推荐阅读起点**：要求在交付新建或重组的导图时，简明说明本图覆盖范围（含刻意不纳入的范围外内容）与推荐默认阅读起点；明确 AI 生成解释不等于待核实内容已确认。

### Rationale
- 直接解决 AI 生成导图常见的“空话套话”和“强行连成单根树”两大质量通病，同时保持通用思维导图定位，不强加课程专用的五级深度枚举字段。

### Alternatives Considered
- **在 `map.json` 新增必填 `recommendedDepth` / `observableEvidence` 字段**：会破坏架构图与流程图的通用性，且破坏 `schemaVersion: 1` 契约。

---

## 5. 可独立拆分回退的节点详情关系胶囊、连线焦点高亮与选中解耦

### Decision
将“详情内前后关系胶囊”与“收起详情保留画布选中高亮”设计为**与核心排版、提示词、笔记编辑器完全解耦的独立模块**：
1. **独立关系胶囊组件 `src/client/components/NeighborPills.tsx`**：
   - 纯函数 `computeViewNeighbors(map, view, nodeId)` 仅读取当前视图 `view.relationIds`，筛选出两端均在当前视图内（含 `view.centerNodeId`）的直接关联节点，按三类分组：`前置依赖`（入向 `dependency`）、`后续节点`（出向 `dependency`）、`补充关联`（双向 `supplement`）；
   - 点击胶囊时调用 `onSelectNeighbor(targetNodeId)`：在当前视图内将画布相机平滑定位到该节点（若右侧 `NoteInspector` 展开且侧栏较窄，相机横向中心按除去详情面板后的左半可视区域或适度偏移计算，避免目标节点被详情面板完全挡住），并将 `NoteInspector` 切换到该节点详情（`selectedNodeId = targetNodeId, detailHidden = false`），**即使该节点带有 `childViewId` 也不触发子图下钻**；
   - `NoteInspector.tsx` 仅通过单点挂载 `<NeighborPills ... />`，若验收后需打回，移除该挂载行与组件文件即可完全回退。
2. **画布关系焦点高亮（`src/client/components/MapScene.tsx`）**：
   - 提取纯函数 `classifyEdgeFocus(relation, selectedNodeId)`：当画布有选中节点 `selected` 时，直接相连的前置入边、后续出边与补充关联边赋予高亮类名（`edge-focus-in` / `edge-focus-out` / `edge-focus-supplement`，不透明度提升至 `0.95`、线宽微增至 `2.4px`），其余非直接相连的边赋予 `edge-dimmed`（不透明度降至 `0.2`）；当无选中节点时保持原有 `0.76 / 0.58` 默认样式。
3. **“收起详情”与“取消选中”解耦（`ReadingState.detailHidden`）**：
   - 在客户端会话内 `ReadingState`（`src/client/reading-state.ts`，不落盘到 `map.json` 或 `layout.json`）新增可选布尔字段 `detailHidden?: boolean`；
   - 单击画布上无子图节点（或通过菜单“本节笔记”、关系胶囊、搜索定位打开节点）时：`selectedNodeId = id, detailHidden = false`（同时高亮关联连线并展开详情面板）；
   - 点击详情面板关闭按钮 `×`（或在详情面板打开时按一次 `Escape`）：`closeNote()` 仅将 `detailHidden` 设为 `true`，**保留 `selectedNodeId` 不变**，使详情面板收起而画布继续保留该节点选中态与关联边高亮；
   - 当详情面板已收起（`detailHidden === true`）且存在 `selectedNodeId` 时：
     - 再次单击该已选中无子图节点：重新将 `detailHidden` 设为 `false` 展开详情面板；
     - 点击画布空白背景（未发生平移拖拽的轻点）或再按一次 `Escape`：调用 `clearSelection()` 将 `selectedNodeId` 与 `detailHidden` 清空，恢复全图默认连线状态。

### Rationale
- 完全遵循用户在 Clarification Q3/Q4 中指定的 Option A 及“做好可拆分性，可能在验收后打回”的工程约束，所有状态均在客户端内存 `ReadingState` 与独立子组件内闭环。

### Alternatives Considered
- **把关联节点写死进 Markdown 正文**：会导致关系变更时正文失步，且污染用户 Markdown 源文件。
