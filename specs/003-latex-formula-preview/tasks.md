---
description: "节点笔记公式预览实施任务"
---

# Tasks: 节点笔记 LaTeX 公式预览与编辑

**Input**: [计划](plan.md)、[规格](spec.md)、[调研](research.md)、[数据模型](data-model.md)、[契约](contracts/formula-preview.md)、[验收](quickstart.md)。

**Tests**: 本轮仅构建和静态核对。人工验收根据项目约定留待用户执行。

## Phase 1: Setup

- [X] T188 在 package.json 与 package-lock.json 锁定 KaTeX 0.19.1，核对宿主及发布包依赖边界。

## Phase 2: Foundational

- [X] T189 [P] 在 src/shared/note-markdown.ts 实现共享公式分词，保留 kind、delimiter、tex、raw，无子 token；保护金额、代码、转义及链接目标。
- [X] T190 [P] 在 src/client/note-math.ts 实现 ready/invalid 预览、固定错误文本、有界缓存及信任隔离。单条源式 4096 UTF-16 码元、宏展开 200 次、显式尺寸 20 em。
- [X] T191 [P] 在 scripts/build.mjs 处理已锁定字体、CSS 及上游许可，注入在线与离线入口。

## Phase 3: User Story 1 - 阅读公式 (P1)

**Goal**: 在笔记阅读中渲染公式，保持附近文本、资源与现有引用。
**Independent Test**: 16 条有效公式、8 组非公式与两条错误式，正常显示或按契约回退。

- [X] T192 [P] [US1] 在 src/shared/note-sections.ts、src/client/render-note.tsx、src/client/styles/atlas.css 接入公式、保留章节标题 token，支持窄栏和无障碍。
- [X] T193 [P] [US1] 在 src/server/map-files.ts 复用共享分词以保持资源扫描边界。
- [X] T194 [US1] 在 src/client/copy-note.ts、src/client/selection.ts、src/client/reference-navigation.ts 统一公式原式投影及选文、回跳。

## Phase 4: User Story 2 - 直接编辑公式 (P1)

**Goal**: 直接键入或粘贴，自动预览，局部编辑和既有自动保存。
**Independent Test**: 插入、取消、修改、删除、撤销重做，保存后重开核对源式和周围正文。

- [X] T195 [US2] 在 src/client/note-rich-text.ts 接入原式公式节点、序列化和局部投影，保留未修改内容。
- [X] T196 [US2] 在 src/client/components/NodeEditor.tsx 接入输入、混合粘贴、IME 和光标；内容历史有界，含修改前后 Markdown 及锚点，显示转换不增加一步。
- [X] T197 [US2] 在 src/client/components/NodeEditor.tsx 与 src/client/styles/atlas.css 实现指定出现位置的源式编辑、实时预览、取消及删除，应用前核对原式及编辑版本。
- [X] T198 [US2] 在 src/client/edit-session.ts、src/client/components/NoteInspector.tsx、src/client/AtlasPane.tsx 接入局部草稿与离开保护。未应用草稿独立于 autosave，宿主关闭仅会话保留，版本失配禁止应用。

## Phase 5: User Story 3 - 离线分享 (P1)

**Goal**: 导出单个可断网阅读和复制的文件。
**Independent Test**: 独立 HTML 复制到另一目录，断网验证显示、错误回退和原式复制。

- [X] T199 [US3] 在 src/client/offline.tsx、src/client/index.tsx、src/client/export-html.ts 与 scripts/build.mjs 复用阅读、样式和原式复制，保留单文件、自包含和无草稿契约。

## Phase 6: Polish

- [X] T200 更新 docs/mindmap-storage-format.md、docs/mindmap-authoring-prompts.md 的定界约定和模型输入边界。
- [X] T201 以 package.json 和 scripts/build.mjs 构建候选，并在 docs/validation/latex-formula-preview.md 记录实际构建与暂未验证的场景。
- [ ] T202 用户按 specs/003-latex-formula-preview/quickstart.md 完成并记录 DSH、输入法、性能与断网人工验收。

## Dependencies & Execution Order

T188 → T189/T190/T191 → US1 阅读基线 → US2 编辑及 US3 导出 → T200/T201 → T202。US2 与 US3 共用阅读基线，不依赖彼此。先交付 US1 阅读作为最小增量，随后接入编辑和离线，最终候选包含三者。

## Parallel Examples

- US1：T192 视图与 T193 服务端扫描可并行，T194 等阅读包装完成。
- US2：T195→T196→T197→T198 按顺序集成，避免同时编辑正文和草稿路径。
- US3：共享样式就绪后，T199 可与 T196/T197 独立进行，涉及同一个样式文件时串行。

2026-11-18 实施结果：T188～T201 已交付代码和本地包。T199 沿用现有 export-html.ts 的快照结构，公式资源随阅读器 IIFE 内嵌。T202 为人工验收，保持未完成。见 [交付记录](../../docs/validation/latex-formula-preview.md)。
