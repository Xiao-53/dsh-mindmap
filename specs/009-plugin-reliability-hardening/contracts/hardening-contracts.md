# Interface & Runtime Contracts: 插件架构隐患排查与健壮性加固

**Feature**: `009-plugin-reliability-hardening` | **Date**: 2026-11-19

---

## 1. 插件清单与依赖契约（`package.json`）

- **`engines`**:
  - `node`: `>=24.9.0`
  - `dsh`: `>=0.2.2-alpha.3 <0.3.0-0`
- **`peerDependencies`**（与宿主共享实例，不装入插件私有副本）:
  - `@deepseek-ai/cordis`: `~4.1.0`
  - `@deepseek-ai/dsh-client-store`: `>=0.2.2-alpha.3 <0.3.0-0`
  - `@deepseek-ai/dsh-skill`: `>=0.2.2-alpha.3 <0.3.0-0`
  - `@deepseek-ai/dsh-tools`: `>=0.2.2-alpha.3 <0.3.0-0`
  - `@deepseek-ai/dsh-typert-protocol`: `>=0.2.2-alpha.3 <0.3.0-0`
  - `react`: `^18.2.0`
  - `zod`: `^4.0.0`（从 `dependencies` 移入 `peerDependencies` 与 `devDependencies`）
- **`dependencies`**（仅保留插件私有运行时库，不与 DSH 核心共享实例）:
  - `katex`: `0.19.1`（或 `^0.19.1`）
  - `marked`: `17.0.1`（或 `^17.0.1`）
- **`dsh.client.inject`**（完整声明所有直接消费的客户端宿主包）:
  - `@deepseek-ai/dsh-api-gateway`
  - `@deepseek-ai/dsh-api-session-controller`
  - `@deepseek-ai/dsh-api-workspace-files`
  - `@deepseek-ai/dsh-client-store`
  - `@deepseek-ai/dsh-client-ui-conversation`
  - `@deepseek-ai/dsh-client-ui-input-trigger`
  - `@deepseek-ai/dsh-client-ui-renderer`
  - `@deepseek-ai/dsh-client-ui-session`
  - `@deepseek-ai/dsh-client-ui-sidebar-right`
  - `@deepseek-ai/dsh-client-ui-slots`

---

## 2. Host RPC 扩展契约（`dshAtlas/request`）

保持单一 Typert 入口 `dshAtlas/request(workspaceFileScope, payload, signal)` 不变，向后兼容现有全部 `op`，新增 2 个受控维护操作：

### 2.1 `cleanupOrphanAssets`（孤儿图片安全回收）

- **Request**:
  ```json
  {
    "op": "cleanupOrphanAssets",
    "mapId": "<idSchema>",
    "expectedFingerprint": "<non-empty-string>",
    "expectedWorkspaceKey": "<non-empty-string>",
    "assetIds": ["<optional-asset-id>"]
  }
  ```
- **Preconditions**:
  - `sameWorkspaceKey(expectedWorkspaceKey, workspaceFileScope.workspaceRoot)` 为真。
  - 会话非只读（`policy.mode !== 'read-only'`）。
  - 当前磁盘快照无活动事务、非回收站/已清除状态，且 `snapshot.fingerprint === expectedFingerprint`。
  - 仅扫描本图 `assets/` 下符合 `/^[A-Za-z0-9_-]{1,128}\.image\.json$/` 的普通文件（`lstat.type === 'file'`），且内容通过 `validateImage` 确认为插件自有图片资产。
  - 重新扫描所有节点正文，确认目标资产在全图零引用后，使用 `ctx.fs.deleteFile(target, { version }, signal, policy)` 逐项条件删除。
- **Response (`ok: true`)**:
  ```json
  {
    "deletedAssetIds": ["<id>"],
    "skipped": [{ "id": "<id>", "reason": "<string>" }]
  }
  ```
- **Errors**: `workspace_changed` / `permission_denied` / `version_conflict` / `recovery_required` / `map_deleted`。

### 2.2 `compactRetired`（已完结空壳目录标记压实）

- **Request**:
  ```json
  {
    "op": "compactRetired",
    "expectedWorkspaceKey": "<non-empty-string>",
    "keepRecent": 0
  }
  ```
  （`keepRecent` 可选，非负整数默认 `0` 表示压实全部可安全压实的已完结记录；自动阈值触发时可传如 `50` 保留最近标记。）
- **Preconditions**:
  - 在工作区级 `__library__` 锁内执行，非只读会话，`sameWorkspaceKey` 校验通过。
  - 仅处理同时满足以下条件的目录：
    - 属于 `state === 'discarded'` 的作废创建目录（`inspectCreatePlaceholder` 确认），或属于 `.transactions/purge.json` `state === 'completed'` 且所有已列内容文件已不存在的已永久删除目录；
    - 不含 `map.json`、`active.json` 或任何未知文件/子目录。
  - **严格两步顺序**：先通过 CAS 更新 `library.json`（将作废创建写入 `retiredCreateIds`、已删导图写入 `purgedMapIds`），再通过 `ctx.fs.deleteFile` 条件删除对应目录的 `discarded-create.json` / `purge.json` 标记文件。
- **Response (`ok: true`)**:
  ```json
  {
    "compactedIds": ["<mapId>"],
    "library": { "data": "...", "version": "...", "workspaceKey": "..." }
  }
  ```

### 2.3 既有 `purge` 与 `list` 契约增强

- `purge`: 删完单图内容文件后，通过 `__library__` 队列 + CAS 重读最新 `library.json` 合并写入（最多重试 5 次），避免并发更新导致 `library.json` 滞后死锁；支持对处于 `purgingMapIds` 的条目安全重试收敛。
- `list`: 使用 `ctx.fs.listDir`（回退 `workspaceFiles.list`）列出目录，静默忽略已在 `purgedMapIds` / `retiredCreateIds` 中的空目录，并附带 `capacity: { directoryCount, retiredCount, warningThreshold }`。

---

## 3. DSH AI 工具契约（`atlas_*`）

### 3.1 参数 Schema 转换契约（`src/server/tools/index.ts`）

`parameters(schema)` 将 Zod v4 的 `z.toJSONSchema(schema)` 转换为 `@deepseek-ai/dsh-tools` 的 `ParameterSchemaSpec`：
- 展开 `$defs` / `$ref`（防环保护）；
- `anyOf` / `oneOf` 映射为 `{ oneOf: [...] }`；
- `type` 为数组（如 `['string', 'null']`）映射为 `{ oneOf: type.map(t => ({ type: t })) }`；
- 透传 `description`、`enum`、`const`、`items`；
- 对象 `additionalProperties` 规范化为严格布尔值（支持 `z.record` 的自由键对象）。
- 6 个注册工具全部必须通过 `defineTool(...)` 静态与单测校验。

### 3.2 工具失败返回契约（FR-014）

- **成功路径**：保持返回原有 JSON 结构对象（`{ status: 'success' | 'preview', ... }`），`dsh-tools` 标记 `isError: false`。
- **失败路径**：抛出 `AtlasToolError`（继承 `Error`）：
  - `error.status` / `error.code`: 既有错误码字符串（`invalid_data`、`version_conflict`、`preview_required`、`approval_required`、`permission_denied`、`create_discarded`、`failed_rolled_back`、`recovery_required` 等）；
  - `error.diagnostics`: `Diagnostic[]`；
  - `error.message`: `JSON.stringify({ status, message, diagnostics })`。
- **宿主效果**：`@deepseek-ai/dsh-tools` 流水线捕获后生成 `{ isError: true, content: [{ type: 'text', text: 'Error: {"status":...}' }], error: { message } }`，同时满足宿主失败状态识别与模型结构化诊断解析。

---

## 4. 客户端侧栏、事件流与渲染契约

### 4.1 侧栏导航参数（`AtlasNavigation`）

```ts
export interface AtlasNavigation {
  mapId?: string
  reference?: ReferenceSnapshot
  /** 为 true 表示由后台工具完成自动触发，受非打断保护约束 */
  autoOpen?: boolean
}
```

- `register-sidebar.tsx` **移除** `insertText` prop 及 `'slash/input-insert-text'` 内部事件调用；仅保留公开支持的 `ctx.conversation.input.for(binding.ctx).insertReference`。

### 4.2 客户端本地完成事件通知

- `open-completed-map.ts` 在安全解析到成功的 `atlas_create` / `atlas_apply` / `atlas_cleanup_create` 工具结果时：
  - 若是 `atlas_create` / `atlas_apply` 且当前会话挂载了右侧栏，发送 `openTab(ATLAS_KIND, { params: { mapId, autoOpen: true } })`（由 `AtlasPane` 根据编辑/拖拽/引用状态决定直接打开还是显示非阻塞“查看更新”提示）；
  - 通过模块内轻量监听通知正在显示的 `MapLibrary` 刷新目录列表（取代对每张图的 5 条文件监听流）。

### 4.3 节点正文本地链接渲染契约（FR-007）

- `readSnapshot` 仅解析 `image` 与历史兼容 `noteImageToken` 的本地图片资源（支持 `png/jpg/jpeg/gif/webp/.image.json`），忽略非图片本地链接，不报错也不加载其字节。
- `RenderNote` 渲染 `link` 时仅允许 `safeHref(link.href)`；无法通过 `safeHref` 的本地非图片链接渲染为不可点击的 `<span>{inner}（仅支持网络链接与本地图片）</span>`。
