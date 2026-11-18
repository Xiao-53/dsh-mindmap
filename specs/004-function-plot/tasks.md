# 任务：节点笔记函数图像与统计图表

输入 [功能规格](spec.md)、[实施计划](plan.md)、[调研](research.md)、[数据模型](data-model.md)、[图块契约](contracts/plot-markdown.md)、[DSH 契约](contracts/dsh-plot-reference.md) 与 [验收指南](quickstart.md)。按用户故事分阶段实现，任务编号接续项目现有编号。独立验收由用户在目标环境执行。

## 阶段 1｜现有工程准备

- [x] T203 核对 .gitignore 与现有构建边界，在 package.json 和 package-lock.json 固定 JSXGraph 1.14.3，分配新的本地预览构建号。

## 阶段 2｜公共基础

- [x] T204 [P] 在 src/shared/plot-expression.ts 实现受限实函数 AST、同源 KaTeX 图例与有界区间采样。每条最多 256 字符、语法嵌套最多 32 层，跳过非定义域、裁切视窗并在不确认连续时断段。
- [x] T205 [P] 在 scripts/build.mjs 的宿主客户端与离线 IIFE 中隔离 JSXGraph ESM 的 window.JXG 赋值，内联实际模块图，保留 MIT 声明，避免外部资源。
- [x] T206 在 src/shared/note-plot.ts 定义严格 JSON 校验、稳定身份、规范化和可读快照。version 为整数 1，id 用现有 ID 规则且笔记内唯一，kind 为 function、bar、line；标题、系列名称、类目和单位为最长 120 字符的单行纯文本。函数范围可选，各为两个严格递增有限数，独立默认 [-5,5]；有序 1–3 项，每项 expression 最长 256 字符，label 可省。统计有序 1–3 系列，每项 label、1–100 个有限数或 null、可选 unit；各系列等长，与 1–100 个类目等长。柱状必填类目，折线可按位置从 1 起编号。JSON 输入最多 128 KiB。
- [x] T207 在 src/shared/note-markdown.ts 识别顶层 dsh-plot 围栏，保留原始章节片段、CRLF 与局部诊断，检测重复身份并比较持久化图块序列；普通围栏、引用内的示例与公式沿用既有解析。

## 阶段 3｜US1 阅读节点中的图像（P1）

**目标** 在现有节点详情显示只读函数图和统计图。**独立验收** 按 SC-001、SC-003 核对区间和数据，在普通编辑尝试跨块删除及新增。

- [x] T208 [P] [US1] 在 src/client/components/NotePlot.tsx 和 src/client/styles/atlas.css 显示 JSXGraph SVG 坐标轴、分段曲线、分组正负柱、含缺值折线、窄栏图例和完整文本数据。只初始化可见图块，卸载释放，异常可复制原文。
- [x] T209 [P] [US1] 在 src/client/note-rich-text.ts、src/client/components/NodeEditor.tsx、src/server/edit-service.ts 守住只读图块。UI 保留原文并阻断跨块写，服务端比较已保存序列；标题、正文、公式和图片照旧编辑。
- [x] T210 [US1] 在 src/client/render-note.tsx、src/shared/note-sections.ts、src/client/copy-note.ts、src/client/selection.ts 接入共同渲染、章节分割、图例投影与复制，保持普通 Markdown/LaTeX 行为。

## 阶段 4｜US2 把指定图块交给 DSH（P1）

**目标** 从已保存图块生成宿主引用，AI 经手动发送后处理指定图。**独立验收** 按 SC-002 核对两个同名同数据图块、草稿选区、变化前后的目标检查和删除授权。

- [x] T211 [P] [US2] 在 src/client/reference-source.ts、src/client/reference-navigation.ts、src/client/insert-reference.ts 扩展兼容的 plot 引用，保留 mapId/nodeId/originViewId/plotId、规范化内容快照与原工作区、会话检查，序列化显式传递来源和可读快照。保留 draftRev 并折叠选区后插入。
- [x] T212 [P] [US2] 在 src/server/tools/index.ts 和 src/server/tools/candidate.ts 中校验创建及完成候选，拒绝新的坏围栏，兼容原样损坏旧块，把图块实际删除登记到现有预览与授权路径，沿用指纹和事务。
- [x] T213 [US2] 在 src/client/AtlasPane.tsx、src/client/components/NoteInspector.tsx 和 src/client/components/NotePlot.tsx 接入右键及键盘等效菜单、原会话插入与重试、保存来源和回跳定位。
- [x] T214 [P] [US2] 更新 src/server/prompts/authoring.ts 和 docs/mindmap-authoring-prompts.md 的已实现格式、同源任务确认、重读核对、缺数据和保存说明。

## 阶段 5｜US3 在离线分享文件中只读看图（P1）

**目标** 读已保存图、笔记和资源，单个离线 HTML 整页只读。**独立验收** 按 SC-004 迁移到新目录并断网打开，核对邻近正文、图块和普通阅读操作。

- [x] T215 [US3] 在 src/client/offline.tsx、src/client/export-html.ts、src/client/AtlasPane.tsx 移除离线写能力，使用已保存内容生成单文件；切断编辑快捷键、节点菜单和宿主操作，保留阅读平移缩放和搜索。

## 阶段 6｜交付

- [x] T216 更新 docs/mindmap-storage-format.md 和 docs/validation/function-plot.md，记录图块格式、安装产物、已完成构建和待人工验收范围。
- [x] T217 用 scripts/build.mjs 完成现有构建、类型核对及本地打包，并记录实际结果于 docs/validation/function-plot.md。产品验收按项目约定另行执行。

## 依赖与执行顺序

准备 → 公共基础 → US1 阅读 → US2 引用与 AI 变更 / US3 离线阅读 → 交付。US2、US3 都依赖阅读入口；离线不依赖 AI 写入，二者编辑同一个 AtlasPane.tsx 时串行合入。

- US1 并行示例：先分头完成 T208 绘图和 T209 手动边界，再用 T210 联接阅读。
- US2 并行示例：T211 引用模型、T212 后端候选和 T214 文案可独立处理；T213 在引用模型就绪后接入。
- US3 并行示例：离线入口及已保存数据路径可与 T214 文案同步处理，共享阅读入口等 T213 完成后调整。

最小可用增量为 US1 的纯阅读图块。当前交付范围包含全部三个 P1 故事。实现完成与手动验收分别记录。
