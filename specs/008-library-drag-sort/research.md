# Technical Research: 思维导图管理页拖放定位与手动排序

**Feature**: `008-library-drag-sort` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

## 1. 现状问题与架构约束核查

对现有管理页与索引存储代码核查后，确认以下事实：

1. **目录索引结构**（[src/shared/library.ts](../../src/shared/library.ts)、[docs/mindmap-storage-format.md](../../docs/mindmap-storage-format.md)）：
   - `library.json`（`schemaVersion: 1`）当前仅保存 `folders`、`mapFolders` 以及回收站相关可选字段，没有保存导图顺序。
   - 导图枚举来自 [src/server/map-files.ts](../../src/server/map-files.ts) 的 `listMapHeaders`（底层按文件系统目录枚举顺序返回），前端直接按该顺序渲染，因此无法手动排序。
   - 现有集成测试 [tests/integration/local-files.test.ts](../../tests/integration/local-files.test.ts) 直接校验了 `folders` 中包含 `parentId` 的历史结构与循环父级拒绝逻辑。
2. **前端拖放实现**（[src/client/components/MapLibrary.tsx](../../src/client/components/MapLibrary.tsx)）：
   - 仅文件夹标题行 `.library-entry-line`、空文件夹占位 `.library-folder-empty`、根目录标题栏 `.library-section` 和最外层容器挂了 `dropProps`。
   - 导图行 `mapRow` 与已展开文件夹的 `.library-children` 容器未处理 `onDragOver` / `onDrop` 也未阻止冒泡，导致拖入已展开文件夹内部导图位置时事件直接冒泡到外层根目录，使导图被反向移回根目录。
   - `onDragLeave` 跨越行内子元素频繁清零高亮，且 HTML5 `dragover` 阶段不允许读取 `dataTransfer.getData()`，无法在悬停时区分当前拖动的是导图、文件夹还是多选集合。

## 2. 技术决策

### Decision 1: 排序数据存储方式（扩展 `library.json` 可选字段，保持 `schemaVersion: 1`）

- **Decision**: 在 `librarySchema`（继续保持 `schemaVersion: 1`）上新增两个可选字段保存导图顺序：`rootMapOrder?: string[]` 与 `folderMapOrders?: Record<string, string[]>`；文件夹顺序直接以 `folders` 数组自身顺序持久化，不额外引入冗余 `folderOrder` 字段。
- **Rationale**:
  - 文件夹本身已存储在有序数组 `folders` 中，调整 `folders` 数组元素顺序即可天然表达手动排序，新建文件夹追加至末尾也符合既有 `[...data.folders, newFolder]` 习惯。
  - 将导图顺序拆为 `rootMapOrder` 与按 `folderId` 索引的 `folderMapOrders`，能够精确对应规范中“根目录与各文件夹内分别独立维护导图顺序”，且避免 `""` 或魔术键名与 `idSchema`（`/^[A-Za-z0-9_-]+$/`）发生冲突。
  - 字段均为可选，完全向后兼容既有 `library.json` 与 `local-files.test.ts`，无需升级 `schemaVersion` 或做破坏性迁移。
- **Alternatives considered**:
  - *单数组 `mapOrder: string[]` 全局扁平排序*：跨文件夹移动与文件夹内局部插入时需要反推同级相对位置，且无法直接防止同一导图意外受其他目录旧顺序牵连；相对繁琐。
  - *把序号写进每张图的 `map.json` 或独立新建 `order.json`*：违背单图内容与目录组织解耦原则，且一次拖动多图需要修改多个 `map.json` 文件，增加多文件并发冲突风险。

### Decision 2: 单层文件夹约束与历史数据兼容策略

- **Decision**: 保持 `librarySchema` 对 `parentId: idSchema.nullable()` 及合法性校验的兼容，由客户端目录逻辑与移动辅助函数强制执行单层文件夹规则（新建文件夹 `parentId: null`，拖拽文件夹只触发文件夹间上下重排，绝不嵌套为子文件夹）。若读取到历史 `library.json` 中存在带 `parentId` 的文件夹，管理页展示时将其视为顶层文件夹平铺展示，删除任意文件夹将其内部导图移回根目录末尾，并在执行文件夹结构保存时将所有文件夹统一规范化为 `parentId: null`。
- **Rationale**:
  - 既满足用户明确要求“不能文件夹中套文件夹”，又不会因历史工作区遗留 `parentId` 数据或既有契约测试（`local-files.test.ts`）校验失败而阻断读取。
- **Alternatives considered**:
  - *在 `librarySchema` 中直接禁止 `parentId` 非空*：会导致包含历史嵌套数据的 `library.json` 报错不可读，同时破坏现有 `local-files.test.ts` 用例。

### Decision 3: 拖放交互机制与落点指示方案

- **Decision**: 沿用并修复组件级原生 HTML5 拖放（`draggable` + `onDragStart` / `onDragOver` / `onDrop` / `onDragEnd`），同时在 React ref/state 中记录当前拖动条目集合（`dragEntries`），在 `onDragOver` 阶段基于指针 Y 坐标与行矩形高度（上半区 `before` / 下半区 `after`）实时计算唯一的语义化 `DropIndicator`（横线插入指示或容器高亮），并在内层容器严格 `stopPropagation()` 阻断向根目录冒泡。
- **Rationale**:
  - 原生 HTML5 拖放自带半透明拖拽随行预览（与用户提供的三张参考截图视觉一致），无需额外引入第三方 DnD 库或自建全局浮层。
  - 通过组件内存放 `dragEntries` 绕过浏览器 `dragover` 阶段禁读 `dataTransfer.getData()` 的限制，使得悬停时即可按“拖动导图 vs 拖动文件夹 vs 多选混合”精准决定显示横线插入还是拒绝落放（`dropEffect = 'none'`）。
  - 行内元素（文字、图标、按钮）设置统一坐标判定或对插入线使用 `pointer-events: none`，并只在有效区域外/容器真正退出或 `dragend` 时清理指示状态，可消除高亮闪烁。
- **Alternatives considered**:
  - *改用 `pointerdown/pointermove/pointerup` 全手动模拟拖拽*：与 `MapLibrary` 既有打开按钮点击、复选框及行内菜单抢占手势的协调成本更高，且需自造拖拽幽灵副本；在已有 HTML5 拖放基础上修复更加最小化。
  - *引入外部拖拽库（如 dnd-kit）*：违反宪章 IV“最小实现、不提前引入额外依赖”的约定。

### Decision 4: 排序与移动纯函数下沉共享模块

- **Decision**: 将目录展示排序（`orderedFolders`、`orderedMapsInScope`）与所有移动/重排/删除/还原后的索引变更计算提取为纯函数，放在 `src/shared/` 中（如 `src/shared/library-order.ts` 或扩展 `src/shared/library.ts`），供 `MapLibrary.tsx`、服务端 `purge` 清理（[src/server/map-service.ts](../../src/server/map-service.ts)）以及共享单元测试/DOM 集成测试共同调用。
- **Rationale**:
  - 避免在前端组件内重复编写边界判断（如：拖到自身前后不触发保存、多选保留相对顺序、搜索期间禁止拖拽、永久删除同步清理排序数组、删除文件夹保留相对顺序移至根目录末尾等）。
  - 纯函数可在 Node 测试环境下 100% 确定性验证，无需依赖浏览器渲染。
