# Implementation Plan: 基于相连节点距离与结构规则的卡片初始排列优化

**Branch**: `013-distance-aware-card-layout`（实际工作于 `main` 分支，遵循仓库单一功能目录规范） | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from [spec.md](spec.md)、[存储契约](../../docs/mindmap-storage-format.md) 与 [项目宪章](../../.specify/memory/constitution.md)。

## Summary

围绕“**相连节点距离最小化 + 结构规则约束**”升级卡片初始排列与补位算法，并同步落地“**带子图节点单击选中高亮、双击下钻**”交互拆分：

1. **跨分组与组内连线距离协同寻优（`FR-001`, `FR-002`, `FR-006`, `FR-007`）**：
   - 在 `src/shared/layout.ts` 中升级 `placeBucketNodes`、`fillLayout` 与 `relayoutView`，为分桶排布引入跨分组已定位节点坐标锚点（`anchors`）与两轮协同传播，将组内连线与跨组连线真实空间距离共同纳入目标函数；消除跨组分层导图因组内无边而退化为按数组下标盲排及横跨全屏对角斜线的问题，并保持紧凑分组外框随节点坐标包裹平移。
2. **打破固定满行塞格的弹性层级与横向重心直线吸附（`FR-003`, `FR-004`）**：
   - 有连线时开放完整 $R \times 3$ 弹性候选槽位池（允许单源/单汇分叉与汇合按拓扑层级留白居中，长链保持 S 型蛇形折行）与“交换 + 空槽迁移”局部搜索；在离散行列确定后，对不满 3 列的行计算上下游相连邻居加权水平重心并做连续微调与 `48px` 直线对齐吸附，既保障零重叠与 `296px+` 同行安全距，又最大化触发 `012` 面对面笔直连线。
3. **既有视图增量新增节点的邻居就近补位与旧布局保护（`FR-005`, `FR-008`）**：
   - 在 `fillLayout` 中遇到已保存部分节点的视图时，100% 保留所有已存节点与分组外框坐标；对新增未定位节点优先围绕视图内已定位相连邻居按依赖流向就近搜寻最近无碰撞空位，无邻居时再退回常规空位补齐。
4. **带子图节点的单击画布选中高亮与双击进入子图（`FR-009` / Clarification Q1 Option A）**：
   - 在 `useReadingNavigation.ts` 新增 `selectNode(id)`（置 `selectedNodeId = id, detailHidden = true`），并在 `NodeCard.tsx`、`MapScene.tsx`、`AtlasPane.tsx` 中将带可下钻子图节点的单击（及 `Space`）绑定为仅画布选中并激活 `.edges-focus` 连线/胶囊提层高亮（不弹详情，若已开其他节点详情则收起），双击（及 `Enter`）才触发 0.5 秒平滑过渡进入子图；普通叶子节点保持单击选中并打开详情直觉，拖拽结束 `190ms` 内同步拦截双击防误触。

## Technical Context

**Language/Version**: TypeScript（`typescript ^6.0.3`，Node.js `>=24.9.0`，测试使用 `node --experimental-strip-types --test` 直接运行 TS）。

**Primary Dependencies**: 既有 React `^18.2.0`、Zod `4.6.6`、`@deepseek-ai/cordis ~4.1.0`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-typert-protocol`、`@deepseek-ai/dsh-client-store`、`katex 0.19.1`、`marked 17.0.1`、`jsxgraph 1.14.3`、`@codemirror/*`、`esbuild ^0.27.0`；零新增外部依赖。

**Storage**: 工作区 `dsh-knowledge-maps/<mapId>/` 下的 `map.json`（`schemaVersion: 1`）与 `layout.json`（`schemaVersion: 1 | 2`）**零格式变更**；`selectNode` 复用会话内存状态 `ReadingState.selectedNodeId` 与 `detailHidden`，不写盘。

**Testing**: Node 内置 `node:test` + `jsdom`（按 `AGENTS.md` 开发约定，日常开发默认运行 `npm.cmd run typecheck`、`npm.cmd run build` 及按规定打包预览包，交付时标注未运行自主测试或视觉验收；`npm.cmd run test` 仅在用户明确授权时执行）。扩展 `tests/shared/layout-navigation.test.ts` 与 `tests/integration/dom.test.ts`；真机与离线 HTML 视觉手感按 [quickstart.md](quickstart.md) 交由用户人工验收。

**Target Platform**: DSH `>=0.2.2-alpha.3 <0.3.0-0`（目标宿主 `v0.2.2-rc.3`）桌面端原生右侧栏（浅色/深色主题）及离线导出单文件 HTML 阅读器（`src/client/offline.tsx` 自动复用 `ReadingPane`）。

**Project Type**: 单仓库 DSH 原生侧栏思维导图插件（`src/shared` + `src/client` + `src/server`）。

**Performance Goals**: 单视图 $\le 20$ 节点、30+ 连线下的全量初始排列（含两轮跨组协同、弹性槽位寻优与重心连续对齐）耗时 $< 2\text{ ms}$，100% 确定性无随机跳变；单双击事件切换在单帧内响应，零动画闪烁。

**Constraints**: 严格遵守项目宪章、`AGENTS.md` 与 `Session 2026-11-24` 澄清结论：零新增依赖；零破坏存储格式；100% 保护已存 `layout.json` 节点和分组坐标；保持宿主桌面侧栏与离线独立 HTML 阅读器表现一致。

**Scale/Scope**: 覆盖 4 个 User Stories、9 条 Functional Requirements（`FR-001`–`FR-009`）与 5 项 Success Criteria（`SC-001`–`SC-005`），聚焦 `src/shared/layout.ts` 与客户端卡片交互链路及对应单测/DOM 测试。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 规划前检查 | 设计后复核 |
| --- | --- | --- |
| I. 内容生成与界面实现职责分离 | 通过。距离与规则混合排版、重心吸附与单双击分离完全由插件在 `src/shared/` 与 `src/client/` 执行，不要求 AI 生成坐标或修改 `/mindmap` 内容格式。 | 通过。`src/server/prompts/` 零修改；AI 仍只提供结构与 Markdown 笔记。 |
| II. 独立数据与稳定身份 | 通过。不改动 `map.json` 与 `layout.json` 持久化字段，已存坐标在打开时严格保留。 | 通过。`AnchorPoint` 与 `BucketPlacementOptions` 均为瞬态计算参数，`selectNode` 复用现有内存态 `ReadingState.detailHidden`，100% 保护历史 `layout.json`。 |
| III. 用户控制发送与修改保护 | 通过。不涉及引用草稿或自动发送，不干扰节点手动拖拽与保存撤销栈。 | 通过。拖拽松手 `190ms` 内同时拦截 `onClick` 与 `onDoubleClick`，防止拖拽误下钻；单双击分支均受 `doc.guard(...)` 未保存保护。 |
| IV. 官方契约与最小实现 | 通过。零新增图形库或力导向引擎依赖，不修改宿主清单与工具契约。 | 通过。完全基于既有 `src/shared/layout.ts`、React 事件流与 `ReadingState` 演进，对外签名向后兼容。 |
| V. 一致呈现与可验证交付 | 通过。与 HTML v17 视觉规范及 `012` 连线路由互补，侧栏与离线导出共享代码。 | 通过。`src/client/offline.tsx` 无需改动即可自动继承双端一致的布局与单双击交互；[quickstart.md](quickstart.md) 明确区分构建校验与真机人工验收边界。 |

## Project Structure

### Documentation (this feature)

```text
specs/013-distance-aware-card-layout/
├── spec.md                                      # 需求规范（含 US1–US4、Clarifications Q1 Option A）
├── plan.md                                      # 本文件（$speckit-plan 产出）
├── research.md                                  # Phase 0 现状复盘与距离-规则混合布局/单双击拆分决策
├── data-model.md                                # Phase 1 运行时常量、目标函数及交互状态机模型
├── quickstart.md                                # Phase 1 工程校验命令与真机/离线人工验收清单
├── contracts/
│   └── distance-layout-interaction.md           # Phase 1 共享排版签名、单双击交互及回归测试契约
└── checklists/
    └── requirements.md                          # 规范质量检查表（16/16 通过）
```

### Source Code (repository root)

```text
src/
├── shared/
│   └── layout.ts                                # 阶段 1：跨组距离感知、完整弹性槽位池、重心直线吸附、增量邻居就近补位
└── client/
    ├── hooks/
    │   └── useReadingNavigation.ts              # 阶段 2：新增 selectNode(id)（选中并收起详情，不触发下钻）
    ├── components/
    │   ├── NodeCard.tsx                         # 阶段 2：带子图节点单击触发 onSelect、双击/Enter 触发 onOpen，拖拽保护覆盖双击
    │   └── MapScene.tsx                         # 阶段 2：向 SceneNode 透传 onSelect 处理器
    └── AtlasPane.tsx                            # 阶段 2：接入 onSelect -> doc.guard(() => nav.selectNode(id))

tests/
├── shared/
│   └── layout-navigation.test.ts                # 阶段 3：补充跨组距离对齐、1→2→1/1→3 重心对齐、邻居就近补位与满载确定性测试
└── integration/
    └── dom.test.ts                              # 阶段 3：更新并补充带子图节点单击选中高亮（不弹详情不跳转）与双击下钻测试
```

**Structure Decision**: 严格沿用现有 `src/shared` + `src/client` 单仓库分层结构，零新增运行时文件、零修改 `src/server/` 与 `src/client/offline.tsx`。所有初始排版优化收敛在 `src/shared/layout.ts`，所有节点单双击行为分离收敛在 4 个客户端交互文件中，边界清晰、可测且低回归风险。

## 实施顺序

1. **阶段 1 — 距离与规则混合初始排版与增量邻居补位（P1–P2 / `FR-001`–`FR-008`）**：
   - 改造 `src/shared/layout.ts`：
     - 定义 `AnchorPoint` 与 `BucketPlacementOptions`，为 `placeBucketNodes` 接入组内与跨组锚点联合距离计算、完整 $R \times 3$ 弹性候选槽位（支持分叉/汇合居中留白与 S 型长链折行）及 Stage 2 横向重心微调与 `48px` 直线对齐吸附；
     - 在 `fillLayout`（无已存布局分支）与 `relayoutView` 中实现两轮跨组协同锚点传播，并支持 `grid` 模式下跨列横向距离参考；
     - 在 `fillLayout`（已有部分已存节点的新增补位分支）中实现基于已定位关联邻居坐标与流向方向的最近无碰撞就近落位。
2. **阶段 2 — 带子图节点单击画布选中高亮与双击下钻分离（P1 / `FR-009` / Q1）**：
   - 在 `src/client/hooks/useReadingNavigation.ts` 实现 `selectNode(id)`（置 `selectedNodeId: id, detailHidden: true, focusSource: id`）；
   - 在 `src/client/AtlasPane.tsx`、`src/client/components/MapScene.tsx` 与 `src/client/components/NodeCard.tsx` 中打通 `onSelect` 与 `onDoubleClick` / `Enter` / `Space` 分离逻辑，确保拖拽结束后 `suppressClickUntil` 同步拦截误双击，并同步更新带子图节点无障碍与悬停提示文案。
3. **阶段 3 — 测试用例补充、静态校验与构建打包（`SC-001`–`SC-005`）**：
   - 补充 `tests/shared/layout-navigation.test.ts` 的距离排版与增量补位验证断言；
   - 更新 `tests/integration/dom.test.ts` 中对带子图节点 `a` 的单/双击交互与防误触验证；
   - 依 `AGENTS.md` 执行 `npm.cmd run typecheck`、`npm.cmd run build` 与预览包打包（若在实现回合触发 `src/` 改动），若获用户授权则运行 `npm.cmd run test`。

## Complexity Tracking

无宪章违规项，无需额外复杂度豁免。
