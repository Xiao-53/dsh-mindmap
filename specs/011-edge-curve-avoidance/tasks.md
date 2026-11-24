---

description: "节点连线曲线弧度与避让逻辑优化任务清单"
---

# Tasks: 节点连线曲线弧度与避让逻辑优化

**Input**: Design documents from `specs/011-edge-curve-avoidance/`（[spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/edge-routing.md](contracts/edge-routing.md)、[quickstart.md](quickstart.md)）

**编号**: 沿用仓库全局唯一任务编号，接续 `010` 的 `T305`，从 **`T306`** 顺序编号至 **`T321`**（共 16 项任务；实现完成与真机/离线 HTML 人工验收分别记录）。标有 `[P]` 的任务可在前置依赖完成后并行，`[US1]`–`[US3]` 对应 [spec.md](spec.md) 中的 3 个用户故事。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（涉及不同文件且无未完成前置依赖）
- **[Story]**: 所属用户故事标签（`[US1]`、`[US2]`、`[US3]`；Setup、Foundational 与 Polish 阶段不带故事标签）
- 每条任务均包含精确文件路径，并显式引用 [data-model.md](data-model.md) 与 [contracts/edge-routing.md](contracts/edge-routing.md) 中的常量、类型、约束与不变量

## Path Conventions

- **Single project**: 源代码位于 `src/shared/`、`src/client/`，自动化回归测试位于 `tests/shared/`、`tests/integration/`。
- **零存储变更约束**: 不修改 `map.json`（`schemaVersion: 1`）与 `layout.json`（`schemaVersion: 1 | 2`）字段结构，不改写任何已保存的节点或分组坐标，不新增第三方依赖。

---

## Phase 1: Setup（模块骨架与类型契约建立）

**Purpose**: 建立内聚的共享连线几何求解模块骨架并对齐公开接口类型，确保与宿主桌面侧栏、动画帧及离线阅读器共用。

- [X] T306 新建共享路由核心骨架 `src/shared/edge-routing.ts` 并在 `src/shared/edge-geometry.ts` 对齐公开类型与常量契约：在 `src/shared/edge-routing.ts` 定义常量 `CLEARANCE_PAD = 7`（6～8px 克制留白）、`PREFERRED_LANE_GAP = 10`、`MIN_LANE_GAP = 4`、`HYSTERESIS_COST = 24`、`SWITCH_MARGIN = 16`（正面直挡换边原侧轻度偏好阈值）、`LAMBDA_BEND = 0.32`（弯曲能量与降级权重系数）、`HEAD_ON_MIN_PENETRATION = 18`、`HEAD_ON_RATIO = 0.25`、`MAX_SEGMENTS = 3`、`MIN_SAMPLE_STEP = 12` 及实体类型 `Point`、`Box`、`Cubic`、`BypassSide`（`'top' | 'bottom' | 'left' | 'right' | '+' | '-'`）、`CardEnvelope`（`id`/`card`/`pad`/`core`）、`SelfCardGuard`（`selfA`/`selfB`）、`ObstacleCluster`（`key`/`ids`/`card`/`pad`）、`SplineCurve`（`segments` 长度 `1 | 2 | 3`、`waypoints` 长度 `0 | 1 | 2`、`d`、`label`）、`PathMetrics`（含 `segmentPenalty = segments.length - 1` 即 `0 | 1 | 2`）、`EdgeRouteHint`（`sourceSide`/`targetSide`/`bypassSide?`）、`RoutingOptions`（`hints?`/`dragging?`/`outHints?`）、`CorridorGroup` 与 `RoutedSegment`；在 `src/shared/edge-geometry.ts` 保持既有导出 `PORT_RADIUS = 3.5`、`INPUT_PORT_STROKE = 1`、`OUTPUT_PORT_STROKE = 2`、`ARROW_LENGTH = 8`、`ARROW_HALF_WIDTH = 3.5`、`Rect`、`Port`、`edgeGeometry` 完全不变并透出新增公共类型。

---

## Phase 2: Foundational（安全包络、自适应采样与向心平滑样条内核）

**Purpose**: 实现支撑所有用户故事的三级卡片安全包络、凸包剪枝采样评估器与向心弦长加权平滑样条生成器。

**⚠️ CRITICAL**: User Story 1、2、3 的基础弧度、避让、共路分层与标签择优均依赖本阶段完成。

- [X] T307 在 `src/shared/edge-routing.ts` 中实现卡片安全包络构造 `createCardEnvelopes(nodes: Record<string, Rect>)` 与曲线评估函数 `evaluateSpline(spline, envelopes, aId, bId, baseArcLength)`（依赖 T306）：为每个正尺寸节点生成 `card`（0px 完整可见边框）、`pad`（外扩 `CLEARANCE_PAD = 7px`）与 `core`（内缩 `min(10, dim / 4)`）三层盒；为起终点自身卡片构建 `SelfCardGuard`（`selfA` 内缩 `1px` 且首段仅豁免 `t <= 0.03`、后续段全程严检；`selfB` 使用完整 `card` 外框全程严检）；每段三次贝塞尔先做控制多边形 AABB 凸包 $O(1)$ 剪枝，通过剪枝的段按控制折线总长动态计算采样点数 `N = clamp(ceil(L_poly / 12), 8, 48)`（相邻步长 `<= 12px`），精确返回 `selfHits`、`cardHits`、`coreHits`、`maxCardDepth`、`padHits`、`maxPadDepth`、`minClearance`、`arcLength`、`detourExcess`、`bendEnergy` 与 `hitObstacleIds`，并对零间距或非法非正尺寸做有限数值兜底防 `NaN`/`Infinity`。
- [X] T308 在 `src/shared/edge-routing.ts` 中实现向心弦长加权平滑样条构造 `buildCentripetalSpline(ps, pe, us, ut, waypoints)` 与路径格式化 `formatSpline`（依赖 T306）：严格限定 `waypoints.length` 为 `1` 或 `2`（输出 2 段或最多 3 段三次贝塞尔，严格满足 `1 <= segments.length <= 3`）；强制首段第一控制点落在起点外法线射线 `ps + h_s * us`（`h_s = clamp(0.38 * L0 * max(0.45, us · d0), 18, min(0.48 * L0, 140))` 且超短跨度按 `min(h, 0.55 * L)` 缩容）、末段第二控制点落在终点箭头反向延长线 `pe + h_e * ut`（`h_e > 0`）；对每个内部航点 `Q_i` 使用向心权重 $\sqrt{L}$ 融合前后单位弦向得到连续切向 `tau_i`（绝不在反弯点归零），并按夹角余弦衰减系数 `rho_i = 0.34 * clamp(0.75 + 0.25 * c_i, 0.52, 1.0)` 生成严格共线反向的前后手柄 `Q_i - (rho_i * L_{i-1}) * tau_i` 与 `Q_i + (rho_i * L_i) * tau_i`，格式化为合法连续 `M.. C..` SVG 路径字符串且零 `NaN`。

**Checkpoint**: 三级安全包络、自适应弧长采样与 1～3 段向心平滑样条内核就绪，可进入 User Story 实现。

---

## Phase 3: User Story 1 - 顺滑自然的曲线弧度与无折角端口衔接 (Priority: P1) 🎯 MVP

**Goal**: 让所有无中间卡片阻挡的常规连线（水平、垂直、斜向、邻边转角、跨组远距、极近间距及自环）在输出圆点出口与箭头根部严格保持端切向 $G^1$ 共线无折角，且弧度随间距与角度自适应收敛、无过度鼓包、不回擦自身起终点卡片。

**Independent Test**: 构造覆盖 ≥ 15 种无阻挡相对位置组合与自环的验证视图，检验所有连线出口与箭头入向法线误差 `< 0.01°`（无折角）、无自身卡片回擦、邻边及远距无过度鼓包且自环清晰不压字。

### Implementation for User Story 1

- [X] T309 [US1] 在 `src/shared/edge-routing.ts` 中实现无阻挡基础曲线与自环构造 `buildBaseSpline(a: Port, b: Port, self: boolean)`（FR-001、FR-002、FR-010，依赖 T306、T307、T308）：所有 4 类基础曲线均强制端切向与端口外法线共线（$G^1$ 锁死）：1）对边正向（`d_parallel >= 16`）沿用 `d_parallel / 2` 并在超长明显错位时按 `min(d_parallel / 2, max(0.45 * L, 220))` 适度收敛，极近或轴向反向重叠（`d_parallel < 16`）保底外伸 `clamp(28 + 0.35 * |d_perp|, 24, 96)` 防止控制点缩回自身卡片；2）邻边转角采用四分之一椭圆系数 `kappa = 0.55` 计算 `h_s = clamp(max(0.55 * p_s, 0.25 * L), 22, 180)` 与 `h_e = clamp(max(0.55 * p_t, 0.25 * L), 22, 180)`，消除远距 `length / 2` 过度鼓包；3）同侧拱桥按 `A_0 = clamp(0.22 * L_perp + 24, 34, 112)` 并齐平两端口高度差计算对称拱弧；4）自环（`self === true`）采用水平出射、水平汇入 `3px stem` 箭头的卡片右侧外伸平滑双段圆润回环，无折角且不压盖卡片文字。
- [X] T310 [US1] 在 `src/shared/edge-geometry.ts` 中将无阻挡曲线与自环渲染切换至 `buildBaseSpline` 并保留既定箭头与 `3px stem` 外沿几何（FR-001、FR-002、FR-010，依赖 T309）：保持 `arrow` 尖端停靠输入圆外沿 `inputPortOuterRadius = 4px`、`ARROW_LENGTH = 8px`、`ARROW_HALF_WIDTH = 3.5px` 与 `3px` 轴向 `stem` 直线段公式不变，使 `connectionGeometry` 在未传入 `nodes` 或无障碍时直接输出 $G^1$ 无折角平滑曲线与准确中点标签坐标。

**Checkpoint**: User Story 1（MVP：$G^1$ 无折角端口衔接、无阻挡基础弧度自适应收敛与光滑自环）已可独立运行与验证。

---

## Phase 4: User Story 2 - 完整边界避让、多障碍平滑绕行与自身卡片防穿透 (Priority: P1)

**Goal**: 取消写死三段与固定长度阈值，基于 `card` 完整边框 + `7px` 克制留白与自身卡片防回穿边界，落实“仅正面直挡智能换边”和“最小绕行改动”原则，按实际障碍簇与可行走廊自适应选用 1～3 段平滑曲线绕过单卡、宽/高卡及交错多卡，并在极端重叠无通道时稳定降级。

**Independent Test**: 构造 ≥ 12 个阻挡场景（同排/同列正面直挡、轻微擦边、单卡高/宽阻挡、多卡交错阻挡及极端卡片重叠），验证可通行场景下非端点 `card` 与自身卡片穿透数为 `0`、轻微擦边仅做最小微调不绕大圈、分段数严格 $\in [1, 3]$，且极端场景稳定输出最小遮挡路径无 `NaN` 或飞线。

### Implementation for User Story 2

- [X] T311 [US2] 在 `src/shared/edge-routing.ts` 中实现障碍簇聚类与 4 级自适应 1～3 段单边避让引擎 `routeSingleEdge(a, b, edgeId, envelopes, options)`（FR-003、FR-004、FR-005、FR-006，依赖 T307、T308、T309）：1）当两张挡路/相邻非端点卡片净距 `< 2 * CLEARANCE_PAD`（`14px`）且投影重叠时合并为稳定排序键的 `ObstacleCluster`；2）Stage 0 无碰撞直接返回基础 1 段曲线；3）Stage 1 对同侧拱桥按障碍包络精确计算最小拱高，对邻边/斜向微擦在锁定端法向下做轻量非对称手柄调优；4）Stage 2（1 航点 → 2 段）生成轻微擦边最小微推点（基于精确 `maxPadDepth` 脱边）、障碍簇四向包络外侧点（无旧版 `248px` 偏幅上限）与相邻卡片间隙走廊中点（缝隙 `>= 6px`），并执行 1 次 `+8px`/`+16px` 超调外推微调，满足无硬碰撞与最小绕行改动即止步于 2 段；5）Stage 3（2 航点 → 最多 3 段封顶）仅在 1～2 段仍有硬碰撞或大范围侵占留白时启用，构造宽/高簇双外角、沿弦序错位双簇通道组合与近端口脱困点（约 12～24 组），随后做冗余航点抽稀（删去单个航点若 2 段等价更优则自动降回 2 段）；6）严格执行最小绕行改动代价 `detourExcess + LAMBDA_BEND * bendEnergy + 8 * segmentPenalty + 2.5 * maxPadPenetration + hysteresisBonus`（其中 `LAMBDA_BEND = 0.32`，`segmentPenalty = segments.length - 1` 即 `0 | 1 | 2`，窄缝优先最小幅度贴外框通过而非绕大圈），在极端重叠超出 3 段上限时按 `selfHits + cardHits → coreHits → maxCardDepth → detourRatio + LAMBDA_BEND * bendEnergy` 确定性降级，且记录 `bypassClusterKey` 与 `bypassSide` 元信息。
- [X] T312 [US2] 在 `src/shared/edge-routing.ts` 中实现仅正面直挡智能换边评估 `selectHeadOnPortSides(segments, envelopes, options)` 并接入 `src/shared/edge-geometry.ts` 的 `createConnections` 端口分配阶段（FR-005、FR-010，依赖 T311）：仅在 `!order && !self`、初选为对边（`left↔right` 或 `top↔bottom`）、两端卡片在垂直连线轴上投影重叠或中心距 `<= 0.65 * max(dimA, dimB)` 且至少一张中间卡片深度阻挡直连走廊（侵入 `card` 深度 `>= min(18, 0.25 * cardDim)`，轻微擦边绝不触发）时，评估同侧拱桥端口对（水平评 `top→top` / `bottom→bottom`，垂直评 `left→left` / `right→right`）；仅当换边拱桥满足 `selfHits === 0 && cardHits === 0` 且在计入原侧偏好阈值 `SWITCH_MARGIN = 16`（及拖拽滞回）后综合代价严格优于留守原侧时才改写对应 `Port.side`，随后完整进入既有的 `projectedOrder` 同侧防交叉排序与 `place(group)` 均匀分布。

**Checkpoint**: User Story 1 与 User Story 2（全部 P1 核心能力：曲线弧度收敛、完整安全包络、正面直挡换边与 1～3 段自适应最小避让）已完整闭环且可独立测试。

---

## Phase 5: User Story 3 - 多条绕行连线分离、关系标签防遮挡与拖动稳定性 (Priority: P2)

**Goal**: 实现 Pass-2 共路与双向边自适应轨道分层（窄缝内收紧绝不挤去对侧绕大圈）、关系文字标签沿弧长中段避卡择优，并通过 `routeSegments` 统一静态渲染与 180ms 端口动画帧，配合按 `viewId` 隔离的瞬态拖拽滞回消除临界闪烁，同步保证离线独立 HTML 一致性。

**Independent Test**: 验证 2～4 条共路绕行线与双向互连边在宽走廊和窄走廊下均保持清晰间距、不翻侧绕大圈；带标签绕行边 `>= 90%` 完整避开卡片遮挡；节点以 `2px` 步进缓慢拖过障碍中线时绕行方向切换 `<= 1` 次且端口圆点/曲线/箭头同步贴合。

### Implementation for User Story 3

- [X] T313 [US3] 在 `src/shared/edge-routing.ts` 中实现 Pass-2 共路绕行与双向边自适应轨道分层 `separateSharedCorridors(routed, envelopes, nodes)`（FR-007，依赖 T311）：按 `corridor:${bypassClusterKey}:${bypassSide}` 聚合绕过同一障碍簇同侧的边，同时按 `pair:${minId}|${maxId}:${sideKey}` 聚合中段距离 `< 6px` 的同对双向/多关系边；组内按法向垂直轴坐标均值 → 端口序 → `relation.id` 确定性排序；测量走廊两旁卡片内壁真实净空 `W_avail`（最外侧开阔区为 `Infinity`），按 `gap = clamp((W_avail - 2 * 4) / (k - 1), 4, 10)` 计算分层步距（宽敞区 `10px`，窄缝自适应收紧至 `4～10px`，绝不将多余连线挤去障碍卡片另一侧或更外圈绕大圈）；沿分离法向平移航点（无航点的双向直连边补充中点微弧航点）重建 $G^1$ 样条，并做外侧 `card` 边界回夹防碰撞。
- [X] T314 [US3] 在 `src/shared/edge-routing.ts` 中实现关系文字标签防压卡动态择优定位 `pickLabelAnchor(spline, labelText, envelopes)`（FR-008，依赖 T307、T308）：当 `labelText` 为空时零开销直接返回中点；非空时按全角 `11px` / 半角 `6.5px` 估算标签包围盒 `boxW = clamp(estWidth + 12, 34, 180)`、`boxH = 18`（中心对齐 `MapScene` 渲染坐标 `(x, y - 8)`），在曲线总弧长 `25%～75%` 区间等距采样 9 个候选点；若线上候选均存在卡片重叠，额外测试局部曲线单位法向 `±10px` 贴线偏移候选，按（与全图所有卡片重叠面积最小 → 局部曲率更平缓 → 靠近弧长中点 `0.5`）字典序返回最优 `{ x, y }`。
- [X] T315 [US3] 在 `src/shared/edge-geometry.ts` 中导出视图级批量路由 `routeSegments(segments, nodes?, options?)` 并完整接入拖拽滞回、Pass-2 共路分层与标签择优（FR-007、FR-008、FR-009、FR-011，依赖 T310、T312、T313、T314）：在 `routeSegments` 中串联 Pass-1 `routeSingleEdge`（当 `options.dragging === true` 且上一帧 `hints[relation.id]` 对应侧仍保持 `selfHits === 0 && cardHits === 0` 时对切向对侧施加 `HYSTERESIS_COST = 24` 等效代价缓冲，原侧一旦穿卡立即撤回滞回）、Pass-2 `separateSharedCorridors` 与 `pickLabelAnchor`，并输出最新 `hints` 映射；将 `createConnections(nodes, edges, order?, options?)` 升级为返回 `{ ports, segments, hints }` 并委托 `routeSegments`，保持 `connectionGeometry` 单边向后兼容。
- [X] T316 [P] [US3] 更新 `src/client/animate-ports.ts` 中的 `useAnimatedPorts(target, nodes, viewId, options?)` 接入批量 `routeSegments`（FR-009、FR-011，依赖 T315）：将每帧 180ms 端口边缘环形滑动补间后的渲染计算从逐边调用 `connectionGeometry` 替换为统一调用 `routeSegments(interpolatedSegments, nodes, options)`，传入相同的 `nodes` 与 `{ dragging, hints }`，并显式返回 `{ ports, segments, hints }`（保持 `ReturnType<typeof createConnections>` 完整结构一致），确保动画帧与静态帧 100% 共享 1～3 段避让、共路分层、标签避卡定位及临界滞回方向。
- [X] T317 [P] [US3] 更新 `src/client/components/MapScene.tsx` 维护按 `view.id` 隔离的瞬态路由提示并透传拖拽状态（FR-009、FR-010、FR-011，依赖 T315）：新增仅存内存的 `routeHintsRef`（结构 `{ viewId: string; map: Map<string, EdgeRouteHint> }`，绝不写入 `layout.json` 或 `map.json`）；渲染期按 `const prevHints = routeHintsRef.current.viewId === view.id ? routeHintsRef.current.map : undefined` 读取同视图上一帧提示传给 `createConnections(rects, edges, undefined, { hints: prevHints, dragging })`（避免切换 `view.id` 首帧误读旧视图缓存），将本帧产出的 `connections.hints` 直接传给 `useAnimatedPorts(connections, rects, view.id, { dragging, hints: connections.hints })` 防止换边/翻侧首帧错拍，并在提交渲染后通过 `useLayoutEffect` 回写 `routeHintsRef.current = { viewId: view.id, map: connections.hints }`；保持 `<SceneEdge>`、`classifyEdgeFocus`、端口圆点配色与离线入口 `src/client/offline.tsx` 复用链路零接口破坏。

**Checkpoint**: 全部 3 个 User Stories（包括 P2 共路分离、标签防遮挡、拖拽滞回与离线 HTML 同步呈现）已完整集成。

---

## Phase 6: Polish & Cross-Cutting Concerns（回归测试、原型对齐、构建打包与人工验收）

**Purpose**: 补齐覆盖 `SC-001` 至 `SC-005` 的自动化测试与 v17 原型基线校准，执行静态检查、构建与打包验证，并记录真机与离线 HTML 人工验收项。

- [X] T318 [P] 新增专项几何与路由单元测试 `tests/shared/edge-routing.test.ts` 覆盖 `SC-001` 至 `SC-004`（依赖 T316、T317）：校验 ≥ 15 种无阻挡方位组合及自环的端切向法线误差 `< 0.01°`、零自身卡片穿透与无过度鼓包；校验 ≥ 12 个阻挡场景（同排/同列正面直挡拱桥换边、轻微擦边最小微调不绕大圈也不换边、高/宽卡与多卡交错 1～3 段平滑绕过、绝对分段数 `<= 3`、极端重叠确定性降级无 `NaN`/飞线）；校验 2～4 条共路绕行线与双向边中段分离 `>= 3.5px` 且窄缝收紧不翻侧；校验带标签绕行边 `>= 90%` 零卡片重叠；校验 `2px` 步进缓慢拖过障碍中线时 `bypassSide` 切换 `<= 1` 次；校验 20 节点 30+ 边批量耗时满足 60fps 预算且零修改输入节点坐标。
- [X] T319 [P] 更新原型基线回归测试 `tests/shared/prototype-parity.test.ts` 并复核 `tests/integration/dom.test.ts`（依赖 T316、T317）：对 `docs/knowledge_atlas_demo_v17.html` 全视图中所有无中间卡片阻挡的连线保留严格端口选边、唯一边界坐标、箭头/`stem` 几何与无折角 $G^1$ 曲线校验；对 v17 中存在正面直挡的隔卡边显式断言新版 `createConnections` 不再切割中间卡片完整外框且端口、箭头、标签保持合法无交叉；更新既有避让断言与 1～3 段自适应样条保持一致，并直接复用 `tests/integration/dom.test.ts` 既有宿主 DOM 与离线 HTML 导出用例（补充轻量烟雾断言确认 `MapScene` / 离线导出渲染新样条路径及标签且不改写既有布局坐标）。
- [X] T320 依据 `specs/011-edge-curve-avoidance/quickstart.md` 执行本地工程核验与产物打包检查（依赖 T318、T319）：运行 `npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd run pack:plugin -- --dry-run`（若用户明确授权运行自动化测试则一并执行 `npm.cmd run test`，否则按 `AGENTS.md` 约定记录测试代码已就绪但未自主执行），核查 `git status --short` 确认 `map.json` / `layout.json` 存储契约零变更且未影响无关工作区修改，整理交付与未验证项说明。
- [ ] T321 【人工验收 — 独立记录】由用户在 DSH Desktop 真机（浅色/深色主题）与导出的独立离线 HTML 阅读页中按 `specs/011-edge-curve-avoidance/quickstart.md` 第 2 节逐项复核基础弧度与无折角衔接、正面直挡拱桥与轻微擦边最小微让、多障碍 1～3 段顺滑绕行、共路分层与关系标签避卡、拖拽中线防闪烁及历史 `layout.json` 坐标 100% 保持（依赖 T320）。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup: `T306`)**: 无前置依赖，可立即开始。
- **Phase 2 (Foundational: `T307`–`T308`)**: 依赖 `T306`；二者均编辑 `src/shared/edge-routing.ts`，按 `T307 → T308` 顺序完成。
- **Phase 3 (User Story 1 / MVP: `T309`–`T310`, P1)**: 依赖 Phase 2；`T309`（`edge-routing.ts`）→ `T310`（`edge-geometry.ts`）完成后即可独立演示与验收无阻挡曲线与自环。
- **Phase 4 (User Story 2: `T311`–`T312`, P1)**: 依赖 `T309`（`T311` 仅需内核与基础构造，与 `T310` 无文件冲突）；`T311` → `T312` 完成后打通全部 P1 避让与换边能力。
- **Phase 5 (User Story 3: `T313`–`T317`, P2)**:
  - `T313` 依赖 `T311`、`T314` 依赖 `T307`–`T308`，均位于 `src/shared/edge-routing.ts`；
  - `T315` 依赖 `T310`、`T312`、`T313`、`T314`；
  - `T316`（`src/client/animate-ports.ts`）与 `T317`（`src/client/components/MapScene.tsx`）仅依赖 `T315` 且涉及不同文件，可完全 `[P]` 并行。
- **Phase 6 (Polish & Manual Acceptance: `T318`–`T321`)**:
  - `T318`（`tests/shared/edge-routing.test.ts`）与 `T319`（`tests/shared/prototype-parity.test.ts`）均依赖 `T316`、`T317`，相互独立可 `[P]` 并行；
  - `T320` 依赖 `T318`、`T319`；
  - `T321` 依赖 `T320`（独立记录用户真机与离线 HTML 人工验收）。

### User Story Dependency Graph

```text
Phase 1 (T306) ──► Phase 2 (T307 → T308)
                     │
                     ├──► Phase 3: US1 基础曲线 G1 锁定与无阻挡收敛 (T309 → T310)          [P1 / MVP]
                     │      │
                     ├──► Phase 4: US2 正面直挡换边与 1～3 段自适应避让 (T311 → T312)        [P1]
                     │      │
                     └──────┴──► Phase 5: US3 共路分层、标签避卡与拖拽滞回 (T313 → T314 → T315 ──► T316 [P] // T317 [P]) [P2]
                                   │
                                   └──► Phase 6: Polish 回归测试、构建校验与人工验收 (T318 [P] // T319 [P] → T320 → T321)
```

---

## Parallel Example: User Story 3 & Polish

```bash
# Phase 5 共享批量路由 T315 完成后，客户端两处接线可完全并行：
Task T316: "更新 src/client/animate-ports.ts 中的 useAnimatedPorts 接入批量 routeSegments"
Task T317: "更新 src/client/components/MapScene.tsx 维护按 view.id 隔离的瞬态路由提示并透传拖拽状态"

# Phase 6 回归测试可双文件并行编写：
Task T318: "新增专项几何与路由单元测试 tests/shared/edge-routing.test.ts 覆盖 SC-001 至 SC-004"
Task T319: "更新原型基线回归测试 tests/shared/prototype-parity.test.ts"
```

---

## Implementation Strategy

### MVP First (Phase 1–3 / 完整 P1 至 Phase 4)

1. **最小视觉闭环（Phase 1–3：`T306`–`T310`）**：先交付 `edge-routing.ts` 几何底座与无阻挡 $G^1$ 弧度收敛，立即消除所有常规与转角连线的端口出口/箭头折角及远距鼓包问题，独立验证 `SC-001`。
2. **完整 P1 避让（Phase 4：`T311`–`T312`）**：接入 7px 克制留白、自身卡片防回穿、最小绕行改动、正面直挡拱桥换边与 1～3 段自适应封顶绕行，独立验证 `SC-002`。

### Incremental Delivery (Phase 5–6)

3. **P2 体验打磨与动画同步（Phase 5：`T313`–`T317`）**：补齐 Pass-2 共路/双向自适应分层、标签防压卡、拖拽临界滞回，并将 `routeSegments` 同步至 180ms 端口滑轨动画与离线阅读器入口。
4. **验证与人工交付（Phase 6：`T318`–`T321`）**：并行完成专项与原型单测后执行静态构建打包校验，最后按 `quickstart.md` 交付用户在 DSH Desktop 真机与离线 HTML 中复核 `T321`。

---

## Notes

- **编号连续性**：全仓任务编号唯一，紧接 `010` 末尾 `T305`，本特性从 `T306` 起连续编排至 `T321`。
- **AGENTS.md 开发约定**：UI/视觉与浏览器测试需在用户明确要求时由 Agent 执行自动化验证，日常开发仅完成代码、测试代码编写与 `typecheck` / `build` / `pack:plugin -- --dry-run` 构建检查；实现完成与人工验收在 `T320` / `T321` 分别记录。
- **零侵入保障**：`map.json`、`layout.json`、提示词文件、服务端工具及 `010` 未提交修改均不受本任务列表改动范围影响。
