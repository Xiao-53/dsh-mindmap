# Phase 0 技术调研与决策记录：插件架构隐患排查与健壮性加固

**Feature**: `009-plugin-reliability-hardening` | **Date**: 2026-11-19  
**Sources Verified**: 本仓库源码 (`src/`, `scripts/`, `package.json`) 与本地已安装的 DSH 官方契约包 (`node_modules/@deepseek-ai/*`, `0.2.2-rc.3`)。

---

## Decision 1: `zod` 共享依赖与客户端 `dsh.client` 声明对齐（FR-001）

- **Decision**:
  1. 将 `package.json` 中的 `zod` 从 `dependencies`（精确 `"4.6.6"`）移至 `peerDependencies`（`"^4.0.0"`）与 `devDependencies`（`"4.6.6"`），使 Host 与 Client 统一复用宿主环境的 `zod` 实例。
  2. 补齐 `package.json` 的 `dsh.client.inject`，显式加入直接消费的 `@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-api-session-controller` 与 `@deepseek-ai/dsh-client-store`。
  3. 保持 `scripts/build.mjs` 对客户端 `['react', 'react/jsx-runtime', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', 'zod']` 的 `external` 列表（经验证与 DSH Web 客户端内置基线一致，且 `ctx.remote.$mount(atlasRemote)` 需要与宿主兼容的 `zod`），并将 `AtlasPane.tsx` 对 `@deepseek-ai/dsh-util-workspace-path` 的单一 `fileAddressFor` 调用收口到独立薄适配器，便于未来协议变更集中调整。
  4. 为 `scripts/build.mjs` 中针对 `jsxgraph` / `katex` 的构建期转换与 `scripts/pack-release.mjs` 中的 `cordis.yml` 包名替换增加清晰断言与更稳健的匹配逻辑，减少三方小版本升级误断构建的概率。
- **Rationale**:
  - 核查 `node_modules/@deepseek-ai/dsh-typert-protocol/package.json` 与 `dsh-api-workspace-files/package.json` 证实宿主内部直接依赖 `zod`，且 `src/shared/rpc.ts` 将 `z` 传入 `createTypertRemoteInfo(..., z)`。若本插件在 `dependencies` 中写死 `"zod": "4.6.6"`，DSH 升级 `zod` 补丁/次版本后会在用户 profile 下拉起重复 `zod` 副本，埋下与 `0.4.3` 修复前同源的冲突风险。
  - `node_modules/@deepseek-ai/dsh-package-manifest/src/types.ts` 明确 `dsh.client.inject` 用于声明客户端包依赖；当前依赖缺失导致启动顺序隐式仰赖其他宿主包的传递注入。
- **Alternatives Considered**:
  - *在 `dependencies` 中把 `zod` 放宽为 `"^4.6.0"`*: 仍可能在宿主使用不同锁定策略或跨次版本时由 npm 嵌套安装第二份 `zod`，不如 `peerDependencies` 彻底共享宿主实例（且 `0.4.3` 已验证 DSH Desktop 能正确提供 `peerDependencies` 中的宿主依赖）。
  - *把 `zod` 打入 `client.js`*: 会增加约 60KB 体积并可能使 `atlasRemote` 传入 `ctx.remote.$mount` 时与宿主网关持有的 `zod` 实例不一致。

---

## Decision 2: 宿主/客户端初始化隔离、事件防御与死代码清理（FR-002, FR-003）

- **Decision**:
  1. **清理死代码与内部事件耦合（FR-003）**：移除 `src/client/register-sidebar.tsx` 与 `AtlasPaneProps` 中完全未使用的 `insertText` 及其对内部事件 `'slash/input-insert-text'` 的 `bail` 调用（经全仓检索，业务代码零调用），并同步更新 `tests/integration/client-contract.test.ts`。
  2. **客户端启动隔离（FR-002）**：在 `src/client/index.tsx` 中用受控 `try/catch` 包裹 `ctx.remote.$mount(atlasRemote)` 与 `registerClient`，当远端命名空间未就绪或挂载失败时记录警告而不向外抛未捕获异常阻断宿主启动。
  3. **事件流防御性解析（FR-002）**：在 `src/client/open-completed-map.ts` 中对 `binding.eventSource`、`window.change`、`entry.event`、`message.content` 等全部做运行时类型守卫与外层 `try/catch` 隔离，宿主微调事件字段时安全跳过并告警。
  4. **服务端服务拆分与工具模式转换加固（FR-002）**：
     - 将 `src/index.ts` 的 `ctx.inject(['tools', 'skills', 'approval'], ...)` 拆分为 `ctx.inject(['tools', 'approval'], ...)` 与 `ctx.inject(['skills'], ...)`，避免缺省 `skills` 时工具也无法注册，反之亦然；并在注册时捕获异常输出明确日志（含 `skills.register` 重名碰撞告警）。
     - 强化 `src/server/tools/index.ts` 的 `parameters()` 转换器：显式支持 `type` 数组（转 `oneOf`）、`oneOf` / `anyOf`、`$defs`/`$ref` 展开、`description` 透传、合法 `additionalProperties` 布尔规范化，并在单元测试中用真实 `@deepseek-ai/dsh-tools` 的 `defineTool` 校验全部 6 个工具的 schema 编译通过。
  5. **统一缺失文件错误识别**：在 `src/server/map-files.ts` 中收口 `isNotFoundError(e)`，兼容 `workspace-file/not-found`、`FS_NOT_FOUND`、`ENOENT`。
- **Rationale**:
  - 核查 `@deepseek-ai/dsh-skill/lib/index.js`（第 196–200 行）证实：同名 runtime skill 会打印 warn 并返回空 disposer，而 `@deepseek-ai/dsh-tools/lib/index.js`（第 281、437 行）会在注册期执行 `assertSupportedJsonSchema`，遇到非法 schema 会直接抛 `JsonSchemaError` 令插件 fiber 崩溃。拆离注入与加固转换可从根源防止单点故障蔓延至宿主。
- **Alternatives Considered**:
  - *改名 `/mindmap` skill*: 会破坏已交付的用户指令习惯（`0.3.9` 已人工验收通过），故保持 `mindmap` 名称不变，通过独立注入与冲突诊断来防崩。

---

## Decision 3: 批量永久删除收敛与防死锁策略（FR-004）

- **Decision**:
  1. 在 `src/server/map-service.ts` 中，所有读写 `library.json` 的操作（`saveLibrary`、`purge`、`create`、`compactRetired`）统一归入工作区级串行队列键 `${workspaceComparisonKey(workspaceRoot)}\0__library__`。
  2. `purge` 流程在调用各图 `purgeMap` 完成后，**不再**直接拿删除前缓存的旧 `current.version` 写回，而是采用**重读最新 `library.json` + 合并已删集合 + 有限次 CAS 重试（最多 5 次）**将 `deletedIds` 合入 `purgedMapIds` 并从 `deletedMapIds`/`purgingMapIds`/`deletedMapTitles`/`mapFolders`/排序序列中清除；不覆盖期间对其他导图或文件夹的合法并发修改。
  3. 允许 `purge` 请求对已在 `purgingMapIds` 中但尚未完成收敛的导图重试（即使其 `map.json` 已在上一轮被删、`purge.json` 已处于 `state: 'completed'`）；同时在 `list` 读取时检测“在 `purgingMapIds` 中且磁盘 `purge.json` 已 `completed` 且内容文件已空”的条目，标记为可自动收敛或允许在回收站一键重试完成退场。
- **Rationale**:
  - 核查 `src/server/map-service.ts:89-115` 确认原逻辑存在明确窗口：删除磁盘文件后用过期的 `current.version` 写 `library.json`，一旦发生并发写入即报错且状态无法平滑收敛。CAS 重读合并既遵守宿主 `replaceIfVersion` 条件写契约，又能保证最终一致性。
- **Alternatives Considered**:
  - *拿全局大锁把整个工作区所有单图操作全部锁死*: 锁粒度过大，会让读图/编辑阻塞整个工作区；使用专门的 `__library__` 锁 + 末段 CAS 合并更轻量安全。

---

## Decision 4: 突破列举上限与延迟安全目录/孤儿资源回收（FR-005, FR-006）

- **Decision**:
  1. **目录列举改用 `ctx.fs.listDir`（消除 2000 条截断锁死）**：
     - 核查 `node_modules/@deepseek-ai/dsh-fs/lib/types/index.d.ts:225` 确认官方 `FileSystem` 服务提供 `listDir(target, signal): Promise<FsDirEntry[]>`，无 `workspaceFiles.list` 的 `maxEntries: 2000` 预览截断上限。
     - `createHostFiles().list()` 与 `listEntries()` 优先使用 `ctx.fs.listDir`（当测试 mock 未提供 `listDir` 时回退到 `ctx.workspaceFiles.list` 以保持既有测试兼容）。
  2. **空壳/作废目录的延迟安全回收与上限预警（遵循澄清 Q1 Option B 与宪章）**：
     - 核查 `dsh-fs` 契约证实：当前 DSH `0.2.x` 的 `ctx.fs` **仅提供 `deleteFile` 与 `moveFile`，尚未提供目录删除 API**（`docs/mindmap-storage-format.md` 第 7 行已明确记录此约束）。遵循宪章第 IV 条（不绕过宿主沙箱），插件**不直接调用** `node:fs` 的 `rmdir/rm` 绕过 `ctx.fs`。
     - 因此采用“**防复活元数据压缩 + 标记文件条件删除 + 空目录静默忽略 + 容量预警**”四步闭环：
       - 在 `library.json`（仍为 `schemaVersion: 1`，向后兼容）增加可选字段 `retiredCreateIds?: string[]`（记录已压实的作废创建 `mapId`）；`atlas_create` 同时检查磁盘 `.transactions/discarded-create.json` 与 `library.json` 的 `retiredCreateIds`，确保旧 `operationId` 永远无法复活。
       - 新增服务端 RPC 操作 `compactRetired`：按最旧优先或用户显式请求，对已确认 `state === 'discarded'` 或 `purge.json` 为 `completed`（且无 `map.json`、无 `active.json`、无未知文件）的目录，先把其 ID 持久化到 `library.json`（`retiredCreateIds` / `purgedMapIds`），再用 `ctx.fs.deleteFile` 条件删除冗余的 `discarded-create.json` / `purge.json` 标记文件（若未来宿主 `ctx.fs` 新增官方 `deleteDirectory`，再按能力探测调用；本版明确标记为**待宿主提供能力**）。
       - `listMapHeaders` / `listMaps` 对已在 `purgedMapIds` 或 `retiredCreateIds` 中、且确认空目录（0 文件）的目录静默跳过，不产生误报诊断；并在 `MapListing` 返回 `capacity: { directoryCount, retiredCount, warningThreshold }`（预警阈值默认 500），达到阈值时在管理页显示预警提示与“清理历史记录”入口（回收站“未完成创建”页签同样常驻该手动入口）。
  3. **孤儿图片延迟安全回收（遵循澄清 Q1 Option B）**：
     - 仅回收插件自有且经 `validateImage` 校验的 `assets/<id>.image.json` 孤儿文件（不触碰用户手动放置的未知文件或普通图片）。
     - 在编辑会话存活期间（`EditSession` 保留撤销历史时），删图操作**不立即删除**磁盘 `.image.json`，保障 `Ctrl+Z` / `Cmd+Z` 或“放弃修改”可随时恢复图片。
     - 新增服务端 RPC 操作 `cleanupOrphanAssets`（校验 `expectedWorkspaceKey`、`expectedFingerprint`、非只读、单图串行队列、全图所有节点 Markdown 重新解析确认零引用后，通过 `ctx.fs.deleteFile` 带版本号条件删除孤儿 `.image.json`）。
     - 客户端触发时机：（a）在 `EditSession` 检测到本会话曾提交过“移除图片引用”的保存，且随后会话安全脱离（`detach` 完成、无脏草稿且无在途保存、状态 `clean`）时自动发起一次后台尽力清理；（b）在导图菜单/管理入口提供手动“清理未引用图片”按钮供用户显式触发。
- **Rationale**:
  - 完全遵守项目宪章（不绕过 `ctx.fs` 沙箱、不删未知文件、不破坏编辑撤销）和 Q1 的延迟安全回收决策，同时彻底消除 2000 目录截断锁死与孤儿图片无限膨胀问题。
- **Alternatives Considered**:
  - *绕过 `ctx.fs` 直接用 `node:fs/promises` 的 `rmdir` 删目录*: 违反宪章“不绕过宿主沙箱或文件权限体系”，且在未来远程/沙箱化 `ctx.fs` 后端下会失效或越权，故明确拒绝。

---

## Decision 5: 收敛本地附件至仅支持图片（FR-007，遵循澄清 Q4 Option C）

- **Decision**:
  1. 在 `src/server/map-files.ts` 的 `readSnapshot` 中移除 `pdf` 与 `txt` MIME 映射；本地资产收集仅处理 `token.type === 'image'`（以及兼容历史误删 `!` 的 `noteImageToken`），不再把普通 Markdown 链接 `[...](../assets/*.pdf)` / `.txt` 读入内存与 `resources`。
  2. 常规非图片本地链接不触发 `readSnapshot` 失败（避免阻塞旧笔记阅读），而在 `src/client/render-note.tsx` 中 `case 'link'` 仅允许 `safeHref(link.href)`（`http://`、`https://`、`mailto:`、`#`）；其余本地非图片链接渲染为明确只读提示 `<span>{inner}（本地非图片附件暂不支持打开）</span>`，不再输出会被 Chromium/Electron 拦截的 `data:` 链接。
  3. 同步更新 `docs/mindmap-storage-format.md` 说明本地资源仅限受支持图片格式。
- **Rationale**:
  - 经核查 UI 编辑态仅支持上传 PNG/JPEG/WebP；去掉 PDF/TXT 内联加载既修复被拦截的无效链接，又避免大文档被 Base64 内联拖慢导图快照读取与导出。

---

## Decision 6: 文件监听收敛、消除二次刷新与快照性能/载荷保护（FR-008, FR-009）

- **Decision**:
  1. **单图监听收敛（`src/server/watch-map.ts`）**：
     - 核查 `node_modules/@deepseek-ai/dsh-fs-local/lib/index.js:756-770` 证实：`ctx.fs.watch(dirTarget)` 使用 `chokidar` 以 `depth: 0` 监听目录直接子项的增删改。
     - 因此 `watchPaths(snapshot)` 改为仅返回**去重后的目录集合**（`<mapId>`、`<mapId>/.transactions`、以及 `snapshot.files` 中每个文件去重后的父目录如 `notes`、`assets` 及嵌套子目录，上限 16 个目录），不再为每个 `.md` 和 `.image.json` 单独建流。50 节点 + 20 附件的导图从 ~75 条流收敛至 **4 条**。
     - 对可选目录（如尚未创建的 `.transactions`），流结束或不可用时不触发整体 `watchError`（`<mapId>` 目录监听已能感知 `.transactions` 的新建）。
  2. **导图库监听收敛与去冗余刷新（`src/client/host-adapter.ts`）**：
     - `watchLibrary` 由 `3 + 5 * N` 条流收敛为固定 **2–3 条常驻流**（`.`、`dsh-knowledge-maps`、`dsh-knowledge-maps/library.json`）。
     - `watchLibrary` 仅在收到 `frame.kind === 'change'` 时触发回调，不再在首次 `ready` 时触发一次冗余的 `host.list()`；同时在客户端建立轻量本地事件通知（当 `open-completed-map` 观测到 `atlas_create` / `atlas_apply` / `atlas_cleanup_create` 成功时，若当前在管理页则主动触发刷新），弥补不逐图监听 `map.json` 标题变更的窗口。
  3. **消除 `readSnapshot` 二次全量读图片 + 总载荷上限保护（FR-009）**：
     - 在 `MapFilePort` 新增可选轻量校验方法 `verify?(path, mapId, assetsOnly): Promise<{ version: string; identity: string }>`：真实 `createHostFiles` 对 `assets/*` 二次校验阶段仅调用 `stat` + `boundary` 比对 `version` 与 `targetKey`（无需把数 MB 图片整份重读并二次 SHA-256），文本类小文件及未实现 `verify` 的测试 mock 沿用原 `read` 复核。
     - 在 `readSnapshot` 中累计已编码 `resources` 总字节预算（默认上限 `20 MiB`）：超出时，写路径（`allowResourceErrors = false`）直接抛 `resource_too_large`；读路径（`allowResourceErrors = true`）将超出部分记入 `diagnostics` 并安全降级为 `writable = false` 只读提示，防止击穿 24 MiB RPC/内存阈值。
     - 修复 `EditSession.acceptReceipt`（`src/client/edit-session.ts`）：图片一旦写入磁盘出现在 `snapshot.files` 中，立即从 `this.pool` 移出，避免同会话后续每次文字自动保存都重复上传数 MB 的 Base64 图片。
- **Rationale**:
  - 直接消除百条并发监听、二次整图读盘、以及每次自动保存重传历史图片的三大真实性能/容量隐患。

---

## Decision 7: 内存状态淘汰与交互保护（FR-010, FR-011, FR-012）

- **Decision**:
  1. **内存缓存有界化（FR-010）**：
     - 客户端 `edit-session.ts`：`closeEditSessions(sessionId)` 在 `detach()` 完成后，对 `!dirty && !uncertain` 的会话立即从 `sessions` Map 移除并 `dispose()`；新增 `dropEditSession(workspaceKey, mapId)` 在删除/永久清除导图时释放缓存；为干净已脱离会话设最大保留数（16）按 LRU 淘汰。
     - 客户端 `AtlasPane.tsx`：`retainedLayouts` 在会话关闭或导图删除时清理，并设上限 32 条。
     - 客户端 `open-completed-map.ts`：`calls` Map 设 256 上限 FIFO 淘汰。
     - 服务端 `edit-service.ts`：`notePaths` Map 设 128 上限 LRU 淘汰，并在 `purge` / `cleanupCreate` 时主动清理对应 `mapId`。
     - 服务端 `tools/index.ts`：`previews` Map 为每条记录加 `createdAt`，15 分钟 TTL 过期清理 + 128 条上限 FIFO 淘汰，且在 `atlas_apply` 成功消费后立即删除。
  2. **非阻塞自动跳转与统一未保存保护（FR-011，遵循澄清 Q2 Option B）**：
     - `open-completed-map.ts` 打开页签时在 `params` 中附带 `autoOpen: true`。
     - `AtlasPane.tsx` 区分 `autoOpen`（后台工具自动触发）与用户显式跳转（如点击 `@` 引用）：
       - 收到 `autoOpen` 时，若用户正处于编辑态（`editing` 或 `editor.dirty`）、拖拽布局中（`nodeDragging` 或 `draftRef.current`）或正在核对引用（`reference !== undefined`），**不强制切页、不清空 `reference`、不丢草稿**，改为弹出带“查看更新”按钮的非阻塞通知条；若空闲且处于同图则温和刷新快照，处于异图或管理页则自动切换。
       - 用户点击聊天 `@` 引用或显式切图时，统一经过 `guard(...)` 未保存保护流程。
  3. **macOS 与 Windows 快捷键统一（FR-012）**：
     - `AtlasPane.tsx:799` 画布撤销/重做改为支持 `(e.ctrlKey || e.metaKey)`：`Z`（无 Shift）撤销，`Y` 或 `Shift+Z` 重做，保持对输入框与 `contenteditable` 的排除。
- **Rationale**:
  - 彻底封堵长会话内存增长、编辑中并发跳转丢稿/误清引用及 macOS 画布快捷键失效。

---

## Decision 8: 路径规范化与工具失败状态对齐（FR-013, FR-014）

- **Decision**:
  1. **工作区与笔记路径规范化（FR-013）**：
     - 新增共享纯函数模块 `src/shared/workspace-path.ts`，提供 `workspaceComparisonKey(path)`（Windows 盘符/UNC 路径统一 `/`、去尾部多余斜杠并转小写；POSIX 路径折叠重复 `/`、去尾部 `/` 且保持大小写敏感）、`sameWorkspaceKey(a, b)` 与 `normalizeNotePathKey(path)`。
     - 全面接入 `map-service.ts`、`tools/index.ts`、`edit-service.ts`、`cleanup-create.ts`、`AtlasPane.tsx`、`edit-session.ts`、`reference-navigation.ts` 的路径比较与 `serializeMap` 锁键。
  2. **工具失败状态对齐 `dsh-tools`（FR-014）**：
     - 核查 `node_modules/@deepseek-ai/dsh-tools/lib/pipeline.js:868-880` 证实：工具 `execute()` 抛出 `Error` 时，宿主流水线会自动将其规范化为 `{ isError: true, content: [{ type: 'text', text: 'Error: ' + error.message }], error: { message } }`。
     - 定义 `AtlasToolError extends Error`，在 `src/server/tools/index.ts` 的 `execute` 捕获失败时抛出 `new AtlasToolError(code, payloadJson, diagnostics)`（其中 `error.message` 保留完整结构化 JSON `{ status, message, diagnostics }`，`error.status` / `error.code` / `error.diagnostics` 供代码检查）。
     - 这样既满足宿主 `isError: true` 的失败判定，又保证模型与 `/mindmap` skill 仍能完整读取 `status` 与 `diagnostics`；同步更新 `tests/integration/atlas-tools-internal.test.ts` 并新增真实 `dsh-tools` 流水线验证测试。
- **Rationale**:
  - 与 `dsh-tools` 官方契约完全对齐，且不新增任何额外宿主包依赖（无需引入 `@deepseek-ai/dsh-llm` 运行时依赖）。

---

## 未验证项与宿主能力边界显式声明

按项目宪章要求，明确记录以下尚未在真机验证或受限于当前宿主版本的能力：
1. **目录物理删除能力**：DSH `0.2.2-rc.3` / `0.2.2-rc.5` 的 `ctx.fs` 尚未暴露目录删除 API（`deleteDirectory` / `rmdir`），本规划不绕过沙箱直接删除物理空目录，而是通过 `ctx.fs.listDir` 解除列举截断、`ctx.fs.deleteFile` 清理冗余标记文件、`library.json` 压实防复活记录以及空目录静默忽略达成目标；若未来宿主提供官方目录删除接口可再渐进接入。
2. **DSH Desktop 真机启动、升级共存与 UI 交互手感**：将在实现构建打包后交由用户按 `quickstart.md` 进行人工验收。
