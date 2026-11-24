# Phase 1 Data Model: 基于相连节点距离与结构规则的卡片初始排列优化

**Feature**: `013-distance-aware-card-layout` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

---

## 1. 持久化存储模型影响（零变更）

- **`map.json`（`schemaVersion: 1`）**：零字段增删或校验变动。
- **`layout.json`（`schemaVersion: 1 | 2`）**：零 Schema 变更。既有视图打开时所有已存 `nodes` 与 `groups` 坐标 100% 保持原样；新视图、空视图、未定位新增节点及主动触发 `relayoutView` 时写入的仍是标准 `{ nodeId, x, y, width, manual }` 与 `{ groupId, x, y, width, height }`。
- **会话阅读状态 `ReadingState`（`src/client/reading-state.ts`）**：零新字段。复用现有 `selectedNodeId?: string` 与 `detailHidden?: boolean`（`010` 引入的内存状态），即可完整表达“带子图节点仅画布选中不弹详情（`selectedNodeId = id, detailHidden = true`）”。

---

## 2. 布局计算常量与运行时实体（`src/shared/layout.ts`）

### 2.1 几何与评分常量

| 常量 | 值 | 用途与对应需求 |
| --- | --- | --- |
| `CARD_WIDTH` | `236` | 默认节点卡片宽度（与 HTML v17 及现有布局一致） |
| `COL_STEP` | `327` | 标准网格列步距（`236px` 卡宽 + `91px` 通道间距） |
| `ROW_GAP` | `32` | 行间最小垂直间距（结合每行最大卡片实测高度计算行纵坐标） |
| `GROUP_PAD_X` | `24` | 分组容器左右内边距（1 节点组宽 `284px`，2 节点标准列距组宽 `611px`） |
| `GROUP_PAD_TOP` | `62` | 分组容器顶部标题预留高度 |
| `GROUP_PAD_BOTTOM` | `24` | 分组容器底部内边距 |
| `MIN_ROW_CARD_GAP` | `60` | Stage 2 横向重心微调时同行相邻卡片间的最小水平净空（`MIN_ROW_STEP = 296`） |
| `DEPENDENCY_WEIGHT` | `1.0` | 主要依赖关系在距离目标函数中的权重 |
| `SUPPLEMENT_WEIGHT` | `0.6` | 补充关联关系在距离目标函数中的权重 |
| `SNAP_STRAIGHT_THRESHOLD` | `48` | Stage 2 横向重心对齐后，与上下直接相连节点水平偏差 $\le 48\text{px}$ 时吸附对齐触发垂直直线（`FR-004`） |

### 2.2 核心运行时数据结构

- **`AnchorPoint`**：跨分组与增量补位传参用的轻量已定位节点坐标锚点：
  ```ts
  export interface AnchorPoint {
    x: number
    y: number
    width: number
    height: number
  }
  ```
- **`BucketPlacementOptions`**：`placeBucketNodes` 的可选扩展参数（保持原有 6 参数调用 100% 向后兼容）：
  ```ts
  export interface BucketPlacementOptions {
    anchors?: ReadonlyMap<string, AnchorPoint>
    allRelations?: readonly Relation[]
  }
  ```
- **`CandidateSlot`**：完整弹性网格槽位池中的离散位置 `{ row: number; col: number }`，其中 `col ∈ {0, 1, ..., columns - 1}`（不再只生成前 `memberIds.length` 个紧凑下标，而是开放整张网格的空白中心/右列供分叉、汇合及跨组对齐占用）。
- **`DistanceRuleObjective`（距离 + 规则混合评分模型）**：
  对当前组内每个槽位分配方案 `assignment`，综合计算以下确定性代价：
  1. **组内连线距离 + 夹心 + 交叉 + 枢纽居中项**：
     - 离散网格距离惩罚与精确像素距离项：$w_e \cdot (40 (dr + dc - 1)^2 + 25 \cdot dr \cdot dc + 0.08 |\Delta x_{\text{slot}}|)$；
     - 同行/同列夹心穿卡重罚（`+500`）：中间格存在无关已占卡片时禁止同排隔卡直挡；
     - `dependency` 逆流向惩罚（`a.row > b.row` 罚 `45`，同行逆序罚 `15`）；
     - 线段交叉惩罚（`+180`）与四向枢纽居中奖励（`degree >= 3` 且占中列/中行减分）；
  2. **跨分组连线距离项（`FR-002`）**：
     - 对每条连接组内节点 $u$ 与跨组锚点 $v \in \text{anchors}$ 的边 $e$（按所在相对上下游关系方向加权）：
       $$w_e \cdot \left(0.45 \cdot |\text{centerX}(u) - \text{centerX}(v)| + 0.12 \cdot |\text{centerY}(u) - \text{centerY}(v)|\right)$$
       加上垂直同列对齐奖励（当 $|\text{centerX}(u) - \text{centerX}(v)| \le 48\text{px}$ 时减 `28 * w_e`）与上下游跨组流向对齐判断（若锚点在当前组上方且边为 $u \to v$ 逆流时轻罚，鼓励前置靠顶行、后续靠底行）。

### 2.3 弹性行列与重心对齐计算流（`placeBucketNodes` + `fillLayout`）

```text
输入: memberIds, relations (组内+跨组), heights, anchors
  │
  ├─ [无组内边 且 无跨组边]
  │     ──► 纯规则退化：按 memberIds 原顺序从左到右、从上到下平铺 3 列网格（100% 确定向后兼容）
  │
  └─ [存在组内边 或 跨组边]
        ├─ 1. 拓扑深度与弹性网格维度：
        │     计算组内有向无环（确定性破环）深度，识别 1→2→1 / 1→3 / 2→1 等分叉汇合结构；
        │     长链维持 S 型蛇形种子，生成完整 R×C 候选槽位池（允许空留中间/侧边槽位）。
        ├─ 2. Stage 1 离散联合寻优（<= 6 轮确定性扫描）：
        │     同时尝试“两节点交换槽位”与“单节点移入空槽位”，最小化 DistanceRuleObjective。
        ├─ 3. 空行压缩与行坐标生成：
        │     压缩全空中间行，按各行实际节点最高测量高度 + 32px 计算 rowY。
        └─ 4. Stage 2 横向重心连续微调与直线吸附（针对节点数 < C 的行）：
              收集上下不同行（含跨组 anchors）直接相连邻居中心 X，计算加权重心 x*；
              按同行最小间距 296px 与走廊 [baseX, baseX + (C-1)*327] 约束将 x 移向 x*，
              且若与上下直连邻居 X 偏差 <= 48px 且不碰撞同行卡，精确吸附对齐。
```

---

## 3. 节点交互状态机模型（`FR-009` / Clarification Q1 Option A）

区分视图内 `drill = Boolean(node.childViewId && node.childViewId !== viewId)`：

| 当前节点属性 | 用户交互动作 | 状态变更（`ReadingState`） | 视觉与导航结果 |
| --- | --- | --- | --- |
| `drill === true`（带可下钻子图） | 左键单击 / 键盘 `Space` | `selectedNodeId = node.id`<br>`detailHidden = true`<br>`focusSource = node.id` | 停留在当前视图；卡片选中并触发 `.edges-focus` 关联边与胶囊提层高亮；不弹出 `NoteInspector`（若先前已打开其他节点详情则收起） |
| `drill === true`（带可下钻子图） | 左键双击 / 键盘 `Enter` | 触发 `nav.navigate(dest)`（写入新视图 `viewId`、`history` 及目标相机） | 0.5 秒平滑过渡进入目标子图视图；过渡锁期间忽略重复双击 |
| `drill === false`（无子图叶子或当前已在自身子图中） | 左键单击 / `Enter` / `Space` | `selectedNodeId = node.id`<br>`detailHidden = false`<br>`focusSource = node.id` | 卡片选中并触发 `.edges-focus` 高亮，同时右侧展开/刷新 `NoteInspector` 详情面板（若详情已收起且同一卡片仍选中，再次单击重新展开） |
| 任意已选中卡片 | 拖拽移动松手后 `< 190ms` | 仅更新节点坐标与 `manual: true` | `suppressClickUntil` 阻断紧随其后的 `click` 与 `dblclick`，不误选、不误下钻 |
| 任意视图且 `selectedNodeId` 非空 | 点击空白画布或按 `Escape` | 若 `!detailHidden` 首次 `Escape` 置 `detailHidden = true`；点击空白或再按 `Escape` 置 `selectedNodeId = undefined, detailHidden = undefined` | 收起详情时保持画布高亮；清除选中时恢复全图底层连线 |
