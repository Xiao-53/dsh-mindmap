# 节点详情阅读与编辑样式统一实施计划

**分支** `main`　**日期** 2026-11-18　**功能目录** `005-unify-note-presentation`　**输入** [功能规范](spec.md)

## 摘要

按现有节点编辑页统一标题、摘要和正文呈现，切换读写时保持相同内容位置。两种模式均显示完整公式、图片与图表，编辑态可删除、移动整张图并沿用正文保存和撤销。正文右键将点击处与所属段落加入原 DSH 草稿。用户手动发送后，由现有工具按已核验的源码位置补入公式或图表。同期修复画布节点拖出分组时背景被拉大的问题。

## 技术上下文

| 项目 | 决定 |
| --- | --- |
| 语言与运行时 | TypeScript 6、React 18、Node.js ≥24.9.0。 |
| 依赖 | 复用锁定的 DSH `0.2.2-rc.3` 原生侧栏和输入服务，沿用 Marked 17、KaTeX 0.19、JSXGraph 1.14、Zod 4 和现有构建。 |
| 持久化 | 沿用 `map.json`、独立节点 Markdown、`layout.json`、图片资源和现有条件事务。位置引用由 DSH 草稿承载，图块撤销依据按现有宿主编辑会话持有。 |
| 平台与类型 | DSH 桌面侧栏插件，独立 HTML 复用只读详情。 |
| 验证 | 文档阶段静态核对。实现后使用现有打包命令，按 [快速验收](quickstart.md) 交用户在 DSH 和断网 HTML 手动验证。 |
| 性能目标 | 读写切换保持稳定的滚动区域；普通输入只同步相关正文，避免整篇重新挂载图表。拖动期间只更新落点反馈，放下后提交一次编辑。 |
| 范围 | 节点详情、正文图块的原子编辑、正文位置引用及条件插入，以及画布节点移动时固定已有分组背景。沿用现有权限、数量和输入上限。导出保留已保存的阅读内容。 |

## 宪章检查

| 原则 | 研究前门槛 | 设计复核 |
| --- | --- | --- |
| I. 内容生成与界面实现职责分离 | DSH 只生成内容，插件维护呈现。 | 通过。公式、图表仍是 Markdown，位置由插件计算和验证。 |
| II. 独立数据与稳定身份 | 稳定地图、节点及图块身份，沿用现有文件职责。 | 通过。旧笔记直接读取，图块移动及恢复保留原围栏，外部变更受版本约束。画布移动只更新目标节点的坐标和手动标记，分组身份、成员和几何位置沿用原记录。 |
| III. 用户控制发送与修改保护 | 保留原草稿、原会话及来源，所有写入检查版本。 | 通过。引用仅进草稿；工具候选验证源码命中，冲突保留修改；图块手动撤销沿用条件保存和事务回执。 |
| IV. 官方契约与最小实现 | 依据目标宿主官方包，复用已有 React、工具和编辑链路。 | 通过。沿用 rc.3 的原生输入接口，新增变更项复用工具注册和提交，不扩展宿主依赖。 |
| V. 一致呈现与可验证交付 | 同一 Markdown 和样式，区分设计与实际验证。 | 通过。读写共用投影并保留离线阅读，人工验收覆盖布局、真实发送与落点、图块保存及冲突。 |

通过表示设计符合 [项目宪章](../../.specify/memory/constitution.md) 的约束。DSH 实机、保存与撤销、离线 HTML 均待实现后验收。

## 项目结构

### 本功能文档

```text
specs/005-unify-note-presentation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── note-detail.md
    └── dsh-insertion-reference.md
```

### 实现涉及的现有入口

```text
src/
├── client/
│   ├── AtlasPane.tsx
│   ├── components/{MapScene,NoteInspector,NodeEditor,NotePlot}.tsx
│   ├── note-rich-text.ts
│   ├── edit-session.ts
│   ├── reference-source.ts
│   ├── reference-navigation.ts
│   ├── insert-reference.ts
│   └── styles/atlas.css
├── server/
│   ├── edit-service.ts
│   ├── tools/{schemas,candidate,index}.ts
│   └── prompts/authoring.ts
└── shared/
    ├── layout.ts
    ├── note-markdown.ts
    └── note-plot.ts
```

在现有插件内复用 Markdown lexer、图表组件、条件事务和原会话草稿服务。实现时将手动移动和删除的例外同步到 [存储契约](../../docs/mindmap-storage-format.md)，将定位插入流程同步到 [生成规则](../../docs/mindmap-authoring-prompts.md) 及运行时 skill。005 中的图块手动操作覆盖 004 的对应规则，其余图块定义见 [图块格式](../004-function-plot/contracts/plot-markdown.md)。

## Phase 0 研究

[研究记录](research.md) 收敛了共用渲染、图块原文和撤销保护、DOM 与 Markdown 源码偏移、rc.3 草稿契约及工具写入约束。

### 画布节点拖动与分组背景

[MapScene](../../src/client/components/MapScene.tsx) 的拖动预览与 [AtlasPane](../../src/client/AtlasPane.tsx) 的移动草稿已经只改节点坐标。拖动提交后，`AtlasPane` 根据工作快照再次调用 `fillLayout`。[共享布局](../../src/shared/layout.ts) 在发现已有分组时，仍用全部成员的边界与原分组矩形取并集。节点移到分组外后，这一步会扩大背景，向左或向上移动还可能改变背景原点。相同计算会在刷新、重开和生成离线布局时运行。后续拖动可能把上次扩大后的背景带入保存。

已有分组矩形应作为普通补位的基准。直接保留它的 `x`、`y`、`width`、`height`，继续为新分组生成初始几何并为缺失的节点补位。`viewBounds` 仍同时计入节点和分组，使分组外的节点可继续浏览。显式切换排列和重置由 `relayoutView` 生成新矩形。旧文件按已保存的矩形读取，过去已写入的扩大区域可通过现有重置重新生成。依据见 [存储契约](../../docs/mindmap-storage-format.md#layoutjson) 和 [排列与拖动设计](../002-edit-layout-history/plan.md)。

## Phase 1 设计

| 需求 | 设计 |
| --- | --- |
| FR-001–006 | 在同一滚动面板保留稳定的标题、摘要、正文结构和可见段落。正文从原 Markdown 按原顺序生成标题、列表、文字和原子内容。编辑控件留在正文排版流之外。详见 [节点详情契约](contracts/note-detail.md)。 |
| FR-007、FR-009 | 完整图表使用现有绘图组件。整图删除和拖放是正文的独立历史动作，操作按原始围栏置换位置，服务端按有效图块身份和原始内容核验。详见 [数据模型](data-model.md) 和 [节点详情契约](contracts/note-detail.md)。 |
| FR-008 | 从正文点击生成稳定定位，使用原会话引用及版本保护，发送后通过 `insert_note_content` 完成受约束的条件插入。详见 [DSH 定位引用契约](contracts/dsh-insertion-reference.md)。 |
| SC-001–005 | 用正常宽度和窄栏、复杂 Markdown、历史坏块、草稿附件、失效位置、保存后撤销及离线 HTML 验收。详见 [快速验收](quickstart.md)。 |

### 画布背景修复与验收

- 在 `fillLayout` 删除已有分组的边界并集计算，直接复用原矩形并沿用补位顺序。拖动预览、保存和 [移动历史](../../src/client/edit-session.ts) 继续走现有路径。完整视图的布局随拖动提交，目标节点的 `x`、`y` 和 `manual` 是本次移动的有效变化。分组成员关系沿用 `map.json`。
- 人工验收使用两个相邻分组。把同一节点先向下拖入相邻分组的背景，再向左上拖出原分组。核对拖动中、松手、自动保存、关闭重开及撤销重做时，两个背景的位置和尺寸都与拖动前一致。节点应到达落点，连线跟随。对照 `layout.json` 中的分组记录，在已有布局和首次补位的布局各复验一次，再用显式排列或重置确认仍可重建背景。

## 实机反馈增量

- 位置引用补齐块间空白，设计见 [图表与公式的正文选点](insertion-followup.md)。已纳入 `v0.4.0` 并获用户人工验收。
- 离线 HTML 恢复画布节点拖动和排版切换。复用画布预览、连线和当前视图的重排，在页面内存保留调整后的布局，关闭或刷新回到导出位置。节点笔记继续只读。验收见 [离线回归](quickstart.md#离线回归)。

## 复杂性跟踪

设计无宪章例外。
