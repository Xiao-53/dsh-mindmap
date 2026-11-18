# Implementation Plan: 思维导图管理页拖放定位与手动排序

**Branch**: `main`（Spec Kit 功能：`008-library-drag-sort`） | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from [spec.md](spec.md)、[存储契约](../../docs/mindmap-storage-format.md) 与 [项目宪章](../../.specify/memory/constitution.md)。

## Summary

修复管理页拖放时的冒泡与落点识别缺陷，并引入导图与单层文件夹的手动排序持久化。存储层在保持 `library.json`（`schemaVersion: 1`）向后兼容的前提下，以 `folders` 数组顺序表达文件夹顺序，并新增可选字段 `rootMapOrder` 与 `folderMapOrders` 分别记录根目录及各文件夹内的导图排序；共享纯函数统一处理投影排序、跨文件夹插队、多选保留顺序、无变化跳过、单层文件夹规范化及删除/还原/永久清理。前端 [MapLibrary.tsx](../../src/client/components/MapLibrary.tsx) 补充导图行上下半区与文件夹行上下半区的精确拖放判定、内层子列表冒泡阻断、横向插入指示线视觉反馈及搜索/回收站禁拖保护。

## Technical Context

**Language/Version**: TypeScript（客户端构建目标 ES2023，Node.js ≥ 24.9.0，`--experimental-strip-types` 直接运行 TS 测试）。

**Primary Dependencies**: 既有 React 18、Zod 4、esbuild 及原生 HTML5 Drag-and-Drop；不引入任何第三方拖拽或状态管理库。

**Storage**: 工作区 `dsh-knowledge-maps/library.json`（延续 `schemaVersion: 1`、宿主机 `ctx.fs` 与 `createIfAbsent` / `replaceIfVersion` 条件写入，复用 `saveLibrary` 与 `purge` 服务）。

**Testing**: Node 内置 `node:test` + `jsdom`（`npm run typecheck`、`npm run test`、`npm run build`）覆盖共享排序纯函数、本地文件存储/冲突/`purge` 清理及管理页 DOM 交互；DSH 真机视觉与手感按 [quickstart.md](quickstart.md) 人工验收。

**Target Platform**: DSH `v0.2.2-rc.3` 桌面原生右侧栏。

**Project Type**: 单仓库 DSH 学习插件（前后端共享 schema 与纯函数，esbuild 打包客户端与服务端产物）。

**Performance Goals**: 拖放悬停计算仅做 O(1) 几何高度判定与 O(N) 内存序列投影，不引入频繁重排抖动；仅在实际归属或顺序发生实质变化时触发一次 `saveLibrary` 写入。

**Constraints**: 保持 `schemaVersion: 1` 向后兼容历史 `library.json` 与既有集成测试；强制单层文件夹（不允许文件夹嵌套文件夹），所有文件夹始终整体排在根目录导图上方；搜索筛选与回收站视图下禁用拖放排序与移动；复用既有保存错误提示与版本冲突保护。

**Scale/Scope**: 覆盖单个工作区导图库管理页面（通常数十至数百张导图与若干单层文件夹）；不改动 `map.json`、`layout.json`、节点正文、AI `/mindmap` 提示词或离线 HTML 导出。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 规划前检查 | 设计后复核 |
| --- | --- | --- |
| I. 内容生成与界面实现职责分离 | 通过。仅涉及插件自身目录索引与管理页 UI。 | 通过。不涉及模型提示词、AI 工具或单图内容结构，新图仍由插件在展示时追加至默认位置。 |
| II. 独立数据与稳定身份 | 通过。排序完全基于稳定 `mapId` / `folderId`。 | 通过。导图与文件夹改名不影响顺序；`library.json` 保持 `schemaVersion: 1`，新增可选排序字段并校验唯一性与跨列表互斥，不移动磁盘地图目录。 |
| III. 用户控制发送与修改保护 | 通过。不涉及提问发送；沿用 `library.json` 条件写保护。 | 通过。无实质变化不写入；写入复用 `replaceIfVersion` 版本冲突检查；失败保留原状并报错提示。 |
| IV. 官方契约与最小实现 | 通过。复用既有宿主 `saveLibrary`、`purge` 与 React/Zod。 | 通过。零新增外部依赖与宿主 RPC；纯函数提取在共享层，避免逻辑重复。 |
| V. 一致呈现与可验证交付 | 通过。延续暖纸色调管理页视觉风格。 | 通过。以横向插入指示线和容器高亮提供明确落点提示；自动化测试验证逻辑与 DOM 行为，真机手感交由用户按 `quickstart.md` 验收。 |

## Project Structure

### Documentation (this feature)

```text
specs/008-library-drag-sort/
├── spec.md                              # 澄清后的功能规范
├── plan.md                              # 本文件（$speckit-plan 产出）
├── research.md                          # Phase 0 技术决策与备选对比
├── data-model.md                        # Phase 1 数据模型与状态转换
├── quickstart.md                        # Phase 1 构建检查与真机验收步骤
├── contracts/
│   └── library-drag-sort.md             # Phase 1 拖放语义矩阵与存储契约
└── checklists/
    └── requirements.md                  # 规范质量检查表（16/16 通过）
```

### Source Code (repository root)

```text
src/
├── shared/
│   ├── library.ts                       # 扩展 librarySchema（rootMapOrder / folderMapOrders 及互斥校验）
│   └── library-order.ts                 # 拟新增：排序投影、插入移动、多选重排、删除/还原清理纯函数
├── server/
│   └── map-service.ts                   # purge 成功时同步清理 rootMapOrder / folderMapOrders 中已清除 ID
└── client/
    ├── components/
    │   └── MapLibrary.tsx               # 改造：单层文件夹展示、导图/文件夹上下插线判定、防冒泡、搜索禁拖
    └── styles/
        └── atlas.css                    # 补充横向插入指示线、折叠/空文件夹移入高亮及禁用态样式

docs/
└── mindmap-storage-format.md            # 同步补充 library.json 新增排序字段与单层约束说明

tests/
├── shared/
│   └── library-order.test.ts            # 拟新增：纯函数排序、插队、多选、无变化、单层规范化、删/还单测
└── integration/
    ├── local-files.test.ts              # 补充 rootMapOrder / folderMapOrders 校验、兼容及 purge 清理验证
    └── dom.test.ts                      # 补充管理页拖放插线、已展开文件夹落位、文件夹重排不嵌套及搜索禁拖验证
```

**Structure Decision**: 延续项目既有的 `src/shared`（Schema 与纯逻辑）+ `src/server`（文件与服务）+ `src/client`（React UI 与样式）三层结构。将所有排序与移动计算收口到 `src/shared/library-order.ts`，使 `MapLibrary.tsx` 只负责指针分区计算与视觉状态，服务端只负责 `purge` 字段清理与版本校验，从而把耦合和重复降到最低。

## 实施顺序

1. **共享模型与纯函数**：更新 [src/shared/library.ts](../../src/shared/library.ts) 的 `librarySchema` 校验规则；新建 `src/shared/library-order.ts` 实现 `getOrderedFolders`、`getOrderedMaps`、`moveMapsToTarget`、`reorderFolders`、`removeEntriesFromLibrary`、`restoreMapsInLibrary` 及变化判定。
2. **服务端清理与存储文档同步**：更新 [src/server/map-service.ts](../../src/server/map-service.ts) 的 `purge` 分支清理 `rootMapOrder` / `folderMapOrders`；同步更新 [docs/mindmap-storage-format.md](../../docs/mindmap-storage-format.md) 对 `library.json` 的增量说明。
3. **前端交互与样式**：改造 [src/client/components/MapLibrary.tsx](../../src/client/components/MapLibrary.tsx) 与 [src/client/styles/atlas.css](../../src/client/styles/atlas.css)，接入单层文件夹呈现、基于 `dragEntries` 与指针纵向位置的实时 `DropIndicator`、内层冒泡阻断、横向插入指示线以及搜索/回收站禁拖保护。
4. **测试与构建核验**：补充 `tests/shared/library-order.test.ts`、`tests/integration/local-files.test.ts` 与 `tests/integration/dom.test.ts`，运行 `npm run typecheck`、`npm run test`、`npm run build` 确认通过后交付用户按 [quickstart.md](quickstart.md) 进行 DSH 真机验收。

## Complexity Tracking

无宪章违规项，无需额外复杂度豁免。
