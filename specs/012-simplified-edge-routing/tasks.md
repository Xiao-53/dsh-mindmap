---

description: "简化节点连线路由、焦点提层与自适应关系胶囊标签任务清单"
---

# Tasks: 简化节点连线路由、焦点提层与自适应关系胶囊标签

**Input**: Design documents from `specs/012-simplified-edge-routing/`（[spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/edge-routing.md](contracts/edge-routing.md)、[quickstart.md](quickstart.md)）

**编号**: 沿用仓库全局唯一任务编号，接续 `011` 的 `T321`，从 **`T322`** 顺序编号至 **`T335`**（共 14 项任务；实现完成与真机/离线 HTML 人工验收分别记录）。标有 `[P]` 的任务可在前置依赖完成后并行，`[US1]`–`[US3]` 对应 [spec.md](spec.md) 中的 3 个用户故事。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（涉及不同文件且无未完成前置依赖）
- **[Story]**: 所属用户故事标签（`[US1]`、`[US2]`、`[US3]`；Setup、Foundational 与 Polish 阶段不带故事标签）
- 每条任务均包含精确文件路径，并显式引用 [data-model.md](data-model.md) 与 [contracts/edge-routing.md](contracts/edge-routing.md) 中的常量、类型与约束

## Path Conventions

- **Single project**: 源代码位于 `src/shared/`、`src/client/`，自动化回归测试位于 `tests/shared/`、`tests/integration/`。
- **零存储变更约束**: 不修改 `map.json`（`schemaVersion: 1`）与 `layout.json`（`schemaVersion: 1 | 2`）字段结构，不改写任何已保存的节点或分组坐标，不新增第三方依赖，不修改 `src/server/`、`src/client/offline.tsx` 与 `src/client/styles/prototype.css`。

---

## Phase 1: Setup（精简模块骨架与清理 `011` 冗余全局避让定义）

**Purpose**: 将 `011` 的 1,980 行重型路由模块清空重建为精简骨架，并对齐公开类型与常量契约。

- [X] T322 重建 `src/shared/edge-routing.ts` 精简骨架并在 `src/shared/edge-geometry.ts` 对齐导出：删除 `011` 全部重型符号 `CardEnvelope`、`SelfCardGuard`、`ObstacleCluster`、`PathMetrics`、`CorridorGroup`、`createCardEnvelopes`、`evaluateSpline`、`buildCentripetalSpline`、`routeSingleEdge`、`separateSharedCorridors`；在 `src/shared/edge-routing.ts` 定义常量 `SINGLE_SIDE_TOP_OFFSET = 43`、`PORT_INSET_Y = 18`、`PORT_INSET_X = 20`、`STRAIGHT_DEADZONE = 16`、`MIN_STRAIGHT_SPAN = 24`、`MAX_BEZIER_HANDLE = 110`、`MAX_ARCH_HANDLE = 148`、`HEAD_ON_ENTER_DEPTH = 18`、`HEAD_ON_EXIT_DEPTH = 6`、`ARCH_HYSTERESIS = 24`、`PILL_MAX_WIDTH = 132`、`PILL_HEIGHT = 22`、`PILL_CARD_MARGIN = 4`、`PILL_CANDIDATE_T = [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8]` 及类型 `Point`、`Box`、`Cubic`、`EdgeCurve`（`kind: 'straight' | 'cubic' | 'self'`、`segments`、`d`、`defaultLabel`）、`PortEndpoints`、`InlineArchSpec`、`EdgeRouteHint`（`sourceSide`/`targetSide`/`archActive?`）、`RoutingOptions`（`hints?`/`dragging?`/`outHints?`）、`PlacedPillBox`、`RoutedSegment`；`src/shared/edge-geometry.ts` 完整保留 `PORT_RADIUS = 3.5`、`INPUT_PORT_STROKE = 1`、`OUTPUT_PORT_STROKE = 2`、`ARROW_LENGTH = 8`、`ARROW_HALF_WIDTH = 3.5`、`Rect`、`Port`、`edgeGeometry` 不变，`RoutedSegment` 保持 `{ relation, source, target, vertical, self, d, arrow, stem, label }` 形状向后兼容。

---

## Phase 2: Foundational（法线、终点箭头几何与曲线求值内核）

**Purpose**: 实现支撑所有用户故事的端口外法线、箭头/短接段几何与 $O(1)$ 曲线求值，对应 Q3 Option A 的顺线箭头对接。

**⚠️ CRITICAL**: User Story 1、2、3 的曲线构造、拱桥与胶囊定位均依赖本阶段完成。

- [X] T323 在 `src/shared/edge-routing.ts` 中实现 `sideNormal(side)`、`computePortEndpoints(a, b, straightDir?)` 与 `evalCurvePoint(curve, t)`（依赖 T322）：`computePortEndpoints` 默认沿目标端口外法线 `ut` 对接箭头（箭头尖端停靠输入圆外沿 `INPUT_PORT_OUTER_RADIUS = 4px`、`ARROW_LENGTH = 8px`、`ARROW_HALF_WIDTH = 3.5px`、`STEM_LENGTH = 3px`），当传入 `straightDir`（直线模式沿 `normalize(b - a)`）时，终点 `pe = b - straightDir * (4 + 8 + 3)` 并让箭头与 `3px` stem 顺沿该直线方向微调（Q3 Option A，零折角）；`evalCurvePoint` 对直线与单/双段三次贝塞尔按 $t \in [0, 1]$ 做 $O(1)$ 求值；所有坐标经 `finite()` 兜底，不得产生 `NaN` 或 `Infinity`。

**Checkpoint**: 法线、箭头对接与曲线求值内核就绪，可进入 User Story 实现。

---

## Phase 3: User Story 1 - 该直则直、该弯克制、允许穿底的简洁连线呈现 (Priority: P1) 🎯 MVP

**Goal**: 同排/同列相邻卡片在高度不一、多端口对单端口或小幅错位时呈干净直线；跨行跨列与远距曲线为单段受控弧度、无折角无大鼓包，并允许局部从无关卡片下方穿过；自环清晰独立。

**Independent Test**: 构造覆盖“同排高度不等串联卡片”、“一侧双端口对接对侧单端口”、“16px 内面对面微错位”、“跨行跨列斜向与长距离连线”、“途中被无关卡片遮挡的斜连线”与“自环”的标准视图，核查直线类边 100% 为纯直线且箭头与直线共线、曲线类边非自环严格 1 段无折角无多段波浪。

### Implementation for User Story 1

- [X] T324 [US1] 在 `src/shared/edge-routing.ts` 中实现 `buildEdgeCurve(a, b, self, archClearance?)`（FR-001、FR-002、FR-003、FR-010，依赖 T323）：1）自环（`self === true`）保留卡片右侧外伸 2 段平滑回环，水平出射、水平汇入；2）面对面（`dotN < -0.5`）且 `dParallel >= MIN_STRAIGHT_SPAN(24)` 与 `dPerp <= STRAIGHT_DEADZONE(16)` 时输出直线 `M.. L..` 并返回 `straightDir = normalize(b - a)`；3）面对面其余输出 1 段 $G^1$ 三次贝塞尔，正向 `handle = clamp(dParallel * 0.42, 24, MAX_BEZIER_HANDLE=110)`，反向/重叠 `handle = clamp(32 + Math.sqrt(Math.abs(dParallel) * 18) + dPerp * 0.15, 42, 120)`；4）邻边转角（`|dotN| <= 0.5`）取 `hs = clamp(Math.max(0.55 * pS, 0.25 * L), 22, 110)`、`he = clamp(Math.max(0.55 * pT, 0.25 * L), 22, 110)`；5）同侧拱桥（`dotN > 0.5`）取 `a0 = clamp(0.18 * lPerp + 26, 36, 92)`，若传入 `archClearance` 则 `baseH = Math.max(a0, (4 / 3) * (archClearance + 14))` 并封顶 `MAX_ARCH_HANDLE = 148`，再补平出射高度差 `hs = baseH + Math.max(0, dOut)`、`he = baseH + Math.max(0, -dOut)`；非自环严格 1 段，首末控制点锁定在端口外法线射线上。
- [X] T325 [US1] 更新 `src/shared/edge-geometry.ts` 端口分配与批量路由（FR-001、FR-002、FR-003、FR-008、FR-010，依赖 T324）：1）`place(group)` 中左右侧单端口（`group.length === 1`）默认 `y = node.y + clamp(SINGLE_SIDE_TOP_OFFSET(43), insetY, node.height - insetY)`（`insetY = Math.min(node.height / 4, 18)`，Q2 Option A），上下侧单端口保持 `width / 2`，多端口保持既有 `17px`/`24px` 等距步距；2）在 `!order` 分支 `place(group)` 之后新增 `alignSinglePorts`：对面对面（`left↔right` 或 `top↔bottom`）且 `!self` 的边，当一侧 `group.length === 1`、对端端口自由轴坐标落在其安全区间 `[min + inset, max - inset]` 内时，将单端口投影对齐到对端坐标；双端均为单端口时优先将目标对齐到起点（起点无法覆盖时再反向）；跨行斜边的对端坐标越出安全区时不得吸入角落；3）将 `routeSegments`、`connectionGeometry` 切换到 `buildEdgeCurve` + `computePortEndpoints`（直线模式传入 `straightDir`），移除对 `createCardEnvelopes`、`routeSingleEdge`、`separateSharedCorridors`、`pickLabelAnchor` 的引用。

**Checkpoint**: User Story 1（MVP：直线化、受控单段曲线、穿底与自环）已可独立运行与验证。

---

## Phase 4: User Story 2 - 轻量同排/同列隔卡直连拱桥与选中提层高亮 (Priority: P1)

**Goal**: 仅同排/同列面对面直连被中间卡正面整卡堵死时改走同侧单段对称拱桥；常态连线位于卡片下层，仅单击选中节点时直接关联连线提层到卡片上方高亮，悬停不触发。

**Independent Test**: 在“同排三卡首尾直连”、“同列三卡首尾直连”、“普通斜向穿底连线”及“点击选中/取消选中/鼠标悬停”的视图中验证：仅正面直挡边转为同侧拱桥；选中节点时关联边浮升到卡片之上、取消后退回底层、悬停不跳层。

### Implementation for User Story 2

- [X] T326 [US2] 在 `src/shared/edge-routing.ts` 实现纯矩形 `selectInlineBlockedSides(specs, nodes, options?)` 并在 `src/shared/edge-geometry.ts` 的 `createConnections` 端口分配阶段调用（FR-004、FR-009，依赖 T325）：仅在 `!order && !self`、初选为面对面端口、两卡同排/同列正对（投影重叠 `>= 0` 或中心差 `<= 0.5 * Math.min(dimA, dimB)`）且存在严格位于两卡之间的中间卡正面深度直挡直连走廊（侵入深度 `>= Math.min(HEAD_ON_ENTER_DEPTH(18), 0.25 * obsDim)`；`dragging` 且 `prevHint?.archActive` 时保持门槛放宽为 `>= HEAD_ON_EXIT_DEPTH(6)`）时，评估水平 `top→top` / `bottom→bottom`（垂直 `left→left` / `right→right`）；按外伸 `archClearance` 加邻近卡数量择优（平手优先 `top` / `left`），拖拽期间对背离上一帧 `prevHint.sourceSide` 的对侧施加 `ARCH_HYSTERESIS = 24` 缓冲；轻微擦边与斜向边绝不换边；全程仅做矩形区间比较，不做曲线采样；写入 `sourceSide`、`targetSide`、`archClearance` 与 `hints[relationId].archActive`。
- [X] T327 [US2] 更新 `src/client/components/MapScene.tsx` 拆分连线图层并实现仅单击提层（FR-005、FR-012，Q1 Option A，依赖 T325）：将现有 `<svg className="edges">` 改为 `<svg className="edges edges-base" aria-hidden="true">`（渲染 `focusRole === 'default' | 'dimmed'` 的连线），并在节点卡片之后仅当 `selected` 非空且存在 `focusRole === 'in' | 'out' | 'supplement'` 的连线时挂载 `<svg className="edges edges-focus" aria-hidden="true">` 渲染高亮连线；严禁为 `.node`、连线或胶囊绑定任何 `onMouseEnter` / `:hover` 提层逻辑；保留 `classifyEdgeFocus`、`routeHintsRef` 渲染期读取与 `useLayoutEffect` 回写、`<svg className="atlas-ports">` 端口层及 `SceneEdge` 既有配色。

**Checkpoint**: User Story 1 与 User Story 2（全部 P1 能力：直线化、受控曲线、隔卡拱桥与仅单击提层）已完整闭环且可独立测试。

---

## Phase 5: User Story 3 - 沿线自动避卡滑动的关系胶囊标签与丝滑交互稳定性 (Priority: P2)

**Goal**: 关系名称改为卡片之上、端口之下的圆角胶囊，沿线 7 点自动避开卡片与已放胶囊，极短边居中截断并悬停显示全文；拖拽与端口动画全程流畅不崩溃，浅/深主题与焦点联动，离线 HTML 一致。

**Independent Test**: 在含多种长度标签与 40 节点 / 60+ 边视图中验证：胶囊避卡（常规 `>= 95%`）、极短边居中截断且 `title` 提示完整文字、选中联动高亮/淡化、持续拖拽 30 秒零崩溃零卡顿、历史布局坐标与离线导出一致。

### Implementation for User Story 3

- [X] T328 [US3] 在 `src/shared/edge-routing.ts` 实现 `pickPillAnchor(curve, labelText, nodes, placedPills?)` 并接入 `src/shared/edge-geometry.ts` 的 `routeSegments`（FR-007、FR-008，依赖 T323、T325）：仅当 `labelText?.trim()` 非空时执行；按全角 `11px` / 半角 `6.5px` 估算 `boxW = clamp(estWidth + 18, 36, PILL_MAX_WIDTH(132))`、`boxH = PILL_HEIGHT(22)`；依次探测 `PILL_CANDIDATE_T = [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8]`，以 `evalCurvePoint` 取点，外扩 `PILL_CARD_MARGIN = 4` 与视图内全部卡片矩形及 `placedPills` 做 AABB 相交检测；取第一个与卡片及已放胶囊均无重叠的候选，若仅与已放胶囊重叠则取重叠面积最小者，7 点全部压卡（极短边）时回退居中 `t = 0.5`；将结果写入 `RoutedSegment.label` 并累积 `PlacedPillBox`。
- [X] T329 [P] [US3] 更新 `src/client/animate-ports.ts`（FR-009、FR-011，依赖 T326、T328）：为 `offset` / `place` 增加 `rect.width <= 0 || rect.height <= 0` 保护避免除零 `NaN`，动画帧继续调用轻量 `routeSegments(interpolated, nodes, options)` 并返回 `{ ports, segments, hints }`，保持 180ms 沿卡片边缘滑动动画与 `routeSegments` 单边 $O(1)$ 计算，确保拖拽与端口滑动期间连线、圆点与胶囊同步无闪回。
- [X] T330 [US3] 更新 `src/client/components/MapScene.tsx` 将 SVG 文字标签替换为 HTML 胶囊（FR-006、FR-007、FR-012，依赖 T327、T328）：移除 `SceneEdge` 内 `<text className="edge-label">`，在 `.edges-focus` 之后、`.atlas-ports` 之前新增 `<div className="edge-labels" aria-hidden="true">`，仅对 `segment.relation.label?.trim()` 非空的连线渲染 `memo` 化 `<ScenePill>`（`<span className="edge-pill">`），设置 `data-relation={r.id}`、`data-focus={focusRole === 'default' ? undefined : focusRole}`、`title={r.label}`、`style={{ left: segment.label.x, top: segment.label.y }}`，并按 `secondary` / `is-focused`（`in`、`out`、`supplement`）/ `is-dimmed` 同步类名。
- [X] T331 [P] [US3] 更新 `src/client/styles/atlas.css` 与 `src/client/styles/dark.css`（FR-005、FR-006、FR-007、FR-012，依赖 T327）：新增 `.dsh-atlas .edges-base { z-index: 1 }`、`.dsh-atlas .edges-focus { z-index: 5 }`、`.dsh-atlas .edge-labels { position: absolute; inset: 0; pointer-events: none; overflow: visible; z-index: 6 }`；`.dsh-atlas .edge-pill` 采用暖纸浅色（`background: rgba(255, 253, 248, 0.94)`、`border: 1px solid #dfd6c7`、`color: #6b6154`、轻阴影）与暗色（`background: rgba(37, 35, 31, 0.94)`、`border: 1px solid #443e35`、`color: #cfc4b3`）双主题，`transform: translate(-50%, -50%); max-width: 132px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: auto; cursor: default`；`.edge-pill.is-focused` 取 `z-index: 7` 并边框/文字绑定 `var(--edge-primary)`（`secondary` 用 `var(--edge-secondary)`），`.edge-pill.is-dimmed` 取 `opacity: 0.22; pointer-events: none`；删除或停用旧 `.edge-label` 规则；补充 `prefers-reduced-motion` 下关闭胶囊过渡；确认不与 `src/client/styles/prototype.css` 的 `.edges` 规则冲突。

**Checkpoint**: 全部 3 个 User Stories（含 P2 胶囊避卡、提层联动与稳定性）已完整集成。

---

## Phase 6: Polish & Cross-Cutting Concerns（回归测试重写、构建打包与人工验收）

**Purpose**: 重写覆盖 `SC-001` 至 `SC-006` 的自动化测试，执行静态检查、构建与打包验证，并记录真机与离线 HTML 人工验收项。

- [X] T332 [P] 重写 `tests/shared/edge-routing.test.ts` 覆盖 `SC-001` 至 `SC-006`（依赖 T328）：移除对已删除符号的引用；校验 ≥ 12 组同排高度不一串联、多端口对单端口、16px 内小错位直连均输出纯直线 `M.. L..` 且箭头方向与直线夹角 `< 0.01°`，跨行大斜边不被吸入卡片角落；校验 ≥ 15 组跨行/跨列/远距/反向回环/穿无关卡片斜连与自环中非自环严格 1 段（0 条多段波浪）、非直线端切向与端口法线误差 `< 0.01°`、正向控制臂 `<= 110`；校验同排/同列正面直挡转同侧单段拱桥、斜向与擦边不换边、拖拽进出滞回切换 `<= 1` 次；校验胶囊 7 点避卡与极短边居中回退；校验零尺寸/重叠卡片零 `NaN`、40 节点 60+ 边批量耗时远低于帧预算且零修改输入节点坐标。
- [X] T333 [P] 更新 `tests/shared/prototype-parity.test.ts` 并在 `tests/integration/dom.test.ts` 补充断言（依赖 T329、T330、T331）：`prototype-parity.test.ts` 移除对 `createCardEnvelopes`、`evaluateSpline` 的引用与“跨卡绝不穿框”断言，保留 v17 全视图端口选边唯一性、端口坐标唯一、箭头/`stem` 合法、无折角及自环独立端口校验，对同排/同列正面直挡边断言转为单段拱桥；`dom.test.ts` 验证渲染含 `.edges-base`、`.edge-labels` 及带 `title` 的 `.edge-pill`，选中节点时挂载 `.edges-focus` 且关联胶囊含 `is-focused`，未选中时不存在 `.edges-focus`，并验证离线导出同样包含上述结构。
- [X] T334 依据 `specs/012-simplified-edge-routing/quickstart.md` 执行本地工程核验与产物打包检查（依赖 T332、T333）：运行 `npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd run pack:plugin -- --dry-run`（若用户明确授权运行自动化测试则一并执行 `npm.cmd run test`，否则按 `AGENTS.md` 约定记录测试代码已就绪但未自主执行），核查 `git status --short` 确认 `map.json` / `layout.json` 存储契约零变更且未影响无关工作区修改，整理交付与未验证项说明。
- [ ] T335 【人工验收 — 独立记录】由用户在 DSH Desktop 真机（浅色/深色主题）与导出的独立离线 HTML 阅读页中按 `specs/012-simplified-edge-routing/quickstart.md` 第 2 节逐项复核同排直连与高矮/多端口对齐、跨行跨列曲线弧度与穿底观感、同排/同列隔卡拱桥、仅单击选中提层（悬停不跳层）、关系胶囊避卡与短边截断、40 节点持续拖拽流畅度及历史 `layout.json` 坐标 100% 保持（依赖 T334）。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup: `T322`)**: 无前置依赖，可立即开始。
- **Phase 2 (Foundational: `T323`)**: 依赖 `T322`；阻塞全部用户故事。
- **Phase 3 (User Story 1 / MVP: `T324`–`T325`, P1)**: 依赖 Phase 2；`T324`（`edge-routing.ts`）→ `T325`（`edge-geometry.ts`）。
- **Phase 4 (User Story 2: `T326`–`T327`, P1)**: `T326` 依赖 `T325`（同改 `edge-geometry.ts` 需串行）；`T327` 仅依赖 `T325` 且改 `MapScene.tsx`，可与 `T326` 并行推进。
- **Phase 5 (User Story 3: `T328`–`T331`, P2)**:
  - `T328` 依赖 `T323`、`T325`；
  - `T329`（`animate-ports.ts`）依赖 `T326`、`T328`，与 `T331` 不同文件可 `[P]` 并行；
  - `T330`（`MapScene.tsx`）依赖 `T327`、`T328`（与 `T327` 同文件需串行）；
  - `T331`（两份 CSS）仅依赖 `T327`，可与 `T329` `[P]` 并行。
- **Phase 6 (Polish & Manual Acceptance: `T332`–`T335`)**:
  - `T332` 依赖 `T328`，`T333` 依赖 `T329`、`T330`、`T331`，二者不同文件可 `[P]` 并行；
  - `T334` 依赖 `T332`、`T333`；
  - `T335` 依赖 `T334`（独立记录用户真机与离线 HTML 人工验收）。

### User Story Dependency Graph

```text
Phase 1 (T322) ──► Phase 2 (T323)
                     │
                     ├──► Phase 3: US1 直线化 + 受控单段曲线 + 穿底 (T324 → T325)            [P1 / MVP]
                     │      │
                     │      ├──► Phase 4: US2 隔卡拱桥 (T326) // 单击提层图层 (T327)          [P1]
                     │      │
                     │      └──► Phase 5: US3 胶囊定位 (T328) → 胶囊渲染 (T330)
                     │                     动画保护 (T329 [P]) // 主题样式 (T331 [P])          [P2]
                     │
                     └──────────────► Phase 6: 测试重写 (T332 [P] // T333 [P]) → T334 → T335
```

---

## Parallel Example: User Story 3 & Polish

```bash
# Phase 5 中 T328 与 T327 完成后，以下两项涉及不同文件可并行：
Task T329: "更新 src/client/animate-ports.ts 增加零尺寸保护并衔接轻量 routeSegments"
Task T331: "更新 src/client/styles/atlas.css 与 dark.css 落地分层与 .edge-pill 样式"

# Phase 6 回归测试可双文件并行编写：
Task T332: "重写 tests/shared/edge-routing.test.ts 覆盖 SC-001 至 SC-006"
Task T333: "更新 tests/shared/prototype-parity.test.ts 并补充 tests/integration/dom.test.ts 断言"
```

---

## Implementation Strategy

### MVP First (Phase 1–3)

1. **最小视觉闭环（`T322`–`T325`）**：先瘦身 `edge-routing.ts` 并交付直线化、顶距基准、单端口投影对齐与限幅单段曲线，立即消除“该直的地方弯”与过度避让大弯，独立验证 `SC-001`、`SC-002`。
2. **完整 P1（`T326`–`T327`）**：加入轻量隔卡拱桥与仅单击提层的双图层，独立验证 `SC-003`。

### Incremental Delivery (Phase 5–6)

3. **P2 胶囊与稳定性（`T328`–`T331`）**：落地沿线 7 点避卡胶囊、浅/深主题样式、动画零尺寸保护，独立验证 `SC-004`、`SC-005`。
4. **验证与人工交付（`T332`–`T335`）**：并行重写测试后执行静态构建打包校验，最后按 `quickstart.md` 交由用户在 DSH Desktop 真机与离线 HTML 中复核 `T335`。

---

## Notes

- **编号连续性**：全仓任务编号唯一，紧接 `011` 末尾 `T321`，本特性从 `T322` 起连续编排至 `T335`。
- **AGENTS.md 开发约定**：UI/视觉与浏览器测试需在用户明确要求时由 Agent 执行自动化验证；日常开发仅完成代码、测试代码编写与 `typecheck` / `build` / `pack:plugin -- --dry-run` 构建检查；实现完成与人工验收在 `T334` / `T335` 分别记录。
- **取代关系**：本任务清单取代 `specs/011-edge-curve-avoidance/tasks.md` 中尚未完成的全局避让实现任务，其复杂路由实现不再继续推进。
- **零侵入保障**：`map.json`、`layout.json`、提示词文件、服务端工具及 `010` 未提交修改均不受本任务列表改动范围影响。
