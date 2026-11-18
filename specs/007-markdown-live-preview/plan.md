# Implementation Plan: 节点正文 Markdown 实时预览编辑

**Branch** `main` · **Spec Kit 功能** `007-markdown-live-preview` · **Date** 2026-11-18 · **Spec** [功能规范](spec.md)

**Input** [功能规范](spec.md)、[既有节点详情契约](../005-unify-note-presentation/contracts/note-detail.md)和[存储契约](../../docs/mindmap-storage-format.md)。

## Summary

在 DSH 在线侧栏节点详情接入 CodeMirror 6。真实文档、输入和选区由正文编辑器管理，显示层按进入范围显露 Markdown 标记。行内公式原位切换源码和 KaTeX，独立公式按块显示，并在原位编辑时显示一个下方预览。只读与实时预览复用现有样式、公式和图表语义。

新编辑入口沿用「编辑／完成」和同一详情面板。正文变更进入现有 `EditSession`，原文换行、图片引用、图表围栏、位置引用及服务器写入安全均有明确接入约束。详细选择和证据见[调研](research.md)。

## Technical Context

| 项目 | 方案 |
| --- | --- |
| Language/Version | 既有 TypeScript、React 18、Node.js ≥ 24.9.0、esbuild，客户端构建目标 ES2023。 |
| Primary Dependencies | 在线正文使用 CodeMirror 6 的状态、视图、命令、语言和 Markdown 模块。选定支持 `insertNewlineContinueMarkupCommand({ nonTightLists: false })` 的 Markdown 版本（最低 6.5.0），实现时锁定兼容包版本和单一状态模块实例。原 Marked、KaTeX、JSXGraph、Zod 继续使用。 |
| Storage | 现有节点 Markdown、图片资源和地图写入协议。文本变化按原文范围应用，保留未触及的换行与字节。图表只可按现有整图规则操作。 |
| Testing | 规划阶段核对文档与代码。实施可按项目约定构建、打包和类型检查。交互、真机及离线验证见[验收指南](quickstart.md)，自动化和内部故障注入按项目授权执行。 |
| Target Platform | DSH `v0.2.2-rc.3` 的桌面原生右侧栏。独立 HTML 沿用阅读入口。实际复验同时记录用户使用的宿主版本。 |
| Project Type | 单仓库 DSH 插件，在线编辑模块经现有客户端装载格式打包。 |
| Performance Goals | 移动光标、选区和滚动只更新必要表示，无写入及历史记录。长笔记滚动复用已解析状态和未变化的渲染，避免重复初始化图面、反复整篇解析或每次按键重新创建编辑器。使用[长笔记样例](quickstart.md#7-长笔记只读和离线)人工核对。 |
| Constraints | 同节点原值和保存确认保持选区与正文历史。有效外部替换清理失效历史。图面、资源、正文均以项目已有安全规则渲染。离线阅读构建只引入阅读所需代码，在线编辑器由在线入口注入。 |
| Scale/Scope | 一次编辑当前打开的节点，允许长正文和混合换行，沿用现有大小、图片、图表和历史上限。画布、DSH 工具、存储契约及提示词接口沿用现行版本。 |

## Constitution Check

| 原则 | 规划前 | 设计复核 |
| --- | --- | --- |
| I. 内容生成与界面实现职责分离 | 通过。围绕 Markdown 正文交互。 | 同一套公式、图表及位置工具继续由插件实现布局与校验。模型仅按既有规则提供知识内容。 |
| II. 独立数据与稳定身份 | 通过。依托现有笔记与图表身份。 | 地图、节点、资源与图表 ID 保持现行含义。原文逐段落回写，图表移动只修改对应围栏位置，无迁移。 |
| III. 用户控制发送与修改保护 | 通过。保留引用手动发送和写入保护。 | 位置锚点按已保存内容复核，保留草稿与原会话绑定。文件写入仍经 `commitEdit` 的版本检查、事务和恢复。 |
| IV. 官方契约与最小实现 | 通过。使用已核对的 DSH 目标标签和编辑器公开 API。 | CodeMirror 6 只进入在线编辑入口，复用既有 React、渲染、保存与 DSH 接入。真实输入与宿主兼容性列为后续验证。 |
| V. 一致呈现与可验证交付 | 通过。阅读和编辑遵守规范排版。 | 冻结跨模式对照和保存保护用例。已发布版本和待验证的 007 分开记录。 |

## Project Structure

### Documentation (this feature)

```text
specs/007-markdown-live-preview/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   └── live-preview.md
└── quickstart.md
```

### Source Code (repository root)

```text
src/client/
├── index.tsx                     # 在线入口和编辑器注入
├── AtlasPane.tsx                 # 节点打开、保存保护和画布快捷键
├── components/
│   ├── NoteInspector.tsx         # 详情区、滚动和引用界面
│   ├── NodeEditor.tsx            # 标题、摘要及正文读写衔接
│   └── MarkdownNoteEditor.tsx    # 拟新增，在线正文编辑和控件
├── note-rich-text.ts             # 保留阅读投影和引用定位所需逻辑
├── edit-session.ts               # 现有工作副本、资源池、批次及提交
├── reference-navigation.ts       # 现有引用回跳
└── styles/atlas.css              # 共享正文排版
src/shared/
├── note-markdown.ts              # 项目公式和图表语法及围栏操作
└── note-position.ts              # 现有 DSH 定位载荷及校验
```

**Structure Decision** 编辑器状态、源码范围及装饰留在在线编辑器附近。在线入口传入编辑组件，离线入口继续只构造阅读面板。先核对所有读者与引用投影调用，再删除已被替换的正文 DOM 序列化、公式草稿和相关离开拦截。最终拆分以类型边界、调用关系及最少文件为准。

## 实施顺序

1. **文本与生命周期。** 建立在线编辑器组件及原文和编辑坐标的映射。维护按身份隔离的文档、选区、历史和有效外部更新路径。保留原有读取投影，同时铺设跨模式滚动位置与共享正文样式。
2. **格式与输入。** 先接标题、正文、加粗与斜体装饰，再以 Markdown 插入／删除命令处理列表。针对紧密列表、嵌套退出和合并补足边界。接入行内、独立 KaTeX 预览，中文输入和选区与常规正文使用同一输入路径。
3. **受保护块与宿主动作。** 接入图片资源、图表挂载与整图操作，利用精确来源和事务保护普通编辑。复用 DSH 引用和跳转接口，显式区分真实文本点、顶层块间隙和图表控件。
4. **保存、打包与交付。** 在 `EditSession` 两层历史、自动保存、冲突和断线边界核对结果。清理旧公式草稿拦截。交付时记录构建证据、离线包边界及待复验项，按[验收指南](quickstart.md)回归 FR-001 至 FR-009。

未发现需要例外批准的宪章冲突。本设计完成后可生成任务清单。
