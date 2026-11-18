---

description: "思维导图管理页拖放定位与手动排序任务清单"
---

# Tasks: 思维导图管理页拖放定位与手动排序

**Input**: Design documents from `specs/008-library-drag-sort/`（[spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/library-drag-sort.md](contracts/library-drag-sort.md)、[quickstart.md](quickstart.md)）

**编号**: 沿用仓库全局唯一任务编号，从 `T257` 开始。标有 `[P]` 的任务可在前置依赖完成后并行，`[US1]`、`[US2]` 对应用户故事。

**验证**: 按 `AGENTS.md` 约定，本轮实现完成后执行静态类型检查与构建（`npm run typecheck`、`npm run build`）；自动化测试运行及 DSH 真机交互验收由用户按 [quickstart.md](quickstart.md) 决定或另行要求。

## Phase 1: Setup（Schema 与数据结构准备）

**Purpose**: 扩展向后兼容的 `library.json` Schema，为导图与文件夹手动排序提供校验基础。

- [X] T257 在 `src/shared/library.ts` 扩展 `librarySchema`：继续保持 `schemaVersion: 1` 与 `folders[].parentId: idSchema.nullable()` 兼容校验；新增可选字段 `rootMapOrder: z.array(idSchema).optional()` 与 `folderMapOrders: z.record(idSchema, z.array(idSchema)).optional()`，在 `superRefine` 中校验 `folderMapOrders` 的键必须存在于 `folders`、各排序数组内部无重复 `mapId` 且同一个 `mapId` 不同时出现在多个排序数组中。

---

## Phase 2: Foundational（共享排序投影与拖放移动纯函数）

**Purpose**: 在共享模块实现不依赖 UI 的排序投影与移动计算，供前端与服务端复用。

**⚠️ CRITICAL**: 所有用户故事依赖本阶段纯函数完成。

- [X] T258 新建 `src/shared/library-order.ts`，实现以下纯函数（依赖 T257）：
  - `getOrderedFolders(library)`: 按 `folders` 数组先后顺序返回单层展示列表。
  - `getOrderedMapsInScope(maps, library, folderId)`: 根据 `rootMapOrder` 或 `folderMapOrders[folderId]` 返回已排好序的当前层级有效导图，并将未收录的剩余导图按原列表顺序追加至末尾。
  - `moveMapsToTarget(library, activeMaps, mapIds, target)`: 支持导图插入指定导图上方/下方、移入指定文件夹末尾、移出至根目录末尾；保留多选导图原有相对顺序，目标本身在 `mapIds` 内时返回未变更，结果与移动前完全一致时返回 `changed: false`。
  - `reorderFolders(library, folderIds, target)`: 支持将文件夹插入目标文件夹上方/下方或根目录文件夹区末尾，保留多选文件夹相对顺序，绝不嵌套子文件夹并在保存结构中将所有文件夹 `parentId` 规范化为 `null`；目标在 `folderIds` 内或无实质顺序变化时返回 `changed: false`。

**Checkpoint**: 共享模型校验与核心排序/移动纯函数就绪。

---

## Phase 3: User Story 1 - 直接拖放导图与文件夹完成归位及手动排序 (Priority: P1) 🎯 MVP

**Goal**: 用户可以在管理页直接把导图拖到任意导图下方/上方或文件夹中并看到清晰的横向插入指示线，支持单层文件夹手动排序且彻底修复展开文件夹内拖放冒泡回根目录的问题。

**Independent Test**: 在包含根目录导图、多个单层文件夹及文件夹内导图的管理页中，分别完成同级导图上下重排、从文件夹拖出到根目录导图下方、从根目录拖入已展开文件夹内导图下方、拖到首项上方以及文件夹上下重排，松手前可见准确指示线或容器高亮，松手后位置与归属立即生效且无文件夹嵌套。

### Implementation for User Story 1

- [X] T259 [P] [US1] 在 `src/client/styles/atlas.css`（并核对 `src/client/styles/prototype.css` 避免冲突）新增拖放视觉样式：为导图行和文件夹行添加上方/下方 `2px` 横向插入指示线（`pointer-events: none`，定位在行边缘不造成布局抖动），保留折叠/空文件夹及根目录容器高亮态，增加拖放禁止或非搜索禁用视觉过渡。
- [X] T260 [US1] 改造 `src/client/components/MapLibrary.tsx` 拖放交互与单层列表渲染（依赖 T258、T259）：
  - 文件夹改用 `getOrderedFolders` 单层平铺渲染（新建文件夹 `parentId: null`，不再嵌套渲染子文件夹），各层级导图改用 `getOrderedMapsInScope` 渲染。
  - 在 ref 中记录当前 `dragEntries`，于 `onDragOver` 根据指针在目标行 `getBoundingClientRect()` 的上下半区实时计算单一 `DropIndicator`（`map-insert` / `folder-insert` / `folder-into` / `root-into`），仅对合法组合显示指示；拖动纯文件夹经过导图区或子列表时阻止冒泡并设 `dropEffect = 'none'`。
  - 为 `mapRow`、已展开文件夹 `.library-children` 及 `.library-folder-empty` 绑定独立 `onDragOver` / `onDrop` 并调用 `stopPropagation()`，阻断向根目录容器的误冒泡。
  - 释放时调用 `moveMapsToTarget` / `reorderFolders`，仅在 `changed === true` 时触发 `save`；拖入折叠文件夹时自动展开；搜索筛选（`query.trim().length > 0`）、回收站视图（`trash`）或忙碌时禁用 `draggable` 与拖放处理；拖放结束或按 `Esc` 清理指示状态且不误触发行点击。

**Checkpoint**: User Story 1（直接拖放落位、横向指示线、防冒泡、导图与文件夹手动排序）已可独立运行与验收。

---

## Phase 4: User Story 2 - 手动排序持久保留并兼容多选、新增与恢复 (Priority: P2)

**Goal**: 保证手动排序持久化保存并在删除导图/文件夹、还原导图及永久删除等全生命周期操作下不打乱其余项目的相对顺序。

**Independent Test**: 排好文件夹及根目录/文件夹内导图顺序后，打开导图返回、刷新、新建文件夹/导图、删除导图至回收站再还原以及删除非空文件夹，验证已有项目相对顺序全部保留。

### Implementation for User Story 2

- [X] T261 [P] [US2] 在 `src/shared/library-order.ts` 新增生命周期维护纯函数（依赖 T258）：
  - `removeEntriesFromLibrary(library, activeMaps, entries)`: 删除导图时同步从 `rootMapOrder` / `folderMapOrders` 剔除对应 ID（保留 `mapFolders` 供还原）；删除文件夹时清除 `folderMapOrders[id]`，将所属导图从 `mapFolders` 移除并按原展示顺序追加到 `rootMapOrder` 末尾（若已有 `rootMapOrder`），其余文件夹 `parentId` 规范为 `null`。
  - `restoreMapsInLibrary(library, mapIds)`: 还原时清除 `deletedMapIds` / `deletedMapTitles`，并确保待还原导图不残留于排序数组以免插队，使其自然落在所属文件夹或根目录末尾。
  - `prunePurgedFromOrders(library, purgedIds)`: 从 `rootMapOrder` 与 `folderMapOrders` 清理已永久删除导图 ID。
- [X] T262 [P] [US2] 在 `src/server/map-service.ts` 的 `purge` 成功分支接入 `prunePurgedFromOrders`（依赖 T261），永久删除导图后同步清理 `rootMapOrder` 与 `folderMapOrders` 中的残留 ID。
- [X] T263 [US2] 在 `src/client/components/MapLibrary.tsx` 将 `remove` 与 `restore` 接入 `removeEntriesFromLibrary` 和 `restoreMapsInLibrary`（依赖 T260、T261）。

**Checkpoint**: User Story 1 与 User Story 2 全部功能及生命周期兼容逻辑就绪。

---

## Phase 5: Polish & Cross-Cutting Concerns（文档同步、测试补充与构建交付）

**Purpose**: 同步存储契约文档、补充测试覆盖并执行构建与静态检查。

- [X] T264 [P] 更新 `docs/mindmap-storage-format.md`，补充 `library.json` 可选字段 `rootMapOrder`、`folderMapOrders`、单层文件夹约定以及删除/还原/永久删除对排序字段的清理规则。
- [X] T265 [P] 新建 `tests/shared/library-order.test.ts`，并更新 `tests/integration/local-files.test.ts` 与 `tests/integration/dom.test.ts`，覆盖排序投影、导图上下插线跨层移动、多选相对顺序、无变化跳过、文件夹重排不嵌套、展开文件夹内防冒泡、搜索禁拖及 `purge` 清理。
- [X] T266 运行 `npm run typecheck` 与 `npm run build` 验证无类型与打包错误；核查 `git status --short` 确认仅包含预期修改，并按 `AGENTS.md` 约定交付构建结果及 `specs/008-library-drag-sort/quickstart.md` 人工验收清单（注明未执行自动测试与真机交互）。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: T257 可立即开始。
- **Phase 2 (Foundational)**: T258 依赖 T257。
- **Phase 3 (US1)**: T259 可与 T257/T258 并行；T260 依赖 T258 与 T259。
- **Phase 4 (US2)**: T261 依赖 T258；T262 依赖 T261；T263 依赖 T260 与 T261。
- **Phase 5 (Polish)**: T264、T265 在核心实现完成后可并行，最后执行 T266。

### Parallel Opportunities

- `T259`（CSS 样式）可与 `T257` / `T258`（Schema 与共享纯函数）并行推进。
- `T261`（生命周期纯函数）完成后，`T262`（服务端 `purge` 清理）可与 `T260` / `T263` 并行。
- `T264`（文档同步）与 `T265`（测试编写）在 `T260`–`T263` 完成后可并行编写。

## Implementation Strategy

先以 `T257 → T258 → (T259 // T258) → T260` 快速打通 MVP（US1：直接拖到目标导图下方/上方、横向指示线、防冒泡、单层文件夹排序），再通过 `T261 → (T262 // T263)` 补全删除/还原/永久清理对排序的保护（US2），最后完成 `T264`、`T265` 与 `T266` 静态核验和构建交付。
