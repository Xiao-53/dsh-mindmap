# Implementation Plan: 导图四向邻接排版、生成质量与详情关系操控优化

**Branch**: `main`（Spec Kit 功能：`010-layout-authoring-navigation`） | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from [spec.md](spec.md)、[存储契约](../../docs/mindmap-storage-format.md)、[提示词契约](../../docs/mindmap-authoring-prompts.md) 与 [项目宪章](../../.specify/memory/constitution.md)。

## Summary

在严格保持通用思维导图定位（不引入学习进度点亮、不引入画布内折叠小组、不新增线性大纲视图）、零第三方新依赖且 `map.json` / `layout.json` 向后兼容的前提下，分 3 个相互解耦的模块落地本次优化：

1. **模块 A — 四向端口感知的二维网格邻接排版、紧凑分组框与贝塞尔绕弧避让（P1 / FR-001–FR-004, FR-009）**：
   - 严格保护既有 `layout.json`：已存节点坐标与已存分组框在打开时 100% 保持原样；仅在新建导图、无已存布局、新增未定位节点补位或用户主动点击“重置排列 / 切换排列”时应用新排版；
   - 在 `src/shared/layout.ts` 中将组内（及无分组桶）“按数组下标盲填 3 列网格”升级为**四向端口感知的二维网格邻接排布**：有关系时以 S 型蛇形拓扑序为种子，通过确定性成对槽位交换最小化相连节点网格距离、重罚同行/同列夹心穿卡、让多度枢纽居中以充分利用上/下/左/右四向动态端口，无关系时完全保持原序；
   - 移除分组框 `1058px` 硬编码最小宽度，按组内实际节点列宽紧凑包裹；移除 `availableModes` 中 ≥7 组才触发的冗余 `columns`（多列）模式（仅保留 `vertical` 与 `grid`，并对旧 `layout.json` 中的 `"columns"` 保持兼容读取）；
   - 在 `src/shared/edge-geometry.ts` 与 `src/client/animate-ports.ts` 中为三次贝塞尔曲线增加非端点卡片碰撞检测，穿卡时将控制点向阻挡卡片外侧间隙法向偏移绕弧，未穿卡时保持原 v17 曲线。
2. **模块 B — `/mindmap` 运行时生成质量提示词加固（P1 / FR-005）**：
   - 在 `src/server/prompts/authoring.ts`（并同步 `docs/mindmap-authoring-prompts.md`）中补充“起始节点独立性自检（禁止为凑唯一根节点或填满画布编造假 `dependency`）”、“跨主题（架构/流程/学习）去虚词可检验写作判据”与“范围边界及推荐阅读起点交待”。
3. **模块 C — 可独立拆分回退的详情关系胶囊、连线焦点高亮与选中解耦（P2 / FR-006–FR-009）**：
   - 新增独立组件 `src/client/components/NeighborPills.tsx`，在 `NoteInspector` 中展示当前视图（`view.relationIds`）内的直接前置依赖、后续节点与补充关联胶囊；点击胶囊始终在当前视图内平滑居中并切换详情（即使目标节点带 `childViewId` 也不触发跨视图下钻）；
   - 在 `src/client/components/MapScene.tsx` 中支持选中节点的关系焦点高亮（突出直接前置入边、后续出边与补充关联边，淡化其余非直接关联边至 `0.2` 不透明度）；
   - 在 `src/client/reading-state.ts`、`useReadingNavigation.ts` 与 `AtlasPane.tsx` 中通过 `detailHidden?: boolean` 解耦“收起详情面板”与“取消画布节点选中”：关闭详情面板（或按一次 `Escape`）仅收起面板而保留画布选中与关联连线高亮，再次点击已选中无子图节点重新展开详情，点击画布空白背景（或再按一次 `Escape`）才清除选中。该模块与模块 A、B 完全解耦，支持人工验收后按需单独调整或打回。

## Technical Context

**Language/Version**: TypeScript（Host 与 Client 均面向 ES2023，Node.js ≥ 24.9.0，测试使用 `--experimental-strip-types` 直接运行 TS）。

**Primary Dependencies**: 既有 React 18、Zod 4、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-typert-protocol`、`@deepseek-ai/dsh-client-store`、KaTeX、Marked、JSXGraph、CodeMirror 6、esbuild；零新增外部依赖。

**Storage**: 工作区 `dsh-knowledge-maps/<mapId>/` 下的 `map.json`（`schemaVersion: 1`，零改动）、`layout.json`（`schemaVersion: 1 | 2`，兼容读取旧 `"columns"`，新建与重排仅产出 `'vertical' | 'grid'`）与 `notes/*.md`。

**Testing**: Node 内置 `node:test` + `jsdom`（`npm.cmd run typecheck`、`npm.cmd run test`、`npm.cmd run build`、`npm.cmd run pack:plugin -- --dry-run`），覆盖二维网格邻接排布、紧凑分组框、既有 `layout.json` 保护、贝塞尔穿卡绕弧、提示词规则、详情关系胶囊与选中解耦；DSH Desktop 真机体验按 [quickstart.md](quickstart.md) 由用户人工验收。

**Target Platform**: DSH `0.2.2-alpha.3` ~ `0.2.x` 桌面端原生右侧栏（360px～720px 宽度）及离线导出单文件 HTML 阅读器。

**Project Type**: 单仓库 DSH 原生侧栏思维导图插件（`src/shared` + `src/server` + `src/client`）。

**Performance Goals**: 单视图 $\le 20$ 节点下，组内二维网格槽位优选计算耗时 $< 1\text{ ms}$；贝塞尔穿卡检测与控制点绕弧在拖拽 60fps 补间帧中无卡顿（单帧计算 $< 0.5\text{ ms}$）；详情关系胶囊点击到同层相机居中与详情切换在单次渲染帧内响应。

**Constraints**: 严格遵守项目宪章与 5 项澄清结论：不改动已有 `layout.json` 已存节点/分组坐标；保持 HTML v17 三次贝塞尔曲线与端口滑动动画；模块 C（详情关系胶囊 + 连线焦点高亮 + 收起详情保留选中）必须在代码与任务层面保持高度独立可拆分，以便用户在真机验收后可随时单独保留或打回。

**Scale/Scope**: 覆盖 3 个 User Stories、9 条 Functional Requirements（`FR-001`–`FR-009`），涉及共享排版/几何模块、服务端运行时提示词、客户端详情/画布/阅读导航及对应单测与集成测试。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 规划前检查 | 设计后复核 |
| --- | --- | --- |
| I. 内容生成与界面实现职责分离 | 通过。AI 仍只产出 `map.json` 与 Markdown，排版优化与贝塞尔避让完全在插件 `src/shared/` 与 `src/client/` 内完成。 | 通过。`/mindmap` 提示词仅强化内容真实性、防伪连线与去虚词写作质量，不要求模型计算坐标或感知布局模式。 |
| II. 独立数据与稳定身份 | 通过。不改变 `map.json` 与 `layout.json` 分离契约。 | 通过。既有 `layout.json` 打开时 100% 保留原坐标与外框；`validate-layout.ts` 保留 `'columns'` 枚举向后兼容旧文件；`detailHidden` 仅存在于会话内存 `ReadingState`，不污染磁盘文件。 |
| III. 用户控制发送与修改保护 | 通过。不涉及自动发送模型请求，且保留所有未保存修改保护。 | 通过。点击详情内的相邻节点胶囊切换详情时，同样经过 `doc.guard(...)` 与 `onFinishEdit` 保护，不会丢失未保存的正文或布局草稿。 |
| IV. 官方契约与最小实现 | 通过。零新增图形库或状态库，完全复用现有 DOM/SVG 与 React 组件。 | 通过。新增仅 1 个可独立拆分的轻量组件 `NeighborPills.tsx`，其余均在既有文件内最小改动落地。 |
| V. 一致呈现与可验证交付 | 通过。保留 HTML v17 雾霾蓝/灰豆沙端点、三次贝塞尔弧线与 0.5 秒子图过渡。 | 通过。贝塞尔避让仅在穿卡时外偏控制点，未阻挡时与 v17 曲线完全一致；离线 HTML 通过复用 `ReadingPane` 100% 同步获得全部排版与操控优化；真机验收步骤已记录于 [quickstart.md](quickstart.md)。 |

## Project Structure

### Documentation (this feature)

```text
specs/010-layout-authoring-navigation/
├── spec.md                                    # 澄清后的功能规范（5 轮澄清已整合）
├── plan.md                                    # 本文件（$speckit-plan 产出）
├── research.md                                # Phase 0 算法与交互设计决策
├── data-model.md                              # Phase 1 二维邻接槽位、避让几何与状态流转模型
├── quickstart.md                              # Phase 1 自动化核验与真机人工验收指南
├── contracts/
│   └── layout-authoring-navigation.md         # Phase 1 排版、提示词与可拆分详情操控契约
├── checklists/
│   └── requirements.md                        # 规范质量检查表（16/16 通过）
└── tasks.md                                   # Phase 2 产物（待 $speckit-tasks 生成）
```

### Source Code (repository root)

```text
src/
├── shared/
│   ├── layout.ts                              # 模块 A：实现四向端口感知的二维网格邻接排布、S 型长链折行、枢纽居中、防夹心穿卡、紧凑分组外框（去掉 1058px 死宽）、精简 availableModes 移除 'columns' 并兼容旧 mode 重排
│   ├── edge-geometry.ts                       # 模块 A：在 connectionGeometry / createConnections 中实现非端点卡片碰撞检测与贝塞尔控制点法向绕弧避让
│   └── validate-layout.ts                     # 模块 A：保持 layoutSchema 对历史 'columns' 枚举的兼容读取
├── server/
│   └── prompts/
│       └── authoring.ts                       # 模块 B：升级 /mindmap 提示词（无前置节点独立性自检防单根假边、架构/流程/学习去虚词正反例判据、范围边界与默认阅读起点说明）
└── client/
    ├── animate-ports.ts                       # 模块 A：向 connectionGeometry 传入 nodes 矩形表，使端口过渡动画与静态渲染共用同一避障贝塞尔曲线
    ├── reading-state.ts                       # 模块 C（可拆分）：ReadingState / ReadingLocation 增可选 detailHidden?: boolean
    ├── navigation.ts                          # 模块 C（可拆分）：targetReading 支持可视视口宽度适配（避开已展开的 NoteInspector 遮挡）并重置 detailHidden: false
    ├── AtlasPane.tsx                          # 模块 C（可拆分）：接入 detailHidden 控制 NoteInspector 显隐、画布空白点击清除选中、Escape 分级收起详情/清除选中，以及向 NoteInspector 传入同层胶囊跳转回调
    ├── hooks/
    │   └── useReadingNavigation.ts            # 模块 C（可拆分）：closeNote 改为收起详情保留 selectedNodeId，新增 clearSelection 与 focusNodeInView（同层居中切详情，不触发子图下钻）
    ├── components/
    │   ├── MapHeader.tsx                      # 模块 A：排列切换文案与循环逻辑适配 vertical / grid 双模式
    │   ├── MapViewport.tsx                    # 模块 C（可拆分）：识别画布空白背景的非拖拽轻点并触发 onClearSelection
    │   ├── MapScene.tsx                       # 模块 C（可拆分）：根据 selected 计算关联边焦点角色（edge-focus-in / out / supplement / edge-dimmed）
    │   ├── NoteInspector.tsx                  # 模块 C（可拆分）：单点挂载 <NeighborPills /> 展示当前视图前置/后续/补充节点胶囊
    │   └── NeighborPills.tsx                  # 模块 C（新增，可独立移除）：计算并渲染当前视图 view.relationIds 的直接关联节点胶囊
    └── styles/
        ├── atlas.css                          # 模块 C（可拆分）：补充关系胶囊（.neighbor-pills）与焦点高亮/降噪连线（.edge-focus-* / .edge-dimmed）样式
        └── dark.css                           # 模块 C（可拆分）：深色模式下的关系胶囊与高亮连线配色适配

docs/
├── mindmap-authoring-prompts.md               # 模块 B：同步更新生成质量规则说明
└── mindmap-storage-format.md                  # 模块 A：同步说明 layout.json 排列模式精简为 vertical / grid 并兼容旧 columns 读取

tests/
├── shared/
│   ├── layout.test.ts                         # 模块 A：验证二维网格邻接排布、S 型长链、枢纽居中、防夹心穿卡、紧凑分组框、既有 layout.json 保护与 availableModes
│   └── edge-geometry.test.ts                  # 模块 A：验证贝塞尔连线穿卡检测与控制点绕弧避让
└── integration/
    ├── authoring-prompt.test.ts               # 模块 B：验证 /mindmap 提示词包含防单根假边、去虚词判据及范围起点规则
    └── dom.test.ts                            # 模块 C：验证详情关系胶囊同层跳转（含带 childViewId 目标不下钻）、关联边高亮/降噪、收起详情保留选中及点击空白/Escape 清除选中
```

**Structure Decision**: 严格沿用现有 `src/shared` + `src/server` + `src/client` 三层结构，并将改动划分为 **模块 A（排版与避让）**、**模块 B（提示词质量）**、**模块 C（详情关系胶囊与焦点操控）** 三个互不依赖的代码切片。模块 C 的 UI 仅新增一个独立组件文件 `src/client/components/NeighborPills.tsx`，确保验收后可随时独立微调或一键回退。

## 实施顺序（按独立可交付与可拆分模块推进）

1. **阶段 1 — 模块 A：四向端口感知的二维网格邻接排版、紧凑分组框与贝塞尔绕弧避让（P1 / FR-001–FR-004）**：
   - 改造 `src/shared/layout.ts`（`placeGroupNodes` 二维网格邻接优选、紧凑分组包络、移除 `availableModes` 中的 `'columns'` 并保护既有 `layout.json`）；
   - 改造 `src/shared/edge-geometry.ts` 与 `src/client/animate-ports.ts`（非端点卡片碰撞检测与贝塞尔控制点法向绕弧）；
   - 更新 `src/client/components/MapHeader.tsx` 与 `docs/mindmap-storage-format.md`，并补充 `tests/shared/layout.test.ts` 与 `tests/shared/edge-geometry.test.ts`。
2. **阶段 2 — 模块 B：`/mindmap` 运行时生成质量提示词加固（P1 / FR-005）**：
   - 更新 `src/server/prompts/authoring.ts` 与 `docs/mindmap-authoring-prompts.md`，补充起始节点独立性自检、跨主题去虚词正反例判据及范围/阅读起点说明，并校验提示词单测。
3. **阶段 3 — 模块 C（可独立回退切片）：节点详情前后关系胶囊、连线焦点高亮与选中解耦（P2 / FR-006–FR-009）**：
   - 新增 `src/client/components/NeighborPills.tsx` 并在 `NoteInspector.tsx` 中挂载；
   - 在 `MapScene.tsx` 中实现选中节点的关联边高亮与非关联边降噪；
   - 在 `reading-state.ts`、`navigation.ts`、`useReadingNavigation.ts`、`MapViewport.tsx` 与 `AtlasPane.tsx` 中实现 `detailHidden` 收起详情保留画布选中、再次点击展开详情以及点击空白/按 `Escape` 清除选中；
   - 补充 `atlas.css` / `dark.css` 样式与 `tests/integration/dom.test.ts` 集成测试，最终统一运行 `typecheck`、`test`、`build`、`pack:plugin -- --dry-run` 验证。

## Complexity Tracking

无宪章违规项，无需额外复杂度豁免。
