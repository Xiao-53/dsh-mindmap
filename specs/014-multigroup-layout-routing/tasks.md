---

description: "多分组跨组卡片排版与连线路由深度优化任务清单"
---

# Tasks: 多分组跨组卡片排版与连线路由深度优化

**Input**: Design documents from `specs/014-multigroup-layout-routing/`（[spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/multigroup-layout-routing.md](contracts/multigroup-layout-routing.md)、[quickstart.md](quickstart.md)）

**编号**: 沿用仓库全局唯一任务编号，接续 `013` 的 `T347`，从 **`T348`** 顺序编号至 **`T367`**（共 20 项任务；`T366` 工程校验打包与 `T367` 真机/离线 HTML 人工验收分别独立记录）。标有 `[P]` 的任务可在前置依赖完成后并行，`[US1]`–`[US5]` 对应 [spec.md](spec.md) 中的 5 个用户故事（按 P1 → P2 优先级编排）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（涉及不同文件且无未完成前置依赖）
- **[Story]**: 所属用户故事标签（`[US1]`–`[US5]`；Setup、Foundational 与 Polish 阶段不带故事标签）
- 每条任务均包含精确文件路径，并直接引用 [data-model.md](data-model.md) 与 [contracts/multigroup-layout-routing.md](contracts/multigroup-layout-routing.md) 中的常量、接口签名、公式及约束

## Path Conventions

- **Single project**: 共享引擎位于 `src/shared/`，客户端交互与样式位于 `src/client/`，单测与集成测试位于 `tests/shared/` 与 `tests/integration/`。
- **零存储变更与既有布局保护约束**: 不修改 `map.json`（`schemaVersion: 1`）与 `layout.json`（`schemaVersion: 1 | 2`）字段结构；不修改 `src/server/` 与 `src/client/offline.tsx`；零新增外部依赖；打开既有布局时 100% 保留已存 `nodes` 与 `groups` 坐标。

---

## Phase 1: Setup（接口契约、常量与共享数据结构准备）

**Purpose**: 在共享路由与排版引擎中建立扩展接口、常量定义与向后兼容契约，为并行推进“布局引擎线”与“局部路由线”奠定一致基础。

- [X] T348 [P] 在 `src/shared/edge-routing.ts` 补充并导出新路由常量与扩展接口契约（参照 [data-model.md](data-model.md) 2.2 节与 [contracts/multigroup-layout-routing.md](contracts/multigroup-layout-routing.md) 2.1 节）：保留全部既有导出常量（`SINGLE_SIDE_TOP_OFFSET = 43`、`STRAIGHT_DEADZONE = 16` 等），新增导出 `BIDIR_SLOPE_ENTER = 24`、`BIDIR_SLOPE_EXIT = 12`、`ARCH_LANE_STEP = 24`、`MAX_ARCH_LANE_HANDLE = 180`、`ARCH_LANE_SPAN_MARGIN = 8`、`OUTER_SPAN_MARGIN = 16`、`PARALLEL_BIAS_MIN_PERP = 32`、`PARALLEL_BIAS_MAX = 18`、`TOP_ARCH_GROUP_PROXIMITY = 80`、`TOP_ARCH_GROUP_PENALTY = 60`、`TOP_ARCH_TITLE_CLEARANCE = 36`、`CANVAS_TOP_ARCH_MARGIN = 14`、`CANVAS_LEFT_ARCH_MARGIN = 10`、`PILL_PORT_MARGIN = 5`、`SHORT_HORIZ_MIN_SPAN = 40`、`SHORT_HORIZ_MAX_SPAN = 120`、`SHORT_VERT_MAX_SPAN = 60`、`SIDE_SADDLE_GAP = 10`；将 `PILL_CANDIDATE_T` 扩展为 `[0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8, 0.14, 0.86]`；在 `EdgeRouteHint` 新增可选 `bidirFlipped?: boolean`，在 `RoutingOptions` 新增可选 `groups?: readonly Rect[]`，在 `InlineArchSpec` 新增可选 `archLane?: number`，在 `RoutedSegment` 新增可选 `archLane?: number`、`hsBias?: number`、`heBias?: number`、`bidirFlipped?: boolean`，并导出 `PillPlacement`（`{ x: number; y: number; maxWidth?: number }`）与 `PillPlacementOptions`。
- [X] T349 [P] 在 `src/shared/layout.ts` 定义全局实高评分常量、内部计算数据结构与 `PartialRelayoutOptions` 导出契约（参照 [data-model.md](data-model.md) 2.1/3.1 节与 [contracts/multigroup-layout-routing.md](contracts/multigroup-layout-routing.md) 1.1 节）：保留既有全部导出常量与 `placeBucketNodes`/`fillLayout`/`relayoutView` 公开签名；新增 `PartialRelayoutOptions`（`scope: 'unlocked' | { groupId: string }`、`refitTargetGroup?: boolean`）及 `relayoutViewPartial(map, current, heights, options)` 导出声明；新增全局权重与缓存常量 `OUTER_FEEDBACK_BONUS = -75`、`INTRA_SCC_COHESION_WEIGHT = 18`、`BOUNDARY_PROXIMITY_WEIGHT = 14`、`PIERCE_INNER_VERT_PENALTY = 750`、`PIERCE_HORIZ_PENALTY = 620`、`PIERCE_DIAG_PENALTY = 520`、`LEGAL_OUTER_ARCH_PENALTY = 115`、`STRAIGHT_PROXY_BONUS = -42`、`PROXY_CROSS_PENALTY = 260`、`SAME_COL_VERT_OVERLAP_PENALTY = 800`、`SAME_ROW_HORIZ_OVERLAP_PENALTY = 600`、`SAME_SIDE_ARCH_OVERLAP_PENALTY = 140`、`PINNED_OVERLAP_PENALTY = 5000`、`DIRTY_BBOX_EXPAND = 24`，并将 `OUT_OF_GROUP_PENALTY` 升级为 `420`；声明内部接口 `CycleDecomposition`、`ProxyEdgeGeometry` 与 `IncrementalEvalCache`。

**Checkpoint**: 两个共享模块契约与常量全部就绪；此后“全局布局线（`src/shared/layout.ts`）”与“局部路由线（`src/shared/edge-routing.ts`）”可独立并行推进。

---

## Phase 2: Foundational（实高几何重建、闭式曲线代理与增量评分内核）

**Purpose**: 在 `src/shared/layout.ts` 建立“消除排版与路由两张皮”的统一实高几何底座与脏边缓存框架，阻塞后续 `US1`、`US2` 与 `US5` 排版任务。

**⚠️ CRITICAL**: User Story 1、User Story 2 与 User Story 5 依赖本阶段完成；User Story 3（路由线 `T356`–`T358`）可与本阶段并行推进。

- [X] T350 在 `src/shared/layout.ts` 实现 `computeViewGeometry` 实高矩形重建及 $O(1)$ 解析穿卡/交叉几何工具（FR-001，依赖 T349）：1）封装 `computeViewGeometry` 根据每个分桶的当前离散行分布实时读取 `nodeHeight(heights, viewId, nodeId)` 累加行最大高度与 `ROW_GAP = 32`（支持 `vertical` 统一左起 `42` 堆叠与 `grid` 按真实两列组宽计算 `colLefts`、`rowTops`），完全替代 `row * 162` 与 `130px` 硬编码估算，并支持候选试探期冻结非活动分桶顶边原点的“刚性位移冻结”模式；2）实现基于 Liang-Barsky 算法的 $O(1)$ 解析线段-矩形相交判定（对非端点卡片四边向内缩进 `4px` 判定有效穿刺）及带 AABB 包围盒预剪枝的精确两线段交叉检测函数。
- [X] T351 在 `src/shared/layout.ts` 实现闭式四分位曲线代理 `evalProxyQ25Q75`、全局目标函数 `scoreGlobal` 与脏边矩阵缓存 `IncrementalEvalCache`（FR-001、FR-002、FR-013，依赖 T350）：1）构造与 `edge-geometry.ts`/`edge-routing.ts` 数学同构的 `evalProxyQ25Q75`——按真实矩形中心与 `|dy| > |dx| * 0.55` 判定四向端口，按 `SINGLE_SIDE_TOP_OFFSET = 43` 与单端口投影估算端点，执行单趟跨度感知直挡拱桥判定；满足 `across <= 16 && along >= 24` 时退化为直线段并计入 `STRAIGHT_PROXY_BONUS = -42 * w`，其余生成限幅控制臂（正向封顶 `110`、回环封顶 `120`、拱桥封顶 `148`）并用闭式公式 $Q_{0.25} = (27P_0 + 27C_1 + 9C_2 + P_3)/64$、$Q_{0.75} = (P_0 + 9C_1 + 27C_2 + 27P_3)/64$ 生成 3 段折线 $(P_0, Q_{0.25}, Q_{0.75}, P_3)$ 与包围盒；2）实现完整 7 维度 `scoreGlobal`（顶行重力 `+28 * posRow`、枢纽居中 `-35 * deg` / `-20 * deg`、`useLayeredSeed` 层偏 `+220 * |posRow - layer|`、组内网格距/夹心/逆流、跨组纵向 `0.45|dx|+0.08|dy|+14w*distToBoundary`、双列 `grid` 同排左右 `0.55|dy|+0.35|dx|` / 同列上下 `0.55|dx|+0.15|dy|` / 对角 `0.40|dx|+0.40|dy|`、实高解析穿卡 `+750`/`+620`/`+520` 与合法外拱 `+115/卡`、真实代理交叉 `+260` 与同列竖段重叠 `+800`/同行横段 `+600`/同侧拱桥 `+140`）；3）实现基于扁平 `Float64Array` / `Int32Array` 对称矩阵 `pairCostMat` 与 `DIRTY_BBOX_EXPAND = 24` 的增量脏边重算，且在单视图节点数 `<= 25` 时配置全局上限 `4` 轮 / Sifting `2` 趟，`> 25` 时自动降为全局 `2` 轮 / Sifting `1` 趟。

**Checkpoint**: 实高几何重建、闭式曲线代理与增量评分内核就绪，可进入多分组全局求解与回路拆解实现。

---

## Phase 3: User Story 1 - 真实卡片高度与多分组跨组全局联合排版 (Priority: P1) 🎯 MVP

**Goal**: 用四阶段全视图实高联合求解器取代孤立逐桶局部扫描，打通纵向跨多组跳跃与 `grid` 双列强耦合寻优，同时完整保留离散 3 列对齐、分组叙事顺序与既有回归特性。

**Independent Test**: 构造包含极端变高卡片（86–260px）、纵向 4 分组跨段跳跃、2×2 强耦合田字视图以及既有斯大林/一战/菱形/一分三/孤立节点回归结构，运行 `fillLayout` 与 `relayoutView` 验证穿刺与交叉显著压降、双列左右相邻组靠内侧边缘贴靠且对齐行高、严格 3 列与首行紧凑全部通过且零重叠。

### Implementation for User Story 1

- [X] T352 [US1] 在 `src/shared/layout.ts` 实现四阶段确定性全局联合求解器 `solveGlobalViewLayout`（FR-001、FR-002、FR-013，依赖 T351）：1）阶段一（桶内初始种子）：纯孤立无边分桶严格按输入顺序平铺；满足无外边、全连通、无依赖环且有分叉/汇合的独立分桶保持 `useLayeredSeed`；其余分桶按拓扑序 S 型蛇形填充；2）阶段二（跨组双向重心初排）：当视图有 `>= 2` 分桶且存在跨组边时，在全局邻接图上执行 3 趟交替重心扫描（向下 → 向上 → 向下）映射初始列槽位，在 `grid` 模式下对同排左右分组的横向邻居额外施加朝向内侧边界列（左组靠 `cols - 1`、右组靠 `0`）的 `1.5×` 引力；3）阶段三（纵向 `3!` 列置换脱困）：在 `vertical` 模式下对每个 3 列分桶枚举全部 5 种非恒等列置换，上下交替扫掠最多 2 轮评估 `scoreGlobal` 解开多组交叉死锁；4）阶段四（全局交替 Sifting + 跨桶耦合列交换）：按节点度数降序依次尝试同桶节点交换与迁往空槽（候选期冻结非活动桶纵坐标，仅胜出提交时更新全图 `computeViewGeometry` 与缓存），每轮后对相邻分桶对 `(k, k+1)`（`grid` 额外含纵向相邻对 `(k, k+2)`）尝试同步交换列 `c1 ↔ c2` 打破双组对称死锁；压缩全空中间行并严格保持 `views[].groups[]` 原有叙事顺序与离散 3 列输出。
- [X] T353 [US1] 在 `src/shared/layout.ts` 将 `placeBucketNodes`、`placeFreshBuckets` 与 `relayoutView` 接入新版实高引擎并清理全部旧版硬编码（FR-001、FR-002、FR-014，依赖 T352）：1）单桶调用 `placeBucketNodes` 自动走新版实高重建与 `evalProxyQ25Q75` 评分（保持 6/7 参签名 100% 向后兼容，纯孤立组继续原序平铺）；2）更新 `placeFreshBuckets`（`fillLayout` 无已存视图分支与 `relayoutView('vertical')`）直接运行 `solveGlobalViewLayout` 并统一所有非空分组 `unifiedLeft` / `unifiedWidth`；3）更新 `relayoutView('grid')` 直接在全视图两列真实组宽与行顶框架下运行 `solveGlobalViewLayout`，移除 Pass-1 硬编码 `[42, 1040]` 与 `360` 步进估算以及 `passingVerticals`/`extAnchorBlocks`/`verticalSegs` 残留的 `row * 162` 与 `130px` 逻辑。

**Checkpoint**: User Story 1（MVP：全视图实高联合排版与双列耦合）已完整可测并向后兼容既有回归。

---

## Phase 4: User Story 2 - 组内循环与跨组长回路的结构化排布与外侧通道引导 (Priority: P1)

**Goal**: 识别双向互连、组内强连通闭环与跨组长逆向回边，保全主要依赖与叙事主干骨架并引导跨组回边走外侧边界列避卡。

**Independent Test**: 构造同时含 2-cycle 双向边、组内 3–4 节点闭环与跨 2–3 个分组反馈回边的测试视图，验证同输入确定性收敛、循环节点紧邻聚拢、合理组内回边不把下游节点倒拉回首行，且跨组反馈连线两端对齐最外侧边界列以消除对中间分组卡片的穿心遮挡。

### Implementation for User Story 2

- [X] T354 [US2] 在 `src/shared/layout.ts` 实现 `tarjanScc` 与 `decomposeCyclesWeighted` 升级环路拆解（FR-003、FR-013，依赖 T349）：1）**双向边预分离**：在 SCC 分解前识别同时存在 $u \to v$ 与 $v \to u$ 的节点对，优先保留高权边（`dependency = 1.0 > supplement = 0.6`），同权重时保留叙事下标 $u < v$ 为正向边，反向边记入 `backEdgeIndices`；2）**Tarjan SCC 分解**：在扣除双向逆边后的有向子图上运行线性 Tarjan 算法标记所有节点数 `>= 2` 的非平凡强连通分量 `sccId`；3）**加权边界感知 GreedyFAS**：对每个非平凡分量剥离零出度汇点入右栈 `s2`、零入度源点入左栈 `s1`，无源无汇时赋 `dependency` 边权 `2.0`、`supplement` 边权 `0.5`，叠加跨分组流入/流出偏置按最大化 $\Phi(u) = (w_{\text{out}}(u) - w_{\text{in}}(u)) + 0.35(\text{extInBias}(u) - \text{extOutBias}(u))$ 选点入 `s1`（平局按原 `memberIds` 下标升序确定性破平局），起始排位高于终点的边记入 `intraFeedbackIndices`；4）**极小 FAS 清洗**：按边权降序复核非双向回边，若当前 DAG 已不存在从 `v` 到 `u` 的路径则安全恢复为正向边。
- [X] T355 [US2] 在 `src/shared/layout.ts` 的 `scoreGlobal` 与 `solveGlobalViewLayout` 集成回路约束与跨组外侧回边引导（FR-003、FR-004，依赖 T353、T354）：1）对属于 `intraFeedbackIndices` 的组内回边豁免 `+45 / +15` 逆流惩罚；2）对同属非平凡 `sccId >= 0` 的组内相连边施加紧凑聚拢引力 `+INTRA_SCC_COHESION_WEIGHT * (dr + dc - 1)`（`+18 * (dr + dc - 1)`）；3）对起点组序大于终点的跨组回边（`bucket(u) > bucket(v)`）及纵向跨越 `>= 2` 个分组的远距边，当起止节点对齐至视图最外侧边界列（`!isInteriorX`）时施加 `OUTER_FEEDBACK_BONUS * w`（`-75 * w`）外侧通道奖励。

**Checkpoint**: 布局层全局实高求解与回路/跨组外侧通道能力全部闭环，可独立通过 `layout-navigation` 全部回归与新指标验证。

---

## Phase 5: User Story 3 - 双向与平行斜线清晰分离、外侧拱桥护栏分层及高亮光晕补强 (Priority: P1)

**Goal**: 彻底消除双向斜线双交叉、平行斜线粘连、同端嵌套拱桥交叉与首行顶拱/左拱越界压标题，并为选中提层连线提供自适应主题光晕，同时保持拖拽零延迟与 $O(E)$ 局部几何。

**Independent Test**: 验证标准 `91px` 列距下 `dy ∈ [24, 162]` 与 `dx = +200` 双向斜线 0 交叉且净空 `>= 16px`、慢速跨临界翻转 `<= 1` 次、同向平行斜线四向净空 `>= 14px`、同端嵌套外拱桥 `r1→r3` 与 `r1→r5` 0 交叉且外层更高、首行顶拱 `min_y > group.y + 34`、左拱 `min_x >= 10`（含田字双列左邻组标题保护），以及单击选中节点在浅深主题挂载 `.edge-focus-halo` 光晕而悬停绝不提层。

### Implementation for User Story 3

- [X] T356 [P] [US3] 升级 `src/shared/edge-routing.ts` 的 `selectInlineBlockedSides` 与 `buildEdgeCurve`（FR-007、FR-008，依赖 T348）：1）**跨度感知 `hasOuterCard`**：仅检查主轴区间与拱桥外包跨度 `[Math.min(a.m0, b.m0) - OUTER_SPAN_MARGIN, Math.max(a.m1, b.m1) + OUTER_SPAN_MARGIN]` 重叠的卡片，释放下方窄分组外侧净空同时继续严禁内部列/行向内绕行；2）**顶拱优先让道与区间图彩虹分层**：当 `horizontal` 边选 `top` 侧且端卡顶边处于所属分组（`options?.groups`）顶边下方 `<= TOP_ARCH_GROUP_PROXIMITY (80)` 内时叠加 `TOP_ARCH_GROUP_PENALTY (60)` 惩罚优先走空旷下侧；对全部活跃同侧同方向外拱桥按跨度 `[spanLo, spanHi]` 升序（平局按起点与 `relation.id`）贪心区间着色（预留 `ARCH_LANE_SPAN_MARGIN = 8`）写入 `spec.archLane`；3）**精确标题/画布边界护栏与偏置接入**：扩展 `buildEdgeCurve(a, b, self?, archClearance?, options?)` 消费 `archLane`（`baseH = min(MAX_ARCH_LANE_HANDLE, baseH + archLane * ARCH_LANE_STEP)`）及可选平行偏置 `hsBias`/`heBias`（钳位于安全最小臂长 `>= 18`）；对 `top` 与 `left` 拱桥应用反解极值公式 $\text{baseH}_{\max} = \max(18, (p_s + p_e + 6\min(p_s, p_e) - 8 c_{\text{ceil}}) / 6)$，其中 `top` 拱取所属分组 `group.y + TOP_ARCH_TITLE_CLEARANCE(36)`（无组且 `min(ps.y, pe.y) > 14` 时取 `14`，保留合成原点单测兼容），`left` 拱取 `Math.max(CANVAS_LEFT_ARCH_MARGIN(10), adjLeftGroupRight + 6)` 兼顾画布左边缘与双列右列左拱不触及左列相邻分组标题。
- [X] T357 [US3] 升级 `src/shared/edge-geometry.ts` 的 `createConnections` 与 `routeSegments` 注入双向斜线配对、LIFO 嵌套端口序与平行斜线偏置（FR-005、FR-006、FR-008，依赖 T356）：1）**斜率感知双向端口配对**：按无序节点对 `{min(u, v), max(u, v)}` 分组面对面双向边，以 `BIDIR_SLOPE_ENTER = 24` 与拖拽滞回 `BIDIR_SLOPE_EXIT = 12`（读取/写入 `EdgeRouteHint.bidirFlipped`）决定是否触发槽位翻转，在 `projectedOrder` 排序与 6 轮防逆序校验中注入确定性 `bidirRank`（水平 `dy_lr > 0` 时右→左占上槽 `0`、左→右占下槽 `1`，`dy_lr < 0` 反转；垂直边按 `dx_tb` 对称）；2）**LIFO 嵌套拱桥端口序**：在 `projectedOrder` 中对带有 `archLane !== undefined` / `archActive` 标记的拱桥端口采用反号投影 `-(axis(port, point) - center) / 24`，确保共享同一端点的长拱桥占外侧端口、短拱桥占内侧端口；3）**平行斜线反相偏置**：对同节点对且同向面对面的 $k \ge 2$ 条平行斜线，按一致正方向轴差 $d_{\text{axis}}$（`left`/`right` 取 `pe.y - ps.y`，`top`/`bottom` 取 `pe.x - ps.x`）当 $|d_{\text{axis}}| \ge 32$ 时计算 $\delta_i = \text{clamp}(0.08|d_{\text{axis}}|, 0, 18)\cdot(i - (k-1)/2)\cdot\text{sign}(d_{\text{axis}})$，设定 `hsBias = -delta_i`、`heBias = +delta_i` 并写入 `RoutedSegment` 供 `buildEdgeCurve` 与动画帧共享复用；4）在 `routeSegments` 中把 `options?.groups` 及各边 `archLane`/`hsBias`/`heBias` 透传给 `buildEdgeCurve` 并完整写回 `hints`。
- [X] T358 [US3] 更新 `src/client/animate-ports.ts`、`src/client/components/MapScene.tsx`、`src/client/styles/atlas.css` 与 `src/client/styles/dark.css` 完成客户端透传与提层高亮光晕（FR-007、FR-009、FR-014，依赖 T357）：1）在 `useAnimatedPorts.ts` 扩展 `options` 接收 `groups?: readonly Rect[]`，并在构造 `interpolated` 传给 `routeSegments` 时保留每条边的 `archLane`、`hsBias`、`heBias`、`bidirFlipped`；2）在 `MapScene.tsx` 向 `createConnections` 与 `useAnimatedPorts` 透传 `groups: visualLayout.groups`；在 `SceneEdge` 中仅当 `focused === true`（单击选中节点挂载 `.edges-focus`，悬停绝不触发）时在主连线 `<path>` 之前渲染 `<path className="edge-focus-halo" d={d} />`；3）在 `atlas.css` 与 `dark.css` 为 `.dsh-atlas .edge-focus-halo` 添加样式规则（`fill: none; stroke: var(--canvas, #faf7ef); stroke-width: 5; opacity: 0.72; stroke-linecap: butt; stroke-linejoin: round; stroke-dasharray: none;`，在 `dark.css` 通过 `--canvas: #1c1a17` 自动适配且确认减少动态效果媒体查询无冲突）。

**Checkpoint**: 路由层与渲染层核心精修全部完成；`src/client/offline.tsx` 自动通过 `ReadingPane → MapScene` 同步生效。

---

## Phase 6: User Story 4 - 四维防遮盖的关系胶囊与极短边自适应定位 (Priority: P2)

**Goal**: 让关系胶囊避开卡片、已放胶囊、其他连线路径及全部端口/箭头，并解决 `91px` 水平短边偏心撑爆与 `32px` 竖向短边压箭头压边框问题。

**Independent Test**: 构造 8 边多组标注场景（含 4 条交叉跨组斜线、3 条 `91px` 水平短边与 1 条 `32px` 竖向短边），验证胶囊压卡/压他胶囊/压他线/压端口箭头冲突全为 0，水平短边返回居中坐标与自适应 `maxWidth`，竖向短边停靠右侧（或左侧）走廊侧鞍且不压卡片与箭头，既有 `pickPillAnchor` 旧 3/4 参单测保持 100% 通过。

### Implementation for User Story 4

- [X] T359 [US4] 在 `src/shared/edge-routing.ts` 升级 `pickPillAnchor` 支持四维分级避让与双短边特化定位（FR-010，依赖 T356）：1）保留 3/4 参旧调用（`options === undefined`）的完全向后兼容行为且不附带多余 `maxWidth` 属性；2）引入线段-矩形碰撞辅助，接收 `options?.otherChords`（他线 3 段闭式弦）与 `options?.portBoxes`（全端口圆点及箭头保护盒）；3）针对 `SHORT_HORIZ_MIN_SPAN(40) <= span < SHORT_HORIZ_MAX_SPAN(120)` 且 `|dy| < 20` 的水平短边，将两卡边框净空真实中点 `(ps + p3)/2` 设在候选列表首位并输出 `maxWidth = clamp(span - 18, 54, PILL_MAX_WIDTH)`；针对 `0 < span < SHORT_VERT_MAX_SPAN(60)` 且 `|dx| < 20` 的竖向短边，追加右/左侧鞍走廊候选点 `(shaftX ± (pillW / 2 + SIDE_SADDLE_GAP), gapMidY)`；4）按“不压任意外扩 `PILL_CARD_MARGIN(4)` 卡片（或最小压卡面积） > 最小化 `4 * placedOverlap + 3 * portArrowOverlap + 2 * otherChordOverlap` 综合冲突 > 最贴近曲线中点”严格分级择优，并返回 `{ x, y, ...(maxWidth !== undefined ? { maxWidth } : {}) }`。
- [X] T360 [US4] 在 `src/shared/edge-geometry.ts`（`routeSegments`）与 `src/client/components/MapScene.tsx`（`ScenePill`）接入全图四维避让与自适应胶囊宽度（FR-010、FR-014，依赖 T357、T358、T359）：1）将 `routeSegments` 拆为两趟 $O(E)$ 流水线——第一趟对每条边执行 `buildEdgeCurve` 与 `computePortEndpoints`，提取 3 段闭式弦（`t = 0, 1/3, 2/3, 1`）与全端口/箭头保护盒 `portBoxes`（输出圆点 `±PILL_PORT_MARGIN(5)`，输入圆点及箭头三角外框外扩 `PILL_PORT_MARGIN(5)`）；第二趟仅对含非空 `label` 的边排除自身弦与自端保护盒后调用 `pickPillAnchor(..., options)`，写入 `segment.label`（`PillPlacement`）；2）在 `MapScene.tsx` 的 `ScenePill` 接收 `maxWidth?: number` 并在 `style` 中应用 `...(maxWidth !== undefined ? { maxWidth } : {})`，保留 `title={r.label}` 悬停看全文与 CSS `text-overflow: ellipsis`。

**Checkpoint**: 关系胶囊四维避让与短边自适应定位在桌面侧栏与离线 HTML 双端同步就绪。

---

## Phase 7: User Story 5 - 框内优先增量补位与保留手动位置的局部整理 (Priority: P2)

**Goal**: 修复邻居拖出分组框后新增节点跟随脱框的缺陷，并提供保留用户 `manual: true` 节点与分组框零漂移的局部整理引擎与顶部轻量操作入口。

**Independent Test**: 将某节点手动拖至分组外框之外，新增同分组相连节点验证 100% 落入所属分组框内最近空槽且旧位置零变动；在含 `manual: true`（含偏离网格位置）的视图中点击顶部工具栏“整理未锁定节点”，验证手动节点与分组框位移 0、未锁定节点整齐重排零重叠且支持撤销；调用 `relayoutViewPartial` 单分组模式验证其余分组与节点位移 0。

### Implementation for User Story 5

- [X] T361 [US5] 在 `src/shared/layout.ts` 升级 `placeNearNeighbors` 框内槽位感知并实现 `relayoutViewPartial` 局部整理引擎（FR-011、FR-012、FR-013，依赖 T353、T355）：1）升级 `placeNearNeighbors`：当 `oldGroup` 存在时，在邻居顺向/逆向周边候选外同步枚举 `oldGroup` 内全部未占用标准网格槽位（从 `oldGroup.x + GROUP_PAD_X`、`oldGroup.y + GROUP_PAD_TOP` 按 `COL_STEP` 与实测行步进生成），并将 `outOfGroupPenalty` 由 `150` 提至 `OUT_OF_GROUP_PENALTY = 420`、到邻居距离权重调整为 `0.5`，使脱框邻居的新增同组节点优先精准落回框内最近空位（框内全满时安全回退邻居周边空位）；2）实现导出函数 `relayoutViewPartial(map, current, heights, options)`：在 `scope === 'unlocked'` 时原位钉死所有 `manual: true` 节点与全部 `current.groups`（0 位移；若全锁定则原样返回浅拷贝），仅对 `manual: false` 节点复用 `solveGlobalViewLayout`（附加对全部锁定卡碰撞含 `24px` 净空的 `PINNED_OVERLAP_PENALTY = 5000` 硬隔离；若离散槽位仍冲突则末步垂直安全顺延确保物理零重叠）；在 `scope === { groupId }` 时钉死所有非目标分组成员与其余全部分组（0 位移），仅重排目标分组内节点（当 `refitTargetGroup === true` 时按新包络紧凑重算目标分组宽高，默认 `false` 保持原分组外框稳定）。
- [X] T362 [US5] 在 `src/client/hooks/useViewportLayout.ts`、`src/client/components/MapHeader.tsx` 与 `src/client/AtlasPane.tsx` 接入“整理未锁定节点”入口与撤销历史（FR-012、FR-014，依赖 T361）：1）在 `useViewportLayout.ts` 新增并导出 `relayoutPartial(options: PartialRelayoutOptions)`：复用与 `changeLayout` 一致的前置守卫（`measured === snapshot.fingerprint && !navigationBusy.current`）及未完成输入提交检查 `active?.finishInput()`，调用 `relayoutViewPartial` 生成 `next` 后经 `active?.setLayout(next, old)` 接入自动保存与 30 步撤销重做栈（离线只读不暴露入口，若内部调用则走会话草稿）；2）在 `MapHeader.tsx` 新增可选 `onTidyUnlocked?: () => void`，仅当传入时在 `onReset` 按钮旁渲染轻量 `.atlas-host-button.atlas-quiet-icon` 按钮（`aria-label="整理未锁定节点"`、`title="整理未锁定节点"`）；3）在 `AtlasPane.tsx` 仅当 `!props.offline` 时透传 `onTidyUnlocked={() => vp.relayoutPartial({ scope: 'unlocked' })}`，保持 `src/client/offline.tsx` 零修改。

**Checkpoint**: 全部 5 个 User Stories（US1–US5）功能均已在源码层规划闭环且可独立校验。

---

## Phase 8: Polish & Cross-Cutting Concerns（回归测试、编译打包与人工验收）

**Purpose**: 补充覆盖 `SC-001`–`SC-007` 的单元测试与 DOM 集成测试，完成 `typecheck`、`build`、预览包自动打包及独立记录 DSH 真机/离线人工验收。

- [X] T363 [P] 扩展 `tests/shared/edge-routing.test.ts` 并复核 `tests/shared/prototype-parity.test.ts` 验证 `SC-003`、`SC-004`、`SC-006`（依赖 T358、T360）：保留全部既有断言（包括 3/4 参 `pickPillAnchor` 返回值 `deepEqual`），新增覆盖：1）`dy ∈ [24, 162]` 水平双向斜线与 `dx = +200` 垂直双向斜线 40 点采样最小间距 `>= 16px`、0 交叉，及慢速拖拽跨越 `dy = 0` 临界区翻转 `<= 1` 次；2）同向面对面平行斜线（$k = 2$，含左右/右左/上下/下上四向）中段分离净空 `>= 14px`、0 交叉；3）同端嵌套外侧拱桥 `r1→r3` 与 `r1→r5` 0 交叉、净空 `>= 6px` 且外层拱顶高于内层，阶梯窄分组外侧拱桥不被远处宽分组误杀；4）传入 `groups` 时首行顶拱全曲线 `min_y > group.y + 34`（不压标题）、左拱 `min_x >= 10`（不越画布左缘且田字双列右列左拱不侵入左列标题）；5）8 边多组标注场景（交叉斜线 + `91px` 短横边 + `32px` 短竖边）胶囊四维碰撞全部为 0 且短横边输出收窄 `maxWidth`；6）40 节点 / 65 边单次 `createConnections` 耗时远低于 `16ms`。
- [X] T364 [P] 扩展 `tests/shared/layout-navigation.test.ts` 验证 `SC-001`、`SC-002`、`SC-005`、`SC-006`、`SC-007`（依赖 T355、T361）：保留全部既有回归断言（斯大林结构、一战纵向与田字结构、6 节点蛇形、枢纽居中、菱形与一分三、20 节点环路 10 次确定性、既有 `previous` 布局零漂移），新增覆盖：1）`varied_heights`（86–260px 极端变高混排）无高度错位纵向穿卡；2）2×2 强耦合田字视图（`grid`）左右相连向内列靠拢且穿卡显著减少（`<= 2`）；3）组内闭环与跨多分组逆向回边确定性收敛、合理回边不被倒拉首行且跨组回边优先对齐最外侧边界列；4）`fillLayout` 在邻居拖至 `oldGroup` 框外后新增同组相连节点精准落回框内最近空位且旧位置不变；5）`relayoutViewPartial` 在 `'unlocked'`（含偏离网格锁定节点及全锁定边界）与 `{ groupId }` 模式下锁定节点/他组零位移、全图零重叠；6）20 节点满载重排瞬时完成且 10 次结果 100% 一致。
- [X] T365 [P] 扩展 `tests/integration/dom.test.ts` 验证客户端高亮光晕、短边胶囊宽度及“整理未锁定节点”交互（依赖 T358、T360、T362）：验证 1）单击选中节点挂载 `.edges-focus` 内存在 `.edge-focus-halo` 路径，悬停节点不触发提层或光晕；2）水平短边 `.edge-pill` 渲染内联 `maxWidth` 样式；3）非离线工具栏展示 `[aria-label="整理未锁定节点"]` 按钮，点击后已手动拖动锁定节点保持原坐标不变、未锁定节点重新整理，且可一步撤销恢复；4）离线模式不渲染“整理未锁定节点”按钮。
- [X] T366 依据 [quickstart.md](quickstart.md) 与 `AGENTS.md` 执行最终静态检查、构建与预览包打包（依赖 T363、T364、T365）：运行 `npm.cmd run typecheck` 与 `npm.cmd run build` 验证全仓编译无错；按《2026-11-24 预览包自动打包约定》先检查 `dist/previews/` 最大 `preview.n`、同步更新 `package.json` 与 `package-lock.json` 版本号至 `0.4.5-preview.(n+1)` 后执行 `npm.cmd run pack:plugin` 校验唯一 `.tgz` 产物（若获用户明确授权运行自动化测试则执行 `npm.cmd run test`，否则在交付报告中注明未运行自主测试或浏览器检查）；核查 `git status -s` 确认存储契约零变更并执行本地 Git 检查点提交。
- [ ] T367 【人工验收 — 独立记录】由用户在 DSH `v0.2.2-rc.3` 桌面端原生侧栏（浅色/深色主题、窄栏至宽屏）与导出的独立离线 HTML 页面中按 [quickstart.md](quickstart.md) 第 2 节完成多分组实高/田字排列、环路外侧绕行、双向/平行斜线分离、拱桥护栏与分层、高亮光晕、四维胶囊避让、脱框框内补位、“整理未锁定节点”及撤销、跟手零延迟拖拽、0.5 秒过渡与历史旧图零漂移的人工视觉复验（依赖 T366）。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup: `T348`, `T349`)**: 无前置依赖，可立即并行启动（分属 `edge-routing.ts` 与 `layout.ts`）。
- **Phase 2 (Foundational: `T350` → `T351`)**: 依赖 `T349`；阻塞所有 `layout.ts` 相关的故事（US1、US2、US5）。
- **Phase 3 (User Story 1 / MVP: `T352` → `T353`)**: 依赖 `T351`（串联修改 `src/shared/layout.ts`）。
- **Phase 4 (User Story 2: `T354` → `T355`)**: `T354` 依赖 `T349`（可于 `T350`–`T353` 逻辑设计完后并入 `layout.ts`），`T355` 依赖 `T353` 与 `T354`。
- **Phase 5 (User Story 3: `T356` → `T357` → `T358`)**: **完全不依赖 `src/shared/layout.ts`**！仅依赖 `T348`，可按“低风险路由精修先行”策略从起点即与 Phase 2–4 全程并行。
- **Phase 6 (User Story 4: `T359` → `T360`)**: `T359` 依赖 `T356`；`T360` 依赖 `T357`、`T358`、`T359`。
- **Phase 7 (User Story 5: `T361` → `T362`)**: `T361` 依赖 `T353`、`T355`；`T362` 依赖 `T361`。
- **Phase 8 (Polish & Acceptance: `T363`–`T367`)**:
  - `T363` 依赖 `T358`、`T360`（可提前独立验收路由线！）；
  - `T364` 依赖 `T355`、`T361`；
  - `T365` 依赖 `T358`、`T360`、`T362`；
  - `T363`、`T364`、`T365` 分属不同测试文件，可 `[P]` 并行；
  - `T366` 依赖 `T363`–`T365`；`T367` 依赖 `T366`。

### User Story Dependency Graph

```text
Line A（布局核心线 - src/shared/layout.ts）:
T349 [P] ──► T350 ──► T351 ──► T352 [US1] ──► T353 [US1/MVP] ──► T355 [US2] ──► T361 [US5] ──► T362 [US5] ──► T364 [P]
                                                                       ▲                                           │
                                                                 T354 [US2]                                        │
                                                                                                                   ▼
Line B（局部路由与交互线 - edge-routing / edge-geometry / client）:                                              T366 ──► T367
T348 [P] ──► T356 [US3] ──► T357 [US3] ──► T358 [US3] ──┬──────────────────────────────────────► T365 [P] ─────────▲
                       └──► T359 [US4] ──► T360 [US4] ──┴──────────────────────────────────────► T363 [P] ─────────┘
```

---

## Parallel Example: 路由精修线与全局布局线同步推进

```bash
# 第一波（Setup 阶段并行启动）：
Task T348: "src/shared/edge-routing.ts 扩展路由常量与接口契约"
Task T349: "src/shared/layout.ts 定义全局评分常量、结构与 relayoutViewPartial 契约"

# 第二波（Line A 布局内核 与 Line B 路由精修 完全解耦并行）：
Line A: T350 -> T351 -> T352 [US1] -> T353 [US1] -> T354/T355 [US2] -> T361/T362 [US5]
Line B: T356 [US3] -> T357 [US3] -> T358 [US3] -> T359/T360 [US4]

# 第三波（Polish 阶段三个独立测试文件并行补充）：
Task T363: "tests/shared/edge-routing.test.ts"
Task T364: "tests/shared/layout-navigation.test.ts"
Task T365: "tests/integration/dom.test.ts"
```

---

## Implementation Strategy

### 低风险路由先行 + MVP 分阶段合并节奏

1. **第一批（低风险路由线先行：`T348` + `T356`–`T360` + `T363`）**：
   - 先交付完全不改卡片坐标的路由层精修（US3 双向/平行斜线分离、拱桥护栏分层、光晕 + US4 四维胶囊避让），可独立运行 `T363` 核验 `SC-003`、`SC-004` 与 `< 16ms` 性能预算，随时安全回滚。
2. **第二批（MVP 布局内核 + 回路引导：`T349`–`T355`）**：
   - 接入实高重建、`evalProxyQ25Q75`、四阶段全视图联合求解（US1 MVP）及 Tarjan+GreedyFAS/外侧回边牵引（US2），覆盖 `SC-001` 与 `SC-002`。
3. **第三批（框内补位、局部整理与全栈交付：`T361`–`T367`）**：
   - 落地脱框框内补位与“整理未锁定节点”（US5，`SC-005`），并行补充全量测试 `T363`–`T365`，经 `T366` 完成构建打包后，最终交由用户在 `T367` 完成 DSH 真机与离线阅读页人工验收。

---

## Notes

- **编号连续性**：全仓任务编号唯一，紧接 `013` 末尾 `T347`，本特性从 `T348` 连续编排至 `T367`。
- **关键兼容红线**：`pickPillAnchor` 3/4 参旧调用保持纯 `{ x, y }` 返回（不附带 `maxWidth: undefined`）；无 `groups` 传入且合成测试卡位于 `y <= 14` 时顶拱护栏不得破坏现有原点拱桥上拱测试断言；平行斜线 `axisDelta` 必须使用与端口排序 `place()` 一致的正方向轴差。
- **AGENTS.md 开发与交付约定**：日常实现阶段完成后自动执行 `typecheck`、`build` 与 `0.4.5-preview.(n+1)` 预览包打包及本地检查点提交；自动化测试仅在用户明确授权时执行，真机视觉验收独立记录于 `T367`。
