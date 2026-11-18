# Implementation Plan: 节点笔记 LaTeX 公式预览与编辑

**Branch**: `main`（当前 Git 工作分支，Spec Kit 特性 `003-latex-formula-preview`） | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: [功能规格](spec.md)及已确认的无插入按钮交互。

## Summary

在节点详情的阅读、可视编辑和独立 HTML 中共享 LaTeX 识别与 KaTeX 显示。用户直接键入或粘贴，闭合有效的公式在原位置显示。已有公式可局部编辑，自动渲染本身不产生撤销或保存动作。Markdown 保存原式，导出携带必要的样式和字体。

## Technical Context

**Language/Version**: TypeScript/TSX、React 18、Node.js >=24.9、ES2023 浏览器构建。
**Primary Dependencies**: 现有 Marked 17、esbuild 与 DSH 原生侧栏。采用独立打包的 KaTeX，计划基准为官方 0.19.1，实施时核对锁定版本和样式资源。依据与替代方案见 [research.md](research.md)。
**Storage**: 沿用 UTF-8 Markdown 和现有 EditSession。公式视图、渲染错误、光标及局部草稿属于内存状态。沿用现有导出结构、写入权限、回执与版本冲突规则。
**Testing**: 现有工程构建与打包。按 [quickstart.md](quickstart.md) 人工验证 DSH、键盘、输入法、断网导出和时延。任何产品或浏览器自动验证遵循项目已有授权规则。
**Target Platform**: DSH v0.2.2-rc.3 原生桌面侧栏及 Chromium 桌面打开的独立阅读 HTML。
**Project Type**: 单仓库 DSH 插件，共享正文组件和独立 HTML 阅读器。
**Performance Goals**: 16 条公式首屏五次均 ≤1 s；单条预览停输五次均 ≤300 ms。限制输入和宏展开，避免重复同式渲染及修改正文时全篇重构。
**Constraints**: 只在正文范围识别。保留金额、代码、转义、有效编辑和外部版本保护。离线无需 CDN、网络字体、宿主服务或文件旁资源。公式来源按不可信数据处理。
**Scale/Scope**: 首期覆盖规格八类公式、四种定界符、一条公式的局部编辑，以及当前导出范围。保留可视编辑器、图片、链接、选文、复制及现有导图级撤销。

## Constitution Check

| 原则 | 设计核对 | 结论 |
| --- | --- | --- |
| I 内容与呈现分工 | 正文只写 LaTeX 源式，排版由插件完成。模型提示词只说明定界、适用条件和单位。 | 通过 |
| II 文件和稳定身份 | 无新持久化实体。渲染和阅读不落盘。公式编辑只改变对应 Markdown 内容，不动视图、结构或资源。 | 通过 |
| III 手动发送与修改保护 | 源式按既有离开、撤销、自动保存和版本保护处理。选文引用仍由用户决定插入与发送。 | 通过 |
| IV 官方契约与最小实现 | 基于本地官方宿主源码和上游官方文档。复用插件现有构建与编辑器，仅引入一个公式渲染依赖。 | 通过 |
| V 一致呈现与验证 | 阅读、编辑和离线共用分词与渲染规则。明确人工验证与构建证据的区别。 | 通过 |

设计后复核通过。需要后续实施验证的项目为宿主字体隔离、断网单文件加载、输入法和正文撤销、选文回跳及保存边界，均已列入验证指南。

## Project Structure

### Documentation (this feature)

    specs/003-latex-formula-preview/
      spec.md
      plan.md
      research.md
      data-model.md
      contracts/formula-preview.md
      quickstart.md

### Source Code (repository root)

    src/shared/
      note-markdown.ts            共享 Marked 实例、公式 token 和定界识别（新增）
      note-sections.ts            保留公式与章节标题 token
    src/client/
      note-math.ts                统一生成受限预览及源式回退（新增）
      render-note.tsx             阅读和离线复用公式呈现
      note-rich-text.ts           保留公式源码、原位投影与序列化
      components/NodeEditor.tsx  输入、粘贴、光标、编辑框与正文历史
      components/NoteInspector.tsx、AtlasPane.tsx、edit-session.ts
                                  局部草稿、离开保护、应对外部版本变化
      copy-note.ts、selection.ts、reference-navigation.ts
                                  原式投影、整篇复制和可逆选文定位
      index.tsx、offline.tsx、styles/atlas.css
                                  样式安装及侧栏滚动
    src/server/map-files.ts        图片/链接提取复用公式分词，不将 TeX 字面量视为路径
    scripts/build.mjs             编译本地公式 CSS 与字体进两套现有入口

**Structure Decision**: 继续使用单插件两种分发。共享分词在浏览器及服务端运行，公式排版只在客户端与离线阅读器运行。现有服务端写入流程接收普通 Markdown，无新 RPC。

## Implementation Sequence

1. 按[定界契约](contracts/formula-preview.md)实现共享分词。用已存在的 Markdown 规则保护代码、HTML、链接目标等内容，迁移正文阅读和资源提取调用；保留章节、图片和引用行为。
2. 实现单公式的安全渲染、源码回退与样式嵌入。先使阅读和离线同源，再接入编辑视图，便于隔离渲染和输入问题。
3. 接入有效文本原位投影、局部编辑草稿和手动应用。先记录语义内容更新，再更新显示。粘贴混合内容遵守定界规则；编辑器应保留输入法、光标方向、相邻图片和原式。
4. 实现共享剪贴板与选文投影。单个公式只有一份原式，从投影位置映射回 DOM 边界。核对旧引用回跳和可读回退。
5. 同步存储契约和 DSH 生成提示词，只在能力交付后宣称支持。构建候选并按约定交由用户执行实机与离线验收。若快捷键冲突、渲染依赖断网加载或数据保护未达标，记录对应失败并修正后再交付该能力。

## Complexity Tracking

无宪章豁免。编辑投影和局部历史是确保原位渲染不产生额外撤销步骤、且不误改源码所需。验收细节见 [quickstart.md](quickstart.md)。
