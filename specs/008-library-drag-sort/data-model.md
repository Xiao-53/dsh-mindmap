# Data Model: 思维导图管理页拖放定位与手动排序

**Feature**: `008-library-drag-sort` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

## 1. 持久化实体：`MapLibrary`（`dsh-knowledge-maps/library.json`）

继续沿用 `schemaVersion: 1`，在原有结构基础上扩展可选导图排序字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | 是 | 目录索引版本号，保持为 `1` |
| `folders` | `FolderEntry[]` | 是 | 单层文件夹数组，**数组先后顺序即为文件夹手动排序** |
| `folders[].id` | `idSchema` | 是 | 文件夹稳定身份 |
| `folders[].title` | `string` (1..120) | 是 | 文件夹显示名称 |
| `folders[].parentId` | `idSchema \| null` | 是 | 兼容旧数据保留字段；本功能新建及重排写入恒为 `null` |
| `mapFolders` | `Record<idSchema, idSchema>` | 是 | `mapId -> folderId` 归属映射；不在映射中表示位于根目录 |
| `rootMapOrder` | `idSchema[]` | 否 | 根目录活动导图的手动排序 ID 列表 |
| `folderMapOrders` | `Record<idSchema, idSchema[]>` | 否 | 按 `folderId` 记录的各文件夹内部导图手动排序 ID 列表 |
| `deletedMapIds` | `idSchema[]` | 否 | 回收站中的导图 ID（既有字段） |
| `deletedMapTitles` | `Record<idSchema, string>` | 否 | 回收站导图兜底标题（既有字段） |
| `purgingMapIds` | `idSchema[]` | 否 | 删除进行中标记（既有字段） |
| `purgedMapIds` | `idSchema[]` | 否 | 已永久删除墓碑（既有字段） |

### 校验与不变量（Validation Rules）

1. `folders` 中所有 `id` 必须唯一。
2. `mapFolders` 中所有目标 `folderId` 必须存在于 `folders`。
3. `folderMapOrders` 中所有键 `folderId` 必须存在于 `folders`。
4. `rootMapOrder` 与 `folderMapOrders[folderId]` 的每个数组内部不允许出现重复 `mapId`。
5. 同一个 `mapId` 不允许同时出现在两个及以上排序列表中（`rootMapOrder` 与各 `folderMapOrders[*]` 两两互斥）。
6. `rootMapOrder` 与 `folderMapOrders` 中允许暂存当前已不在目录中（如被外部删除）的 `mapId` 残留记录，读取渲染时按当前有效导图集合过滤，避免因为外部文件删除导致 `library.json` 校验失败。

## 2. 展示排序投影规则（Derived View Model）

给定当前有效导图列表 `activeMaps`（排除 `deletedMapIds`、`purgedMapIds`）、`folders` 及 `mapFolders`：

- **文件夹展示列表**：按 `data.folders` 数组顺序直接展示，全部位于根目录导图上方（UI 上单层平铺，忽略历史 `parentId` 嵌套视觉层级）。
- **某层级导图展示列表**（根目录 `scope = null` 取 `rootMapOrder`；文件夹 `scope = folderId` 取 `folderMapOrders[folderId]`）：
  1. 收集当前归属于 `scope` 的所有有效导图 `scopedMaps`。
  2. 先按对应排序数组中的顺序提取仍存在于 `scopedMaps` 中的导图。
  3. 再将尚未出现在排序数组中的其余 `scopedMaps`（如新建导图、外部新增导图、从回收站还原或旧文件夹解散移回根目录且尚未写入排序的导图）按 `listing.maps` 原有默认顺序追加至该层级末尾。

## 3. 状态变更规则（State Transitions）

| 操作 | 对 `folders` / `mapFolders` 的影响 | 对 `rootMapOrder` / `folderMapOrders` 的影响 |
| --- | --- | --- |
| **拖动导图插入某导图上方/下方** | 更新被移动导图的 `mapFolders` 归属为目标所在层级（根目录则删除对应键） | 从源层级序列移除被移动导图；按目标层级当前可见完整序列补齐基准后，将被移动导图按原相对顺序插入目标导图之前/之后并写回对应序列 |
| **拖动导图放入文件夹行 / 空文件夹** | 将被移动导图的 `mapFolders[id]` 设为目标 `folderId` | 从源层级序列移除；追加到目标文件夹序列末尾（若原已在目标文件夹且非排序目标，保持不动或追加末尾规则一致） |
| **拖动导图放入根目录空白/标题区** | 删除被移动导图的 `mapFolders[id]` | 从源层级序列移除；追加到 `rootMapOrder` 末尾 |
| **拖动文件夹调整顺序** | 将被移动文件夹从 `folders` 原位置取出，按目标文件夹 `before`/`after` 插入新位置；顺带将所有文件夹 `parentId` 设为 `null` | 不改变各文件夹内 `folderMapOrders` 与 `rootMapOrder` |
| **新建文件夹** | 追加到 `folders` 末尾（`parentId: null`） | 不变 |
| **新建或外部新增导图** | 不改 `folders` 与 `mapFolders`（默认位于根目录） | 未在 `rootMapOrder` 中，自动展示在根目录末尾 |
| **删除导图（移入回收站）** | 写入 `deletedMapIds` 与 `deletedMapTitles`，保留 `mapFolders` 原所属文件夹（供还原用） | 从 `rootMapOrder` 与 `folderMapOrders` 中移除该导图 ID，其余导图相对顺序不变 |
| **从回收站还原导图** | 从 `deletedMapIds` 与 `deletedMapTitles` 移除；`mapFolders` 中指向的文件夹若仍存在则回到该文件夹，否则回到根目录 | 还原导图此时不在目标序列中，自动追加显示在目标层级末尾，不打乱原有顺序 |
| **删除文件夹** | 从 `folders` 移除该文件夹；将原属于该文件夹的导图从 `mapFolders` 移除（移回根目录），其余文件夹 `parentId` 规范为 `null` | 删除 `folderMapOrders[deletedFolderId]`；若存在 `rootMapOrder`，将被解散导图按原文件夹内展示顺序追加至 `rootMapOrder` 末尾，不打乱原根目录导图顺序 |
| **永久删除导图（`purge`）** | 写入 `purgedMapIds`，清理 `deletedMapIds`、`purgingMapIds`、`deletedMapTitles`、`mapFolders` | 从 `rootMapOrder` 与 `folderMapOrders` 同步清理已永久删除的导图 ID |

## 4. 前端交互临时状态（UI Transient State）

仅存在于 [MapLibrary.tsx](../../src/client/components/MapLibrary.tsx) 渲染期间，不持久化：

- `dragEntries: Entry[]`：当前正在拖动的条目集合（单拖时为当前项；若拖动项处于多选选中集合内，则为当前所有已选项）。
- `dropIndicator: DropIndicator | undefined`：
  - `{ kind: 'map-insert'; folderId: string | null; targetMapId: string; position: 'before' | 'after' }`
  - `{ kind: 'folder-insert'; targetFolderId: string; position: 'before' | 'after' }`
  - `{ kind: 'folder-into'; folderId: string }`
  - `{ kind: 'root-into' }`
- **无效/无变化判定**：若落点计算后的结果序列与归属与操作前完全一致（例如拖到紧邻前一项下方、紧邻后一项上方或自身），不显示高亮/插入线且松手不触发 `save`。
