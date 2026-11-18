# Implementation Plan: 导图编辑、图片、排版与 30 步历史

**Branch**: `main` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: `specs/002-edit-layout-history/spec.md`，含自动保存增量及 2026-11-18 三项澄清（失败期间可撤销、取消米字型改为按组数开放多列、外部更新清空历史）。

`setup-plan.ps1 -Json` 返回 FEATURE_DIR 为本目录、BRANCH 为 `002-edit-layout-history`（功能选择标识）；实际 `git branch --show-current` 为 `main`，没有创建或切换 Git 分支。

## Summary

在现有原生侧栏、React 组件、DOM/SVG 画布及会话状态中增加节点标题/摘要/Markdown 编辑、本地图片、纵向/田字型及分组较多时开放的多列排版和 30 步撤销重做。采用会话级自动保存协调器，输入停顿 800ms 后提交，图片和布局动作立即提交；保存与面板挂载生命周期分离。复用现有候选校验、条件写、事务回退和地图串行队列，不新增框架或图形库。

新图片存为受控文本封装并由阅读层解码；布局以 v2 保存模式，读取兼容 v1。独立操作历史记录本地动作，保存回执管理磁盘基线：保存失败期间撤销/重做只改本地，恢复后按目标提交净差异；外部版本（含 AI 修改）载入后清空本图历史。排列控件按当前视图组数只列出可用模式（田字型 ≥2 组、多列 ≥7 组）。完整设计见 [research.md](research.md)、[data-model.md](data-model.md) 和 [接口契约](contracts/editor.md)。

## Technical Context

**Language/Version**: TypeScript（package.json 开发范围 ^6.0.3），Node.js >=24.9.0；复用现有 ES module 构建。

**Primary Dependencies**: 宿主 React 18、DSH 固定 0.2.2-rc.3、marked 17.0.1、zod 4.6.6；现有 esbuild。无新增运行时依赖。

**Storage**: 原 map.json、Markdown、assets、layout.json；仅布局增加 v2、图片增加 `.image.json` 文本封装。草稿和历史仅当前会话内存；事务日志与操作回执沿用 `.transactions`，不把 30 步历史写入地图或导出。

**Testing**: 本轮只静态研究和文档核对；不运行测试、类型检查、构建或浏览器。将来构建打包生成安装产物；界面由用户人工验收。新增事务失败边界在另获授权后使用现有 Node 测试基础验证，不新增框架，不沿用旧测试通过来替代新边界证据。

**Target Platform**: DSH 0.2.2-rc.3 桌面原生侧栏；全图离线 HTML 保持只读。

**Project Type**: 已有 Host/Client 双端插件。

**Performance Goals**: 120 节点、12 分组切换后 2 秒内可操作；三张固定图至少两张跨组交叉下降 20%；均为待测目标，不承诺几何排布天然满足。

**Constraints**: 官方 fs 只有条件文本写入，没有 writeBytes；官方侧栏没有关闭前否决钩子。输入逐次捕获至会话副本，自动保存不依赖组件存活；宿主直接关闭只能继续保存/会话恢复，不能保证进程退出落盘。严格读写边界、共享节点、无自动模型请求。

**Scale/Scope**: 标题、摘要、正文和本地图片；vertical/grid/columns（columns 仅 ≥7 组可选）；每图本次打开 30 步；不扩展结构 CRUD、富文本库、图片标注或 AI 排版接口。建议首版单图像解码字节上限 8 MiB，单提交新增图片合计 16 MiB，编码请求上限 24 MiB，事务序列化日志上限 48 MiB；在进入提交前拒绝超限并保留草稿，需真机验证传输能力。

## Constitution Check

研究前与设计后均通过设计门槛；下表“通过”不表示运行验收完成。

| 原则 | 研究前约束 | 设计后结论 |
| --- | --- | --- |
| 内容与界面职责分离 | 模型不生成界面或坐标 | 通过；模式和位置仅插件维护，不扩展 AI 工具布局参数 |
| 独立数据与身份 | 不复制共享节点，不改无关位置 | 通过；详情定向变化、布局独立 v2、资源不可变 |
| 修改保护与手动发送 | 条件写、冲突拒绝、多文件回退 | 通过；UI 和 AI 复用事务。新增图片事务未验证前不开放实际写入，只保留候选/预览；自动保存不等于绕过保护；失败期间撤销后的净差异提交仍走条件写，外部版本载入即清空旧历史，不以旧前值覆盖 |
| 官方契约与最小实现 | 依目标版本核对，不绕权限 | 通过；本地官方包证明文本写与关闭限制，采用文本资源和会话协调器，无虚构 API |
| 一致呈现及证据 | 维持既有风格，区分规划/验收 | 通过；只新增指定入口和模式，人工/内部验证分别列明 |
| 流程 | 不自动推进步骤 | 通过；用户后续明确授权 tasks 后继续 implement，已同步任务并生成预览；不推送、不发布、不自行进入后续步骤 |

自动保存及宿主关闭边界已同步 [规范增量](spec.md#2026-11-18-自动保存增量优先于下文原显式保存描述)，不再声称所有宿主关闭入口可事先弹窗。无需要豁免的宪章违反项。

## Project Structure

### Documentation (this feature)

```text
specs/002-edit-layout-history/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
└── contracts/editor.md
```

### Source Code (repository root)

以下为实现改动位置（2026-11-18 已生成预览代码）：

```text
src/client/
  AtlasPane.tsx                 接入编辑会话、受控导航、局部快捷键
  edit-session.ts              新增：批次、历史、草稿、保存协调器、失败后净差异提交、外部更新清史
  host-adapter.ts               受限提交与结构化错误
  components/NoteInspector.tsx  编辑输入与预览、图片入口
  components/MapHeader.tsx      全部导图旁模式（按组数列出可用项）与重置
  components/MapScene.tsx       拖动起止、取消恢复
  render-note.tsx               复用图片安全显示
  export-html.ts               只封装有效阅读内容/资源
src/shared/
  map-types.ts / validate-layout.ts  v1/v2 读取、模式与结果类型
  layout.ts                    保留补位，新增显式单视图重排
  image-resource.ts            新增：文本封装校验与限额
src/server/
  map-service.ts               新增受限 UI 编辑请求
  edit-service.ts              新增：抽取可共用提交服务
  map-files.ts                 文本图片解码、只读降级、严格候选校验
  transaction.ts               资源白名单、回执与恢复
  tools/index.ts / tools/storage.ts  复用共用提交，不新增模型排版入口
```

**Structure Decision**: 延用单仓库双端结构；模块名为拟定实现落点。编辑会话由插件注册生命周期拥有，按 session/workspace/map 隔离，不新增全局状态库；面板只是订阅者。已有阅读导航历史独立保留。

## Phase 0：研究结果

研究完成，结论与证据见 [research.md](research.md)。技能要求的并行研究分别覆盖保存/资源与布局/生命周期，均只读。主要决策：文本图片封装、布局 v2 单向升级、受限通用编辑提交、800ms 自动保存批次、会话内草稿保留、读取降级与写入严格验证分开。2026-11-18 澄清后新增：失败期间本地撤销与按目标净差异提交（research §4.1）、外部更新识别自有回执并清空历史（§4.2）、取消 radial 改为 grid/columns 共用网格算法并按组数开放（§6）。

## Phase 1：设计与契约

- [数据模型](data-model.md)：资源、布局、工作副本、历史及保存状态迁移。
- [接口契约](contracts/editor.md)：UI 编辑批次、幂等提交、错误、快捷键和阅读降级。
- [验证指南](quickstart.md)：实现完成后由用户执行的端到端场景与另行安排的内部验证。
- 实施前同步 docs/mindmap-storage-format.md 的新资源和布局格式；docs/mindmap-authoring-prompts.md 仍要求模型只处理内容，不加入坐标或图片任意路径写入规则。存储兼容说明须明确旧插件不能读取新 layout v2 和文本图片，不静默回退或称双向兼容。
- T047 的工作副本/历史、T048 的详情子集、T049 的重排撤销、T050 的刷新协调及 T051 的人工场景为本增量复用范围；不勾选完整结构编辑或旧全套内部验收。

## Complexity Tracking

无宪章豁免。文本图片封装是目标宿主条件写能力的直接约束；布局 v2 是避免 strictObject 旧读取器误判兼容的显式格式变更；两者均不引入新持久化系统。

## 交付状态

Phase 0 与 Phase 1 设计已按 2026-11-18 澄清更新，新增事务实际写入仍受验证门槛约束。不存在 `.specify/extensions.yml`，无前后钩子。

[tasks.md](tasks.md) 已按用户授权同步并继续 implement。预览代码和本地安装包已完成，新写分支由服务端开关保持关闭。实现完成与运行验证分别记录，内部证据及人工验收任务保持未完成；不自动进入下一 Spec Kit 步骤。见 [实施记录](../../docs/validation/edit-layout-history.md)。

最新增量：preview.2 已交付原位编辑与单键循环排版，获授权的保存专项通过后开放手动编辑自动保存。人工验收待执行。
