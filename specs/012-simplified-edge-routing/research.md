# Phase 0 Research: 简化节点连线路由、焦点提层与自适应关系胶囊标签

**Feature**: `012-simplified-edge-routing` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

---

## 0. `011` 方案失败复盘与结构性根因

对现行 `src/shared/edge-routing.ts`（1,980 行）与实际画布渲染效果及交互崩溃的排查确认了 3 个核心根因：

1. **硬性零碰卡约束导致过度避让与曲率畸变**：
   - 现行 `isBetterCandidate` 将 `cardHits === 0` 设为凌驾一切的绝对门槛。只要斜向跨列连线（如 `党内权力斗争 → 大清洗`、`雅尔塔体系 → 冷战与东欧`）轻微擦碰中间或邻近卡片外框与 `7px` 留白区，就会被迫切入 Stage 2/3 生成极端非对称控制臂或多段深 U/过山车式大弯。
2. **固定居中端口 + 未拉直小错位导致“该直的地方弯”**：
   - `place(group)` 把单端口卡片放在自身 `height / 2`（不同正文行数的卡片中心高度天然差 10～30px）；同时一侧挂 2 个错开端口而对侧只有 1 个端口时（如 `民族事务人民委员 → 总书记之路`），两端无法水平对齐，导致原本应当笔直的水平线全被画成起伏的小 S 弯。
3. **高复杂度采样与动画每帧全量重算引发卡顿与崩溃**：
   - `evaluateSpline` 对每条边生成多阶段 30～80 个候选，每个候选最多 3 段 × 48 采样点并在内层遍历全部卡片计算距离；配合 `useAnimatedPorts` 180ms 帧循环和拖拽指针高频更新，造成巨大 CPU 与 GC 压力。

---

## 1. 放弃全局多卡避让，精简为 ~280～340 行 $O(E)$ 局部几何引擎（FR-001）

### Decision
- 完全删除全局多卡安全包络构造、障碍簇合并、2～3 段向心样条搜索与 Pass-2 共路轨道重算（从 `src/shared/edge-routing.ts` 删减约 1,650 行复杂逻辑，将其收束为约 **280～340 行** 纯局部几何函数，单次视图全量路由复杂度严格控制在 **$O(E)$**）。
- 允许一般斜向及跨分组连线从无关卡片下层（`z-index: 1`）平稳穿过，由不透明卡片本体（`z-index: 2`）自然遮挡局部线段，不再为了零遮挡而强行拉扯丑陋大弯。

### Rationale
- 业界主流现代交互式节点画布（React Flow、Obsidian Canvas、Heptabase、FigJam、Excalidraw）均证明：自由拖拽画布下只有将几何复杂度降到单边 $O(1)$、全局 $O(E)$，才能在 40+ 节点、60+ 边拖动时保持稳健 60fps、零拓扑闪烁与零崩溃；人眼借助格式塔连续性 + 选中节点提层高亮即可轻松辨识穿底关系。

### Alternatives Considered
- **继续保留缩水版多卡避让/局部微调采样**：只要存在“对非端点任意卡片做曲线采样避让 + 离散候选切换”，就无法根本消除临界闪烁、奇形反弯与高频重算压力，已彻底放弃。
- **改用 SmoothStep 直角圆角折线作为全局唯一风格**：违背项目宪章第 V 条延续 HTML v17 柔和曲线视觉语言的要求，已放弃。

---

## 2. 该直则直：单端口顶距基准、轴向投影对齐与死区拉直（FR-002 / Q2 & Q3 Option A）

### Decision
落地三层递进的直线化策略，彻底消灭不必要的小 S 弯并保证零箭头折角：

1. **左右侧单端口固定顶距基准（Q2 Option A）**：
   - 在 `place(group)` 中，当 `side === 'left' || side === 'right'` 且同侧仅 1 个端口、未触发投影改写时，默认不再放 `height / 2`，而是锚定在距卡片顶部固定高度 `SINGLE_SIDE_TOP_OFFSET = 43`（并钳位在安全内边距 `[insetY, height - insetY]` 内，其中 `insetY = Math.min(height / 4, 18)`）。
   - 该数值恰好等于 HTML v17 标准 86px 卡片的垂直中线（`86 / 2 = 43`）：既对常规高度卡片保持完全居中的原型观感，又使同一排顶部对齐的高矮不一卡片串联时共用同一条平直水平主干线。上下边（`top`/`bottom`）单端口保持水平居中 `width / 2`。
2. **面对面单端口轴向投影对齐**：
   - 在 `createConnections` 的 `place(group)` 完成端口初始坐标分配后，对所有面对面边（`left↔right` 或 `top↔bottom`，且 `!self`）执行一次轻量对齐扫描：
     - 统计每个 `(nodeId, side)` 上的端口数 `sideCount`。
     - 若一端 `sideCount === 1` 而另一端 `sideCount > 1`（或两端均 `=== 1` 但因卡片自身错位/不同顶距导致坐标不等）：将单端口端的自由轴坐标（左右边为 `y`，上下边为 `x`）向对端端口坐标投影并钳位到该单端口卡片的安全区间 `[min + inset, max - inset]` 内。
     - **关键安全约束**：仅当对端端口坐标**本身落在**单端口卡片安全区间内（即两卡在该轴上存在足够面对面投影重叠，或已非常接近安全区边缘且距离偏移未越界）时才吸附对齐，**绝不把跨行/跨列大斜边强行吸进角落**。当双方均 `sideCount === 1` 且都可移动时，优先将目标单端口对齐到起点端口（若起点无法覆盖目标安全区再反向尝试）。
3. **小错位死区拉直 + 顺线箭头对齐（Q3 Option A）**：
   - 定义 `STRAIGHT_DEADZONE = 16` 与 `MIN_STRAIGHT_SPAN = 24`。
   - 对非自环、面对面端口（`dotN < -0.5`）：计算端点沿出射方向的正向净跨度 `dParallel = (b - a) · us` 与横向错位 `dPerp = |((b - a) · perp)|`（使用最终端口 `a`、`b` 坐标）。
   - 当 `dParallel >= MIN_STRAIGHT_SPAN && dPerp <= STRAIGHT_DEADZONE` 时判定为**直线模式**：
     - 输出纯直线几何路径 `M ps.x ps.y L pe.x pe.y`（无三次贝塞尔反曲点）；
     - **箭头与 `3px stem` 方向（Q3 Option A）**：令输入箭头入向取直线方向单位向量 `dirIn = normalize(b - a)`，起点取 `ps = a`，终点取 `b - dirIn * (INPUT_PORT_OUTER_RADIUS + ARROW_LENGTH + STEM_LENGTH)`（即从输入圆外沿 `4px` 停靠尖端沿直线逆推），使箭头尖端严密贴合输入圆外沿且整条直线、短接段与箭头 $180^\circ$ 共线，零小 S 弯且零箭头折角。

### Rationale
- 组合“顶距基准 + 轴向投影对齐 + 16px 死区顺线直连”后，无论高度差、多端口对单端口，还是多端口对多端口轻微错位，所有视觉上应当为直线的关系都会干脆拉直，代码不足 60 行且零遍历开销。

### Alternatives Considered
- **仅做居中 + 16px 死区拉直**：无法解决同排多张高矮卡串联或一侧 2 端口对另一侧 1 端口错开 25px+ 的问题，已排除。
- **直线模式下箭头强行保留水平/垂直法线**：会在斜直线上造成箭头与直线根部微折角，已由 Q3 Option A 排除。

---

## 3. 弧度受控的单段平滑曲线与原生多端口/双向分离（FR-003 / FR-008 / FR-010）

### Decision
1. **端切向垂直端口边缘的限幅单段贝塞尔（曲线模式）**：
   - 保持起点 `ps = a`、终点 `pe` 沿输入端口外法线 `ut` 预留 `INPUT_PORT_OUTER_RADIUS(4) + ARROW_LENGTH(8) + STEM_LENGTH(3) = 15px`，输出一段三次贝塞尔 `C c1 c2 pe`，首末控制点严格锁在端口外法线射线上（$c_1 = p_s + h_s \vec{u}_s$，$c_2 = p_e + h_e \vec{u}_t$）：
   - **对边非直线曲线（`dotN < -0.5`）**：
     - 正向连接（`dParallel >= 0`）：`handle = clamp(dParallel * 0.42, 24, MAX_BEZIER_HANDLE)`（其中 `MAX_BEZIER_HANDLE = 110`），封顶 `110px` 彻底根治跨多列超长边中段拉平后大鼓包；
     - 反向回环连接（`dParallel < 0`）：`handle = clamp(32 + Math.sqrt(Math.abs(dParallel) * 18) + dPerp * 0.15, 42, 120)`，形成舒展圆润的回环而不甩飞。
   - **邻边转角（`|dotN| <= 0.5`）**：
     - `pS = Math.max(0, dx * us.x + dy * us.y)`、`pT = Math.max(0, -(dx * ut.x + dy * ut.y))`，取 `hs = clamp(Math.max(0.55 * pS, 0.25 * L), 22, MAX_BEZIER_HANDLE)`、`he = clamp(Math.max(0.55 * pT, 0.25 * L), 22, MAX_BEZIER_HANDLE)`。
   - **同侧拱桥（`dotN > 0.5`）**：
     - 保留单段对称拱弧：`a0 = clamp(0.18 * lPerp + 26, 36, 92)`；若带有隔卡净空高度 `archClearance`（默认 `0`），取 `baseH = Math.max(a0, (4 / 3) * (archClearance + 14))` 并封顶 `MAX_ARCH_HANDLE = 148`，再补平双端出射高度差 `hs = baseH + Math.max(0, dOut)`、`he = baseH + Math.max(0, -dOut)`。
   - **自环（`self === true`）**：
     - 保留简洁的卡片右侧外伸双段圆润回环，水平出口与水平入箭头零折角。
2. **多端口与双向互连分离（`FR-008`）**：
   - 同侧多端口与两卡间双向/并行互连，天然通过 `createConnections` 既有的 `projectedOrder` 防交叉排序、`tie` 稳定比较与 `place(group)` 等距分布（垂直边 `17px` 步距、水平边 `24px` 步距）错开起止坐标；由于对边弧度由各自端点几何生成，平行双边与双向互连天生保持可分辨并行间距，无需再在路由层额外写脆弱的 Pass-2 车道重排器。

### Rationale
- 统一在 `buildEdgeCurve`（~90 行）内完成直线、对边限幅曲线、邻边转角、同侧拱桥与自环 5 种形态，彻底保证无多段蛇形弯、无反弯点拧结、无大鼓包。

---

## 4. 轻量同排/同列隔卡直连拱桥（FR-004 / FR-009）

### Decision
仅保留一层极轻的**纯矩形通道判定**（完全不做贝塞尔离散采样）：
1. **严格触发条件**：
   - 仅当 `!order && !self`、初选为面对面端口（水平 `right↔left` 或垂直 `bottom↔top`），且两卡满足同排/同列正对条件（非端点垂直投影重叠 `>= 0` 或中心差 `<= 0.5 * Math.min(dimA, dimB)`）；
   - 扫描严格位于 $A$ 与 $B$ 中心区间内的其他卡片矩形 `obs`：计算其与直连走廊中心带（`[minPortAxis, maxPortAxis]`）的垂直嵌入深度 `depth`；
   - **滞回进出门槛（`FR-009`）**：常规或首次进入需深度阻挡 `depth >= Math.min(HEAD_ON_ENTER_DEPTH, 0.25 * obsDim)`（`HEAD_ON_ENTER_DEPTH = 18`）；当处于 `dragging === true` 且上一帧 `prevHint` 已经走了同侧拱桥时，退出门槛放宽至 `depth < HEAD_ON_EXIT_DEPTH`（`HEAD_ON_EXIT_DEPTH = 6`），避免卡片在临界边缘晃动时直连/拱桥来回跳闪。
2. **选侧规则与低成本滞回**：
   - 水平直挡评估 `'top'` 与 `'bottom'` 两侧（垂直直挡评估 `'left'` 与 `'right'` 两侧）。
   - 对每一候选侧，计算在 `[minCardEdge, maxCardEdge]` 区间跨过阻塞卡片外沿所需的外伸高度 `archClearance` 与拱弧带上邻近阻塞卡数量，综合 `archClearance + nearbyPenalty` 选更宽敞一侧（平手优先 `'top'` / `'left'`）；拖拽期间对背离上一帧 `prevHint.sourceSide` 的对侧施加 `ARCH_HYSTERESIS = 24` 缓冲。
   - 选中侧写入 `spec.sourceSide`、`spec.targetSide` 与 `spec.archClearance`，随后直接进入现有 `place(group)` 与单段对称拱桥计算，与 `useAnimatedPorts` 180ms 沿边框圆弧滑轨动画天然衔接。

### Rationale
- 全函数不超过 80 行且只做简单矩形区间比较（零路径采样、零嵌套克隆），40 节点画布下总耗时不到 `0.05ms`；仅在明确同排/同列正面堵死时架拱桥，绝不干扰斜向穿底边。

---

## 5. 四层视觉渲染栈与仅单击选中提层（FR-005 / Q1 Option A）

### Decision
升级 `MapScene.tsx` 与 `atlas.css` / `dark.css` 渲染层级，保持离线导出 `offline.tsx` 自动继承：
- **图层栈（由底到顶）**：
  1. `.group-area`（`z-index: 0`）：半透明分组容器；
  2. `<svg className="edges edges-base">`（`z-index: 1`）：未选中时渲染全部连线，选中节点时渲染所有非直接关联的 `dimmed` 连线（保持不透明节点卡片之下穿底）；
  3. `.node`（`z-index: 2`）：不透明暖纸/深色节点卡片，自然压住底层穿底连线；
  4. `<svg className="edges edges-focus">`（`z-index: 5`，仅当 `selected` 非空且存在关联边时渲染）：渲染与选中节点直接相连的 `in` / `out` / `supplement` 高亮连线，完整越过所有卡片之上，并在每条高亮路径下方附带一层柔和宽描边光晕（或清晰的强调线宽）提升跨卡可读性；
  5. `<div className="edge-labels">`（`z-index: 6`，含 `.edge-pill.is-focused` 保持在 `z-index: 7`）：渲染所有关系胶囊节点；
  6. `<svg className="atlas-ports">`（`z-index: 9`）：始终置于最顶层的输入/输出端口圆点（雾霾蓝实心圆 `#8699aa` / 灰豆沙 2px 空心圆 `#b38c97`）。
- **交互规则（Q1 Option A）**：仅由 `selected` 状态（单击节点选中/取消选中）决定是否将直接关联边与胶囊提至上层；严禁绑定 `onMouseEnter` / `:hover` 触发连线提层。

### Rationale
- SVG 元素内部不支持跨独立容器的 CSS `z-index` 分层，因此拆分为 `edges-base` 与按需条件渲染的 `edges-focus` 两个轻量 `<svg>` 层是唯一干净、无重排且与现有 `.edges` 样式和 `offline.tsx` 100% 兼容的做法。

---

## 6. 沿线自动避卡移动的关系胶囊标签（FR-006 / FR-007 / FR-008 / SC-004）

### Decision
1. **HTML 圆角胶囊节点替代 SVG 描边文字**：
   - 将原 `<text className="edge-label" x={labelX} y={labelY - 8}>` 替换为 `<div className="edge-labels">` 内的 `<span className="edge-pill" data-relation={r.id} data-focus={...} title={r.label}>`（按 `left: ${labelX}px; top: ${labelY}px; transform: translate(-50%, -50%)` 精准中心骑跨在曲线上）。
   - 样式严格融入暖纸浅/深双主题：
     - 浅色：`background: rgba(255, 253, 248, 0.94)`、`border: 1px solid #dfd6c7`、`color: #6b6154`、`box-shadow: 0 2px 6px rgba(77, 59, 35, 0.08)`；
     - 深色：`background: rgba(37, 35, 31, 0.94)`、`border: 1px solid #443e35`、`color: #cfc4b3`、`box-shadow: 0 2px 8px rgba(0, 0, 0, 0.32)`；
     - 高亮态（`focusRole === 'in' | 'out' | 'supplement'`）：边框与文字颜色绑定对应 `--edge-primary` / `--edge-secondary`，胶囊层级升至 `edges-focus` 之上；淡化态（`dimmed`）：透明度降为 `0.22` 且 `pointer-events: none`。
   - 长文本防撑爆：设定 `max-width: 132px`、`white-space: nowrap`、`overflow: hidden`、`text-overflow: ellipsis`、`pointer-events: auto`、`cursor: default`，并附带原生 `title={r.label}` 悬停显示完整文字。
2. **沿线 7 点轻量自动避卡探测（`pickPillAnchor`）**：
   - 仅当 `relation.label?.trim()` 非空时执行（无标签边零开销）。
   - 按字符宽度估算胶囊盒尺寸 `estW = clamp(charWidth + 18, 36, PILL_MAX_WIDTH)`、`PILL_HEIGHT = 22`；
   - 沿真实曲线或直线按固定 7 个参数位置探测：`t ∈ [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8]`；
   - 对每个候选点以 `(x, y)` 为中心构建 `Box`，校验是否与视图内**全部卡片矩形**（外扩 `PILL_CARD_MARGIN = 4px` 视觉呼吸隙）或**已放置的相邻胶囊框**存在 AABB 相交：
     - 选出**第一个完全无碰撞（与卡片及已放胶囊均无重叠）**的候选点；
     - 若所有候选均仅与“已放置胶囊”重叠而避开了卡片，选避开卡片且与其他胶囊重叠面积最小的候选点；
     - **极短连线兜底**：若 7 个候选全部压到端点/相邻卡片（说明两卡间隙极窄），直接稳妥回退居中位置 `t = 0.5`，绝不飞离连线或跑到卡片外部。

### Rationale
- 7 点固定 AABB 测试单边最多执行 $7 \times N$ 次简单浮点比对（40 节点下不足 `0.003ms`），比连续弧长采样重排快两个数量级；居中回退 + `132px` 截断彻底解决了短竖直线糊字与超长文字盖卡片问题。

### Alternatives Considered
- **继续使用 SVG `<text>` + `<rect>` 胶囊**：无法优雅享受 CSS `text-overflow: ellipsis` 截断、自适应字体测量、阴影与暗色过渡样式，且难以把焦点胶囊独立提至上层而不和下层线混在一起，已排除。
- **支持手动拖动胶囊并将坐标写入 `layout.json`**：违背 `FR-011` 与零存储格式变更约束，已排除。
