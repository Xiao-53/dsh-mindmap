# Implementation Plan: 多分组跨组卡片排版与连线路由深度优化

**Branch**: `014-multigroup-layout-routing`（实际工作于 `main` 分支，遵循仓库单一功能目录规范） | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from [spec.md](spec.md)、[调查研究报告](../../docs/research/MinerU_markdown_202611242123087_9d94c05c.md)、[研究交接文档](../../docs/layout-routing-research-handoff.md)、[存储契约](../../docs/mindmap-storage-format.md) 与 [项目宪章](../../.specify/memory/constitution.md)。

## Summary

围绕“**低频布局期全视图实高联合求解 + 高频渲染期局部 $O(E)$ 几何精修**”双层协同架构，全面优化多分组跨组多节点场景下的卡片排列与连线呈现：

1. **实高与同源几何的全局多分组联合求解（`FR-001`–`FR-004`, `FR-013`）**：
   - 在 `src/shared/layout.ts` 移除硬编码行高 `162` 与卡高 `130px`，每次评估 via `computeViewGeometry` 按真实测量 `heights` 重建精确矩形，结合闭式四分位曲线代理 `evalProxyQ25Q75`、Liang-Barsky 穿卡判定与 AABB 交叉检测消除排版-路由“两张皮”；
   - 引入 2-cycle 预分离 + Tarjan SCC + 加权边界感知 GreedyFAS + 极小 FAS 清洗拆解组内环路（豁免合理回边逆流罚并施同 SCC 引力，引导跨组回边及跳组边走外边界列），并通过四阶段 `solveGlobalViewLayout`（桶内种子 + 3 趟双向重心 + 3! 列置换 + 全局 Sifting 与跨桶耦合列交换）搭配刚性位移冻结分桶与 `crossMat` 脏边缓存求解全视图（保留严格三列对齐与分组叙事顺序）。
2. **局部 $O(E)$ 路由精修与高亮光晕补强（`FR-005`–`FR-009`）**：
   - 在 `src/shared/edge-routing.ts` 与 `src/shared/edge-geometry.ts` 合入斜率感知双向端口配对（`24/12` 滞回 + `bidirFlipped`）、同向平行斜线反相偏置、跨度感知 `hasOuterCard`、顶拱/左拱（含 `grid` 邻组标题）精确护栏钳位、彩虹分层 `archLane` 与成对 LIFO 嵌套 `projectedOrder`；
   - 在 `src/client/animate-ports.ts`、`MapScene.tsx`、`atlas.css`、`dark.css` 透传 `groups` 与边元数据，并为 `focused === true` 高亮边底层追加画布同色 `.edge-focus-halo` 光晕（悬停绝不提层）。
3. **四维防遮盖胶囊与短边自适应定位（`FR-010`）**：
   - `routeSegments` 两趟预构造全图 3 段闭式弦与全端口/箭头保护盒（`±5px`），升级 `pickPillAnchor` 执行四维分级避让，并为水平短边提供真实净空中点与自适应 `maxWidth`、为竖向短边提供左右走廊侧鞍悬停（同时保持 3/4 参旧调用 100% 向后兼容）。
4. **框内优先补位与保留锁定位置的局部整理（`FR-011`, `FR-012`, `FR-014`）**：
   - 升级 `placeNearNeighbors` 在邻居脱框时枚举所属 `oldGroup` 框内空槽；新增 `relayoutViewPartial`（`'unlocked'` 与 `{ groupId }`），经 `useViewportLayout.ts` 的 `relayoutPartial` 接入 `EditSession.setLayout` 自动保存与 30 步撤销栈，并在 `MapHeader.tsx` 重置旁新增轻量“整理未锁定节点”按钮（离线不展示、`offline.tsx` 零改动）。

## Technical Context

**Language/Version**: TypeScript（`typescript ^6.0.3`，Node.js `>=24.9.0`，使用 `node --experimental-strip-types --test` 直接运行 TS 测试）。

**Primary Dependencies**: 既有 `react ^18.2.0`、`zod 4.6.6`、`@deepseek-ai/cordis ~4.1.0`、`katex 0.19.1`、`marked 17.0.1`、`jsxgraph 1.14.3`、`@codemirror/*`、`esbuild ^0.27.0`；**零新增外部依赖**（严格不引入 Dagre、ELK、React Flow 等外部图布局库）。

**Storage**: 工作区 `dsh-knowledge-maps/<mapId>/` 下 `map.json`（`schemaVersion: 1`）与 `layout.json`（`schemaVersion: 1 | 2`）**零格式变更**；全部路由/代理/滞回/胶囊属性均为瞬态运行态，不写盘。

**Testing**: Node 内置 `node:test` + `jsdom`（遵循 `AGENTS.md` 日常开发运行 `npm.cmd run typecheck`、`npm.cmd run build` 及预览包打包，`npm.cmd run test` 仅在用户明确授权时执行）。扩展 `tests/shared/edge-routing.test.ts`、`tests/shared/layout-navigation.test.ts`、`tests/integration/dom.test.ts` 并复核 `tests/shared/prototype-parity.test.ts`；真机与离线 HTML 视觉手感按 [quickstart.md](quickstart.md) 交由用户人工验收。

**Target Platform**: DSH `>=0.2.2-alpha.3 <0.3.0-0`（目标宿主 `v0.2.2-rc.3`）桌面端原生右侧栏（浅色/深色暖纸主题）与独立离线 HTML 阅读页（`src/client/offline.tsx` 自动复用 `ReadingPane` / `MapScene` / `MapViewport`）。

**Project Type**: 单仓库 DSH 原生侧栏思维导图插件（`src/shared` + `src/client` + `src/server`）。

**Performance Goals**: 渲染期 `createConnections` 在 40 节点 / 65 边场景下保持 $O(E)$ 且单次耗时远低于 `16ms` 帧预算（拖拽跟手零延迟）；布局期 $\le 20$ 节点视图全图重排耗时达标瞬时响应（40 节点压力图通过刚性位移冻结分桶与 `crossMat` 脏边缓存显著压低计算开销）。

**Constraints**: 严格遵守项目宪章与 `AGENTS.md`：零新增外部库；零破坏持久化格式；100% 保护已存 `layout.json` 与 `manual: true` 节点坐标；保持柔和单段曲线、`#8699aa` / `#b38c97`（`2px` 描边）与 0.5 秒子图过渡；宿主与离线阅读页表现一致。

**Scale/Scope**: 覆盖 5 个 User Stories、14 条 Functional Requirements（`FR-001`–`FR-014`）与 7 项 Success Criteria（`SC-001`–`SC-007`），涉及 3 个共享算法文件、6 个客户端渲染/交互/样式文件及 4 个测试文件。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 规划前检查 | 设计后复核 |
| --- | --- | --- |
| I. 内容生成与界面实现职责分离 | 通过。所有排布求解、回路拆解、连线分离、胶囊避让与局部整理均由插件在 `src/shared/` 与 `src/client/` 执行，不触碰 `src/server/prompts/`。 | 通过。AI 内容输入仍仅含 `map.json` 与 Markdown；模型无需计算坐标或生成连线。 |
| II. 独立数据与稳定身份 | 通过。零改动 `map.json` 与 `layout.json` Schema，打开既有布局 100% 保留原有节点与分组坐标。 | 通过。新增选项与路由滞回均属瞬态运行态；`relayoutViewPartial` 原位钉死 `manual: true` 节点与既定分组。 |
| III. 用户控制发送与修改保护 | 通过。不涉及引用草稿或自动模型请求；“整理未锁定节点”由用户手动点击触发，并保留手动微调。 | 通过。`relayoutPartial` 通过 `EditSession.setLayout` 纳入既有自动保存与 30 步撤销重做栈，误操作可一步恢复。 |
| IV. 官方契约与最小实现 | 通过。零引入第三方图形库，零改动 DSH 宿主工具及注册契约，所有导出函数向后兼容。 | 通过。仅在现有共享层与客户端组件内部增量演进，无新增构建或编排设施。 |
| V. 一致呈现与可验证交付 | 通过。保留柔和单段曲线、输入/输出端点颜色描边及 0.5 秒过渡，双端复用同一渲染与路由逻辑。 | 通过。`src/client/offline.tsx` 无需改动即可同步继承全部排版、曲线、光晕与胶囊能力；[quickstart.md](quickstart.md) 明确区分工程检查与人工验收边界。 |

## Project Structure

### Documentation (this feature)

```text
specs/014-multigroup-layout-routing/
├── spec.md                                      # 功能规范（US1–US5、FR-001–FR-014、SC-001–SC-007）
├── plan.md                                      # 本文件（$speckit-plan 产出）
├── research.md                                  # Phase 0 决策记录与符号/兼容细节澄清
├── data-model.md                                # Phase 1 常量、运行时实体、代理与护栏公式
├── quickstart.md                                # Phase 1 工程检查与双端人工验收清单
├── contracts/
│   └── multigroup-layout-routing.md             # Phase 1 共享引擎、客户端交互与测试契约
├── checklists/
│   └── requirements.md                          # 规范质量核验清单（16/16 通过）
└── tasks.md                                     # Phase 2 待由 $speckit-tasks 生成
```

### Source Code (repository root)

```text
src/
├── shared/
│   ├── layout.ts                                # 实高重建、evalProxyQ25Q75、Tarjan+GreedyFAS、四阶段联合求解、脏边缓存、框内补位、relayoutViewPartial
│   ├── edge-routing.ts                          # 跨度感知外卡、顶/左精确护栏、彩虹分层 archLane、平行偏置参数、四维避让 pickPillAnchor
│   └── edge-geometry.ts                         # 斜率感知双向配对(24/12)、archActive LIFO 端口序、平行斜线反相偏置、两趟弦/端口盒预生成
└── client/
    ├── animate-ports.ts                         # 透传 groups 与每边 archLane/hsBias/heBias/bidirFlipped
    ├── hooks/
    │   └── useViewportLayout.ts                 # 新增 relayoutPartial(options) 接入 EditSession.setLayout
    ├── components/
    │   ├── MapScene.tsx                         # 透传 groups、SceneEdge 聚焦 .edge-focus-halo、ScenePill 内联 maxWidth
    │   └── MapHeader.tsx                        # 在重置按钮旁新增 onTidyUnlocked（整理未锁定节点）
    ├── styles/
    │   ├── atlas.css                            # .edge-focus-halo 浅色暖纸光晕样式
    │   └── dark.css                             # .edge-focus-halo 深色背景光晕适配
    └── AtlasPane.tsx                            # 仅非离线透传 onTidyUnlocked={() => vp.relayoutPartial({ scope: 'unlocked' })}

tests/
├── shared/
│   ├── edge-routing.test.ts                     # 双向/平行斜线、嵌套拱桥、标题/左边界护栏、四维胶囊、40节点性能基准
│   ├── layout-navigation.test.ts                # 既有回归 + 变高、2x2田字、环路/跨组回边、框内补位、relayoutViewPartial
│   └── prototype-parity.test.ts                 # 回归复核
└── integration/
    └── dom.test.ts                              # .edge-focus-halo、短边胶囊 maxWidth、“整理未锁定节点”按钮/撤销与离线隐藏
```

**Structure Decision**: 严格沿用现有单仓库 `src/shared/` + `src/client/` 分层结构，零新增源码目录、零修改 `src/server/` 与 `src/client/offline.tsx`。推荐采用“低风险路由精修先行（或与布局基础并行） → 全局实高布局内核与回路求解 → 框内补位与局部整理入口 → 测试/构建/人工验收”的渐进合并节奏，确保每一步均向后兼容、可独立测试与回滚。

## Complexity Tracking

无宪章违规项，无需额外复杂度豁免。
