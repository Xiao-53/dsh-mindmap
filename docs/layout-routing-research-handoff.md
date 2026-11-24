# dsh-mindmap 排列、连线与背景方案研究交接文档

**目标读者**：专用于布局与连线算法设计与优化的研究 AI  
**仓库基线**：`0.4.5-preview.5`（commit `6eac350`）  
**文档用途**：完整说明当前思维导图画布的**节点卡片排列**、**节点连线与标签路由**、**背景与分组容器放置方式**、**硬性架构约束**、**历次尝试过的方案与失败/撤回原因**，以及**当前仍未解决的核心痛点**。

---

## 一、核心硬约束与职责边界（优化方案不可突破）

1. **AI 内容层与界面呈现层严格分离**（见 `docs/mindmap-storage-format.md`、`src/server/prompts/authoring.ts`）：
   - DSH 内容生成只输出 `map.json`（`schemaVersion: 1`）与节点 Markdown，**绝不生成坐标、样式、SVG 路径或布局提示**。
   - 默认单视图建议最多 **20 个显示节点**（按 `views[].occurrences` 计数），允许无前置节点（入度为 0）与关系成环（`views[].parentViewId` 不允许成环）。
2. **零存储格式破坏与既有布局保护**（`src/shared/validate-layout.ts`、`src/shared/map-types.ts`）：
   - `layout.json`（`schemaVersion: 1 | 2`）仅持久化：
     - `views[].mode?: 'vertical' | 'grid' | 'columns'`
     - `views[].nodes[]`: `{ nodeId, x, y, width, manual }`
     - `views[].groups[]`: `{ groupId, x, y, width, height }`
   - **连线控制点、端口位置、避让状态、胶囊标签坐标均不落盘**，完全由客户端/共享层根据节点与分组几何实时确定性计算（瞬态滞回可保存在客户端按 `viewId` 隔离的内存 `ref` 中）。
   - **既有布局零静默漂移**：打开已有 `layout.json` 时，必须 100% 保留已存 `nodes`（尤其 `manual: true`）与 `groups` 坐标；仅在新建导图、缺失布局、增量补位新节点，或用户主动点击“排列切换 / 重置排列”时重新计算。
3. **无重型外部依赖 & 双端 100% 一致**：
   - 不引入 Dagre、ELK、React Flow 等外部图形或布局库；共享算法位于 `src/shared/`，客户端渲染位于 `src/client/`。
   - DSH 桌面原生侧栏（窄栏至宽屏，浅色/深色主题）与导出的独立离线 HTML（`src/client/offline.tsx` 直接复用 `ReadingPane`、`MapScene`、`MapViewport`）共用同一套排版、连线与样式代码。
4. **视觉与交互约束**（以当前 `src/client/styles/` 与 `src/shared/edge-geometry.ts` 为准；早期 `knowledge_atlas_demo_v17.html` 已过时，不作为本次研究约束）：
   - 保持柔和曲线美学（不改为全图直角正交折线）。
   - 输入端口为雾霾蓝实心圆（`#8699aa`，半径 `3.5px`，描边 `1px`）；输出端口为灰豆沙空心圆（`#b38c97`，半径 `3.5px`，描边 `2px`）；箭头 `8×7px` 尖端停靠输入圆外沿，带 `3px` 直线短柄 `stem`。
   - 拖拽节点时卡片必须直接跟手、零延迟；进入/退出子图过渡总时长为 `0.5s`（退出 `180ms` + 进入 `320ms`）。

---

## 二、节点卡片排列（Card Layout）现状

核心实现位于 [src/shared/layout.ts](file:///C:/Users/Xiao/mypython/learn/src/shared/layout.ts)、[src/client/measure-nodes.ts](file:///C:/Users/Xiao/mypython/learn/src/client/measure-nodes.ts) 与 [src/client/hooks/useViewportLayout.ts](file:///C:/Users/Xiao/mypython/learn/src/client/hooks/useViewportLayout.ts)。

### 2.1 卡片尺寸与高度测量

- **卡片宽度**：固定 `CARD_WIDTH = 236`（`NodeCard.tsx` 默认 `236px`；CSS `min-height: 86px`，叶子节点 `80px`）。
- **卡片高度**：因标题和 `summary` 长短不同，在隐藏容器 `.measure-nodes`（`AtlasPane.tsx`）中用实际字体与宽度离屏渲染后，由 `measureNodes`（配合 `ResizeObserver` 与 `document.fonts.ready`）实测 `getBoundingClientRect().height` 向上取整，按 `${viewId}/${nodeId}` 键入 `heights`；未测得时缺省回退 `130px`。

### 2.2 视图级排列模式与分桶

- 每个视图的节点先按 `views[].groups[]` 数组顺序分桶，未指定 `groupId` 的节点归入末尾无分组桶（`groupId = undefined`）。
- 用户可切换的模式由 `availableModes(view)` 控制（UI 仅暴露两种，历史 `columns` 读取兼容）：
  - `vertical`（纵向，默认）：所有分桶自上而下垂直叠放；初始 `fillLayout` 组间垂直间距 `19px`，主动 `relayoutView('vertical')` 为 `48px`。
  - `grid`（田字型，仅 `groupCount(view) >= 2` 时可用）：按分桶下标 `i % 2` 分左右 2 列并排，`Math.floor(i / 2)` 分行，列间与行间均距 `48px`。

### 2.3 桶内排布算法（`placeBucketNodes`）

网格基础常量：`COL_STEP = 327`（即 `236px` 卡宽 + `91px` 列间隙）、`ROW_GAP = 32`、`GROUP_PAD_X = 24`、`GROUP_PAD_TOP = 62`、`GROUP_PAD_BOTTOM = 24`。

1. **纯孤立退化路径**：
   - 当桶内既无组内连线、也无指向 `options.anchors` 的跨组连线时，严格按 `memberIds` 输入顺序从左到右、从上到下平铺 `Math.min(3, count)` 列，行纵坐标按各行最大实测 `nodeHeight + 32` 累加。
2. **有连线路径（离散网格槽位寻优）**：
   - **拓扑分析（`computeTopology`）**：统计 `intraEdges` 总度数，对 `dependency` 有向边跑 Kahn 拓扑排序（多个零入度节点按总度数降序、原下标升序破平局；存在环路时按剩余最小入度、度数降序、原下标升序确定性破环），计算无环时的拓扑层级 `layer[]`。
   - **初始种子（`buildInitialSlots`）**：
     - `useLayeredSeed` 仅在同时满足：`externalEdges.length === 0`（无跨组边）、组内全连通、无环、存在分叉或汇合（`outdegree >= 2 || indegree >= 2`）、`layerCount >= 2`、`maxLayerSize <= 3`、`layerCount <= baseRows + 1` 时启用；单节点层优先放中列 `[1]`，双节点层放 `[0, 2]`。
     - 若无组内边但有跨组锚点：按跨组锚点加权平均 `centerX` 排序并映射到最近离散列 `0..2`。
     - 其余情况（含串联长链）：采用 `columns = Math.min(3, ...)` 的 **S 型蛇形（Boustrophedon）** 填充（偶数行左→右，奇数行右→左），防止行尾到次行首出现长回车斜线。
   - **局部寻优（最多 6 轮最速下降）**：
     - 每轮枚举全部“两已占槽位成对交换”与“单节点移入未占空槽位”，选取使 `score()` 严格降优的最大增益动作。
     - 目标函数 `score()` 当前综合以下惩罚/奖励项（`DEPENDENCY_WEIGHT = 1.0`，`SUPPLEMENT_WEIGHT = 0.6`，`SNAP_STRAIGHT_THRESHOLD = 48`）：
       - 顶行紧凑重力：`+28 * posRow[i]`（强力把节点吸向顶部行，消除首行空洞）；
       - 组内边网格曼哈顿距离与对角转折：`w * (40 * (dr + dc - 1)^2 + 25 * dr * dc)`；
       - 组内同行/同列夹心穿卡重罚（中间格非空）：`+500`；
       - `dependency` 逆流向微罚：上下逆行 `+45`，偶数行同行逆序 `+15`；
       - 拓扑层偏离罚（仅 `useLayeredSeed`）：`+220 * |posRow[i] - layer[i]|`；
       - 四向枢纽居中奖励（`degree >= 3`）：占 `col === 1` 减 `35 * degree`，占内部行减 `20 * degree`；
       - 网格线段交叉罚：`+180`；
       - 穿经本区域的已锚定跨组直穿竖线（`passingVerticals`）碰撞罚：内列 `+700`，外边界列 `+120`；
       - 跨组连线距离与垂直对齐（`externalEdges`）：`+ w * 0.45 * dx`，`dx <= 48` 减 `28 * w`；若直穿同列他卡（内列 `+700` / 外列 `+120`），非对齐跨行阻塞 `+90`，同侧跨组边交叉 `+120`；
       - 同列且同拱桥状态的竖向连线重叠罚：`+800`。
   - **压缩空行与最终输出**：剔除全空中间行，按各行最大实测 `nodeHeight + 32` 累加 `rowY`；横坐标**严格对齐离散列** `x: baseX + finalCol[i] * 327`。

### 2.4 多分组协同与增量补位

- **全视图新建/重排跨组协同**：
  - `placeFreshBuckets`（`vertical` 与首次 `fillLayout`）：Pass 1 自上而下前向传递 `anchors`；若视图存在跨组边，Pass 2 再执行 2 轮全视图协同扫掠，使上游小分组能反向呼应下游锚点。
  - `relayoutView('grid')`：Pass 1 用预估列起点 `[42, 1040]`、行步进 `360` 排完并测量两列最大宽后，若有跨组边再用真实列宽 `pass1.colLefts` 与 `pass1.rowTops` 重算 Pass 2。
- **既有视图增量新增节点（`fillLayout`）**：
  - 保留全部已存 `nodes` 与 `oldGroup`；
  - 若整个桶未定位，整桶走 `placeBucketNodes`；
  - 若桶内已有部分已定位节点，对新节点优先调用 `placeNearNeighbors`：收集当前视图已定位直接相连邻居，按 `dependency` 出入向或 `supplement` 生成 6～8 个相对邻居的顺向/近邻候选坐标，综合候选序号（`rank * 40`）、到全部关联邻居的加权欧氏距离、越界罚（`x < 42 || y < 48` 罚 `+220`）及超出 `oldGroup` 罚（`+150`），选第一个满足四周 `24px` 净空（`hasOverlap`）的落位；无已定位邻居时回退 `placeBucketNodes` + 下推防重叠。

---

## 三、节点连线与关系标签（Edge Routing & Pills）现状

核心实现位于 [src/shared/edge-geometry.ts](file:///C:/Users/Xiao/mypython/learn/src/shared/edge-geometry.ts)、[src/shared/edge-routing.ts](file:///C:/Users/Xiao/mypython/learn/src/shared/edge-routing.ts)、[src/client/animate-ports.ts](file:///C:/Users/Xiao/mypython/learn/src/client/animate-ports.ts) 与 [src/client/components/MapScene.tsx](file:///C:/Users/Xiao/mypython/learn/src/client/components/MapScene.tsx)。

### 3.1 四层视觉渲染栈与提层规则

`MapScene.tsx` 与 `atlas.css` / `dark.css` 构成如下 `z-index` 分层（由底到顶）：

1. `.group-area`（无 `z-index`，底层）：半透明分组容器背景。
2. `<svg class="edges edges-base">`（`z-index: 1`）：未选中节点时渲染全部连线；选中节点时渲染所有非直接关联的 `dimmed` 连线（`opacity: 0.2`），允许一般斜向/内部穿卡连线从卡片下方穿过。
3. `.node`（`z-index: 2`，悬停/聚焦 `8`，拖拽中 `12`）：高不透明度节点卡片（浅色 `rgba(255,253,248,0.98)`，深色 `rgba(38,35,31,0.96)`），自然遮挡穿底线段。
4. `<svg class="edges edges-focus">`（`z-index: 5`，**仅单击选中节点时挂载，悬停绝不触发**）：将选中节点的 `in` / `out` / `supplement` 直接关联边整体提到所有卡片上方高亮（线宽 `+0.4px`，不透明度 `0.88~0.96`）。
5. `<div class="edge-labels">`（`z-index: 6`，焦点胶囊 `.is-focused` 为 `z-index: 7`）：HTML 圆角胶囊 `.edge-pill`。
6. `<svg class="atlas-ports">`（`z-index: 9`）：所有输入/输出端口圆点始终处于最顶层。

### 3.2 局部 $O(E)$ 路由四步管线

1. **初始四向选边**：按两卡中心偏移 `vertical = |dy| > |dx| * 0.55` 选择面对面端口（`right↔left` 或 `bottom↔top`），自环固定 `right→right`。
2. **轻量外侧隔卡直连拱桥（`selectInlineBlockedSides`）**：
   - **纯矩形判定（零曲线采样）**：仅当非自环、面对面且横截方向存在投影重叠（或中心偏离 `<= 0.5 * min(dimA, dimB)`）时检测；
   - 估算两卡之间其他卡片侵入直连中心线的深度 `depth`，超过 `HEAD_ON_ENTER_DEPTH = 18`（或 `0.25 * obsDim`）触发换边；拖拽期间若上一帧已处于拱桥状态，退出门槛放宽至 `HEAD_ON_EXIT_DEPTH = 6` 且切换对侧附加 `ARCH_HYSTERESIS = 24` 滞回缓冲；
   - **仅外侧边缘允许拱桥**：遍历两侧候选（水平边测 `top`/`bottom`，垂直边测 `left`/`right`），只要该候选外侧还存在其他任意卡片（`hasOuterCard`），即**直接跳过该侧**。因此位于导图内部列/行的隔卡直连不会绕行，维持穿底直连。
3. **同侧端口防交叉排序、均匀分布与单端口对齐**：
   - **排序**：按 `projectedOrder`（对端中心投到出射边外平面消除远近错序）初排，再按真实端口坐标迭代去逆序最多 6 轮（平局按边 ID 和 `out`/`in` 确定性比较）。
   - **分布**：同侧多端口按边内边距 `inset`（纵向 `14`，横向 `20`）与首选步距（纵向 `17`，横向 `24`）居中排布；**左右侧单端口**锚定距顶固定基准 `SINGLE_SIDE_TOP_OFFSET = 43`（钳位于 `[insetY, height - insetY]`，`insetY = min(height/4, 18)`），使高矮不一的同排串联卡片共处同一水平主干线；上下侧单端口居中 `width / 2`。
   - **`alignSinglePorts`**：对于面对面边中任一侧仅有 1 个端口的情况，若对端端口自由轴坐标落入己方安全内边距区间 `[min + inset, max - inset]` 内，直接投影对齐，否则保留基准位不吸入边角。
4. **曲线几何生成（`buildEdgeCurve` + `computePortEndpoints`）**：
   - 非自环严格至多 1 段；自环为卡片右侧外伸 2 段圆润回环。
   - **小错位拉直**：面对面端口（`dotN < -0.5`）当沿出射方向跨度 `along >= MIN_STRAIGHT_SPAN(24)` 且横向错位 `across <= STRAIGHT_DEADZONE(16)` 时，直接输出纯直线 `M.. L..`，且箭头与 `3px stem` 顺沿直线方向对接输入圆外沿（零 S 弯、零折角）。
   - **单段限幅 $G^1$ 三次贝塞尔**：首末控制点严格锁在端口外法线射线上：
     - 对边正向：`hs = he = clamp(dParallel * 0.42, 24, MAX_BEZIER_HANDLE(110))`；
     - 对边反向回环：`clamp(32 + sqrt(|dParallel|*18) + dPerp*0.15, 42, 120)`；
     - 邻边转角：`clamp(max(0.55 * pS/pT, 0.25 * length), 22, 110)`；
     - 同侧拱桥：`baseH = min(MAX_ARCH_HANDLE(148), max(clamp(0.18*lPerp+26, 36, 92), (4/3)*(archClearance+14)))`，再补平双端外伸高度差。

### 3.3 端口动画与胶囊标签

- **端点换位动画（`useAnimatedPorts`）**：卡片拖拽不补间；仅当端口槽位或侧边变化时，在卡片周长归一化参数 `[0, 4)` 上做 `180ms` 三次缓出滑行，每帧重跑 `routeSegments` 同步曲线、箭头与胶囊。
- **关系胶囊标签（`pickPillAnchor`）**：估算胶囊盒宽 `clamp(estWidth + 18, 36, 132)`、高 `22`，对全部卡片矩形外扩 `PILL_CARD_MARGIN = 4`，按 `t ∈ [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8]` 顺序探测首个不压卡片且不压已放胶囊的点；极短边全压卡时回退 `t = 0.5`，超长文本 CSS 省略号截断并由 `title` 悬停展示原文。

---

## 四、背景与分组容器放置方式现状

核心实现位于 [src/client/components/MapViewport.tsx](file:///C:/Users/Xiao/mypython/learn/src/client/components/MapViewport.tsx)、[src/client/components/MapScene.tsx](file:///C:/Users/Xiao/mypython/learn/src/client/components/MapScene.tsx)、[src/shared/layout.ts](file:///C:/Users/Xiao/mypython/learn/src/shared/layout.ts) 与 [src/client/styles/atlas.css](file:///C:/Users/Xiao/mypython/learn/src/client/styles/atlas.css)。

### 4.1 视口与画布点阵背景

- `.map-wrap` 铺满阅读内容区（`position: absolute; inset: 0`），作为缩放/平移手势捕获层；其底色与点阵背景直接由 CSS 绘制：`background-image: radial-gradient(#d3cabb 0.85px, transparent 0.85px); background-size: 23px 23px;`（深色主题底色 `#1c1a17`、点色 `#38342d`）。**背景点阵固定在视口层，不随 `.map-scene` 的 `translate/scale` 一起缩放移动**。
- `.scene-content` 尺寸为 `Math.max(1140, bounds.x + bounds.width + 40)` × `Math.max(800, bounds.y + bounds.height + 40)`，由 `viewBounds` 同时包络全部 `groups` 与 `nodes`。

### 4.2 分组背景容器（`.group-area`）的放置与更新规则

- **视觉结构**：绝对定位圆角矩形（`border-radius: 17px`、`pointer-events: none`），半透明暖纸/深色填充，左侧带 `3px × 32px` 类别强调竖条，左上角（`top: 17px, left: 22px`）放置编号与分组标题。
- **几何边距**：左右内边距 `GROUP_PAD_X = 24`，顶部标题区 `GROUP_PAD_TOP = 62`，底部内边距 `GROUP_PAD_BOTTOM = 24`；空组或单卡最小高 `178`、空组最小宽 `320`。
- **对齐规则**：
  - `vertical` 模式首次全图排布或重排（`placeFreshBuckets`）：先对各组各自包络，再取所有非空组的共同 `unifiedLeft` 与 `unifiedWidth`（有 3 列卡片时所有分组统一左起 `x = 42`、宽 `938`；只有 1 卡组时宽 `284`、2 卡组宽 `611`）。
  - `grid` 模式（`relayoutView`）：每列所有分组统一采用该列最大宽度 `widths[col]`，左列起始 `x = 42`，右列起始 `x = 42 + widths[0] + 48`；单组若局部缩进（`rawIndent`），节点在对齐后的分组盒内按 `indent` 平移。
- **节点手动拖动时的固定策略**：
  - `fillLayout` 在读取已有 `oldGroup` 时**不再用成员节点边界与旧矩形取并集**，直接保留原 `oldGroup` 的 `{ x, y, width, height }`。因此节点拖出分组或拖入相邻分组时，分组背景保持稳定不变；仅显式点击切换排列/重置时才重建分组矩形。

---

## 五、尝试过的方案与失败/撤回教训

| 阶段 / 特性 | 尝试方案 | 实际结果与撤回/调整原因 |
| --- | --- | --- |
| `0.3.8` 节点拖动动画 | 尝试 70ms 短跟随、5px 提起、统一 300ms 节点位移动画（`animate-layout.ts`） | 拖动粘滞不跟手且 CPU 占用明显上升；最终完全撤回节点动画，改为节点跟手、仅端点 `180ms` 沿边滑移（`animate-ports.ts`）。 |
| `010` 早期连线避让 | 20 点采样检测卡片文字核心区，仅偏移单段贝塞尔控制点 `c1/c2` | 端口法线未锁定导致箭头根部折角明显；长跨度与反弯绕行控制点失控产生巨大鼓包。 |
| `011` 全局多卡避让 | 引入 `CardEnvelope`（`card/pad 7px/core`）、障碍聚类、1～3 段向心样条搜索与 Pass-2 共路分离（`edge-routing.ts` 膨胀至 ~1,980 行） | **彻底失败并被 `012` 推翻**：1）`cardHits === 0` 硬约束导致轻微擦边就强扭成深 U / 过山车大弯；2）居中单端口（`height/2`）与未拉直小错位把本该直的水平线画成小 S 弯；3）每帧 30～80 候选 × 48 点采样与 `180ms` 动画叠加引起卡顿崩溃与临界闪烁。 |
| `012` 简化连线重构 | 砍掉全局多卡避让（~420 行局部 $O(E)$ 几何），允许一般连线穿底，单击选中提层 `.edges-focus`，左右单端口顶距 `43px` + 轴向对齐 + `16px` 死区拉直，HTML `.edge-pill` 7 点避卡 | 解决了性能崩溃、小 S 弯和夸张大弯；最初隔卡拱桥在内部列也触发，造成跨列打架，随后收紧为“仅导图最外侧边缘允许拱桥，内部列/行一律穿底直连”。 |
| `013` 原设计 Stage 2 连续重心排版 | `specs/013` 原方案规划了“离散网格后执行 Stage 2 连续水平重心微调（如 2 卡居中在 `163.5 / 490.5`）并允许首行留空” | **在最新 `6eac350` 实际代码中撤回**：真实导图（如斯大林结构、一战结构截图）出现首行空洞、卡片不在统一网格列上、参差框宽及内列竖线直穿或重合。因此回退为严格离散 3 列对齐（`(x - 66) % 327 === 0`）、加顶行重力 `+28 * posRow`、统一垂直组框宽，并对内列竖穿/同列重线施加重罚（`+700` / `+800`）。 |

---

## 六、当前仍未能解决的核心痛点（重点研究方向）

### 痛点 1：布局几何与连线路由模型割裂（“两张皮”问题）
- `layout.ts` 在评分中用简单的“离散行列差 + `cross()` 线段相交 + `SNAP_STRAIGHT_THRESHOLD = 48` 垂直矩形投影”来预测连线好坏；而 `edge-geometry.ts` 真正画线时依赖 `|dy| > |dx| * 0.55` 四向选边、`alignSinglePorts` 端口吸附、`STRAIGHT_DEADZONE = 16` 拉直与 `selectInlineBlockedSides` 拱桥。
- 两者判定标准不一致，导致布局器以为“直线顺畅或无交叉”，实际渲染出来却变成邻边转角、斜穿多卡或无法拉直。

### 痛点 2：`layout.ts` 中节点高度估算失真且与真实 `heights` 脱节
- `placeBucketNodes` 在计算 `passingVerticals`、`extAnchorBlocks` 和组内 `verticalSegs` 的穿卡与阻塞判定时，**硬编码了 `row * 162` 和卡高 `130`**（`src/shared/layout.ts:398, 425, 485, 528, 549, 580`），完全忽略了同一行卡片实际 `nodeHeight` 可能从 `86px` 到 `260px+` 不等。
- 当某些卡片包含较长摘要而变高时，布局阶段算出的纵向阻塞区间与最终 `rowY` 渲染位置错位，造成跨组纵向穿卡误判或漏判。

### 痛点 3：严格 3 列死网格与强顶行重力导致的“对称性/拓扑表达受限”
- 由于 `013` Stage 2 连续坐标微调未保留（常量 `MIN_ROW_CARD_GAP = 60`、`MIN_ROW_STEP = 296` 仍在源码顶部但未被最终坐标输出使用），`x` 坐标仍被锁死在 `0 / 327 / 654` 三档：
  - **2 节点对 3 节点无法居中对称**（例如上一组 3 张卡，下一组 2 张卡连向上方左右两卡或三卡，只能偏左或留中空隙）。
  - **分叉/汇合种子条件过严**：一旦存在任何跨组边（`externalEdges.length > 0`），`useLayeredSeed` 直接被禁用，退化为普通 3 列网格 + `+28 * posRow` 顶行重力，导致复杂的“分层跨组 + 组内分叉”结构仍容易塞满首行而牺牲拓扑流向清晰度。
- 此外，`buckets` 顺序严格按 `view.groups` 数组顺序垂直堆叠；`grid` 田字模式仅按 `i % 2` 奇偶机械分左右两列，**未根据分组间连线密度优化分组自身的排列位置/顺序**，容易造成跨不相邻分组的长距离跨越。

### 痛点 4：内部列/行隔卡连线只能“穿底盲连”，且外侧多条拱桥缺乏分离
- 在 `012` 规则下，位于导图内部列或内部行的隔卡直连（例如中列第 1 行连到第 3 行），因为两侧有卡片而被禁止拱桥，只能从中间卡片正下方直穿。在**未单击选中节点**的默认浏览态下，用户很难一眼区分“A→B→C 串联”与“A→C 跨过 B”，必须点击选中激活 `.edges-focus` 才能看清。
- 在外侧边缘允许拱桥时，多条同侧外拱桥共用近似的 `baseH` 控制臂公式，缺乏同侧拱桥之间的高度分层，多条外拱桥容易贴合重叠，或外凸超出分组框顶部/边缘遮挡分组标题与画布边距。

### 痛点 5：同侧多端口与斜向双向/多边走廊分离不足
- 放弃 `011` 的 Pass-2 共路分离后，双向互连或同向多边完全依赖端口边缘 `17px / 24px` 的微错开和同侧 `projectedOrder` 排序。
- 实际场景中存在两类顽疾：
  1. 两节点之间同时存在 `A→B` 和 `B→A`（或 2 条同向边），若两端分别挂在不同数量端口上触发 `alignSinglePorts` 或对端角度相近，中段曲线极易靠得过近甚至交叉叠合；
  2. 多条斜线共经两卡之间的窄缝时，没有走廊感知和轻量通道偏移，容易打结。

### 痛点 6：关系胶囊标签（`.edge-pill`）仍可能压线/压端口，极短边易压卡
- `pickPillAnchor` 仅检测与**卡片矩形（+4px）**及**已放胶囊**的碰撞，**不检测是否压住其他连线路径、箭头或端口圆点**；交叉多线场景中胶囊常盖住旁边线条的箭头或路径。
- 极短边 7 个候选点全部碰卡时直接回退 `t = 0.5`，对于间距只有 `32px`（行距）或 `91px`（列距）的相邻短边，宽胶囊（最大 `132px`）会横向盖住卡片左右或上下边框。

### 痛点 7：自由拖动后“分组背景固定”与“局部整理缺失”的矛盾
- 保留 `oldGroup` 固定尺寸防止了拖动时背景乱跳，但用户把节点拖出原分组框后，卡片会视觉脱离分组；此时若通过 AI 或补位新增关联节点，`placeNearNeighbors` 可能把新节点也放在旧分组框外。
- 目前缺少“局部整理/只重排未锁定节点/仅调整某分组及其背景”的中间策略，用户只能二选一：忍受局部杂乱，或者点击“重置排列”清空全视图全部 `manual: true` 手动位置。

---

## 七、关键源码与参考文档索引

| 模块 | 文件路径 | 说明 |
| --- | --- | --- |
| 卡片布局算法 | [src/shared/layout.ts](file:///C:/Users/Xiao/mypython/learn/src/shared/layout.ts) | `placeBucketNodes`、`placeFreshBuckets`、`placeNearNeighbors`、`fillLayout`、`relayoutView` |
| 端口分配与批量路由 | [src/shared/edge-geometry.ts](file:///C:/Users/Xiao/mypython/learn/src/shared/edge-geometry.ts) | `createConnections`、`routeSegments`、`alignSinglePorts`、`projectedOrder` |
| 曲线几何、拱桥与胶囊 | [src/shared/edge-routing.ts](file:///C:/Users/Xiao/mypython/learn/src/shared/edge-routing.ts) | `buildEdgeCurve`、`computePortEndpoints`、`selectInlineBlockedSides`、`pickPillAnchor` |
| 端口滑轨动画 | [src/client/animate-ports.ts](file:///C:/Users/Xiao/mypython/learn/src/client/animate-ports.ts) | `useAnimatedPorts`（`180ms` 周长参数插值） |
| 场景渲染与分层 | [src/client/components/MapScene.tsx](file:///C:/Users/Xiao/mypython/learn/src/client/components/MapScene.tsx) | 四层 SVG/DOM 渲染栈、`.edges-focus`、`.edge-labels` |
| 卡片交互与拖动 | [src/client/components/NodeCard.tsx](file:///C:/Users/Xiao/mypython/learn/src/client/components/NodeCard.tsx) | `236px` 卡片、指针拖拽 `rAF` 合并、单双击分离 |
| 视口、相机与背景 | [src/client/components/MapViewport.tsx](file:///C:/Users/Xiao/mypython/learn/src/client/components/MapViewport.tsx) | 点阵容器、平移缩放、适配视口 |
| 布局草稿与测量 | [src/client/hooks/useViewportLayout.ts](file:///C:/Users/Xiao/mypython/learn/src/client/hooks/useViewportLayout.ts) | `ResizeObserver` 实测高度、拖动草稿、触发重排 |
| 样式与主题 | [src/client/styles/atlas.css](file:///C:/Users/Xiao/mypython/learn/src/client/styles/atlas.css) | 分组背景、卡片、连线层级、胶囊样式（及 [dark.css](file:///C:/Users/Xiao/mypython/learn/src/client/styles/dark.css)） |
| 存储与校验契约 | [src/shared/validate-layout.ts](file:///C:/Users/Xiao/mypython/learn/src/shared/validate-layout.ts) | `layout.json` v1/v2 Schema 与校验 |
| 布局回归测试 | [tests/shared/layout-navigation.test.ts](file:///C:/Users/Xiao/mypython/learn/tests/shared/layout-navigation.test.ts) | 含长链、菱形、一分三、斯大林/一战结构等回归断言 |
| 连线回归测试 | [tests/shared/edge-routing.test.ts](file:///C:/Users/Xiao/mypython/learn/tests/shared/edge-routing.test.ts) | 含直线化、单段曲线、外侧拱桥、滞回与 40 节点性能基准 |
| 演进背景记录 | [specs/012-simplified-edge-routing/research.md](file:///C:/Users/Xiao/mypython/learn/specs/012-simplified-edge-routing/research.md) | `011` 复杂避让失败复盘与 `012` 简化决策（另见 [013 research](file:///C:/Users/Xiao/mypython/learn/specs/013-distance-aware-card-layout/research.md)） |
