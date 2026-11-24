# Phase 0 Research: 多分组跨组卡片排版与连线路由深度优化

**Feature**: `014-multigroup-layout-routing` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

**Inputs**: [调查研究报告](../../docs/research/MinerU_markdown_202611242123087_9d94c05c.md)、[研究交接文档](../../docs/layout-routing-research-handoff.md)、[存储契约](../../docs/mindmap-storage-format.md)、[项目宪章](../../.specify/memory/constitution.md) 及现行源码（`src/shared/layout.ts`、`src/shared/edge-routing.ts`、`src/shared/edge-geometry.ts`、`src/client/components/MapScene.tsx`、`src/client/animate-ports.ts`、`src/client/hooks/useViewportLayout.ts`、`src/client/components/MapHeader.tsx`）。

---

## 1. 核心架构与技术决策

### Decision 1: “低频全局实高联合求解 + 高频局部 $O(E)$ 路由精修”双层协同架构
- **Decision**: 保持零新增外部依赖，将全视图多分组拓扑拆解与交叉/穿卡寻优收敛在低频布局期（`src/shared/layout.ts`）；渲染与拖拽期间（`src/shared/edge-routing.ts`、`src/shared/edge-geometry.ts`、`src/client/animate-ports.ts`）死守单段柔和曲线（非自环至多 1 段）、端口外法线 $G^1$ 锁定、零曲线采样循环与 $O(E)$ 局部几何精修。
- **Rationale**: 吸取 `011` 在渲染期执行全局多段避让导致 `edge-routing.ts` 膨胀至 ~1,980 行、拖拽掉帧与绕出深 U 大弯的教训，布局层与路由层通过同一套四向选边、单端口锚点、拉直死区与跨度感知拱桥数学判定深度对齐，在不影响拖拽跟手帧率的前提下从源头消除跨卡穿刺、交叉和长斜线。
- **Alternatives considered**:
  - 引入 Dagre / ELK / React Flow：违反项目宪章第四条“无重型外部图形库”且难以无缝保留现有 3 列离散网格与暖纸样式；否决。
  - 在渲染期重新做多段采样避让：会重蹈 `011` 帧率崩溃和蛇形大弯覆辙；否决。

### Decision 2: 实测高度重建与 $O(1)$ 闭式四分位曲线代理（`evalProxyQ25Q75`）
- **Decision**: 彻底移除 `src/shared/layout.ts` 中硬编码的 `row * 162` 与 `130px`，封装 `computeViewGeometry()` 每次按各行 `max(nodeHeight(heights, viewId, id)) + ROW_GAP(32)` 重建精确卡片和分组 `rects`；同时构造与 `edge-geometry.ts` / `edge-routing.ts` 数学同构的闭式 3 段代理折线 $(P_0, Q_{0.25}, Q_{0.75}, P_3)$，配合非端点卡片内缩 `4px` 的 Liang-Barsky $O(1)$ 解析线段-矩形穿刺检测与 AABB 预剪枝精确线段交叉检测。
- **Rationale**: 研究原型对照表明，$t = 0.25, 0.75$ 四分位点恰好捕捉对边 S 形三次贝塞尔理论最大肩部偏移（极值位于 $0.5 \pm \sqrt{3}/6 \approx 0.211, 0.789$）的 **97.4%**，相比 `t = 1/3, 2/3` 在 `wwi_grid` 上可实现零穿刺（2 → 0）并在 40 节点压力图上更稳健；启用实测高度后 `varied_heights`（86–260px）穿刺数直接减半且消除了布局期“假阴性”漏判。
- **Alternatives considered**:
  - 在布局期逐边采样 24–48 点检测真实曲线碰撞：在 40 节点图上会造成数十倍性能退化；否决。
  - 采用 $t = 1/3, 2/3$ 三分位代理：虽在个别场景略降总长，但在 `wwi_grid` 与压力图上穿刺控制不如 $t = 0.25, 0.75$ 稳健；保留为可配置备选但不作默认。

### Decision 3: Tarjan SCC + 加权边界感知 GreedyFAS 破环与跨组外侧回边牵引
- **Decision**: 升级 `computeTopology` 环路分解为四步确定性流程：
  1. **双向边（2-Cycle）预分离**：识别同时存在 $u \to v$ 与 $v \to u$ 的边对，优先保留高权边（`dependency = 1.0` > `supplement = 0.6`）与原叙事序 $u < v$ 为正向边，反向边记入 `backEdges`；
  2. **Tarjan SCC 分解**：在扣除已标双向逆边后的子图上识别节点数 $\ge 2$ 的非平凡强连通分量 `sccId`；
  3. **加权边界感知 GreedyFAS**：对每个非平凡分量剥离零出度汇点（入右栈 `s2`）与零入度源点（入左栈 `s1`），无源无汇时赋 `dependency` 边权 `2.0`、`supplement` 边权 `0.5`，按 $\Phi(u) = (w_{\text{out}}(u) - w_{\text{in}}(u)) + 0.35(\text{extInBias}(u) - \text{extOutBias}(u))$ 最大化选点入 `s1`（平局按原始下标确定性破平局），逆序边记为组内回边 `intra_fb`；
  4. **极小 FAS 清洗**：按边权降序复核非双向回边，若当前 DAG 已无 $v \to u$ 路径则安全恢复为正向边。
  随后在目标函数中对 `intra_fb` 豁免 `+45 / +15` 逆流罚并施加同 SCC 紧聚引力 `+18 * (dr + dc - 1)`；对跨组回边（`bucket(u) > bucket(v)`）和跳组边（`|bucket(u) - bucket(v)| >= 2`）落在最外侧边界列（`!isInteriorX`）给予 `-75 * w` 奖励。
- **Rationale**: 解决现行“朴素入度破环拆散主干、对回边照常逆流罚以及跨组反馈穿心”痛点。关于“短线穿底 vs 外侧避卡”的帕累托权衡，默认采用外侧通道奖励 `-75 * w` 将长回边牵引至外边界拱桥，可使穿刺减少 50% 以上（若未来需调轻外绕比例，仅需平滑微调该权重常量）。
- **Alternatives considered**:
  - 维持 Kahn 最小剩余入度贪心破环：会打乱 2-cycle 与 3/4-cycle 主骨架并错罚回边；否决。

### Decision 4: 四阶段全局联合寻优与增量缓存加速
- **Decision**: 将孤立逐桶贪心升级为 `solveGlobalViewLayout` 四阶段确定性联合求解：
  - **阶段一（桶内初始种子）**：孤立桶严格按输入顺序平铺；满足无外边、全连通、无环且存在分叉/汇合的独立桶延续 `useLayeredSeed`；其余桶按加权 FAS 拓扑序 S 型蛇形填充；
  - **阶段二（跨组双向重心初排）**：存在 $\ge 2$ 分桶且有跨组边时执行 3 趟交替重心扫描（下 → 上 → 下），`grid` 模式下对同排左右组邻居施加 `1.5×` 朝向内侧边界列（左组靠右 `cols - 1`，右组靠左 `0`）的引力；
  - **阶段三（纵向 `3!` 列置换脱困）**：`vertical` 模式下对每个 3 列分桶尝试全部 5 种非恒等列置换并上下交替扫掠最多 2 轮，快速解开跨多组交叉结；
  - **阶段四（全局交替 Sifting + 跨桶耦合列交换）**：按节点度数降序试探同桶节点交换与迁入空槽，每轮后对相邻分桶对 `(k, k+1)`（`grid` 额外含纵向对 `(k, k+2)`）尝试同步交换列 `c1 ↔ c2`。
  **性能优化**: 结合**候选探索期刚性位移冻结分桶**（仅 commit 胜出动作时全量重算下游位移）、**脏边 AABB 外扩 `24px` 裁剪 + 对称对价矩阵 `crossMat`（扁平 `Float64Array` / `Int32Array`）**，以及按单视图规模自适应收敛上限（$\le 25$ 节点：全局 4 轮、Sifting 2 趟；$> 25$ 节点：全局 2 轮、Sifting 1 趟）。
- **Rationale**: 在纯 Python 原型中已将 40 节点 / 64 边压力图求解加速 **3.85 倍**，同时打破双组对称死锁并在 `grid_coupled` 场景下将卡片穿刺由 10 次压降至 1 次（-90.0%）。

### Decision 5: 默认保持严格三列离散网格 & 保留分组叙事顺序
- **Decision**: 不对不满 3 列的非对齐行默认启用半步连续重心微调，继续严格保持三列离散对齐；`vertical` 与 `grid` 默认严格保留 `views[].groups[]` 原始数组顺序，不自动重排分组先后次序。
- **Rationale**: 定量对照证明，半步连续重心虽可使纯对称 3→2 汇合总长降 9.7%，却使 1 对 1 垂直连线失去直线对齐（0/2）并拉长 19.5%；保留严格 3 列和原有叙事顺序符合《存储契约》与《斯大林/一战回归测试》稳定预期。

### Decision 6: 斜率感知双向斜线配对 & 同向平行斜线反相偏置（含全四向符号验证）
- **Decision**:
  1. 在 `createConnections` 中按无序节点对 `{min(u, v), max(u, v)}` 分组：对同时存在 `u → v` 与 `v → u` 且面对面的双向边，当跨轴中心偏移满足 `|delta| >= BIDIR_SLOPE_ENTER(24)`（若拖拽中上一帧 `hints?.get(id)?.bidirFlipped === true` 则使用退出滞回 `BIDIR_SLOPE_EXIT(12)`）时注入确定性 `bidirRank`——以水平边 `dy_lr = centerY(rightNode) - centerY(leftNode)` 为例，`dy_lr > 0`（左高右低）令由右向左逆边占上槽（`rank = 0`）、由左向右正边占下槽（`rank = 1`），`dy_lr < 0` 时反转（垂直边按 `dx_tb = centerX(bottomNode) - centerX(topNode)` 对称），并记录 `bidirFlipped` 至 `EdgeRouteHint`；
  2. 对同节点对且同向面对面的 $k \ge 2$ 条平行斜线（`|dPerp| >= 32`），按 `axisDelta`（**严格取与端口排序 `place()` 一致的正方向轴差**：`left`/`right` 边取 `pe.y - ps.y`，`top`/`bottom` 边取 `pe.x - ps.x`）与边索引 $i \in [0, k-1]$ 计算反相偏置：
     $$\delta_i = \text{clamp}(0.08 |d_{\text{axis}}|, 0, 18) \cdot \left(i - \frac{k-1}{2}\right) \cdot \text{sign}(d_{\text{axis}}), \qquad h'_{s,i} = h - \delta_i,\; h'_{e,i} = h + \delta_i$$
     且限制偏置后控制臂不跌破安全最小臂长（如 `Math.max(18, h - delta)`），同时将 `hsBias` / `heBias` 透传至 `RoutedSegment` 供 `useAnimatedPorts` 复用。
- **Rationale**: 修正现行 `computePortEndpoints` 退缩 `15px` 导致双向斜线中段拐点交叉的反几何效应，且显式统一 `axisDelta` 方向与 `place()` 增序（上到下 / 左到右），保证 `right→left`、`left→right`、`bottom→top`、`top→bottom` 四个方向全部向外展开而非向内挤压。

### Decision 7: 跨度感知外侧拱桥、顶/左精确代数护栏与彩虹分层 + LIFO 嵌套端口序
- **Decision**:
  1. **跨度感知外卡检测**：在 `selectInlineBlockedSides` 中，判定 `hasOuterCard` 时仅检查主轴投影与当前拱桥外包跨度 `[Math.min(a.m0, b.m0) - 16, Math.max(a.m1, b.m1) + 16]` 有重叠的卡片；
  2. **顶拱优先避让与顶/左护栏钳位**：水平拱桥选择 `top` 时，若任一端卡顶边处于所属分组顶边 `TOP_ARCH_GROUP_PROXIMITY(80)` 以内（通过 `options?.groups` 查询所属分组矩形），向 `top` 候选叠加 `TOP_ARCH_GROUP_PENALTY(60)` 以优先走空旷下侧；在 `buildEdgeCurve` 中对必须走 `top` 或 `left` 的拱桥按真实贝塞尔中点极值式反解上限：
     $$\text{baseH}_{\max} = \max\left(18,\; \frac{p_s + p_e + 6\min(p_s, p_e) - 8\, c_{\text{ceil}}}{6}\right)$$
     顶拱安全天花板 $y_{\text{ceil}}$ 取所属分组 `group.y + 36`（无所属分组且 `min(ps.y, pe.y) > 14` 时取画布顶边距 `14`，若合成测试卡位于 `y <= 14` 则不额外下压以兼容现有 `edge-routing.test.ts` 原点测试断言）；左拱安全左界 $x_{\text{ceil}}$ 取 `Math.max(10, adjLeftGroupRight + 6)`（双列 `grid` 下同时防左拱触及左列相邻分组标题）；
  3. **区间图彩虹分层 + 成对 LIFO 嵌套端口序**：`selectInlineBlockedSides` 对同侧（同一 `side` 及相近外侧通道）激活拱桥按跨度 `[spanLo, spanHi]` 升序贪心分配非重叠轨道 `archLane`（`8px` 裕量），`buildEdgeCurve` 按 `baseH += archLane * 24`（封顶 `180`，仍受前述标题/左边界护栏严格钳位）外推；**必须同步在 `edge-geometry.ts` 中对 `archActive` 拱桥端口启用反号 LIFO 投影** `-(axis - center) / 24`（仅在同侧存在多条拱桥或与非拱桥混排时按方向正确展开），确保共享同一端点的长拱桥占外端口、短拱桥占内端口。

### Decision 8: 四维防遮盖胶囊定位（兼顾 `pickPillAnchor` 旧签名向后兼容）
- **Decision**: 在 `routeSegments` 中分两趟执行：第一趟构造全图 `curves` 及其 **3 段闭式弦**（`t = 0, 1/3, 2/3, 1`）与全端口/箭头 **保护盒 `portBoxes`**（输出圆点 `±5px`；输入圆点与箭头三角形包围盒外扩 `5px`）；第二趟调用升级版 `pickPillAnchor(curve, labelText, rects, placedPills?, options?)`：
  - **9 候选探测序列**：`[0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8, 0.14, 0.86]`，严格分级择优：（1）不压任意卡片（+4px）或最小压卡面积；（2）最小化 `4 * placedOverlap + 3 * portArrowOverlap + 2 * otherChordOverlap`；（3）最贴近中点；
  - **水平短边特化**（`|dy| < 20 && span ∈ [40, 120)`）：将 `(ps + p3) / 2` 设为首选探测点并计算自适应 `maxWidth = clamp(span - 18, 54, 132)`；
  - **竖向短边侧鞍悬停**（`|dx| < 20 && span ∈ (0, 60)`）：追加右侧 `(shaftX + pillW / 2 + 10, gapMidY)` 与左侧 `(shaftX - pillW / 2 - 10, gapMidY)` 侧鞍候选；
  - **向后兼容保障**：未传入第 5 参 `options`（或未触发水平短边收窄）时，返回对象严格仅包含 `{ x, y }`，确保既有用例 `assert.deepEqual(pickPillAnchor(...), evalCurvePoint(...))` 100% 兼容不报错。

### Decision 9: 高亮光晕、动画态透传、框内补位与局部整理入口
- **Decision**:
  1. `MapScene.tsx` 向 `createConnections` 与 `useAnimatedPorts` 透传 `groups: visualLayout.groups`；`SceneEdge` 在 `focused === true` 底层追加一条同路径 `d` 光晕描边（`stroke="var(--canvas, #faf7ef)"`, `strokeWidth: 5`, `opacity: 0.72`, `strokeDasharray: 'none'`），`ScenePill` 应用可选 `style={{ left: x, top: y, maxWidth }}`；
  2. `useAnimatedPorts.ts` 的插值重建保留每条边的 `archLane`、`hsBias`、`heBias`、`bidirFlipped` 并透传 `groups` 给 `routeSegments`，确保 `180ms` 滑轨过渡期拱桥、平行展开和短边胶囊不跳变；
  3. `placeNearNeighbors` 在 `oldGroup` 存在时同步枚举框内全部未占用标准网格槽位，将 `outOfGroupPenalty` 由 `150` 提至 `420`、距离权重系数设为 `0.5`，既护住框内归属又不锁死全满框时的安全回退；
  4. `relayoutViewPartial` 支持 `scope: 'unlocked'`（钉死全部 `manual: true` 与既有 `groups`，对碰撞锁定卡施加 `+5000` 硬隔离，未锁定节点跑全视图实高全局求解）及 `scope: { groupId }`（钉死其余全部分组与成员，可选 `refitTargetGroup`），并在 `useViewportLayout.ts` 封装 `relayoutPartial` 接入 `EditSession.setLayout`；`MapHeader.tsx` 在重置按钮旁新增轻量图标按钮“整理未锁定节点”（`onTidyUnlocked`，离线导出 `offline.tsx` 不展示）。

---

## 2. 风险与缓解措施

| 风险点 | 缓解设计 |
| --- | --- |
| 顶拱护栏与现有无 `groups` 原点单测（`card(0,0)`）冲突 | 仅当传入包含卡片的 `group` 时应用 `group.y + 36`，无所属分组时仅在 `min(ps.y, pe.y) > 14` 时启用画布顶边距 `14` 钳位。 |
| `pickPillAnchor` 返回新增 `maxWidth` 字段破坏旧 `deepEqual` 测试 | 仅在传入 `options` 且命中水平短边条件时附带 `maxWidth` 属性；常规边与 3/4 参调用严格返回纯 `{ x, y }`。 |
| 平行斜线反向方向（如 `right→left` 或 `top→bottom`）偏置反号导致挤拢 | 统一以端口坐标增序（`left`/`right` 取 `pe.y - ps.y`，`top`/`bottom` 取 `pe.x - ps.x`）作为 `axisDelta` 符号源，并通过四向对称单测覆盖验证。 |
| 40 节点满载重排或全锁定部分整理在 V8 出现偶发超时或无解回退 | 采用扁平 `Float64Array` / `Int32Array` 缓存与规模自适应轮次；全锁定或锁定卡紧密无网格空槽时直接原样保留锁定卡并通过增量无碰撞网格/走廊搜寻安放未锁定卡。 |
