# 节点详情阅读与编辑样式统一任务

依据 [规范](spec.md)、[计划](plan.md)、[数据模型](data-model.md)、[详情契约](contracts/note-detail.md)、[定位契约](contracts/dsh-insertion-reference.md) 和 [人工指南](quickstart.md)。编号延续全项目序列。人工验收单独记录。

## Phase 1 准备

- [X] T218 核对现有依赖、构建入口和忽略规则，复用 `package.json`、`scripts/build.mjs`、`.gitignore`。

## Phase 2 共用基础

- [X] T219 [P] 在 `src/shared/note-markdown.ts`、`src/shared/note-position.ts` 实现原始 UTF-16 范围、SHA-256 摘要及安全源码定位。定位首版为 `version: 1`，限定地图和节点身份，支持 `block` 与 `start`。偏移使用安全的非负整数，块定位包含原范围、段内点击偏移和相邻摘要，空边界为 `null`。
- [X] T220 [P] 在 `src/shared/layout.ts` 固定已有分组矩形，保留补位、可视范围、显式重排及移动历史路径。

## Phase 3 用户故事 1 · 统一阅读和编辑（P1）

打开长笔记后往返读写，检查同一段落、完整图面、独立历史和 DSH 引用写入。

- [X] T221 [US1] 在 `src/client/components/NoteInspector.tsx`、`src/client/components/NodeEditor.tsx`、`src/client/note-rich-text.ts` 共用标题、摘要、原序正文和滚动容器，保留选文、安全链接、图片、公式编辑、保存及只读权限。
- [X] T222 [US1] 在 `src/client/note-rich-text.ts`、`src/client/components/NodeEditor.tsx`、`src/client/components/NotePlot.tsx` 共用完整图形和异常回退。图块是独立非编辑容器，图例与画布排除在正文序列化和公式编辑之外。
- [X] T223 [US1] 在 `src/shared/note-markdown.ts`、`src/client/components/NodeEditor.tsx`、`src/client/edit-session.ts` 用原始 Markdown 范围移动或删除有效唯一图块，支持正文首尾落点、取消、原文保留和既有撤销重做。
- [X] T224 [US1] 在 `src/server/edit-service.ts` 核对图块变化，允许有效整图移动、删除及同作用域已验证删除的原围栏恢复。沿用版本、事务和回执，拒绝新增、改定义、越界或无依据恢复。
- [X] T225 [US1] 在 `src/client/components/NodeEditor.tsx`、`src/client/AtlasPane.tsx`、`src/client/reference-source.ts`、`src/client/insert-reference.ts`、`src/client/reference-navigation.ts` 从右键点及已保存正文构建位置引用，折叠草稿选区，保留原会话、附件、原文快照和回跳。
- [X] T226 [US1] 在 `src/shared/note-position.ts`、`src/server/tools/schemas.ts`、`src/server/tools/candidate.ts`、`src/server/tools/index.ts` 接入单项 `insert_note_content`。仅接受 `inline_formula`、`display_formula` 或 `plot`，按照定位和最新版本拼接、重解析并保护已有笔记路径。

## Phase 4 用户故事 2 · 正文标题层级（P1）

同一篇笔记在读写两种状态均可区分三级标题，窄栏保持换行。

- [X] T227 [US2] 在 `src/client/styles/atlas.css`、`src/client/note-rich-text.ts` 统一正文样式，保留真实标题层级、列表与公式，区分标题颜色、字重、字号和留白。

## Phase 5 交付

- [X] T228 [P] 在 `src/server/prompts/authoring.ts`、`docs/mindmap-authoring-prompts.md`、`docs/mindmap-storage-format.md` 同步定位工具和图块手动编辑契约。
- [X] T229 在 `package.json`、`package-lock.json` 更新候选版本并通过 `scripts/build.mjs` 构建打包。
- [X] T230 在 `docs/validation/release-status.md`、`docs/validation/current-candidate.md` 和 `docs/validation/dsh-regression-prompt.md` 记录交付及从 0.3.12 起的 DSH 回归提示词。

## 依赖与交付顺序

T218 → T219、T220 → T221。T221 → T222 → T223 → T224，T219 和共享详情完成后可分别推进工具定位与客户端接入，涉及相同文件时顺序合并。US2 依赖 US1 的共用正文结构，标题验收可用只含普通 Markdown 的笔记独立执行。T228 依赖工具契约，T229 合并所有实现，T230 记录实际打包结果。

US1 可先以长笔记读写切换、两种图表和草稿位置引用完成首个闭环，US2 校验标题辨识度。分组修复可独立用两组地图验收。人工场景见 [快速验收](quickstart.md) 和 [画布验收](plan.md#画布背景修复与验收)。
