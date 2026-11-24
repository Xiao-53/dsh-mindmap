# Contracts: 导图四向邻接排版、生成质量与详情关系操控优化

**Feature**: `010-layout-authoring-navigation` | **Date**: 2026-11-22

---

## 1. 共享排版与几何计算契约（`src/shared/layout.ts` & `src/shared/edge-geometry.ts`）

### 1.1 `availableModes` 与 `relayoutView` 契约
```ts
// 仅返回 'vertical' 与（当分组区域数 >= 2 时）'grid'；不再返回 'columns'
export function availableModes(view: View): LayoutMode[]

// 对指定视图执行四向端口感知的二维网格邻接排布与紧凑分组框计算；
// 若传入历史遗留的 mode === 'columns'，自动归一为 groupCount(view) >= 2 ? 'grid' : 'vertical'。
export function relayoutView(
  map: KnowledgeMap,
  viewId: string,
  mode: LayoutMode,
  heights: Heights,
): ViewLayout
```

### 1.2 `fillLayout` 既有布局保护契约
```ts
// 1. 若 previous 中已存在某 viewId 的 ViewLayout：
//    - 所有已存在于 old.nodes 的节点 100% 保留原 (x, y, width, manual) 坐标；
//    - 所有已存在于 old.groups 的分组 100% 保留原 (x, y, width, height) 外框；
//    - 仅对新增未定位节点按二维网格与防重叠规则补齐空位，仅对新增分组计算紧凑外框。
// 2. 若 previous === undefined 或某 viewId 在 previous 中尚无记录（新建导图或新增子图）：
//    - 对该视图每个分组（及无分组桶）调用二维网格邻接排布算法，并按实际节点包络计算紧凑分组外框。
export function fillLayout(
  map: KnowledgeMap,
  previous: MapLayout | undefined,
  heights: Heights,
): MapLayout
```

### 1.3 `connectionGeometry` 贝塞尔穿卡避让契约
```ts
// 在保留输入/输出端口坐标与箭头几何的前提下，可选接收当前视图节点矩形表 nodes；
// 当检测到三次贝塞尔曲线穿过除 a.nodeId / b.nodeId 外的其他节点矩形时，
// 将控制点 c1/c2 向阻挡卡片外侧间隙法向偏移绕弧；未穿过其他卡片时输出与原公式完全一致。
export function connectionGeometry(
  a: Port,
  b: Port,
  self?: boolean,
  nodes?: Record<string, Rect>,
): { d: string; arrow: string; stem: string }
```

---

## 2. `/mindmap` 运行时生成质量提示词契约（`src/server/prompts/authoring.ts`）

不改变 `atlas_list`、`atlas_read`、`atlas_create`、`atlas_preview`、`atlas_apply`、`atlas_cleanup_create` 的任何工具参数 Schema，仅在 `mindmapAuthoring` 的 `## 组织可读内容` 与 `## 保存与反馈` 章节强化以下 3 条硬性内容质量规则：

1. **起始节点独立性自检（防单根强迫症与伪连线）**：
   - 建图与扩图时逐一核对无前置（入度为 0）的节点：确认其确属独立入口或前置在范围外，还是漏连了真实依赖；允许多个起始节点并存，严禁为了凑“唯一根节点”或把画布连满而在并列模块间编造 `dependency`。
2. **跨主题“去虚词”可检验写作判据**：
   - `summary` 与笔记正文严禁使用“了解 XX / 理解原理 / 掌握用法 / 负责相关处理 / 进行下一步”等不可检验的空泛套话；
   - 架构类节点写清“核心职责 + 接口/上下游边界与失效约束”；流程类节点写清“触发条件 + 执行动作 + 分支判据/产出”；学习与知识类节点写清“核心机制边界 + 可观察的检验标准（如能自己画出时序、能诊断某类典型错误）”。
3. **范围边界与默认阅读入口交待**：
   - 完成新建或结构重组后，在回复中简明交待本图覆盖范围（含刻意排除在外的外部内容）以及推荐的默认阅读起点节点。

---

## 3. 可独立拆分回退的详情关系操控契约（`src/client/`）

> **可拆分性保证（Modularity Guarantee）**：本节定义的 3 项前端交互增强均封装在独立组件 `NeighborPills.tsx` 与轻量状态辅助函数中，不侵入 `NodeEditor`、`EditSession`、`layout.ts` 或服务端 RPC；若人工验收后决定打回其中任一项，可在不影响排版与提示词的前提下单独移除。

### 3.1 `NeighborPills` 组件契约（`src/client/components/NeighborPills.tsx`）
```ts
export interface NeighborItem {
  nodeId: string
  title: string
  relationId: string
  label?: string
}

export interface ViewNeighbors {
  prerequisites: NeighborItem[]
  dependents: NeighborItem[]
  supplements: NeighborItem[]
}

// 仅基于当前视图 view.relationIds 提取两端均在当前视图内的直接相邻节点（按关系去重并保持稳定顺序）
export function computeViewNeighbors(
  map: KnowledgeMap,
  view: View,
  nodeId: string,
): ViewNeighbors

export function NeighborPills(props: {
  map: KnowledgeMap
  view: View
  nodeId: string
  onSelect: (targetNodeId: string) => void
}): ReactNode
```
- **交互规则**：点击任一胶囊调用 `onSelect(targetNodeId)`，在当前视图内将画布相机平滑定位至 `targetNodeId`（当窄侧栏中详情面板展开时，相机水平中心向可视画布区适配偏移以防目标卡片被详情面板完全遮挡），并将详情面板切换至 `targetNodeId`（不触发 `childViewId` 跨视图子图下钻）。

### 3.2 画布关系焦点高亮契约（`src/client/components/MapScene.tsx`）
- 当 `selected`（即 `reading.selectedNodeId`）非空时：
  - 与 `selected` 直接相连的入向 `dependency` 边带 `edge-focus-in` 类名与 `data-focus="in"`；
  - 与 `selected` 直接相连的出向 `dependency` 边带 `edge-focus-out` 类名与 `data-focus="out"`；
  - 与 `selected` 直接相连的 `supplement` 边带 `edge-focus-supplement` 类名与 `data-focus="supplement"`；
  - 当前视图其余非直接相连的边带 `edge-dimmed` 类名与 `data-focus="dimmed"`（不透明度降至 `0.2`）。
- 当 `selected` 为空时：所有边不带 `data-focus`，恢复原有默认不透明度（`0.76` / `0.58`）。

### 3.3 “收起详情”与“取消节点选中”解耦契约
- **收起详情（保留选中高亮）**：当 `NoteInspector` 处于打开状态（`selectedNodeId` 非空且 `!reading.detailHidden`）时，点击详情面板右上角 `×` 按钮或按下 `Escape`，仅将 `reading.detailHidden` 设为 `true`（`NoteInspector` 卸载收起，画布上 `selectedNodeId` 卡片选中边框与关联连线高亮保持不变）。
- **重新展开详情**：当 `reading.detailHidden === true` 时，单击画布上任何无子图节点（包括当前已选中的节点），均将 `selectedNodeId` 设为该节点且 `detailHidden` 设为 `false`，重新展开 `NoteInspector`。
- **彻底取消选中**：当用户在画布空白背景区域完成一次非拖拽点击（指针按下与抬起位移 $\le 5\text{ px}$ 且未命中节点卡片、按钮、浮层或详情面板），或在 `NoteInspector` 已收起（`detailHidden === true`）时按下 `Escape`，清空 `selectedNodeId: undefined, detailHidden: undefined`，恢复全图连线默认显示。
