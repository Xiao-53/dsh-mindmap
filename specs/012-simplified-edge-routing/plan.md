# Implementation Plan: 简化节点连线路由、焦点提层与自适应关系胶囊标签

**Branch**: `012-simplified-edge-routing`（实际工作于 `main` 分支，遵循仓库单一功能目录规范） | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from [spec.md](spec.md)、[存储契约](../../docs/mindmap-storage-format.md) 与 [项目宪章](../../.specify/memory/constitution.md)。

## Summary

推翻 `011-edge-curve-avoidance` 中近 2,000 行重型全局多卡避让实现，围绕“**局部 $O(E)$ 几何路由 + 穿底渲染 + 单击提层高亮 + 沿线自动避卡小胶囊**”彻底重构连线管线，全面落地 Q1–Q3 澄清结论与调研方案：

1. **大刀阔斧砍除全局避让与多段样条寻路（`FR-001`）**：将 `src/shared/edge-routing.ts` 从 1,980 行精简至 ~280～340 行，删除全部曲线采样碰撞循环、障碍簇合并、2～3 段样条及 Pass-2 车道重排，允许一般斜向与跨区域连线从无关卡片下层穿过，消除过山车大弯与拖拽卡顿崩溃。
2. **该直则直（`FR-002` / Q2 & Q3 Option A）**：左右侧单端口默认采用距卡片顶部固定高度基准（`43`），使同排高矮串联卡片保持在同一平直水平主干线；面对面单端口在安全内边距内沿轴向自动投影对齐；固定多端口且横向/纵向错位 $\le 16$ 时直接拉成直线，并让箭头顺沿直线方向对接输入圆外沿（零 S 弯且零折角）。
3. **弧度受控单段曲线与轻量同排/同列隔卡拱桥（`FR-003`、`FR-004`、`FR-009`）**：曲线边保持垂直端口外法线出射与限幅控制臂（正向封顶 `110`）防止长边鼓包；仅在同排/同列面对面连线正前方被整卡深度直挡时，经纯矩形通道检测切换为同侧对称单段拱桥跨过，配合拖拽进出迟滞（`18` 进 / `6` 出 + `24` 选侧缓冲）防闪烁。
4. **四层渲染栈、仅单击提层与自适应胶囊标签（`FR-005`–`FR-008` / Q1 Option A）**：在 `MapScene.tsx` 中将底层连线（`z: 1`）、节点卡片（`z: 2`）、焦点提层连线（`z: 5`，仅单击选中节点时挂载，悬停绝不提层）、关系胶囊（`z: 6` / 高亮 `z: 7`）与端口圆点（`z: 9`）清晰分层；以 HTML `.edge-pill` 替代 SVG `<text>`，沿 7 个参数位置自动避开卡片与邻近胶囊，极短边居中截断并支持悬停显示全文。

## Technical Context

**Language/Version**: TypeScript（Host 与 Client 均面向 ES2023，Node.js `>= 24.9.0`，测试使用 `node --experimental-strip-types --test` 直接运行 TS）。

**Primary Dependencies**: 既有 React `^18.2.0`、Zod `4.6.6`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-typert-protocol`、`@deepseek-ai/dsh-client-store`、`katex`、`marked`、`jsxgraph`、`@codemirror/*`、`esbuild`；零新增外部依赖。

**Storage**: 工作区 `dsh-knowledge-maps/<mapId>/` 下的 `map.json`（`schemaVersion: 1`）与 `layout.json`（`schemaVersion: 1 | 2`）**零读写变更**；`EdgeRouteHint` 仅存在于客户端按 `view.id` 隔离的瞬态内存中，不落盘。

**Testing**: Node 内置 `node:test` + `jsdom`（按 `AGENTS.md` 开发约定，日常开发默认运行 `npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd run pack:plugin -- --dry-run` 并于交付时说明未验证项；`npm.cmd run test` 仅在用户明确授权时执行）。重构 `tests/shared/edge-routing.test.ts`、更新 `tests/shared/prototype-parity.test.ts` 并补充 `tests/integration/dom.test.ts` 胶囊/提层断言；真机与离线 HTML 视觉手感按 [quickstart.md](quickstart.md) 交由用户人工验收。

**Target Platform**: DSH `>=0.2.2-alpha.3 <0.3.0-0`（目标宿主 `0.2.2-rc.3`）桌面端原生右侧栏（浅色/深色主题）及离线导出单文件 HTML 阅读器（`src/client/offline.tsx` 复用 `ReadingPane → MapScene`）。

**Project Type**: 单仓库 DSH 原生侧栏思维导图插件（`src/shared` + `src/client` + `src/server`）。

**Performance Goals**: 单边 $O(1)$ 几何 + 7 点 AABB 胶囊探测，40 节点、60+ 连线视图全量重算总耗时控制在 `< 1ms`，连续鼠标拖拽与 180ms 端口滑动动画全程稳跑 60fps、零阻塞崩溃。

**Constraints**: 严格遵守项目宪章、`AGENTS.md` 与 Q1–Q3 澄清结论：零新增依赖；零改写历史坐标与存储格式；保持 HTML v17 柔和曲线美学及输入 `#8699aa` 实心圆、输出 `#b38c97` 2px 描边空心圆规范；保持宿主侧栏与离线阅读页 100% 一致。

**Scale/Scope**: 覆盖 3 个 User Stories、12 条 Functional Requirements（`FR-001`–`FR-012`）与 6 项 Success Criteria（`SC-001`–`SC-006`），删减约 1,650 行冗余路由算法并完成客户端四层高亮与胶囊升级。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 规划前检查 | 设计后复核 |
| --- | --- | --- |
| I. 内容生成与界面实现职责分离 | 通过。所有连线直线化、拱桥、提层与胶囊排版仅在插件视图渲染层执行，不触碰 AI 提示词或模型输出契约。 | 通过。改动仅限于 `src/shared/`、`src/client/` 与 `tests/`，服务端与提示词零改动。 |
| II. 独立数据与稳定身份 | 通过。不向 `map.json` 或 `layout.json` 新增路由/胶囊字段，不移动任何节点或分组。 | 通过。`EdgeRouteHint` 仅作按 `viewId` 隔离的客户端内存 ref；胶囊坐标实时计算不落盘，100% 保护历史布局。 |
| III. 用户控制发送与修改保护 | 通过。不涉及引用草稿、消息发送或模型请求，不干扰节点手动移动与保存状态。 | 通过。仅有单节点点击选中驱动视觉提层，悬停不干扰指针，不修改用户手拖位置。 |
| IV. 官方契约与最小实现 | 通过。零新增依赖、零修改宿主接入清单与持久化契约，反而删除约 1,650 行过度设计代码。 | 通过。仅复用现有 React + SVG + HTML/CSS，契约接口与 `011` 调用方保持签名兼容。 |
| V. 一致呈现与可验证交付 | 通过。完整保留 HTML v17 柔和曲线与 `#8699aa` / `#b38c97` 2px 端口规范；`MapScene` 双端共享。 | 通过。`offline.tsx` 自动复用 `MapScene` 及 `atlas.css` / `dark.css`；`quickstart.md` 明确了自动化与人工验收标准及授权边界。 |

## Project Structure

### Documentation (this feature)

```text
specs/012-simplified-edge-routing/
├── spec.md                              # 简化方案需求规范（含 Q1–Q3 澄清）
├── plan.md                              # 本文件（$speckit-plan 产出）
├── research.md                          # Phase 0 根因复盘与精简几何/分层/胶囊设计决策
├── data-model.md                        # Phase 1 常量、精简几何实体与滞回/提层状态模型
├── quickstart.md                        # Phase 1 本地构建校验与真机/离线人工验收指南
├── contracts/
│   └── edge-routing.md                  # Phase 1 精简共享路由接口、四层渲染与胶囊样式契约
└── checklists/
    └── requirements.md                  # 规范质量检查表（16/16 通过）
```

### Source Code (repository root)

```text
src/
├── shared/
│   ├── edge-routing.ts                  # 大幅瘦身重写（1,980 行 → ~300 行）：直线化、限幅单段曲线、纯矩形隔卡拱桥与 7 点胶囊定位
│   └── edge-geometry.ts                 # 对接精简版路由：顶距基准、单端口投影对齐与 routeSegments / createConnections / connectionGeometry
└── client/
    ├── animate-ports.ts                 # 增加零尺寸保护并衔接轻量 routeSegments（无高耗时采样负担）
    ├── components/
    │   └── MapScene.tsx                 # 四层视觉拆分（edges-base + 条件 edges-focus + HTML .edge-labels 胶囊 + atlas-ports）
    └── styles/
        ├── atlas.css                    # .edges-base / .edges-focus / .edge-labels / .edge-pill 浅色暖纸样式与焦点联动
        └── dark.css                     # .edge-pill 暗色模式配色与聚焦/淡化适配

tests/
├── shared/
│   ├── edge-routing.test.ts             # 重写：全面校验直线化、限幅曲线、隔卡拱桥与滞回、胶囊避卡/短边兜底与 40 节点性能
│   └── prototype-parity.test.ts         # 更新：适配“穿底允许 + 轻量隔卡拱桥 + 单端口顶距/直线化”新契约
└── integration/
    └── dom.test.ts                      # 补充：验证 .edges-base / .edges-focus（仅点击选中触发）/ .edge-pill 与离线导出一致性
```

**Structure Decision**: 严格延续仓库 `src/shared` + `src/client` 单仓库分层结构，不引入任何图形库或状态库，不修改 `src/server/`、`src/client/offline.tsx` 与 `src/client/styles/prototype.css`。通过把繁重的 `edge-routing.ts` 瘦身重写为纯 $O(E)$ 几何函数，并在 `MapScene.tsx` 中用极简双 `<svg>` + HTML 胶囊浮层完成视觉分层，既一次性清理了 1,650+ 行隐患代码，又保持离线导出与宿主侧栏天然 100% 同步。

## 实施顺序（按优先级与重构安全闭环推进）

1. **阶段 1 — 删除冗余逻辑并重写精简几何内核（P1 / `FR-001`–`FR-004`, `FR-008`–`FR-010`）**：
   - 将 `src/shared/edge-routing.ts` 推倒重写为 ~300 行纯局部几何引擎：删除所有采样碰撞、障碍聚类与多段样条，落地 16px 直线化与顺线箭头对齐、限幅单段 $G^1$ 曲线、纯矩形同排/同列隔卡拱桥（含拖拽进出滞回）及 7 点 `pickPillAnchor`。
   - 更新 `src/shared/edge-geometry.ts`：单端口默认顶距 `43`、面对面单端口安全投影对齐及批量 `routeSegments` 串联。
2. **阶段 2 — 客户端四层高亮与自适应关系胶囊渲染（P1–P2 / `FR-005`–`FR-007`, `FR-012`）**：
   - 保护 `src/client/animate-ports.ts` 对无效宽高矩形的边界兜底；
   - 更新 `src/client/components/MapScene.tsx` 拆出 `.edges-base`、`edges-focus`（仅 `selected` 激活，悬停不触发）与 `.edge-labels` 内的 `<ScenePill>`；
   - 在 `src/client/styles/atlas.css` 与 `src/client/styles/dark.css` 落地暖纸浅/深主题胶囊、截断与焦点联动样式。
3. **阶段 3 — 重写测试套件与工程校验（`SC-001`–`SC-006`）**：
   - 重写 `tests/shared/edge-routing.test.ts`、调整 `tests/shared/prototype-parity.test.ts` 并在 `tests/integration/dom.test.ts` 增加胶囊与提层集成校验；
   - 按 `AGENTS.md` 执行 `npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd run pack:plugin -- --dry-run` 校验产物可用（`npm.cmd run test` 仅在用户明确授权时执行）。

## Complexity Tracking

无宪章违规项，且本次实施将净删减约 1,650 行冗余几何代码，显著降低长期维护复杂度。
