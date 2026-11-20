# Data Model & State Transitions: 插件架构隐患排查与健壮性加固

**Feature**: `009-plugin-reliability-hardening` | **Date**: 2026-11-19

---

## 1. 目录索引模型扩展（`dsh-knowledge-maps/library.json`）

保持 `schemaVersion: 1` 完全向后兼容历史工作区数据，在 `librarySchema`（`src/shared/library.ts`）中新增 1 个可选字段：

| 字段 | 类型 | 必填 | 说明与校验规则 |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | 是 | 保持版本 1，向后兼容 |
| `folders` | `Folder[]` | 是 | 既有单层文件夹定义（数组顺序即排序） |
| `mapFolders` | `Record<Id, Id>` | 是 | 既有导图归属映射 |
| `rootMapOrder` | `Id[]` | 否 | 既有根目录导图手动顺序 |
| `folderMapOrders` | `Record<Id, Id[]>` | 否 | 既有各文件夹内导图手动顺序 |
| `deletedMapIds` | `Id[]` | 否 | 回收站内待还原/待永久删除导图 ID |
| `deletedMapTitles` | `Record<Id, string>` | 否 | 回收站展示名称缓存 |
| `purgingMapIds` | `Id[]` | 否 | 已开始不可逆永久删除、尚未完成收敛的导图 ID |
| `purgedMapIds` | `Id[]` | 否 | 已完成永久删除的导图 ID（防重现、列表过滤依据） |
| `retiredCreateIds` | `Id[]` | 否 | **新增**：已压实清理标记文件的作废创建 `mapId` 集合（去重、`idSchema` 校验），用于替代已删磁盘 `discarded-create.json` 继续阻止旧 `operationId` 复活 |

### 校验与不变量
- `retiredCreateIds` 中每个元素须满足 `idSchema` 且无重复；与有效 `mapFolders` / `deletedMapIds` 无强冲突要求，但创建校验与列表过滤必须将其视作已作废身份。
- `purgedMapIds` 中的 ID 不得再出现在 `deletedMapIds`、`purgingMapIds`、`mapFolders`、`rootMapOrder`、`folderMapOrders` 中（在 `purge` 收敛时统一清理）。

---

## 2. 导图目录列表与容量模型（`MapListing`）

在 `src/shared/map-types.ts` 的 `MapListing` 增加可选容量诊断字段：

```ts
export interface DirectoryCapacity {
  /** dsh-knowledge-maps/ 下的直接子目录总数 */
  directoryCount: number
  /** 其中已确认完结（purged / discarded / 空历史目录）且可压实的记录数 */
  retiredCount: number
  /** 建议用户清理的预警阈值（默认 500） */
  warningThreshold: number
}
```

- `MapListing.capacity?: DirectoryCapacity`：仅用于管理页预警展示和“清理历史记录”按钮可用性判断，不写入磁盘。

---

## 3. 状态机与生命周期转换

### 3.1 永久删除与并发收敛状态机（FR-004）

```text
[Deleted in Trash]
   │  (用户触发 purge; 写入 purgingMapIds)
   ▼
[Purging] ──(purgeMap 成功写 purge.json: completed)──► [Files Deleted on Disk]
   │                                                          │
   │ (磁盘删除失败/中断)                                      │ (CAS 重读最新 library.json 并合并，最多重试 5 次)
   ▼                                                          ▼
[Purging (Retryable)]                                   [Purged (Settled)]
   │  (用户重试 purge，读取已有 purge.json 继续)              │  - 加入 purgedMapIds
   └─────────────────────────────────────────────────────────►│  - 移除 deletedMapIds / purgingMapIds / orders
                                                              ▼
                                                       [Compacted Retired] (可选：compactRetired 删除 purge.json 标记)
```

- **收敛保证**：即使在 `Files Deleted on Disk` 到 `Purged (Settled)` 期间有其他写入修改了 `library.json`，通过 `__library__` 串行队列 + CAS 重读最新 `library.json` 合并变更，确保已删导图不会卡死在 `purgingMapIds` 中；即使进程异常重启导致残留，下一次 `purge` 重试识别到 `purge.json: completed` 后立即收敛。

### 3.2 未完成创建占位与延迟压实状态机（FR-005）

```text
[reserved] ──(创建失败受控释放)──► [failed]
    │                                  │
    └────(atlas_cleanup_create / UI)───┘
                     │
                     ▼
        [discarded] (磁盘存在 discarded-create.json)
                     │
                     │ (用户显式触发 compactRetired 或达到安全阈值)
                     │ 1. 校验无 map.json / 无 active.json / 无未知文件
                     │ 2. 先将 mapId 写入 library.json.retiredCreateIds
                     │ 3. 再条件删除 .transactions/discarded-create.json
                     ▼
        [compacted] (防复活由 library.json.retiredCreateIds 接管；空目录在 list 时静默忽略)
```

- **顺序不变量**：必须**先**持久化 `retiredCreateIds` 到 `library.json`，**再**删除磁盘 `discarded-create.json`。即使中途失败，旧 `operationId` 始终处于被拒绝状态，绝不复活。

### 3.3 孤儿图片延迟安全回收状态机（FR-006）

```text
[Referenced Asset] (assets/<id>.image.json 被 ≥1 个节点 Markdown 引用)
        │
        │ (编辑提交删除引用)
        ▼
[Unreferenced - Retained for Undo] (EditSession 存活且保留撤销栈；磁盘保留文件)
        │
        ├──(用户 Ctrl+Z / Cmd+Z 撤销并保存)──► [Referenced Asset]
        │
        │ (EditSession 安全 detach 且无脏稿 / 或用户显式点击“清理未引用图片”)
        │ 服务端校验：非只读 + fingerprint 匹配 + 扫描全图所有节点零引用 + validateImage 确认插件自有资产
        ▼
[Deleted via ctx.fs.deleteFile(version)]
```

### 3.4 自动跳图协调状态机（FR-011）

```text
收到外部导航事件 (AtlasNavigation)
  ├── autoOpen === true (AI 后台工具完成)
  │     ├── 编辑中 / 拖拽中 / 有脏草稿 / 正在核对引用 ──► 保持当前画面与引用状态，弹出非阻塞提示（含“查看更新”按钮）
  │     ├── 空闲且已在目标导图 ─────────────────────────► 温和刷新当前快照（不重置相机与浏览历史）
  │     └── 空闲且在管理页或另一张干净导图 ─────────────► 自动打开目标导图
  └── autoOpen !== true (用户主动点击聊天 @ 引用或外部入口)
        └── 统一经过 guard() 未保存保护后再切换并应用 reference
```

---

## 4. 监听与内存缓存预算实体（FR-008, FR-009, FR-010）

| 缓存 / 资源对象 | 所属模块 | 淘汰 / 上限策略 | 主动清理触发点 |
| --- | --- | --- | --- |
| `watchLibrary` 流集合 | `src/client/host-adapter.ts` | 常数 **≤ 3 条流**（`.`、`dsh-knowledge-maps`、`library.json`） | 页签不可见 / 切入导图 / 卸载 |
| `watch` 单图目录流集合 | `src/server/watch-map.ts` + `host-adapter.ts` | 仅目录级监听，上限 **16 个目录**（常规 4 个） | 切图 / 卸载 / 依赖目录集合变化 |
| `readSnapshot` 资源总载荷预算 | `src/server/map-files.ts` | 编码后累计上限 **20 MiB**（低于 24 MiB RPC 边界） | 单次请求级检查，超限降级只读或拒写 |
| `EditSession.pool` | `src/client/edit-session.ts` | 每次 `acceptReceipt` 剔除已落盘图片 | 保存回执确认 / `discard` / `accept` |
| `sessions` Map | `src/client/edit-session.ts` | 已脱离且干净会话上限 **16**（LRU） | `closeEditSessions` 异步清理 / 导图删除 / `dispose` |
| `retainedLayouts` Map | `src/client/AtlasPane.tsx` | 上限 **32**（FIFO） | 保存完成 / 取消拖拽 / 会话关闭 / 导图删除 |
| `open-completed-map` `calls` Map | `src/client/open-completed-map.ts` | 上限 **256**（FIFO） | 收到 `tool/result` / 会话切换 / 卸载 |
| `notePaths` Map | `src/server/edit-service.ts` | 上限 **128**（LRU） | `purge` / `cleanupCreate` 主动移除 |
| `previews` Map | `src/server/tools/index.ts` | 上限 **128**（FIFO）+ **15 分钟 TTL** | 每次写入前过期清理 / `atlas_apply` 消费后删除 |

---

## 5. 工作区与笔记路径规范化规则（FR-013）

| 路径类型 | 原始值保留 | 规范化比较键（`ComparisonKey`） | 应用范围 |
| --- | --- | --- | --- |
| Windows 盘符路径（`C:\Foo\Bar\`） | 保持原值交给 `ctx.fs` | `c:/foo/bar`（`\`→`/`、去尾 `/`、转小写） | `workspaceKey` 比较、`serializeMap` 锁键、`noteKey`、`editSession` 键 |
| Windows UNC 路径（`\\Host\Share\Dir\`） | 保持原值交给 `ctx.fs` | `//host/share/dir`（`\`→`/`、去尾 `/`、转小写） | 同上 |
| POSIX 路径（`/Users/a/Proj/`） | 保持原值交给 `ctx.fs` | `/Users/a/Proj`（折叠重复 `/`、去尾 `/`、保留大小写） | 同上 |
| 导图内 `notePath` | 按原相对路径存储 | `localPath(p).toLowerCase()` | 读写两端节点路径占用与去重判定 |
