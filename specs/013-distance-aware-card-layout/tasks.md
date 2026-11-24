---

description: "基于相连节点距离与结构规则的卡片初始排列优化及带子图节点单双击分离任务清单"
---

# Tasks: 基于相连节点距离与结构规则的卡片初始排列优化

**Input**: Design documents from `specs/013-distance-aware-card-layout/`（[spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/distance-layout-interaction.md](contracts/distance-layout-interaction.md)、[quickstart.md](quickstart.md)）

**编号**: 沿用仓库全局唯一任务编号，接续 `012` 的 `T335`，从 **`T336`** 顺序编号至 **`T347`**（共 12 项任务；实现完成与真机/离线 HTML 人工验收分别记录）。标有 `[P]` 的任务可在前置依赖完成后并行，`[US1]`–`[US4]` 对应 [spec.md](spec.md) 中的 4 个用户故事，按优先级（P1 → P2）排列。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（涉及不同文件且无未完成前置依赖）
- **[Story]**: 所属用户故事标签（`[US1]`、`[US2]`、`[US3]`、`[US4]`；Setup、Foundational 与 Polish 阶段不带故事标签）
- 每条任务均包含精确文件路径，并显式引用 [data-model.md](data-model.md) 与 [contracts/distance-layout-interaction.md](contracts/distance-layout-interaction.md) 中的常量、类型、约束与状态流转

## Path Conventions

- **Single project**: 共享排布引擎位于 `src/shared/`，客户端交互组件位于 `src/client/`，回归测试位于 `tests/shared/` 与 `tests/integration/`。
- **零存储变更与既有布局保护约束**: 不修改 `map.json`（`schemaVersion: 1`）与 `layout.json`（`schemaVersion: 1 | 2`）字段结构；已有保存坐标的视图打开时 100% 保留已存 `nodes` 与 `groups` 坐标；零新增外部依赖；不修改 `src/server/` 与 `src/client/offline.tsx`。

---

## Phase 1: Setup（布局常量与向后兼容接口契约建立）

**Purpose**: 在共享布局引擎中建立常量集合与跨组锚点扩展参数契约，确保所有后续排布与测试任务共用统一基准。

- [X] T336 在 `src/shared/layout.ts` 定义布局几何与距离评分常量并扩展 `placeBucketNodes` 公开签名：声明 `CARD_WIDTH = 236`、`COL_STEP = 327`、`ROW_GAP = 32`、`GROUP_PAD_X = 24`、`GROUP_PAD_TOP = 62`、`GROUP_PAD_BOTTOM = 24`、`MIN_ROW_CARD_GAP = 60`（同行最小步距 `MIN_ROW_STEP = 296`）、`DEPENDENCY_WEIGHT = 1.0`、`SUPPLEMENT_WEIGHT = 0.6`、`SNAP_STRAIGHT_THRESHOLD = 48`；导出接口 `AnchorPoint`（`{ x: number; y: number; width: number; height: number }`）与 `BucketPlacementOptions`（`{ anchors?: ReadonlyMap<string, AnchorPoint>; allRelations?: readonly Relation[] }`）；将 `placeBucketNodes(memberIds, relations, heights, viewId, baseX, baseY, options?)` 扩展为接收可选第 7 参数 `options?: BucketPlacementOptions`，严格保持原有 6 参数调用 100% 向后兼容。

---

## Phase 2: Foundational（拓扑深度、弹性候选槽位池与距离-规则混合评分内核）

**Purpose**: 构建支撑组内距离、跨组对齐与分叉汇合居中排布的核心评分与候选槽位设施。

**⚠️ CRITICAL**: User Story 1、User Story 2 与 User Story 3 的排版算法任务均依赖本阶段完成（User Story 4 的前端交互任务可并行推进）。

- [X] T337 在 `src/shared/layout.ts` 实现无连线退化判定、确定性拓扑分层、完整 $R \times 3$ 弹性候选槽位池构造与 `DistanceRuleObjective` 混合评分函数（依赖 T336）：1）仅当既无组内连线也无指向 `options?.anchors` 的跨组连线时，保留纯数组下标从左到右、从上到下的 3 列平铺结果（100% 向后兼容既有孤立节点行为）；2）有组内或跨组连线时，对组内 `dependency` 有向边执行确定性 Kahn 拓扑分层（多入度为 0 节点按度数降序、原 `memberIds` 下标升序破平局；遇环路时按剩余节点最小入度与原下标确定性破环），释放包含居中格与右侧格在内的完整 $R \times 3$ 候选槽位池（`col ∈ {0, 1, ..., columns - 1}`）；3）实现确定性 `DistanceRuleObjective` 目标函数，综合组内连线网格/像素距离 $w_e \cdot (40(dr + dc - 1)^2 + 25 \cdot dr \cdot dc + 0.08|\Delta x_{\text{slot}}|)$、同行/同列夹心直挡重罚（`+500`）、`dependency` 逆流向惩罚（`a.row > b.row` 罚 `+45`，同行逆序罚 `+15`）、四向枢纽居中奖励（`degree >= 3` 且占中列 `-35 * degree`、占内部行 `-20 * degree`）、线段交叉惩罚（`+180`），以及跨组锚点像素加权距离 $w_e \cdot (0.45|\text{centerX}(u) - \text{centerX}(v)| + 0.12|\text{centerY}(u) - \text{centerY}(v)|)$ 与 `<= 48px` 垂直同列对齐奖励（`-28 * w_e`）和跨组上下游流向偏置（`dependency` 权重 `1.0`、`supplement` 权重 `0.6`）。

**Checkpoint**: 弹性候选槽位池与 `DistanceRuleObjective` 混合评分内核就绪，可进入 User Story 实现。

---

## Phase 3: User Story 1 - 跨分组与组内连线距离共同驱动的就近对齐排布 (Priority: P1) 🎯 MVP

**Goal**: 消除分层与多分组导图中“各组孤立盲排”导致的跨组超长对角斜线，让组内连线与跨分组连线距离共同驱动卡片就近列位对齐与紧凑分组包裹。

**Independent Test**: 构造包含 2～4 个上下游分组（含组内无连线但上游最右列连向下游单节点、跨组平行多链、组内与跨组混合连线）的导图，执行 `fillLayout(map, undefined, heights)` 与 `relayoutView`，验证下游卡片自动向对应上游关联列位对齐、跨组连线总长度显著下降且垂直正对形成干净直线，小分组边框按 `284px` / `611px` 紧凑包裹。

### Implementation for User Story 1

- [X] T338 [US1] 在 `src/shared/layout.ts` 的 `placeBucketNodes` 中实现融合跨组锚点距离的 Stage 1 离散槽位寻优（FR-001、FR-002、FR-006、FR-007，依赖 T337）：当存在组内或跨组连线时，生成基于拓扑层级的确定性初始槽位分配（连续长链采用 S 型蛇形折行避免回车长斜线，无组内边但有跨组锚点时按关联锚点期望中心 X 就近映射到初始列位），随后在完整 $R \times 3$ 候选槽位池中执行至多 6 轮确定性最速下降局部寻优——每轮同时枚举“两已占槽位成对交换”与“单节点移入同组未占空槽位”，选取使 `DistanceRuleObjective` 严格降优的最大增益操作；寻优结束后压缩全空中间行并按各行节点实际 `nodeHeight` 最大值加上 `ROW_GAP = 32` 生成确定性 `rowY`，确保单视图 20 节点规模总耗时控制在 `< 2ms` 且 100% 确定无随机性。
- [X] T339 [US1] 在 `src/shared/layout.ts` 的 `fillLayout`（无已存布局视图）与 `relayoutView` 中实现两轮跨组锚点协同排布与紧凑分组包裹（FR-002、FR-006、FR-008，依赖 T338）：在全视图初始排布与重排时，按 `buckets` 顺序进行 Pass-1 前向锚点传播（排布当前分组时将视图内已定位置的上游分组及已定未分组节点写入 `anchors`，连同 `view.relationIds` 过滤后的全视图 `allRelations` 传入 `placeBucketNodes`），首轮全部槽位落定后再对存在跨组拉扯的分组执行 1 轮 Pass-2 反向回看协同微调（保持分组上下相对顺序不变，使上游小分组能呼应下游大分组重心）；保持分组外框按组内节点最终实际坐标包络紧凑计算（`left = Math.min(baseGroupX, ...inside.map(n => n.x - GROUP_PAD_X))`、`right = inside.length ? Math.max(...inside.map(n => n.x + n.width + GROUP_PAD_X)) : baseGroupX + 320`），保证 1/2 节点小分组跟随平移且保持紧凑宽度，绝不引入硬编码 `1058px` 死宽。

**Checkpoint**: User Story 1（MVP：跨组与组内距离协同排布与紧凑包裹）已可独立运行与验证。

---

## Phase 4: User Story 2 - 打破固定满行塞格的弹性层级排布与相连重心微调 (Priority: P1)

**Goal**: 打破“首行必须塞满 3 张卡、末行余卡只能锁死在最左列”的刚性网格规则，支持 `1→2→1` 菱形、`1→3` 一分三、`2→1` 汇合居中对称，并对不满 3 列的行执行基于相连距离的横向重心微调与 `48px` 直线对齐吸附。

**Independent Test**: 构造包含 `1→2→1` 菱形、`1→3` 辐射、`2→1` 汇合与 `5` 节点（前 `3` 后 `2`）的分组，验证分叉起点、汇合终点与末行不满行卡片自动居中或对齐关联邻居的水平重心，上下相邻偏差 `<= 48px` 时精准吸附至同 `x` 触发直线，且任意两卡间无重叠。

### Implementation for User Story 2

- [X] T340 [US2] 在 `src/shared/layout.ts` 的 `placeBucketNodes` 中实现弹性分叉/汇合行分配与 Stage 2 横向重心连续微调及 `48px` 直线吸附（FR-003、FR-004、FR-006、FR-007，依赖 T338）：1）在 Stage 1 槽位初始化前识别组内窄顶/窄底分叉汇合结构（如 `1→2`、`1→3`、`2→1`、`1→2→1` 菱形且拓扑分层行数与紧凑 `ceil(k / 3)` 差 `<= 1` 时按拓扑层级切分初始行并在单卡行优先落入中间列 `(row, col=1)`；纯串联长链维持 3 列 S 型折行不拉成单列竹竿）；2）Stage 1 离散槽位与行高压缩完成后，在 Stage 2 遍历所有节点数 `< columns` 的不满行，对行内每个节点收集不同行（含组内上下行与跨组 `anchors`）直接相连邻居的中心 X，按 `DEPENDENCY_WEIGHT = 1.0` / `SUPPLEMENT_WEIGHT = 0.6` 与垂直近邻加权计算目标水平重心 `x*`，在严格满足走廊边界 `[baseX, baseX + (columns - 1) * COL_STEP]` 与同行节点左到右最小水平步距 `MIN_ROW_STEP = 296`（`CARD_WIDTH 236 + MIN_ROW_CARD_GAP 60`）约束下将 `x` 移向目标位置；3）当调整后节点与上下直接相连邻居的水平偏差 `<= SNAP_STRAIGHT_THRESHOLD (48)` 且吸附后不违反同行最小步距与走廊边界时，精确对齐至邻居 `x` 以在 `012` 路由中生成笔直垂直连线。

**Checkpoint**: User Story 1 与 User Story 2（全部核心排版距优化能力）已完整闭环且可独立验证。

---

## Phase 5: User Story 4 - 带子图节点的单击选中与双击下钻分离操控 (Priority: P1)

**Goal**: 实现带子图节点“单击仅在画布选中并提层高亮关联连线、不弹详情（若已开其他节点详情则自动收起），双击（或 `Enter`）才平滑过渡进入子图”，并保持叶子节点单击直觉、拖拽防误触及桌面侧栏与离线 HTML 完全一致。

**Independent Test**: 在同时含带子图节点 `a` 与叶子节点 `b` 的视图中：先单击 `b` 打开详情再单击 `a`，验证视图保持在 `root`、`a` 被选中且 `.edges-focus` 高亮 `a` 的直接关联边、`.inspector` 自动收起；双击 `a` 验证 0.5 秒进入 `child` 子图；拖拽 `a` 松手 `190ms` 内连带 `click`/`dblclick` 不误触发下钻；在离线 HTML 中行为一致。

### Implementation for User Story 4

- [X] T341 [P] [US4] 在 `src/client/hooks/useReadingNavigation.ts` 中新增并导出 `selectNode(id: string)` 方法（FR-009，Clarification Q1 Option A）：检查 `!reading || navigationBusy.current` 防护，非菜单触发时记录 `focus.current`，将 `ReadingState` 更新为 `{ ...reading, selectedNodeId: id, detailHidden: true, focusSource: id }` 并同步写入 `latestRef.current.reading` 与 `actions.setReading(readingKeyValue, next)`；保持 `viewId`、`cameras` 与 `detailScroll` 不变，确保带子图节点被选中时激活画布焦点高亮且绝不弹出详情面板（若之前打开了其他叶子节点详情则自动收起）。
- [X] T342 [US4] 更新 `src/client/components/NodeCard.tsx`、`src/client/components/MapScene.tsx` 与 `src/client/AtlasPane.tsx` 拆分带子图节点的单击选中与双击下钻交互（FR-009，依赖 T341）：1）在 `AtlasPane.tsx` 向 `<MapScene>` 传入 `onSelect={id => { void doc.guard(() => nav.selectNode(id)) }}`，保持 `onOpen` 负责进入目标子图或打开叶子详情（在 `src/client/offline.tsx` 共用的 `ReadingPane` 内自动双端生效）；2）在 `MapScene.tsx` 的 `SceneHandlers` 与 `SceneNode` 中新增可选 `onSelect?: (id: string) => void` 并透传给 `NodeCard`；3）在 `NodeCard.tsx` 中基于 `drill = !!node.childViewId && node.childViewId !== viewId` 区分交互：`onClick` 在 `drill && onSelect` 时调用 `onSelect()`，否则调用 `onOpen?.()`；新增 `onDoubleClick` 回调，校验 `!locked && performance.now() >= suppressClickUntil.current` 且 `drill` 时调用 `onOpen?.()` 并 `event.stopPropagation()`；在 `onKeyDown` 中令 `Enter` 触发 `onOpen?.()`、`Space` 在 `drill && onSelect` 时触发 `onSelect()`（否则 `onOpen?.()`）；更新 `drill` 态卡片的 `aria-label`（`选中节点，双击进入内部思维导图：${node.title}`）与 `.node-hint` 提示文案（`双击进入子图`）。

**Checkpoint**: User Story 1、User Story 2 与 User Story 4（全部 P1 功能）均已完成并可独立验证。

---

## Phase 6: User Story 3 - 增量新增节点的关联邻居就近补位与双列分组距离协同 (Priority: P2)

**Goal**: 既有已保存布局新增未定位节点时围绕已定位关联邻居按流向就近无碰撞落位（零改动原有坐标）；多分组视图（含双列 `grid` 模式）在分组间协同跨组距离，且既有保存过 `layout.json` 的旧图打开时坐标 100% 保持。

**Independent Test**: 在已手动定位若干节点的视图中增量新增带连线的节点，验证新节点自动落在被连接既有节点附近的最近顺向安全空位（与关联邻居中心距离在 1.5 倍标准步距内且零重叠），老节点与已有分组坐标 100% 不变；对 3～4 个分组含跨组连线的视图执行 `grid` 重排，验证组内与跨列方位协调。

### Implementation for User Story 3

- [X] T343 [US3] 在 `src/shared/layout.ts` 的 `fillLayout` 与 `relayoutView` 中实现增量新增节点关联邻居就近补位与双列 `grid` 分组跨列距离协同（FR-005、FR-006、FR-008，依赖 T339、T340）：1）在 `fillLayout` 中，当视图 `old` 存在已定位节点且 `members` 中有新增未定位节点时，100% 保留所有已存 `old.nodes` 与 `old.groups` 坐标；对每个未定位新节点，在所属分组与全视图 `nodes` 碰撞集内收集已定位直接相连邻居（含 `old.nodes` 与本轮已落位的新节点），按依赖方向优先生成邻居周边 6 向候选坐标（出向顺行优先右侧 `(v.x + COL_STEP, v.y)`、正下方 `(v.x, v.y + hv + ROW_GAP)`、右下、左下等；入向逆行优先左侧、正上方等），按流向优先级、到全部已定位相连邻居的加权距离与组区偏移挑选首个满足水平/垂直 `24px` 净空防重叠约束的安全空位；仅当新节点无任何已定位相连邻居时才回退 `placeBucketNodes` 顺序空位下移；2）在 `relayoutView` 的 `'grid'`（双列田字）模式下，根据各分组预估所属列（`col = index % 2`）与跨组连线目标列偏移构建跨列虚拟锚点，使跨列相连分组的节点倾向各自靠向相邻侧列位，最终按实际包络尺寸完成两列盒排布。

**Checkpoint**: 全部 4 个 User Stories（P1 + P2）已在源码层完整落地。

---

## Phase 7: Polish & Cross-Cutting Concerns（回归测试、构建打包与人工验收）

**Purpose**: 补充覆盖 `SC-001` 至 `SC-005` 的自动化测试，执行工程编译构建与预览包打包检查，并独立记录 DSH Desktop 真机与离线 HTML 人工验收项。

- [X] T344 [P] 扩展 `tests/shared/layout-navigation.test.ts` 覆盖距离-规则混合排版与增量补位验证（SC-001 至 SC-004，依赖 T343）：保留全部既有回归断言（S 型长链、孤立节点原序、环路确定性、枢纽居中、防同行夹心、1/2 节点组宽 `284` / `611`、历史 `columns` 兼容、已有 `previous` 布局 100% 保留及关系胶囊缩放），新增测试用例校验：1）多层无组内边但存在跨分组连线时，下游卡片自动对齐上游最右/中间列关联节点且跨组水平总偏移较盲排下降 `>= 45%`，1 节点小分组保持 `284px` 紧凑包裹；2）`1→2→1` 菱形、`1→3` 一分三与 `3+2` 不满 3 列行自动对齐相连重心（`<= 48px` 精确吸附直线）且所有卡片重叠率为 `0%`；3）已有手动拖动坐标的视图新增带连线节点时自动落在邻居相邻顺向安全空位且老节点坐标零变动；4）20 节点 / 30 边满载含环路视图重复执行 10 次结果 100% 一致且总耗时远低于预算。
- [X] T345 [P] 更新并扩展 `tests/integration/dom.test.ts` 覆盖带子图节点单双击分离交互（SC-005，依赖 T342）：更新既有 DOM 集成流程断言并在 `ReadingPane` / `AtlasPane` 集成测试中验证：1）先单击叶子节点 `[data-node="b"]` 展开 `.inspector`，随后单击带子图节点 `[data-node="a"]`，断言视图保持在 `root`（`readingState().viewId === 'root'`）、`selectedNodeId === 'a'`、`detailHidden === true`、`.inspector` 自动收起，且 `.edges-focus` 挂载并高亮 `[data-relation="ab"][data-focus="out"]`；2）在 `[data-node="a"]` 上触发 `dblclick`（与键盘 `Enter`）后正常下钻进入 `child` 视图；3）拖拽 `[data-node="a"]` 松手后紧随的 `click` / `dblclick` 被 `suppressClickUntil`（190ms）安全拦截，不误触发下钻；4）确认离线导出页面 HTML 同理复用 `ReadingPane` 并保留一致状态机。
- [X] T346 依据 `specs/013-distance-aware-card-layout/quickstart.md` 与 `AGENTS.md` 执行本地工程核验与预览打包（依赖 T344、T345）：运行 `npm.cmd run typecheck` 与 `npm.cmd run build` 校验全仓编译；因本次修改涉及 `src/`，依 `AGENTS.md`《2026-11-24 预览包自动打包约定》先列出 `dist/previews/` 确定最大 `preview.n`、同步更新 `package.json` 与 `package-lock.json` 版本为 `0.4.5-preview.(n+1)` 后执行 `npm.cmd run pack:plugin` 生成不重复预览包（若获用户明确授权运行自动化测试则一并执行 `npm.cmd run test`，否则在交付中明确标注自动化测试与真机 UI 视觉验收为未验证项）；核查 `git status -s` 确认 `map.json` / `layout.json` 存储契约零变更。
- [ ] T347 【人工验收 — 独立记录】由用户在 DSH Desktop 真机（浅色/深色主题）与导出的独立离线 HTML 阅读页中按 `specs/013-distance-aware-card-layout/quickstart.md` 第 2 节逐项复核跨分组对齐与长斜线消除、分叉/汇合与不满行重心居中、新增节点邻居就近补位、带子图节点单击仅画布高亮/双击进入子图（含拖拽防误触与既有详情自动收起）及既有 `layout.json` 坐标 100% 保护（依赖 T346）。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup: `T336`)**: 无前置依赖，可立即开始。
- **Phase 2 (Foundational: `T337`)**: 依赖 `T336`；阻塞布局相关的 User Story 1、2、3。
- **Phase 3 (User Story 1 / MVP: `T338`–`T339`, P1)**: 依赖 Phase 2（`T337 → T338 → T339`，均改 `src/shared/layout.ts` 需串行）。
- **Phase 4 (User Story 2: `T340`, P1)**: 依赖 `T338`（编辑 `src/shared/layout.ts`，在 `T339` 前后串行执行）。
- **Phase 5 (User Story 4: `T341`–`T342`, P1)**: 无对 `src/shared/layout.ts` 的代码依赖！`T341` 可从一开始就与 Phase 1–4 完全 `[P]` 并行；`T342` 依赖 `T341`。
- **Phase 6 (User Story 3: `T343`, P2)**: 依赖 `T339`、`T340`（整合在 `src/shared/layout.ts` 完成全量布局闭环）。
- **Phase 7 (Polish & Manual Acceptance: `T344`–`T347`)**:
  - `T344`（`tests/shared/layout-navigation.test.ts`）依赖 `T343`；
  - `T345`（`tests/integration/dom.test.ts`）依赖 `T342`；二者涉及不同测试文件可 `[P]` 并行；
  - `T346` 依赖 `T344`、`T345`；
  - `T347` 依赖 `T346`（独立记录用户真机与离线 HTML 人工验收）。

### User Story Dependency Graph

```text
Phase 1 (T336) ──► Phase 2 (T337)
                     │
                     ├──► Phase 3: US1 跨组与组内距离对齐 (T338 → T339)          [P1 / MVP]
                     │      │
                     │      └──► Phase 4: US2 弹性层级与重心吸附 (T340)            [P1]
                     │             │
                     │             └──► Phase 6: US3 增量邻居补位与 grid (T343)   [P2] ──► T344 [P]
                     │                                                                         │
Phase 5 (T341 [P] → T342) [P1: US4 单击选中/双击下钻] ──────────────────────────────────► T345 [P]
                                                                                               │
                                                                                               ▼
                                                                                          T346 → T347
```

---

## Parallel Example: Layout Engine vs. Subgraph Click Interaction & Polish

```bash
# 阶段起点：布局引擎与客户端交互完全解耦，以下两条线可同步并行：
Line A (src/shared/layout.ts): Task T336 -> T337 -> T338 -> T339 -> T340 -> T343
Line B (src/client/):          Task T341 [P] -> T342

# Phase 7 回归测试可双文件并行编写：
Task T344: "扩展 tests/shared/layout-navigation.test.ts 覆盖 SC-001 至 SC-004"
Task T345: "更新并扩展 tests/integration/dom.test.ts 覆盖 SC-005"
```

---

## Implementation Strategy

### MVP First (Phase 1–3 + Phase 5)

1. **MVP 布局核心（`T336`–`T339`）**：先打通跨组连线距离感知与组内槽位寻优，消除多分组导图中的跨组超长对角线，独立验证 `SC-001`。
2. **完整 P1 体验（`T340` + `T341`–`T342`）**：补齐 `1→2→1` / `1→3` 弹性重心对齐与直线吸附（`SC-002`），同时交付带子图节点单击仅选中高亮、双击下钻（`SC-005`）。

### Incremental Delivery (Phase 6–7)

3. **P2 增量补位与 `grid` 协同（`T343`）**：加入已存布局新增节点的关联邻居就近顺向补位与双列跨列距离协同，独立验证 `SC-003`。
4. **测试、构建打包与人工交接（`T344`–`T347`）**：并行完成共享层单测与 DOM 集成测试补充，执行 `typecheck`、`build` 与预览包打包（`T346`），最后按 [quickstart.md](quickstart.md) 交付用户真机与离线 HTML 验收（`T347`）。

---

## Notes

- **编号连续性**：全仓任务编号唯一，紧接 `012` 末尾 `T335`，本特性从 `T336` 起连续编排至 `T347`。
- **AGENTS.md 开发与打包约定**：日常开发完成后按要求完成 `typecheck`、`build` 与 `0.4.5-preview.(n+1)` 预览包打包（`T346`），不擅自运行自动化浏览器检查或发布；如获得用户授权再执行 `npm.cmd run test`；实现完成（`T346`）与用户人工验收（`T347`）分开记录。
- **零侵入保障**：`map.json`、`layout.json`、提示词文件、服务端工具及前序未提交修改均不受本任务清单改动范围影响。
