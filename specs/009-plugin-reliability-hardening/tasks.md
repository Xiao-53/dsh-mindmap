---

description: "插件架构隐患排查与健壮性加固任务清单"
---

# Tasks: 插件架构隐患排查与健壮性加固

**Input**: Design documents from `specs/009-plugin-reliability-hardening/`（[spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/hardening-contracts.md](contracts/hardening-contracts.md)、[quickstart.md](quickstart.md)）

**编号**: 沿用仓库全局唯一任务编号，从 `T267` 开始。标有 `[P]` 的任务可在前置依赖完成后并行，`[US1]`–`[US5]` 对应 `spec.md` 中的 5 个用户故事。

**验证**: 按 `AGENTS.md` 约定，实现完成后执行静态类型检查与构建（`npm run typecheck`、`npm run build`）；自动化测试运行及 DSH Desktop 真机交互验收由用户按 [quickstart.md](quickstart.md) 决定或另行要求。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（涉及不同文件且无未完成前置依赖）
- **[Story]**: 所属用户故事标签（`[US1]`–`[US5]`；Setup、Foundational 与 Polish 阶段不带故事标签）
- 每条任务均包含明确的文件路径与 `data-model.md` / `contracts/hardening-contracts.md` 中的精确约束

---

## Phase 1: Setup（清单边界与构建脚本加固）

**Purpose**: 对齐宿主共享依赖与客户端注入声明，加固构建与发包脚本的文本匹配校验。

- [X] T267 更新 `package.json` 依赖与客户端注入契约：将 `zod` 从 `dependencies`（原精确 `"4.6.6"`）移至 `peerDependencies`（`"^4.0.0"`）并保留在 `devDependencies`（`"4.6.6"`）；在 `dsh.client.inject` 中补齐直接消费的 `@deepseek-ai/dsh-api-session-controller`、`@deepseek-ai/dsh-client-store` 与 `@deepseek-ai/dsh-client-ui-slots`（共 10 项客户端宿主包）。
- [X] T268 [P] 加固 `scripts/build.mjs` 与 `scripts/pack-release.mjs` 构建期匹配校验：在 `scripts/build.mjs` 中为 `jsxgraph` 全局赋值剥离与 `katex.min.css` 字体规则提取增加兼容空白变化的稳健匹配与明确错误诊断；在 `scripts/pack-release.mjs` 中支持 `cordis.yml` 包名带引号或不带引号的稳健替换校验。

---

## Phase 2: Foundational（共享数据模型与跨平台路径规范化基座）

**Purpose**: 提供所有用户故事共用的 `library.json` 扩展 Schema、`MapListing` 容量类型及跨平台路径规范化纯函数。

**⚠️ CRITICAL**: 所有用户故事阶段依赖本阶段完成。

- [X] T269 [P] 在 `src/shared/library.ts` 扩展 `librarySchema`（保持 `schemaVersion: z.literal(1)` 向后兼容）：新增可选字段 `retiredCreateIds: z.array(idSchema).optional()`，并在 `superRefine` 中校验 `retiredCreateIds` 内部每个元素符合 `idSchema` 且无重复 ID。
- [X] T270 [P] 在 `src/shared/map-types.ts` 新增 `DirectoryCapacity` 接口（含 `directoryCount: number`、`retiredCount: number`、`warningThreshold: number`，默认预警阈值 `500`），并在 `MapListing` 接口新增可选字段 `capacity?: DirectoryCapacity`。
- [X] T271 [P] 新建 `src/shared/workspace-path.ts` 实现跨平台路径与笔记路径规范化纯函数：
  - `workspaceComparisonKey(raw: string): string`：识别 Windows 盘符路径（`/^[A-Za-z]:[/\\]/`）与 UNC 路径（`/^\\\\/`），统一分隔符为 `/`、去除末尾多余 `/`（保留根 `c:/`）并转为小写；对 POSIX 路径折叠重复 `/`、去除末尾 `/`（保留 `/`）并保持大小写敏感。
  - `sameWorkspaceKey(a: string | undefined, b: string | undefined): boolean`：基于 `workspaceComparisonKey` 比较两个工作区键是否指向同一工作区。
  - `normalizeNotePathKey(path: string): string`：将导图内 `notePath` 规范化为正斜杠相对路径并转小写（`toLowerCase()`），供读写两端统一防重。

**Checkpoint**: 共享 Schema、容量类型与跨平台路径规范化纯函数就绪。

---

## Phase 3: User Story 1 - 宿主升级与运行边界兼容隔离 (Priority: P1) 🎯 MVP

**Goal**: 消除因依赖冲突、未声明客户端注入、未公开内部事件耦合、启动异常未隔离、工具 Schema 转换脆弱或实时事件流结构微调引发的宿主崩溃与界面白屏风险。

**Independent Test**: 模拟宿主非核心服务缺失、同名 `mindmap` skill 冲突、远端挂载延迟或会话事件流含未知字段的场景，验证插件服务端与客户端启动零未捕获异常，6 个 `atlas_*` 工具 Schema 全部通过 `@deepseek-ai/dsh-tools` `defineTool` 校验，且已彻底移除 `'slash/input-insert-text'` 内部事件耦合。

### Implementation for User Story 1

- [X] T272 [P] [US1] 改造 `src/index.ts` 与 `src/server/prompts/register.ts` 实现服务端启动隔离：在 `src/index.ts` 中将 `ctx.inject(['tools', 'skills', 'approval'], ...)` 拆分为独立的 `ctx.inject(['tools', 'approval'], api => ...)` 与 `ctx.inject(['skills'], api => ...)`，并用 `try/catch` 隔离注册异常、通过 `ctx.logger?.warn` 输出诊断；在 `src/server/prompts/register.ts` 中对 `ctx.skills.register({ name: 'mindmap', ... })` 增加异常捕获与同名冲突诊断日志。
- [X] T273 [P] [US1] 加固 `src/server/tools/index.ts` 中的 `parameters(schema)` JSON Schema 转换器：支持展开 `$defs` / `$ref`（含防环保护）、将 `anyOf` / `oneOf` 统一映射为 `{ oneOf: [...] }`、将 `type` 数组（如 `['string', 'null']`）转换为 `{ oneOf: type.map(t => ({ type: t })) }`、透传 `description`/`enum`/`const`/`items`，并将对象 `additionalProperties` 规范化为严格布尔值，确保全部 6 个工具定义通过 `@deepseek-ai/dsh-tools` 编译校验。
- [X] T274 [P] [US1] 清理 `src/client/register-sidebar.tsx` 与 `src/client/AtlasPane.tsx` 中的未公开内部事件死代码（FR-003）：从 `src/client/register-sidebar.tsx` 移除 `insertText` 注入属性及其 `binding.ctx.bail('slash/input-insert-text', ...)` 调用，并在 `AtlasNavigation` 接口新增可选字段 `autoOpen?: boolean`；从 `src/client/AtlasPane.tsx` 的 `AtlasPaneProps` 移除未使用的 `insertText?: (text: string, span: TokenSpan) => boolean`；同时在 `src/client/AtlasPane.tsx` 中将 `fileAddressFor` 调用收口至带异常兜底的本地辅助函数。
- [X] T275 [P] [US1] 加固 `src/client/index.tsx` 与 `src/client/open-completed-map.ts` 的客户端启动及事件流防御：在 `src/client/index.tsx` 的 `apply(ctx)` 中以 `try/catch` 保护 `await ctx.remote.$mount(atlasRemote)` 及 `registerClient` 回调；在 `src/client/open-completed-map.ts` 中对 `ctx.sessions`、`binding?.eventSource`、`window?.change`、`entry?.event` 及 `Array.isArray(message?.content)` 增加运行时判空守卫与外层 `try/catch` 警告日志。

**Checkpoint**: User Story 1（宿主兼容边界、启动隔离、工具 Schema 转换加固与死代码清理）已可独立运行与验证。

---

## Phase 4: User Story 2 - 事务删除、目录容量与资源生命周期闭环 (Priority: P1)

**Goal**: 解决批量永久删除的并发索引冲突死锁，改用 `ctx.fs.listDir` 解除 2000 目录列举截断限制，提供已完结空壳目录的防复活压实与容量预警，实现保护编辑撤销栈的孤儿图片延迟安全回收，并将本地附件收敛为仅支持图片。

**Independent Test**: 连续执行创建失败清理、图片上传后删除并撤销/退出会话、以及带并发 `library.json` 写入干扰的批量永久删除，验证回收站与索引 100% 收敛无死锁、超过 2000 项时目录仍可正常列出、孤儿 `.image.json` 在编辑期保留供撤销且在会话脱离或手动清理时安全删除、本地 PDF/TXT 链接仅展示只读提示且不内联读取文件字节。

### Implementation for User Story 2

- [X] T276 [US2] 改造 `src/server/map-files.ts` 的目录列举、错误码识别、容量统计与本地图片资源过滤（依赖 T269、T270）：
  - 收口 `isNotFoundError(e)` 统一识别 `'workspace-file/not-found'`、`'FS_NOT_FOUND'` 与 `'ENOENT'`。
  - `createHostFiles().list()` 与 `listEntries()` 优先调用官方 `ctx.fs.listDir(target, signal)`（当测试桩未提供 `listDir` 时回退 `ctx.workspaceFiles.list`），解除 2000 条截断锁死。
  - 在 `readSnapshot` 中移除 `pdf` 与 `txt` MIME 映射；仅对 `token.type === 'image'` 及 `noteImageToken(token)` 收集本地图片资源（支持 `png/jpg/jpeg/gif/webp` 与 `.image.json`），跳过普通 Markdown 非图片本地链接且不抛错阻塞导图读取。
  - 在 `listMapHeaders` 与 `listMaps` 中接收已压实 ID 集合（`purgedMapIds` 与 `retiredCreateIds`）：对位于该集合中且无 `map.json`、无 `active.json`、无未知文件的空壳目录静默忽略（不记入 `diagnostics`），并计算返回 `capacity: { directoryCount, retiredCount, warningThreshold: 500 }`。
- [X] T277 [US2] 在 `src/server/map-service.ts`、`src/server/purge-map.ts` 与 `src/server/tools/index.ts` 实现 `purge` 并发收敛、`compactRetired` 与 `cleanupOrphanAssets`（依赖 T269、T271、T276）：
  - 在 `src/server/map-service.ts` 将所有 `library.json` 写操作（`saveLibrary`、`purge`、`create`、`compactRetired`）纳入 `${workspaceComparisonKey(workspaceRoot)}\0__library__` 串行队列。
  - 改造 `purge`：允许对已在 `purgingMapIds` 中的条目重试；单图 `purgeMap` 完成后，通过重读最新 `library.json` + 合并 `deletedIds` 至 `purgedMapIds` + 最多 5 次 CAS 重试写回，清理 `deletedMapIds`/`purgingMapIds`/`deletedMapTitles`/`mapFolders` 及排序序列，避免并发写导致死锁。
  - 新增 `compactRetired` RPC 操作（支持可选 `keepRecent: number` 默认 `0`）：校验非只读与工作区一致，筛选 `state === 'discarded'` 或 `purge.json` `state === 'completed'`（且无 `map.json`/`active.json`/未知文件）的目录，**先**通过 CAS 将 ID 写入 `library.json` 的 `retiredCreateIds` / `purgedMapIds`，**后**调用 `ctx.fs.deleteFile` 条件删除 `discarded-create.json` / `purge.json`；在 `src/server/tools/index.ts` 的 `atlas_create` 中同时检查 `libraryState.retiredCreateIds?.includes(mapId)` 并返回 `create_discarded` 防止旧 `operationId` 复活。
  - 新增 `cleanupOrphanAssets` RPC 操作：在单图串行队列内校验非只读、`expectedWorkspaceKey` 与 `snapshot.fingerprint === expectedFingerprint`，扫描 `assets/` 下符合 `/^[A-Za-z0-9_-]{1,128}\.image\.json$/` 且通过 `validateImage` 的普通文件，重新词法解析全图所有节点 Markdown 确认零引用后，调用 `ctx.fs.deleteFile(target, { version }, signal, policy)` 条件删除孤儿图片并返回 `{ deletedAssetIds, skipped }`。
- [X] T278 [P] [US2] 改造 `src/client/render-note.tsx` 的链接渲染（依赖 T276）：在 `case 'link'` 中仅允许 `safeHref(link.href)`（`http://`、`https://`、`mailto:`、`#`），不再回退读取 `resources` 中的 `data:` 链接；对本地非图片链接渲染只读提示 `<span key={key}>{inner}（仅支持网络链接与本地图片）</span>`。
- [X] T279 [US2] 在 `src/client/host-adapter.ts`、`src/client/edit-session.ts`、`src/client/AtlasPane.tsx` 与 `src/client/components/MapLibrary.tsx` 接入孤儿图片延迟回收与历史目录压实入口（依赖 T277）：
  - 在 `src/client/host-adapter.ts` 的 `HostAdapter` 新增 `cleanupOrphanAssets` 与 `compactRetired` 方法。
  - 在 `src/client/edit-session.ts` 中记录本会话已保存提交中曾移除引用的图片资产标记；在编辑会话存活期间保留磁盘图片以支持 `Ctrl+Z` / `Cmd+Z` 撤销恢复；当 `detach()` 完成且处于 `!this.dirty && !this.uncertain && this.status === 'clean'` 时，后台尽力调用 `host.cleanupOrphanAssets(mapId, baseline.fingerprint, baseline.workspaceKey)`。
  - 在 `src/client/components/MapLibrary.tsx` 与 `src/client/AtlasPane.tsx` 中：当 `listing.capacity.directoryCount >= listing.capacity.warningThreshold`（500）或在回收站「未完成创建」页签且 `retiredCount > 0` 时，展示容量预警与「清理已完结历史记录」按钮（调用 `host.compactRetired` 后刷新列表）；在阅读页提供手动触发当前导图孤儿图片清理的操作入口。

**Checkpoint**: User Story 2（`purge` 并发自愈、`listDir` 无截断列举、空壳标记压实、孤儿图片延迟安全回收与非图片链接只读提示）已可独立运行与验证。

---

## Phase 5: User Story 3 - 文件监听缩放、大导图载荷与内存边界控制 (Priority: P2)

**Goal**: 将导图库与单图文件观察流收敛至受控小常数并消除首帧重复刷新，消除 `readSnapshot` 对大图的二次全量字节读取与自动保存重复传图，增加 20 MiB 资源总载荷保护，并为前后端所有模块级缓存设置明确淘汰与上限。

**Independent Test**: 在含 50 张导图的工作区与含 50 节点 + 20 附件的单图中验证并发观察流分别不超过 3 条与 5 条且无首帧二次刷新；验证上传图片后继续编辑文字不会重复上传已保存图片；连续切换并关闭 20 个会话后验证干净会话、布局草稿、预览令牌与路径缓存均按上限/生命周期回收。

### Implementation for User Story 3

- [X] T280 [P] [US3] 改造 `src/server/watch-map.ts` 与 `src/client/host-adapter.ts` 收敛文件观察流并消除冗余刷新：
  - 在 `src/server/watch-map.ts` 将 `watchPaths(snapshot)` 改为仅返回去重后的目录路径（`dsh-knowledge-maps/<mapId>`、`dsh-knowledge-maps/<mapId>/.transactions` 及 `snapshot.files` 各文件去重后的父目录链，最多 `16` 个目录），不再为单个文件建立观察流。
  - 在 `src/client/host-adapter.ts` 将 `watchLibrary` 收敛为固定观察 `['.', 'dsh-knowledge-maps', 'dsh-knowledge-maps/library.json']`（≤ 3 条流），仅在 `frame.kind === 'change'` 时触发防抖刷新（消除首次 `ready` 触发的冗余二次 `list`）；在单图 `watch` 中对可选的 `.transactions` 目录观察不可用或结束时静默容忍，不误报整体 `watchError`。
- [X] T281 [P] [US3] 在 `src/server/map-files.ts` 实现轻量资产二次校验与 20 MiB 资源总载荷上限保护（依赖 T276）：
  - 在 `MapFilePort` 新增可选方法 `verify?(path: string, mapId: string, assetsOnly?: boolean): Promise<{ version: string; identity: string }>`，`createHostFiles` 通过 `ctx.workspaceFiles.stat` + `boundary` 实现它；`readSnapshot` 末尾复读校验阶段对 `assets/*` 优先调用 `port.verify` 比对 `version` 与 `identity`（省去整图二次字节读取与二次 SHA-256），未实现 `verify` 的测试桩回退 `port.read`。
  - 在 `readSnapshot` 中累计已编码 `resources` 总字节数，设定上限 `20 * 1024 * 1024`（20 MiB）：超出时若 `allowResourceErrors === false` 抛出 `AtlasError('resource_too_large', ...)`；若 `allowResourceErrors === true` 将超出项记入 `diagnostics` 并设 `writable: false`、`fingerprint: ''` 安全只读降级。
- [X] T282 [US3] 在 `src/client/edit-session.ts`、`src/client/AtlasPane.tsx`、`src/client/open-completed-map.ts`、`src/server/edit-service.ts` 与 `src/server/tools/index.ts` 实现已保存图片池清理与内存缓存有界淘汰（依赖 T275、T279）：
  - 在 `src/client/edit-session.ts` 的 `acceptReceipt(snapshot)` 中，从 `this.pool` 移除已存在于 `snapshot.files`（`assets/<id>.image.json`）的图片资产，防止后续文字自动保存重复上传历史图片。
  - 在 `src/client/edit-session.ts` 中：当 `closeEditSessions(sessionId)` 或 `detach()` 的异步保存完成后，若 `!s.dirty && !s.uncertain` 则调用 `s.dispose()` 并从 `sessions` Map 删除；新增 `dropEditSession(workspaceKey, mapId)` 并在已脱离干净会话超过 `16` 条时按顺序淘汰最旧项。
  - 在 `src/client/AtlasPane.tsx` 中：会话关闭或导图永久删除时同步清理 `retainedLayouts` 对应条目，并限制 `retainedLayouts` 最多 `32` 条（超出按 FIFO 淘汰）。
  - 在 `src/client/open-completed-map.ts` 中限制未结算 `calls` Map 最多 `256` 条（超出按 FIFO 淘汰），并在观测到 `atlas_create`/`atlas_apply`/`atlas_cleanup_create` 成功时触发客户端本地目录刷新监听回调。
  - 在 `src/server/edit-service.ts` 中限制 `notePaths` Map 最多 `128` 条（LRU 淘汰），并导出 `evictEditMemory(workspaceKey, mapId)` 在 `purge` 与 `cleanupCreate` 时主动清理。
  - 在 `src/server/tools/index.ts` 中为 `previews` Map 增加 `createdAt` 时间戳：每次写入前清理超过 `15` 分钟（`15 * 60 * 1000` ms）的过期令牌、限制最多 `128` 条（FIFO 淘汰），并在 `atlas_apply` 成功提交后立即删除已消费的 `previewToken`。

**Checkpoint**: User Story 3（观察流常数收敛、大图轻量复核与 20 MiB 保护、图片池去重及全链路内存缓存淘汰）已可独立运行与验证。

---

## Phase 6: User Story 4 - 会话交互保护与跨平台快捷键一致 (Priority: P2)

**Goal**: 保证用户在编辑正文、拖动布局或核对引用定位期间不被后台 AI 完成跳图强行打断或清空引用，所有主动外部跳转统一受未保存保护，且 macOS 与 Windows 画布快捷键体验一致。

**Independent Test**: 在编辑节点或拖动节点期间触发后台 `atlas_create`/`atlas_apply` 完成事件，验证画面不强切、草稿与引用定位保留且出现带「查看更新」按钮的轻量提示；在 macOS 修饰键（`metaKey`）下按 `Cmd+Z` / `Cmd+Y` / `Cmd+Shift+Z` 验证画布撤销与重做生效。

### Implementation for User Story 4

- [X] T283 [US4] 改造 `src/client/open-completed-map.ts` 与 `src/client/AtlasPane.tsx` 实现 `autoOpen` 防打断协调、统一外部导航 `guard()` 与 macOS 快捷键支持（依赖 T274、T282）：
  - 在 `src/client/open-completed-map.ts` 调用 `ctx.sidebarRight.openTab(ATLAS_KIND, { params: { mapId, autoOpen: true } })` 标记后台自动打开。
  - 在 `src/client/AtlasPane.tsx` 中：当 `tab.navigation.revision` 收到 `params?.autoOpen === true` 时，若当前处于正文编辑中、节点拖拽中（`nodeDragging` 或存在 `draftRef.current`）、`editor.current?.dirty` 或正在核对引用（`reference !== undefined`），则**不切换页面、不清除 `reference`**，改为显示带手动「查看更新」动作的非阻塞提示；若空闲且已在同一 `mapId` 则仅触发温和快照刷新；当收到用户主动点击的外部引用跳转（`params?.reference`）或点击「查看更新」时，统一通过 `guard(...)` 未保存保护流程执行切换。
  - 在 `src/client/AtlasPane.tsx` 的 `onKeyDown` 中将画布撤销/重做条件扩展为 `(e.ctrlKey || e.metaKey) && !e.altKey`：支持 `Z`（无 `shiftKey`）撤销、`Y`（无 `shiftKey`）或 `Shift+Z` 重做，保持对输入框、`contenteditable` 与对话框的排除。

**Checkpoint**: User Story 4（后台自动跳图防打断、外部导航统一未保存保护与 macOS/Windows 画布撤销重做快捷键）已可独立运行与验证。

---

## Phase 7: User Story 5 - 路径规范化与工具异常语义对齐 (Priority: P3)

**Goal**: 在 Windows 等大小写不敏感平台下消除工作区路径盘符大小写及末尾斜杠差异引起的误报与锁键分裂，统一读写两端 `notePath` 大小写防重，并使服务端工具在失败时向宿主正确报告 `isError: true` 同时保留结构化 JSON 诊断。

**Independent Test**: 在 Windows 风格路径下交替使用 `C:\Work\Repo\` 与 `c:/work/repo` 调用读写、清理与引用定位，验证识别为同一工作区且共享同一 `serializeMap` 串行队列；调用 `atlas_apply` / `atlas_create` 触发校验失败或版本冲突，验证通过 `@deepseek-ai/dsh-tools` 执行时结果 `isError === true` 且 `content[0].text` 含有完整 `{ status, message, diagnostics }` JSON。

### Implementation for User Story 5

- [X] T284 [P] [US5] 在服务端与客户端全面接入 `src/shared/workspace-path.ts` 路径规范化（依赖 T271、T277、T282、T283）：
  - 在 `src/server/map-service.ts`、`src/server/cleanup-create.ts`、`src/client/AtlasPane.tsx` 与 `src/client/reference-navigation.ts` 中使用 `sameWorkspaceKey` 替代工作区路径的直接 `===` / `!==` 比较。
  - 在 `src/server/map-service.ts`、`src/server/tools/index.ts`、`src/server/edit-service.ts` 与 `src/client/edit-session.ts` 中使用 `workspaceComparisonKey(workspaceRoot)` 构造 `serializeMap` 串行锁键、`noteKey` 与编辑会话缓存键。
  - 在 `src/server/edit-service.ts`、`src/server/tools/index.ts` 与 `src/shared/validate-map.ts` 中统一使用 `normalizeNotePathKey` 进行 `notePath` 大小写不敏感占用与去重检查。
- [X] T285 [P] [US5] 改造 `src/server/tools/index.ts` 工具失败返回机制以对齐 `@deepseek-ai/dsh-tools` 的 `isError: true` 语义（依赖 T273、T277）：
  - 定义并导出 `AtlasToolError extends Error`，携带 `status: string`、`code: string`、`diagnostics: Diagnostic[]`，且 `error.message` 设为 `JSON.stringify({ status, message, diagnostics })`。
  - 在 `registerTools` 的 `execute` `catch(e)` 分支中抛出 `new AtlasToolError(errorCode(e), String(e), e instanceof AtlasError ? e.diagnostics : [])`，使 `@deepseek-ai/dsh-tools` 流水线记录 `isError: true` 并在错误文本中完整保留结构化 JSON 诊断。

**Checkpoint**: 全部 5 个用户故事（P1–P3 共 14 条功能需求）均已实现完毕。

---

## Phase 8: Polish & Cross-Cutting Concerns（文档同步、测试覆盖与构建交付）

**Purpose**: 同步存储契约文档、补齐单元与集成测试并完成静态类型检查与构建打包验证。

- [X] T286 [P] 更新 `docs/mindmap-storage-format.md`：补充 `library.json` 可选字段 `retiredCreateIds` 与历史空壳目录延迟压实规则、说明本地资源仅支持图片格式（不再内联读取 PDF/TXT 附件）以及当前 DSH `ctx.fs` 无目录删除 API 的沙箱边界说明。
- [X] T287 [P] 新建 `tests/shared/workspace-path.test.ts`，并更新 `tests/integration/host-contract.test.ts`、`tests/integration/client-contract.test.ts` 与 `tests/integration/atlas-tools-internal.test.ts`：覆盖 Windows/POSIX 路径规范化、`package.json` 依赖与 `dsh.client.inject` 契约、客户端移除 `insertText` 后的启动与畸形事件流隔离、6 个工具 `defineTool` Schema 校验、`AtlasToolError` 在真实 `dsh-tools` 流水线下的 `isError: true` 行为、`previews` 过期淘汰与 `retiredCreateIds` 防复活。
- [X] T288 [P] 更新 `tests/integration/local-files.test.ts`、`tests/integration/map-files.test.ts`、`tests/integration/refresh.test.ts` 与 `tests/integration/dom.test.ts`：覆盖 `purge` 并发 CAS 收敛、`ctx.fs.listDir` 超 2000 项无截断列举、`compactRetired` 先写索引后删标记、`cleanupOrphanAssets` 延迟回收与编辑期撤销保留、非图片本地链接只读提示、`readSnapshot` 轻量 `verify` 与 20 MiB 载荷降级、观察流常数收敛（无首帧二次刷新）、`autoOpen` 防打断提示及 macOS `Meta+Z`/`Meta+Shift+Z` 快捷键。
- [X] T289 运行 `npm run typecheck`、`npm run build` 与 `npm run pack:plugin -- --dry-run` 验证类型检查、构建产物与发布包均无错误；核查 `git status -s` 确认无多余未预期修改，并按 `AGENTS.md` 约定交付构建结果与 [quickstart.md](quickstart.md) 人工验收清单。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup: T267–T268)**: 无前置依赖，可立即开始（T267 与 T268 可并行）。
- **Phase 2 (Foundational: T269–T271)**: 无代码冲突，T269、T270、T271 三个不同文件可完全并行；完成后解锁所有用户故事阶段。
- **Phase 3 (US1: T272–T275, P1 🎯 MVP)**: 依赖 Phase 1–2；T272、T273、T274、T275 涉及不同文件，可并行执行。
- **Phase 4 (US2: T276–T279, P1)**: 依赖 Phase 2；`T276 → T277 → T279` 依次推进，`T278` 可在 `T276` 后与 `T277` 并行。
- **Phase 5 (US3: T280–T282, P2)**: 依赖 Phase 2；`T280` 与 `T281`（在 `T276` 后）可并行，`T282` 在 `T275`、`T279` 后收口各模块缓存与图片池清理。
- **Phase 6 (US4: T283, P2)**: 依赖 `T274` 与 `T282`。
- **Phase 7 (US5: T284–T285, P3)**: 依赖 `T271`、`T273`、`T277`；`T284` 与 `T285` 可并行。
- **Phase 8 (Polish: T286–T289)**: `T286`、`T287`、`T288` 可并行，最后执行 `T289`。

### User Story Dependency Graph

```text
Phase 1 (T267, T268) + Phase 2 (T269, T270, T271)
  ├──► Phase 3: US1 宿主升级与运行边界兼容隔离 (T272, T273, T274, T275) [MVP]
  ├──► Phase 4: US2 事务删除、目录容量与资源生命周期闭环 (T276 → T277, T278, T279)
  ├──► Phase 5: US3 监听缩放、大导图载荷与内存边界控制 (T280, T281, T282)
  │      └──► Phase 6: US4 会话交互保护与跨平台快捷键一致 (T283)
  └──► Phase 7: US5 路径规范化与工具异常语义对齐 (T284, T285)
         └──► Phase 8: Polish 文档、测试与构建核验 (T286, T287, T288 → T289)
```

### Parallel Execution Examples

- **Foundational 并行**:
  - `T269` (`src/shared/library.ts`) // `T270` (`src/shared/map-types.ts`) // `T271` (`src/shared/workspace-path.ts`)
- **User Story 1 并行**:
  - `T272` (`src/index.ts`, `src/server/prompts/register.ts`) // `T273` (`src/server/tools/index.ts`) // `T274` (`src/client/register-sidebar.tsx`, `src/client/AtlasPane.tsx`) // `T275` (`src/client/index.tsx`, `src/client/open-completed-map.ts`)
- **User Story 2 & 3 并行**:
  - `T278` (`src/client/render-note.tsx`) // `T280` (`src/server/watch-map.ts`, `src/client/host-adapter.ts`) // `T281` (`src/server/map-files.ts`，在 `T276` 完成后)
- **Polish 阶段并行**:
  - `T286` (`docs/mindmap-storage-format.md`) // `T287` (契约与工具测试) // `T288` (文件、监听与 DOM 测试)

---

## Implementation Strategy

### MVP First (User Story 1 + User Story 2 — P1 高危隐患清零)

1. 完成 **Phase 1 (Setup)** 与 **Phase 2 (Foundational)**（`T267`–`T271`）。
2. 完成 **Phase 3 (US1)**（`T272`–`T275`）：优先解决宿主共享依赖冲突、客户端注入遗漏、死代码内部事件耦合与启动异常隔离，作为最小可独立验证的 MVP 增量。
3. 完成 **Phase 4 (US2)**（`T276`–`T279`）：彻底解决 `purge` 并发死锁、2000 目录截断限制、孤儿图片滞留与非图片本地链接拦截。

### Incremental Delivery (P2 → P3 → Polish)

4. 推进 **Phase 5 (US3)**（`T280`–`T282`）与 **Phase 6 (US4)**（`T283`），完成监听流收敛、图片重复上传修复、内存缓存上限及防打断跳转/macOS 快捷键。
5. 推进 **Phase 7 (US5)**（`T284`–`T285`），完成跨平台工作区路径规范化接入与 `dsh-tools` `isError: true` 状态对齐。
6. 完成 **Phase 8 (Polish)**（`T286`–`T289`），更新存储文档与回归测试，执行 `npm run typecheck` 与 `npm run build` 后交付真机验收。
