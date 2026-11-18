# 实施计划：节点笔记函数图像与统计图表

**分支** `main` · **Spec Kit 功能** `004-function-plot` · **日期** 2026-11-18 · [功能规格](spec.md)

## 概要

节点 Markdown 增加独立的版本化图块。KaTeX 排版函数式，JSXGraph 渲染函数曲线、柱状图和折线图。用户在 DSH 侧栏阅读、复制或右键引用已保存图块，明确指令经手动发送后由 AI 用现有 atlas 工具修改。独立 HTML 复用图块渲染，整页只供阅读。

## 技术背景

| 项目 | 选择 |
| --- | --- |
| 语言和构建 | TypeScript、React 18、Node.js ≥24.9、现有 esbuild 两套浏览端构建。 |
| 主要依赖 | Marked 17.0.1、KaTeX 0.19.1、Zod 4.6.6，实施时固定 JSXGraph 1.14.3。 |
| 存储 | 每节点原 Markdown 的顶层 `dsh-plot` JSON 围栏。保留 `map.json`、`layout.json`、笔记与资源边界。 |
| 目标环境 | DSH `v0.2.2-rc.3` 原生桌面侧栏，独立 HTML 在现代桌面浏览器断网打开。 |
| 大小与范围 | 同轴 1–3 条函数，每式 ≤256 字符；统计 1–3 系列，每系列 1–100 个值。只绘制当前详情内可见图块，按块限制解析和采样成本。 |
| 性能目标 | 在同一验收设备的 320 px 详情中两类代表图各开 5 次，每次从详情出现到可读 ≤1 秒。260 px 窄栏无横向撑宽。记录构建产物前后体积。 |
| 验证 | 沿用项目的检查与打包命令；真机引用、图像与离线表现按 [验收指南](quickstart.md) 手动验证。内部自动验证遵守项目授权约定。 |

## 宪章检查

| 原则 | 规划门槛 | 完成设计后复核 |
| --- | --- | --- |
| I 内容与界面分离 | AI 只生成 Markdown 中的图块数据，插件负责坐标、图例和界面。 | 图块契约只接收数据，受限求值和绘图均在插件内。通过。 |
| II 存储与稳定身份 | 图块在原笔记内，ID 与标题分离，保留无关文件和原布局。 | 新格式独立，老笔记无需迁移。异常块局部降级，读取无隐式写入。通过。 |
| III 发送与修改保护 | 引用只写本会话草稿，版本、权限与书写失败由现有工具链处理。 | 原生插入保护草稿选区；只读编辑防线、候选校验、删除影响与事务有明确落点。通过。 |
| IV 官方最小实现 | 依据 rc.3 官方类型及源码，用现有插入、回跳、审批和构建能力。 | JSXGraph 是用户已确认的单个绘图依赖。现有工具 schema 及引用 source 足以扩展，源码证据见调研。通过。 |
| V 一致呈现与可验证交付 | 延用侧栏外观，约定窄栏、退化和独立 HTML 验收。 | 快速验收可对照 SC-001 至 SC-004，实际结果均待实施后记录。通过。 |

## 项目结构

```text
specs/004-function-plot/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── plot-markdown.md
│   └── dsh-plot-reference.md
└── quickstart.md

src/
├── shared/              # Markdown 图块识别、数据校验与受限表达式
├── client/              # 图块 SVG、草稿引用、回跳及离线入口
│   └── components/      # 节点详情、手动编辑及阅读画布
└── server/
    ├── edit-service.ts  # 手动编辑的服务端图块保护
    ├── prompts/         # 内嵌 /mindmap 指导
    └── tools/           # AI 候选校验与删除影响
scripts/build.mjs        # 两个浏览端产物内嵌 JSXGraph
```

**结构决定**：共用纯数据解析留在 `src/shared/`，JSXGraph 只由浏览端图块组件使用。继续用现有侧栏和离线阅读组件，不另加持久化层、宿主聊天入口或平台依赖。

## 阶段 0：调研

核对了现有 Markdown、KaTeX、手动保存、atlas 工具、引用及离线导出入口；按官方源码确定 JSXGraph SVG API、许可证和 rc.3 的草稿与发送边界。[调研记录](research.md) 已收敛技术选择。运行兼容性与性能列入验收。

## 阶段 1：设计落实点

1. **解析与验证**。在 `src/shared/note-markdown.ts` 的现有 Marked 入口识别和保留图块源片段，共用校验、规范化与 ID 检查。函数式白名单 AST 供服务端验证和客户端求值；局部错误进入同一阅读退化路径。详见 [数据模型](data-model.md) 和 [图块契约](contracts/plot-markdown.md)。
2. **渲染与手动隔离**。由 `src/client/render-note.tsx`、`NoteInspector.tsx` 在正文中挂载只读 SVG 图块。用单独的绘图组件管理 JSXGraph 实例、容器尺寸和清理。手动编辑沿 `NodeEditor.tsx` 与 `note-rich-text.ts` 保留图块片段，UI 防止跨块变更，服务端 `edit-service.ts` 拒绝新增、删除或改写图块的手动候选。复制与选文投影只取可读文本，避开 SVG 内部节点。
3. **DSH 引用与变更**。扩展 `reference-source.ts`、`reference-navigation.ts` 及 `AtlasPane.tsx` 的引用流程。草稿图块 chip 可点击回跳，发送后的消息保留可读快照和来源 ID。AI 读当前笔记后通过 `set_note` 提供完整正文候选，`server/tools` 在创建或应用前验证图块并把实际删除加入既有审批。版本冲突继续使用文件指纹与事务保护。[引用与写入契约](contracts/dsh-plot-reference.md)
4. **离线只读**。继续使用 `export-html.ts` 与 `offline.tsx`，以内嵌资源渲染已保存内容。阅读器不给出布局写入能力或编辑回调，关断离线节点菜单、拖动、布局控件、编辑历史快捷键与宿主操作。画布平移、缩放和导航按阅读状态运行。
5. **`/mindmap`**。本轮已在 `src/server/prompts/authoring.ts` 增加旧图块重读和身份、内容核对的简短提示。实施图块能力时，将本契约已落地的格式示例、数据来源和删除路径写入同一提示词。这段提示与实际服务端版本校验配合使用。

实施后按 [快速验收](quickstart.md) 记录具体结果。当前处于设计交付。
