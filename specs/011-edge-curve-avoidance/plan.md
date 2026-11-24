# Implementation Plan: 节点连线曲线弧度与避让逻辑优化

**Branch**: `main`（Spec Kit 功能：`011-edge-curve-avoidance`） | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from [spec.md](spec.md)、[存储契约](../../docs/mindmap-storage-format.md) 与 [项目宪章](../../.specify/memory/constitution.md)。

## Summary

在不改动 `map.json` / `layout.json` 存储契约、零新增外部图形依赖且完全保留既有节点与分组坐标的前提下，重构节点连线的曲线生成、自适应避让、共路分层与拖拽稳定性管线，直接落地全部 5 项澄清结论：

1. **端口外法线 $G^1$ 锁定与无阻挡基础弧度收敛（`FR-001` / `FR-002`）**：所有 1～3 段曲线的首末控制点强制约束在起点外法线射线与终点箭头反向延长线上，彻底消除端口出口和箭头根部折角；对邻边转角引入 $\kappa=0.55$ 分量收敛与上限控制，消除远距过度鼓包与极近反向回穿。
2. **完整边框 + `7px` 克制留白包络、自身卡片防穿透与正面直挡智能换边（`FR-003` / `FR-004` / `FR-005` / Q1 & Q3）**：将碰撞检测从“仅内缩核心区 + 固定 20 点”升级为“凸包 AABB 剪枝 + $\le 12\text{ px}$ 步长自适应采样”，覆盖非端点 `card` 完整外框、`7px` 安全留白及起终点自身卡片防回穿边界；常规与一般斜向完全保留现有四向动态端口，仅在同排/同列默认端口被中间卡片正面直挡时允许自动换到更顺畅的顶/底或左/右侧形成拱桥，且严格遵循“最小绕行改动”原则（轻微擦边仅施最小微调，窄走廊优先贴框微让而非绕大圈）。
3. **取消写死三段：障碍驱动的 1～3 段自适应封顶与向心平滑样条（`FR-005` / `FR-006` / Q2）**：废除 `460px / 160px` 硬切、`t=1/3, 2/3` 固定切分与 `±248px` 上限，改为按实际障碍簇与可行间隙走廊在 **1 段 → 2 段（1 航点）→ 最多 3 段（2 航点）** 间渐进升级并抽取多余航点；采用向心弦长加权（$\alpha=0.5$）切向与转角衰减控制臂生成平滑样条，彻底修复反弯点切向退化；极端重叠无通道时在 1～3 段内按最小遮挡确定性降级。
4. **Pass-2 共路与双向分层、标签避卡择优及拖拽滞回稳定（`FR-007`–`FR-011` / Q4 & Q5）**：抽离视图级批量路由 `routeSegments` 供静态渲染与 180ms 端口动画共用，对绕过同障碍同侧或双向互连的共路连线按走廊净空自适应以 `4~10px` 间距分层错开（不挤去对侧绕大圈）；动态扫描弧长 `25%~75%` 区间择优放置关系文字标签避开卡片遮挡；并在 `MapScene` 内存维护按 `viewId` 隔离的 `EdgeRouteHint`，拖拽期间为障碍中线临界区提供约 `24px` 等效代价的轻度滞回缓冲，确保零穿卡且无高频闪烁。

## Technical Context

**Language/Version**: TypeScript（Host 与 Client 均面向 ES2023，Node.js ≥ 24.9.0，测试使用 `--experimental-strip-types` 直接运行 TS）。

**Primary Dependencies**: 既有 React 18、Zod 4、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-typert-protocol`、`@deepseek-ai/dsh-client-store`、KaTeX、Marked、JSXGraph、CodeMirror 6、esbuild；零新增外部依赖。

**Storage**: 工作区 `dsh-knowledge-maps/<mapId>/` 下的 `map.json`（`schemaVersion: 1`）与 `layout.json`（`schemaVersion: 1 | 2`）**零读写变更**；`EdgeRouteHint` 仅存在于客户端组件瞬态内存中，不落盘。

**Testing**: Node 内置 `node:test` + `jsdom`（日常开发默认执行 `npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd run pack:plugin -- --dry-run` 并于交付时说明未验证项；`npm.cmd run test` 按 `AGENTS.md` 约定仅在用户明确授权时执行）。测试代码新增 `tests/shared/edge-routing.test.ts` 全量验证 `SC-001`–`SC-004`、更新 `tests/shared/prototype-parity.test.ts` 区分原型无阻挡基线与直挡避让，并复用 `tests/integration/dom.test.ts` 验证宿主 DOM 与离线 HTML 同步渲染；DSH Desktop 真机与离线 HTML 视觉体验按 [quickstart.md](quickstart.md) 交由用户人工验收。

**Target Platform**: DSH `0.2.2-alpha.3` ~ `0.2.x` 桌面端原生右侧栏（浅色/深色主题）及离线导出单文件 HTML 阅读器（`src/client/offline.tsx` 复用 `ReadingPane → MapScene`）。

**Project Type**: 单仓库 DSH 原生侧栏思维导图插件（`src/shared` + `src/server` + `src/client`）。

**Performance Goals**: 单视图 20 节点、30+ 连线场景下，全量路由与 Pass-2 共路分离、标签锚点计算总耗时控制在 `< 2ms`，确保用户连续拖动卡片与 180ms 端口滑轨动画保持 60fps 无明显掉帧。

**Constraints**: 严格遵守项目宪章与 Q1–Q5 澄清结论：不引入任何图形/路由库；不改变既有节点与分组坐标；保留 HTML v17 端口圆点（雾霾蓝实心输入圆、灰豆沙 2px 描边空心输出圆）及外沿箭头视觉规范；保持宿主侧栏与离线独立阅读页呈现 100% 一致。

**Scale/Scope**: 覆盖 3 个 User Stories、11 条 Functional Requirements（`FR-001`–`FR-011`）与 5 项 Success Criteria（`SC-001`–`SC-005`），聚焦共享几何/路由核心、客户端动画与画布场景衔接及对应单元测试。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 规划前检查 | 设计后复核 |
| --- | --- | --- |
| I. 内容生成与界面实现职责分离 | 通过。所有曲线弧度、智能换边与避让路由完全属于插件渲染管线，不触碰 AI 提示词或模型输出契约。 | 通过。改动仅限于 `src/shared/` 与 `src/client/`，DSH 内容生成继续只负责 `map.json` 与 Markdown。 |
| II. 独立数据与稳定身份 | 通过。不修改 `map.json` 或 `layout.json` 任何字段。 | 通过。`EdgeRouteHint` 仅作按 `viewId` 隔离的客户端内存 ref；打开既有 `layout.json` 时节点与分组坐标 100% 只读保留。 |
| III. 用户控制发送与修改保护 | 通过。不涉及引用插入、草稿发送或模型调用。 | 通过。`MapScene` 拖拽滞回仅影响实时曲线绘制，不改写或干扰既有节点位置保存与撤销状态。 |
| IV. 官方契约与最小实现 | 通过。零新增第三方依赖，不改宿主接入清单。 | 通过。仅在 `src/shared/` 新增内聚几何模块 `edge-routing.ts`，沿用现有 React + SVG 渲染管线。 |
| V. 一致呈现与可验证交付 | 通过。延续 HTML v17 柔和曲线美学及输入/输出端点颜色描边规范。 | 通过。无阻挡连线严格保持 v17 端口与柔和风格；`createConnections` / `routeSegments` 同时服务侧栏与离线阅读页；可测与人工验收标准已在 [quickstart.md](quickstart.md) 明确区分。 |

## Project Structure

### Documentation (this feature)

```text
specs/011-edge-curve-avoidance/
├── spec.md                              # 澄清后的功能规范（5 轮澄清 Q1–Q5 已整合）
├── plan.md                              # 本文件（$speckit-plan 产出）
├── research.md                          # Phase 0 几何算法、避让分级、共路与滞回研究决策
├── data-model.md                        # Phase 1 安全包络、样条曲线、共路组与滞回状态模型
├── quickstart.md                        # Phase 1 自动化核验与真机/离线人工验收指南
├── contracts/
│   └── edge-routing.md                  # Phase 1 共享路由接口、客户端动画协作与测试契约
├── checklists/
│   └── requirements.md                  # 规范质量检查表（16/16 通过）
└── tasks.md                             # Phase 2 产物（待 $speckit-tasks 生成，本命令不创建）
```

### Source Code (repository root)

```text
src/
├── shared/
│   ├── edge-geometry.ts                 # 公开端口、箭头与批量路由入口（createConnections / routeSegments / connectionGeometry / edgeGeometry）
│   └── edge-routing.ts                  # 新增内聚几何引擎：安全包络、自适应采样、G1 向心样条、正面直挡换边、1～3 段阶梯避让、Pass-2 共路分层与标签避卡择优
└── client/
    ├── animate-ports.ts                 # 动画帧改用批量 routeSegments，与静态帧共享 1～3 段避让、共路分层、标签定位及滞回状态
    └── components/
        └── MapScene.tsx                 # 维护按 viewId 隔离的瞬态 routeHintsRef，向 createConnections 与 useAnimatedPorts 传入 dragging 与 hints

tests/
├── integration/
│   └── dom.test.ts                      # 复用：既有宿主 DOM 与离线 HTML 导出用例（在 T319 附带轻量烟雾校验确认渲染新曲线与标签）
└── shared/
    ├── edge-routing.test.ts             # 新增：全面验证 SC-001 至 SC-004 的无折角、避让、1～3 段封顶、最小改动、共路分离、标签避卡、拖拽滞回与大图性能
    └── prototype-parity.test.ts         # 更新：区分 v17 无阻挡基线对齐与正面直挡隔卡边的无穿卡避让校验
```

**Structure Decision**: 严格保持现有 `src/shared` + `src/client` 分层，不新增客户端组件或状态库，不修改 `src/server/`、`src/client/offline.tsx` 或样式文件（已通过 `ReadingPane` / `MapScene` / `<SceneEdge>` 复用自动覆盖浅色/深色主题与离线 HTML 导出）。将高密度的几何求解算法独立抽离至 `src/shared/edge-routing.ts`，使 `src/shared/edge-geometry.ts` 保持薄接口层，兼顾代码可读性与单元测试隔离度。

## 实施顺序（按优先级与验证闭环推进）

1. **阶段 1 — $G^1$ 基础曲线收敛、卡片安全包络与自适应采样（P1 / `FR-001`–`FR-004`）**：
   - 建立 `src/shared/edge-routing.ts` 骨架：`createCardEnvelopes`（`card` / `pad=7px` / `core` / 自身防回穿 `selfA` & `selfB`）、凸包剪枝 + `<=12px` 自适应采样 `evaluateSpline`、`buildBaseSpline`（对边/邻边 $\kappa=0.55$/同侧拱桥/光滑自环）及通用 1～3 段向心平滑样条构造 `buildCentripetalSpline`。
2. **阶段 2 — 正面直挡智能换边与障碍驱动 1～3 段自适应避让（P1 / `FR-005`–`FR-006`）**：
   - 实现 `selectHeadOnPortSides`（仅同排/同列正面深度直挡评估同侧拱桥换边）与 `routeSingleEdge`（Stage 0/1/2/3 阶梯升级、障碍簇聚类、最小微推与走廊候选、冗余航点抽稀、极端拥挤最小遮挡降级）。
3. **阶段 3 — Pass-2 共路分层、标签避卡与拖拽滞回全链路接线（P2 / `FR-007`–`FR-011`）**：
   - 实现 `separateSharedCorridors`（共路/双向 `4~10px` 自适应分层）、`pickLabelAnchor`（弧长 `25%~75%` 避卡择优）及拖拽临界 `24px` 滞回缓冲；
   - 更新 `src/shared/edge-geometry.ts` 导出 `routeSegments` 并对接 `createConnections` / `connectionGeometry`；更新 `src/client/animate-ports.ts` 与 `src/client/components/MapScene.tsx`。
4. **阶段 4 — 自动化回归、原型基线对齐与打包校验（`SC-001`–`SC-005`）**：
   - 编写 `tests/shared/edge-routing.test.ts` 与更新 `tests/shared/prototype-parity.test.ts`（同时复用 `tests/integration/dom.test.ts`），默认运行 `npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd run pack:plugin -- --dry-run` 验证产物打包可用并标注未验证项；`npm.cmd run test` 仅在用户明确授权后执行。

## Complexity Tracking

无宪章违规项，无需额外复杂度豁免。
