---

description: "导图四向邻接排版、生成质量与详情关系操控优化任务清单"
---

# Tasks: 导图四向邻接排版、生成质量与详情关系操控优化

**Input**: Design documents from `specs/010-layout-authoring-navigation/`（[spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/layout-authoring-navigation.md](contracts/layout-authoring-navigation.md)、[quickstart.md](quickstart.md)）

**编号**: 沿用仓库全局唯一任务编号，接续 `009` 的 `T289`，从 **`T290`** 开始（`T290`–`T305`，共 16 项任务）。标有 `[P]` 的任务可在前置依赖完成后并行，`[US1]`–`[US3]` 对应 [spec.md](spec.md) 中的 3 个用户故事。

**可拆分性说明**: **Phase 5（`[US3]`: `T298`–`T301`）** 为详情关系胶囊、连线焦点高亮与“收起详情保留画布选中”解耦模块，在代码文件与调用点上与 Phase 1–4（排版避让与提示词质量）完全隔离，支持在真机人工验收后按需单独微调或一键回退。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（涉及不同文件且无未完成前置依赖）
- **[Story]**: 所属用户故事标签（`[US1]`、`[US2]`、`[US3]`；Setup、Foundational 与 Polish 阶段不带故事标签）
- 每条任务均包含精确文件路径与 [data-model.md](data-model.md) / [contracts/layout-authoring-navigation.md](contracts/layout-authoring-navigation.md) 中的硬性约束

---

## Phase 1: Setup（排列模式精简与历史布局兼容契约对齐）

**Purpose**: 精简冗余的 `columns`（≥7 组多列）排列模式，同时保持对历史 `layout.json` 中 `"columns"` 枚举值的无损读取兼容。

- [X] T290 在 `src/shared/layout.ts` 与 `src/shared/validate-layout.ts` 中对齐 `LayoutMode` 精简与向后兼容契约：保持 `src/shared/validate-layout.ts` 中 `layoutSchema` 的 `mode: z.enum(['vertical', 'grid', 'columns']).optional()` 不变以确保历史保存过 `mode: "columns"` 的 `layout.json` 校验通过；将 `src/shared/layout.ts` 中的 `availableModes(view)` 修改为仅返回 `['vertical', ...(groupCount(view) >= 2 ? ['grid'] : [])]`（不再返回 `'columns'`），并在 `relayoutView` 开头将传入的遗留 `mode === 'columns'` 自动归一为 `groupCount(view) >= 2 ? 'grid' : 'vertical'`。

---

## Phase 2: Foundational（四向邻接二维网格评分与贝塞尔穿卡避让纯函数）

**Purpose**: 实现供自动布局与连线渲染消费的核心纯算法函数，不破坏任何既有接口签名。

**⚠️ CRITICAL**: User Story 1 的布局与连线集成依赖本阶段完成。

- [X] T291 [P] 在 `src/shared/layout.ts` 中实现组内（及无分组桶）四向端口感知的二维网格邻接槽位分配纯函数 `placeBucketNodes(memberIds: readonly string[], relations: readonly Relation[], heights: Heights, viewId: string, baseX: number, baseY: number): NodeLayout[]`：
  - 网格列数 $C = \min(3, k)$（$k = \text{memberIds.length}$），行数 $R = \lceil k / C \rceil$，列距步长 `327px`，单卡宽 `236px`，行距为前序各行实际最大卡片高度 `+ 32px`；
  - **无内部连线退化保护**：当 `memberIds` 之间不存在任何视图内关系时，严格按原 `memberIds` 下标顺序从左到右、从上到下填入 `(row = Math.floor(i / C), col = i % C)`；
  - **有内部连线时的 S 型拓扑种子 + 局部槽位交换**：
    1. 基于组内 `dependency` 有向边执行确定性 Kahn 拓扑排序（入度并列时按组内总度数降序及原 `memberIds` 下标破平局；环路节点按原下标确定性破环），按 **S 型蛇形折行（偶数行 `col: 0→1→2`，奇数行 `col: C-1→0`）** 填入槽位作为初始种子；
    2. 按 `data-model.md` 的 `AdjacencyScoreModel` 执行最多 6 轮确定性成对槽位交换（Steepest-Descent Pairwise Swap）：最小化相连节点网格曼哈顿距离 $d = |r_u - r_v| + |c_u - c_v|$（`dependency` 权重 `1.0`、`supplement` 权重 `0.6`，$d=1$ 直接上下/左右相邻代价为 `0`），对同行 $|c_u - c_v| = 2$ 且中间格有节点或同列 $|r_u - r_v| \ge 2$ 且中间行同列有节点的**夹心穿卡**施加 `+500` 重罚，对组内度数 $\ge 3$ 的枢纽节点位于内部格（$C=3$ 时 $c_u = 1$）给予 `-35 * deg(u)` 居中奖励以向 `top/right/bottom/left` 四向端口分散连线，对 `dependency` 逆流（$r_u > r_v$）施加 `+45` 惩罚，对网格中心线段严格相交施加 `+180` 惩罚。
- [X] T292 [P] 在 `src/shared/edge-geometry.ts` 中扩展 `connectionGeometry(a: Port, b: Port, self = false, nodes?: Record<string, Rect>)` 实现三次贝塞尔穿卡碰撞检测与控制点法向绕弧避让：
  - 当 `self === true` 或未传入 `nodes` 时，输出与原三次贝塞尔公式 100% 一致；
  - 当传入 `nodes` 时，过滤掉 `a.nodeId` 与 `b.nodeId`，对默认控制点 `(c1, c2)` 在 $t \in \{0.2, 0.35, 0.5, 0.65, 0.8\}$ 采样检测曲线点是否落入任一非端点卡片矩形的核心区；
  - 仅在检测到穿卡阻挡时，沿连线弦向量 $\vec{v} = \text{end} - a$ 的单位法向量 $\vec{n}_\perp$ 选择净空更大的一侧方向 $s \in \{+1, -1\}$，将 `c1` 与 `c2` 同步叠加法向偏移 $\delta \in [48, 160]\text{ px}$ 绕开阻挡卡片；未命中阻挡卡片时输出与无 `nodes` 参数时完全一致（保证 HTML v17 原型视图 parity 测试 100% 通过）。

**Checkpoint**: 二维网格邻接排布与贝塞尔穿卡绕弧纯函数就绪。

---

## Phase 3: User Story 1 - 契合四向动态端口的二维网格邻接排版与紧凑分组 (Priority: P1) 🎯 MVP

**Goal**: 让新建导图、无布局视图以及主动“重置/切换排列”按四向邻接二维网格排布并紧凑包裹分组外框，彻底保护已有 `layout.json` 不被静默重排，同时让画布连线在静态与端口动画下平滑绕开中间阻挡卡片。

**Independent Test**: 构造包含 6 节点串联链、1 对 4 分叉枢纽、同行夹心潜在冲突及 1～2 节点小分组的导图：验证新建与 `relayoutView` 下串联链呈 S 型相邻折行、枢纽节点居中、1 节点分组框宽 `284px`（2 节点分组框宽 `611px`，不再出现 `1058px` 空框）；验证已有 `layout.json` 的导图经 `fillLayout` 打开时节点与分组框坐标 100% 不变；验证中间有阻挡卡片时连线平滑向侧方绕弧。

### Implementation for User Story 1

- [X] T293 [US1] 改造 `src/shared/layout.ts` 中的 `fillLayout` 与 `relayoutView` 接入 `placeBucketNodes`、紧凑分组包络与既有 `layout.json` 保护（依赖 T290、T291）：
  - 在 `fillLayout(map, previous, heights)` 中：
    - 若 `previous` 已包含当前 `view.id` 的 `old` 视图布局，100% 保留 `old.nodes` 中仍存在于 `view.occurrences` 的节点坐标与 `old.groups` 中已存在的分组外框；仅对 `old.nodes` 中缺失的新增节点寻找不重叠空位；
    - 若 `previous === undefined` 或当前 `view.id` 在 `previous` 中尚无记录（新建导图或新增子图），按 `view.relationIds` 提取当前视图可见关系，对每个分组桶（及未分组桶）调用 `placeBucketNodes` 生成四向邻接网格坐标；
    - 对无 `oldGroup` 的分组计算紧凑包络：`left = Math.min(x, ...inside.map(n => n.x - 24))`、`top = Math.min(y, ...inside.map(n => n.y - 62))`、`right = inside.length ? Math.max(...inside.map(n => n.x + n.width + 24)) : x + 320`（移除原 `x + 1058` 常量）、`bottom = Math.max(y + 178, ...inside.map(n => n.y + nodeHeight(heights, view.id, n.nodeId) + 24))`；
  - 在 `relayoutView(map, viewId, mode, heights)` 中：提取当前视图可见关系，对每个分组桶调用 `placeBucketNodes(memberIds, viewRelations, heights, viewId, 24, 62)`，分组盒子宽度按实际占用列数紧凑计算为 `inside.length ? Math.max(...inside.map(n => n.x + n.width)) + 24 : 320`（1 节点组 `284px`、2 节点组 `611px`、3 节点组 `938px`），并按 `vertical`（1 列分组）或 `grid`（2 列分组）排列分组盒子。
- [X] T294 [P] [US1] 在 `src/shared/edge-geometry.ts` 与 `src/client/animate-ports.ts` 中将当前视图 `nodes` 矩形表传入 `connectionGeometry`（依赖 T292）：
  - 在 `src/shared/edge-geometry.ts` 的 `createConnections` 返回段中调用 `connectionGeometry(segment.source, segment.target, segment.self, nodes)`；
  - 在 `src/client/animate-ports.ts` 的 `useAnimatedPorts` 返回段中调用 `connectionGeometry(source, target, segment.self, nodes)`，使端口滑动补间动画与静态帧共享同一避障贝塞尔轨迹。
- [X] T295 [P] [US1] 更新 `src/client/components/MapHeader.tsx` 适配精简后的 `vertical` / `grid` 双排列模式（依赖 T290）：
  - 将 `current` 归一化为 `layoutMode === 'grid' && modes.includes('grid') ? 'grid' : 'vertical'`（平滑兼容旧 `layout.json` 中的 `'columns'` 值）；
  - 精简 `names` 映射与切换按钮内联 SVG 图标分支，仅保留 `vertical`（纵向）与 `grid`（田字型）。

**Checkpoint**: User Story 1（模块 A：四向邻接二维网格排版、紧凑分组框、既有 `layout.json` 保护与贝塞尔穿卡绕弧）已可独立运行与测试。

---

## Phase 4: User Story 2 - 高信号、无伪连线的 AI 导图生成质量控制 (Priority: P1)

**Goal**: 在不改动任何工具 Schema 与存储字段的前提下，通过 `/mindmap` 运行时提示词根治 AI 生成导图时的“凑单根伪连线”与“空话套话摘要/正文”，并要求交待覆盖范围边界与推荐阅读起点。

**Independent Test**: 检查 `src/server/prompts/authoring.ts` 导出的 `mindmapAuthoring` 正文及 `docs/mindmap-authoring-prompts.md`：包含入度为 0 起始节点独立性自检规则、架构/流程/学习三类主题去虚词可检验写法判据（含禁用空话列表），以及范围边界与默认阅读起点反馈要求。

### Implementation for User Story 2

- [X] T296 [P] [US2] 更新 `src/server/prompts/authoring.ts` 中的 `mindmapAuthoring` 提示词正文（FR-005）：
  - 在 `## 组织可读内容` 的关系规则中补充**起始节点独立性自检**：生成或扩展后逐一核对无前置（入度为 0）的节点是确属独立入口、前置在范围外，还是漏连了真实依赖；允许多个合理起始节点并存，严禁为了凑“唯一根节点”或把画布连满而在并列模块间编造 `dependency`；
  - 在 `## 组织可读内容` 的节点与正文规则中补充**跨主题去虚词质量判据**：禁止在 `summary` 或笔记正文中使用“了解 XX / 理解原理 / 掌握用法 / 负责相关处理 / 进行下一步”等不可检验的空泛套话；架构节点须写明核心职责、接口与上下游边界/失效约束，流程节点须写明触发条件、处理动作与分支判据/产出，学习与知识节点须写明核心机制边界与可观察的检验标准（如能自己推导或排查某类典型错误）；
  - 在 `## 保存与反馈` 中补充**范围边界与推荐阅读起点**：新建或重组完成后简明说明本图覆盖范围（含刻意未纳入的外部范围）及推荐的默认阅读起点节点，且明确 AI 生成内容不代表待核实事实已确认。
- [X] T297 [P] [US2] 同步更新 `docs/mindmap-authoring-prompts.md` 中的公共数据格式与生成规则说明（依赖 T296），保持文档与 `src/server/prompts/authoring.ts` 的质量判据一致。

**Checkpoint**: User Story 2（模块 B：`/mindmap` 生成质量提示词加固）已完成且可独立验证。

---

## Phase 5: User Story 3 - 可独立拆分的节点详情前后关系跳转与画布焦点联动操控 (Priority: P2)

**Goal**: 在节点详情面板中提供当前视图内的前置依赖、后续节点与补充关联快捷跳转胶囊（同层居中并切详情，不触发子图下钻），在选中节点时高亮画布直接关联边并降噪背景边，并解耦“收起详情面板（保留画布选中高亮）”与“点击画布空白/再按 Escape（彻底取消选中）”，且全部实现保持高度模块化以便验收后可随时独立回退。

**Independent Test**: 在 DOM 集成测试中打开节点详情：验证 `NeighborPills` 仅列出当前视图 `view.relationIds` 直接关联节点，点击带有 `childViewId` 的相邻节点胶囊仍在当前视图居中并切详情（不下钻子图）；验证选中节点时直接关联边带 `data-focus="in" | "out" | "supplement"` 高亮、无关边带 `data-focus="dimmed"`；验证点击详情面板关闭按钮（或按一次 `Escape`）仅收起详情而保留画布选中与连线高亮，再次点击该节点重新展开详情，点击画布空白处（或再按一次 `Escape`）彻底清除选中。

### Implementation for User Story 3

- [X] T298 [P] [US3] 新建独立组件 `src/client/components/NeighborPills.tsx`（FR-006）：
  - 导出 `computeViewNeighbors(map: KnowledgeMap, view: View, nodeId: string): ViewNeighbors`：仅遍历 `view.relationIds` 中两端均在当前视图内（`view.occurrences` 或 `view.centerNodeId`）的关系，按 `prerequisites`（`type === 'dependency' && toNodeId === nodeId`）、`dependents`（`type === 'dependency' && fromNodeId === nodeId`）、`supplements`（`type === 'supplement' && (fromNodeId === nodeId || toNodeId === nodeId)`）分组并按目标 `nodeId` 去重；
  - 导出 `<NeighborPills map={map} view={view} nodeId={nodeId} onSelect={onSelect} />`：当三组均为空时返回 `null`；非空时渲染 `<section className="neighbor-pills" aria-label="当前视图关联节点">`，按“前置依赖”、“后续节点”、“补充关联”分组渲染 `<button type="button" className="neighbor-pill" data-neighbor-node={item.nodeId} data-neighbor-role={role} onClick={() => onSelect(item.nodeId)}>`。
- [X] T299 [P] [US3] 在 `src/client/components/MapScene.tsx` 中实现选中节点的关系焦点高亮与背景边降噪（FR-007）：
  - 导出纯函数 `classifyEdgeFocus(relation: Relation, selectedNodeId?: string): 'default' | 'in' | 'out' | 'supplement' | 'dimmed'`；
  - 在 `SceneEdge` 中接收 `focusRole`：当 `focusRole === 'default'` 时保持原不透明度（`dependency: 0.76`, `supplement: 0.58`）；当 `focusRole === 'in' | 'out' | 'supplement'` 时设置 `data-focus={focusRole}`、类名 `edge-focus-${focusRole}`、不透明度提升至 `0.96`（`supplement` 为 `0.88`）并将主线 `strokeWidth` 微增 `+0.4`；当 `focusRole === 'dimmed'` 时设置 `data-focus="dimmed"`、类名 `edge-dimmed` 并将不透明度降至 `0.2`。
- [X] T300 [US3] 在 `src/client/reading-state.ts`、`src/client/navigation.ts` 与 `src/client/hooks/useReadingNavigation.ts` 中实现“收起详情保留选中”与“同层关系胶囊居中切换”（FR-006, FR-008，依赖 T298）：
  - 在 `src/client/reading-state.ts` 的 `ReadingLocation` 与 `ReadingState` 接口新增可选字段 `detailHidden?: boolean`，在 `reconcileReading` 中当节点或视图移除时同步清理 `detailHidden: undefined`；
  - 在 `src/client/navigation.ts` 的 `targetReading` 中将返回状态的 `detailHidden` 设为 `false`；
  - 在 `src/client/hooks/useReadingNavigation.ts` 中：
    - `openNote(id)` 设 `selectedNodeId: id, detailHidden: false`；
    - `closeNote()` 改为：当 `reading?.selectedNodeId` 存在时，设 `{ ...reading, detailHidden: true }`（保留 `selectedNodeId` 以维持画布卡片选中态与关联边高亮）并恢复焦点；
    - 新增 `clearSelection()`：当 `reading?.selectedNodeId` 存在时，设 `{ ...reading, selectedNodeId: undefined, detailHidden: undefined }`；
    - 新增 `focusNodeInView(targetNodeId: string)`：获取 `.content-area` 尺寸，扣除右侧展开的 `inspectorWidth` 计算可视画布宽度（`visibleWidth = viewport.width - inspectorWidth >= 180 ? viewport.width - inspectorWidth : viewport.width`），调用 `targetReading(reading, reading.viewId, targetNodeId, layout, heights, { width: visibleWidth, height: viewport.height })` 在当前视图内平滑更新相机居中并切换详情至 `targetNodeId`（`detailHidden: false`），不触发 `childViewId` 跨视图子图下钻。
- [X] T301 [US3] 在 `src/client/components/NoteInspector.tsx`、`src/client/components/MapViewport.tsx`、`src/client/AtlasPane.tsx` 及 `src/client/styles/atlas.css`、`src/client/styles/dark.css` 中接入关系胶囊、画布空白点击清除选中与样式（FR-006, FR-007, FR-008, FR-009，依赖 T298、T299、T300）：
  - 在 `src/client/components/NoteInspector.tsx` 新增可选属性 `onSelectNeighbor?: (nodeId: string) => void`，在 `.inspector-body` 内单点挂载 `{view && onSelectNeighbor && <NeighborPills map={snapshot.map} view={view} nodeId={node.id} onSelect={onSelectNeighbor} />}`；
  - 在 `src/client/components/MapViewport.tsx` 新增可选属性 `onClearSelection?: () => void`，记录背景 `pointerDown` 起始坐标，在 `onPointerUp` 时若指针位移 `Math.hypot(e.clientX - startX, e.clientY - startY) <= 5` 且事件源不在节点卡片/控件上，调用 `onClearSelection?.()`；
  - 在 `src/client/AtlasPane.tsx` 中：
    - 将 `NoteInspector` 显示条件改为 `snapshot && node && reading && !reading.detailHidden && !nav.searchOpen`（`MapScene` 仍传 `selected={reading.selectedNodeId}`）；
    - 向 `NoteInspector` 传入 `onSelectNeighbor={id => { void doc.guard(() => nav.focusNodeInView(id)) }}`；
    - 向 `MapViewport` 传入 `onClearSelection={() => { if (reading.selectedNodeId) void doc.guard(nav.clearSelection) }}`；
    - 在 `onKeyDown` 的 `Escape` 分支中：若 `node && !reading?.detailHidden` 则调用 `void doc.guard(nav.closeNote)` 收起详情；若 `node && reading?.detailHidden` 则调用 `nav.clearSelection()` 彻底取消选中；
  - 在 `src/client/styles/atlas.css` 与 `src/client/styles/dark.css` 中添加 `.neighbor-pills`、`.neighbor-pill-group`、`.neighbor-pill` 以及 `.edge-focus-in`、`.edge-focus-out`、`.edge-focus-supplement`、`.edge-dimmed` 的亮色/暗色主题样式。

**Checkpoint**: User Story 3（模块 C：可独立拆分的详情关系胶囊、连线焦点高亮与选中解耦）已完整接入并同步支持离线 HTML 导出。

---

## Phase 6: Polish & Cross-Cutting Concerns（文档同步、回归测试与构建核验）

**Purpose**: 同步存储格式文档，补齐单元测试与 DOM 集成测试，执行全量静态检查、测试与打包核验。

- [X] T302 [P] 更新 `docs/mindmap-storage-format.md` 中关于 `layout.json` 的字段说明：注明 `views[].mode` 在新建与排列切换中仅使用 `'vertical' | 'grid'`，并对历史文件中的 `'columns'` 值保持向后兼容读取。
- [X] T303 [P] 在 `tests/shared/layout-navigation.test.ts` 与 `tests/shared/prototype-parity.test.ts` 中新增模块 A 自动化单元测试（依赖 T293、T294、T295）：
  - 验证 6 节点串联链（`n1->n2->n3->n4->n5->n6`）在 `fillLayout`（无旧布局）与 `relayoutView` 下呈 S 型蛇形相邻折行（`n3` 与 `n4` 垂直相邻而非跨列大对角），多度枢纽节点自动落入中间列，同行夹心穿卡被消除；
  - 验证 1～2 节点分组的外框宽度紧凑包裹（1 节点组 `284px`、2 节点组 `611px`），且已有 `layout.json` 的视图通过 `fillLayout` 打开时节点与分组框坐标 100% 保持原样；
  - 验证 `availableModes` 仅返回 `['vertical']` 或 `['vertical', 'grid']`，且 `relayoutView` 对遗留 `'columns'` 模式平滑归一；
  - 验证 `connectionGeometry` 在两点间存在中间阻挡卡片时自动将控制点法向偏移绕弧（曲线中点避开阻挡矩形核心区），且无阻挡时 HTML v17 原型视图全部连线断言继续 100% 通过。
- [X] T304 [P] 在 `tests/integration/host-contract.test.ts` 与 `tests/integration/dom.test.ts` 中新增模块 B 与模块 C 集成测试（依赖 T296、T301）：
  - 在 `tests/integration/host-contract.test.ts` 中断言 `mindmapAuthoring` 包含无前置节点独立性自检（禁止凑唯一根节点编造 `dependency`）、跨主题去虚词写作判据及覆盖范围/阅读起点反馈要求；
  - 在 `tests/integration/dom.test.ts` 中断言：打开节点详情时 `NeighborPills` 准确渲染当前视图内的前置依赖、后续节点与补充关联胶囊；点击带 `childViewId` 的相邻节点胶囊在当前视图内切换详情并居中相机（不触发跨视图下钻）；选中节点时关联边带 `data-focus="in" | "out" | "supplement"` 且无关边带 `data-focus="dimmed"`；点击详情关闭按钮（或按一次 `Escape`）仅收起详情并保留画布选中高亮，再次点击该节点重新展开详情，点击画布空白背景（或再按一次 `Escape`）彻底清除选中。
- [ ] T305 执行 `npm.cmd run typecheck`、`npm.cmd run test`、`npm.cmd run build` 与 `npm.cmd run pack:plugin -- --dry-run` 验证全部类型检查、测试套件与构建打包产物无误；检查 `git status -sb` 确认工作区干净可控，并按 [quickstart.md](quickstart.md) 整理真机人工验收交付说明（依赖 T302、T303、T304）。

---

## 2026-11-23 实施记录

- T290–T302：实现与文档已完成；T303–T304：回归测试代码已补充，尚未执行，不代表验收通过。
- T305：类型检查、构建、打包 dry-run 与本地安装包生成已通过；依照用户提供的 AGENTS.md，本轮不运行 `npm.cmd run test`、浏览器、E2E 或视觉验收，故保留未勾选。
- 本地安装包：`dist/previews/xiao-53-dsh-mindmap-0.4.5-preview.1.tgz`（`@xiao-53/dsh-mindmap@0.4.5-preview.1`），仅本地预览候选，未发布。
- 交付与人工检查见 [implementation-status.md](implementation-status.md)。

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup: T290)**: 无前置依赖，可立即执行。
- **Phase 2 (Foundational: T291–T292)**: `T291`（`src/shared/layout.ts`）可在 `T290` 后执行，`T292`（`src/shared/edge-geometry.ts`）无前置依赖，二者可并行。
- **Phase 3 (User Story 1 / 模块 A: T293–T295, P1 🎯 MVP)**:
  - `T293` 依赖 `T290`、`T291`；
  - `T294` 依赖 `T292`；
  - `T295` 依赖 `T290`；
  - `T293`、`T294`、`T295` 涉及不同文件，可并行完成。
- **Phase 4 (User Story 2 / 模块 B: T296–T297, P1)**: 与 Phase 1–3 完全无代码交集，可随时独立或并行推进（`T296 → T297`）。
- **Phase 5 (User Story 3 / 模块 C 可独立回退切片: T298–T301, P2)**:
  - `T298`（`NeighborPills.tsx`）与 `T299`（`MapScene.tsx`）互不依赖且与模块 A/B 无冲突，可完全并行；
  - `T300` 依赖 `T298`；
  - `T301` 依赖 `T298`、`T299`、`T300`。
- **Phase 6 (Polish: T302–T305)**: `T302`、`T303`、`T304` 可在对应模块完成后并行执行，最后统一执行 `T305`。

### User Story Dependency Graph

```text
Phase 1 (T290) ──► Phase 2 (T291, T292 [P])
                     │
                     ├──► Phase 3: US1 四向邻接排版、紧凑分组与贝塞尔避让 (T293, T294 [P], T295 [P]) [模块 A / MVP]
                     │
                     ├──► Phase 4: US2 /mindmap 生成质量提示词加固 (T296 [P] → T297 [P])             [模块 B / 零耦合]
                     │
                     └──► Phase 5: US3 详情关系胶囊、连线焦点高亮与选中解耦 (T298 [P], T299 [P] → T300 → T301) [模块 C / 可独立回退]
                            │
                            └──► Phase 6: Polish 文档、测试与构建核验 (T302 [P], T303 [P], T304 [P] → T305)
```

### Parallel Opportunities

- **跨模块三路并行**:
  - **模块 A（排版与避让）**: `T290 → T291 → T293` // `T292 → T294` // `T295`
  - **模块 B（提示词质量）**: `T296 → T297`
  - **模块 C（详情关系操控）**: `T298` // `T299` → `T300 → T301`
- **测试与文档三路并行**:
  - `T302`（`docs/mindmap-storage-format.md`） // `T303`（`tests/shared/*`） // `T304`（`tests/integration/*`）

---

## Parallel Example: User Story 1 & User Story 3

```bash
# User Story 1 (模块 A) 内可同时推进的独立文件任务：
Task T293: "src/shared/layout.ts 接入 placeBucketNodes、紧凑分组包络与既有 layout.json 保护"
Task T294: "src/shared/edge-geometry.ts 与 src/client/animate-ports.ts 接入穿卡绕弧贝塞尔计算"
Task T295: "src/client/components/MapHeader.tsx 精简为 vertical / grid 双模式循环"

# User Story 3 (模块 C) 内可同时起步的独立组件任务：
Task T298: "新建 src/client/components/NeighborPills.tsx 实现同层直接关联节点胶囊提取与渲染"
Task T299: "src/client/components/MapScene.tsx 实现 classifyEdgeFocus 关联边高亮与非关联边降噪"
```

---

## Implementation Strategy

### MVP First (User Story 1 + User Story 2 — P1 核心排版与生成质量)

1. 完成 **Phase 1 & Phase 2**（`T290`–`T292`）：建立四向邻接二维网格评分与贝塞尔穿卡绕弧纯函数。
2. 完成 **Phase 3 (US1 / 模块 A)**（`T293`–`T295`）：解决现有导图在新建与重置排列下的跨行回车长斜线、同行/同列夹心穿卡、`1058px` 超宽空分组框与冗余 `columns` 模式，同时 100% 保护已有 `layout.json`。
3. 完成 **Phase 4 (US2 / 模块 B)**（`T296`–`T297`）：加固 `/mindmap` 提示词，消除凑单根伪连线与空话摘要。

### Modular Incremental Delivery (User Story 3 — P2 可独立回退操控层)

4. 完成 **Phase 5 (US3 / 模块 C)**（`T298`–`T301`）：以独立组件 `NeighborPills.tsx` 与轻量 `detailHidden` 状态接入详情关系胶囊、连线焦点高亮和收起详情保留选中；若真机验收后需打回，仅需撤回模块 C 涉及的挂载点即可无损保留模块 A 与模块 B。
5. 完成 **Phase 6 (Polish)**（`T302`–`T305`）：补齐全部自动化测试并运行构建打包验证后交付真机验收。
