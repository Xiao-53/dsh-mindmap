# Implementation Plan: 插件架构隐患排查与健壮性加固

**Branch**: `main`（Spec Kit 功能：`009-plugin-reliability-hardening`） | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from [spec.md](spec.md)、[存储契约](../../docs/mindmap-storage-format.md)、[提示词契约](../../docs/mindmap-authoring-prompts.md) 与 [项目宪章](../../.specify/memory/constitution.md)。

## Summary

针对全仓架构排查识别出的 14 项稳定性与兼容性隐患，在不新增任何第三方运行时依赖、且保持 `map.json` / `layout.json` / `library.json`（`schemaVersion: 1`）向后兼容的前提下，分 5 个能力域进行系统加固：

1. **宿主兼容与启动隔离（P1 / FR-001–FR-003）**：将共享基础库 `zod` 移至 `peerDependencies`（`^4.0.0`）并补齐 `dsh.client.inject`；移除死代码 `insertText` 及其内部事件 `'slash/input-insert-text'` 耦合；隔离服务端 `tools`/`skills` 注入与客户端 `remote.$mount`/实时事件监听异常；加固 Zod→`dsh-tools` 参数 Schema 转换器与构建脚本匹配逻辑。
2. **事务删除收敛、目录上限保护与资源回收（P1 / FR-004–FR-007）**：统一工作区 `library.json` 串行队列并引入 `purge` 末段 CAS 重读合并，消除删文件后写索引冲突死锁；目录列举改用无 2000 截断限制的 `ctx.fs.listDir`；新增 `compactRetired` 与 `library.json.retiredCreateIds` 实现空壳标记延迟安全压实与容量预警；新增 `cleanupOrphanAssets` 在编辑会话结束或用户手动触发时安全回收孤儿 `.image.json`（保留编辑期撤销能力）；收敛本地附件仅支持图片格式，非图片本地链接改以只读提示呈现。
3. **监听收敛、快照载荷保护与内存回收（P2 / FR-008–FR-010）**：将 `watchLibrary` 收敛至常数 ≤ 3 条流并消除首次 `ready` 冗余刷新，将单图 `watchPaths` 收敛至去重目录级（常规 4 条流）；`readSnapshot` 对图片资产二次校验改为轻量 `stat`+边界验证并加入 20 MiB 总资源预算保护；修复 `EditSession.acceptReceipt` 及时释放已落盘图片 `pool`；为客户端与服务端所有模块级缓存（`sessions`、`retainedLayouts`、`calls`、`notePaths`、`previews`）加入明确上限、TTL 或生命周期释放。
4. **防打断自动跳转与跨平台快捷键（P2 / FR-011–FR-012）**：为 AI 后台自动打开标记 `autoOpen: true`，在用户编辑/拖拽/引用核对期间改为非阻塞轻量“查看更新”提示，不丢草稿不清空引用，显式外部跳转统一经 `guard()` 保护；画布撤销/重做统一兼容 Windows `Ctrl` 与 macOS `Cmd`（`Z`/`Y`/`Shift+Z`）。
5. **路径规范化与工具失败语义对齐（P3 / FR-013–FR-014）**：新增共享路径规范化模块消除 Windows 盘符大小写与末尾斜杠造成的锁键分裂或误报；工具执行失败改抛结构化 `AtlasToolError`，使 `@deepseek-ai/dsh-tools` 准确标记 `isError: true` 并完整保留 JSON 诊断供模型解析。

## Technical Context

**Language/Version**: TypeScript（Host 与 Client 均面向 ES2023，Node.js ≥ 24.9.0，测试使用 `--experimental-strip-types` 直接运行 TS）。

**Primary Dependencies**: 既有 React 18、Zod 4（改由宿主 `peerDependencies: ^4.0.0` 共享）、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-typert-protocol`、`@deepseek-ai/dsh-client-store`、KaTeX、Marked、JSXGraph、CodeMirror 6、esbuild；零新增外部依赖。

**Storage**: 工作区 `dsh-knowledge-maps/` 下的 `library.json`（延续 `schemaVersion: 1`，新增向后兼容可选字段 `retiredCreateIds`）、各图 `map.json`、`layout.json`、`notes/*.md`、`assets/*.image.json` 与 `.transactions/*`；所有文件读写与删除严格经宿主 `ctx.fs`（`listDir`、`stat`、`readText`、`writeText`、`deleteFile`）与 `ctx.workspaceFiles` 执行，不绕过沙箱。

**Testing**: Node 内置 `node:test` + `jsdom`（`npm run typecheck`、`npm run test`、`npm run build`、`npm run pack:plugin -- --dry-run`），覆盖共享路径与校验、宿主契约与真实 `dsh-tools` 流水线、并发 `purge`/压实/孤儿图片回收、监听收敛与内存淘汰、DOM 交互；DSH Desktop 真机验证按 [quickstart.md](quickstart.md) 由用户人工完成。

**Target Platform**: DSH `0.2.2-alpha.3` ~ `0.2.x`（已验证 `0.2.2-rc.3` / `0.2.2-rc.5`）Windows 与 macOS 桌面端原生右侧栏（及本地/HTTPS 安全上下文；明确不支持非安全 HTTP 远程访问）。

**Project Type**: 单仓库 DSH 原生侧栏学习插件（`src/shared` + `src/server` + `src/client` 三层结构，esbuild 产出 Host ESM 与 Client `__ModuleLoader__` 闭包产物）。

**Performance Goals**: 管理页并发文件观察流收敛至常数 ≤ 3 条（消除 50 导图打开 250+ 条流及首帧重复 `list`）；单图观察流按目录去重收敛至常规 4 条（上限 16）；`readSnapshot` 消除大图资产二次全量字节读取与 SHA-256 重算；编辑保存不再随每次文字自动保存重传已落盘图片。

**Constraints**: 严格保持向后兼容既有地图与 `library.json`（`schemaVersion: 1`）；当前 DSH `0.2.x` 的 `ctx.fs` 尚未提供目录删除 API（已记录于 [research.md](research.md) 与 [docs/mindmap-storage-format.md](../../docs/mindmap-storage-format.md)），本轮不绕过沙箱调用底层目录删除，仅通过 `ctx.fs.listDir` + `ctx.fs.deleteFile` + `library.json` 压实与空目录静默忽略实现安全闭环；孤儿图片仅在编辑会话退出后或用户显式清理时回收，保护编辑期撤销栈。

**Scale/Scope**: 覆盖全部 P1–P3（5 个 User Stories、14 条 Functional Requirements），涉及打包配置、共享层、服务端文件/事务/工具层、客户端适配/状态/侧栏交互层与对应集成测试，并同步更新 [docs/mindmap-storage-format.md](../../docs/mindmap-storage-format.md)。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 规划前检查 | 设计后复核 |
| --- | --- | --- |
| I. 内容生成与界面实现职责分离 | 通过。不改变 AI 只产出 JSON/Markdown、插件维护界面与布局的分工。 | 通过。未改动 `/mindmap` 内容格式规则，工具失败改抛结构化错误后仍保留原 JSON 诊断字段，提示词契约完全一致。 |
| II. 独立数据与稳定身份 | 通过。不破坏稳定 ID 与目录归属原则。 | 通过。`library.json` 保持 `schemaVersion: 1` 并仅增向后兼容可选 `retiredCreateIds`；压实遵循“先写防复活索引、再删标记文件”；孤儿图片仅限通过 `validateImage` 确认的插件自有 `.image.json` 且全图零引用后才条件删除，不碰未知用户文件。 |
| III. 用户控制发送与修改保护 | 通过。不引入自动发送，且加强未保存保护。 | 通过。后台 `autoOpen` 遇到编辑/拖拽/引用核对时转为非阻塞轻量提示，用户点击外部引用统一经 `guard()`；`purge` 采用 CAS 重读合并避免静默覆盖并发索引变更；孤儿图片延迟回收保护编辑期撤销栈。 |
| IV. 官方契约与最小实现 | 通过。核查本地 `@deepseek-ai/*` 源码作为唯一兼容性依据。 | 通过。移除未公开内部事件 `'slash/input-insert-text'`；共享 `zod` 改为 `peerDependencies` 并补全 `dsh.client.inject`；采用官方 `ctx.fs.listDir`/`deleteFile` 与 `dsh-tools` 异常失败契约，不绕过沙箱、零新增三方依赖。 |
| V. 一致呈现与可验证交付 | 通过。不破坏 HTML v17 视觉呈现，且区分自动化验证与真机人工验收。 | 通过。未变更画布视觉模板；明确标记 DSH `ctx.fs` 尚无物理删目录能力以及 DSH Desktop 真机需人工验收，完整核验步骤写入 [quickstart.md](quickstart.md)。 |

## Project Structure

### Documentation (this feature)

```text
specs/009-plugin-reliability-hardening/
├── spec.md                              # 澄清后的功能规范（5 轮澄清已整合）
├── plan.md                              # 本文件（$speckit-plan 产出）
├── research.md                          # Phase 0 宿主契约核查与技术决策
├── data-model.md                        # Phase 1 扩展模型、状态机与缓存/监听预算
├── quickstart.md                        # Phase 1 自动化核验与真机人工验收步骤
├── contracts/
│   └── hardening-contracts.md           # Phase 1 清单、RPC、工具与客户端契约
├── checklists/
│   └── requirements.md                  # 规范质量检查表（16/16 通过）
└── tasks.md                             # Phase 2 产物（由 $speckit-tasks 生成）
```

### Source Code (repository root)

```text
package.json                             # zod 移至 peerDependencies(^4.0.0)+devDependencies；补齐 dsh.client.inject
scripts/
├── build.mjs                            # 加固 jsxgraph/katex 转换校验
└── pack-release.mjs                     # 稳健化 cordis.yml 包名替换校验

src/
├── index.ts                             # 拆分 tools/approval 与 skills 注入并增加注册容错隔离
├── shared/
│   ├── workspace-path.ts                # 新增：跨平台工作区路径与 notePath 规范化比较纯函数
│   ├── library.ts                       # 扩展 librarySchema 可选字段 retiredCreateIds（schemaVersion: 1）
│   └── map-types.ts                     # MapListing 增可选 capacity 容量字段
├── server/
│   ├── map-files.ts                     # list/listEntries 优先 ctx.fs.listDir；统一 isNotFoundError；移除 pdf/txt 内联加载；assets 二次校验改轻量 verify；20 MiB 总资源预算保护；静默跳过已压实空目录并统计 capacity
│   ├── watch-map.ts                     # watchPaths 收敛为去重目录级（上限 16）
│   ├── map-service.ts                   # 统一 __library__ 队列；purge 末段 CAS 合并收敛；新增 cleanupOrphanAssets 与 compactRetired RPC；接入工作区路径规范化
│   ├── edit-service.ts                  # notePaths 加 LRU 上限 128 与 evictEditMemory；大小写一致的 notePath 占用检查；接入规范化路径键
│   ├── cleanup-create.ts                # 接入工作区路径规范化与 retired 目录清理协同
│   ├── purge-map.ts                     # 配合 purge 重试与已完成状态收敛校验
│   ├── prompts/
│   │   └── register.ts                  # 注册容错与同名冲突诊断日志
│   └── tools/
│       └── index.ts                     # 加固 parameters() Schema 转换；previews 加 15m TTL+128 上限+消费删除；检查 retiredCreateIds 防复活；失败抛结构化 AtlasToolError 对齐 isError: true
└── client/
    ├── index.tsx                        # 客户端 remote.$mount 与 registerClient 异常边界隔离
    ├── register-sidebar.tsx             # 移除未使用的 insertText 与 slash/input-insert-text；AtlasNavigation 增 autoOpen
    ├── open-completed-map.ts            # 防御性事件解析、calls 256 上限淘汰、传递 autoOpen: true 与本地目录刷新通知
    ├── host-adapter.ts                  # watchLibrary 收敛至 ≤3 条流且消除首帧 ready 冗余刷新；watch 兼容可选目录；暴露 cleanupOrphanAssets / compactRetired
    ├── edit-session.ts                  # acceptReceipt 清理已落盘 pool 图片；追踪潜在孤儿图片并在安全 detach 触发延迟回收；closeEditSessions 释放干净会话并加 16 上限 + dropEditSession
    ├── AtlasPane.tsx                    # autoOpen 防打断协调与非阻塞“查看更新”提示；外部跳转统一经 guard()；retainedLayouts 清理与上限 32；支持 macOS Meta+Z/Y/Shift+Z；接入 workspaceKey 规范化与手动清理入口
    ├── reference-navigation.ts          # 接入 sameWorkspaceKey 比较
    ├── render-note.tsx                  # link 仅允许 safeHref，本地非图片附件显示明确只读提示
    └── components/
        └── MapLibrary.tsx               # 展示目录容量预警与“清理历史记录”按钮（管理页预警 + 回收站二级入口）

docs/
└── mindmap-storage-format.md            # 同步更新 library.json.retiredCreateIds、本地资源仅限图片与 ctx.fs 目录约束说明

tests/
├── shared/
│   └── workspace-path.test.ts           # 新增：Windows/POSIX 路径与 notePath 规范化单测
└── integration/
    ├── host-contract.test.ts            # 补充清单依赖契约、启动隔离与工具 schema 校验
    ├── client-contract.test.ts          # 移除旧 insertText 断言；补充客户端隔离与畸形事件防御验证
    ├── atlas-tools-internal.test.ts     # 适配并验证 AtlasToolError + 真实 dsh-tools isError: true、previews 淘汰与 retiredCreateIds 防复活
    ├── local-files.test.ts              # 补充 purge 并发 CAS 收敛、listDir 超 2000 项、compactRetired 与 cleanupOrphanAssets 集成验证
    ├── map-files.test.ts                # 补充非图片附件忽略、verify 轻量校验与 20 MiB 载荷上限降级验证
    ├── refresh.test.ts                  # 适配并验证目录级 watchPaths 收敛与 watchLibrary 常数流/无首帧重复刷新
    └── dom.test.ts                      # 补充 autoOpen 编辑/拖拽防打断、引用保留、macOS 快捷键、非图片链接只读提示与清理 UI 验证
```

**Structure Decision**: 延续既有 `src/shared` + `src/server` + `src/client` 三层架构，不引入新目录或新外部框架。仅新增 1 个共享纯函数文件 `src/shared/workspace-path.ts` 统一两端路径规范化语义，所有加固措施均在既有职责模块内最小改动落地。

## 实施顺序（建议分阶段推进）

1. **阶段 A — 共享基础与宿主/打包边界加固（P1 / FR-001, FR-002, FR-003, FR-013）**：
   - 新增 `src/shared/workspace-path.ts`；调整 `package.json`（`zod` 迁至 `peerDependencies`、补全 `dsh.client.inject`）与 `scripts/build.mjs` / `pack-release.mjs`；移除 `register-sidebar.tsx` 死代码 `insertText`；完成 `src/index.ts`、`src/client/index.tsx`、`open-completed-map.ts`、`prompts/register.ts` 与 `tools/index.ts` `parameters()` 的容错隔离加固。
2. **阶段 B — 数据事务收敛、目录压实与资源生命周期（P1 / FR-004, FR-005, FR-006, FR-007）**：
   - 扩展 `library.ts` / `map-types.ts`；改造 `map-files.ts`（`ctx.fs.listDir`、移除 PDF/TXT 内联、`verify`、20 MiB 预算、空目录静默与容量统计）；改造 `map-service.ts`（`__library__` 锁、`purge` CAS 收敛、新增 `compactRetired` 与 `cleanupOrphanAssets`）；更新 `render-note.tsx`、`MapLibrary.tsx` 与 `docs/mindmap-storage-format.md`。
3. **阶段 C — 监听收敛、缓存有界化与防打断交互（P2 / FR-008, FR-009, FR-010, FR-011, FR-012）**：
   - 改造 `watch-map.ts` 与 `host-adapter.ts`（目录级观察、常数 `watchLibrary` 流、去首帧冗余刷新）；改造 `edit-session.ts`（`acceptReceipt` 清 `pool`、延迟触发孤儿图片清理、会话释放与上限）与 `edit-service.ts` / `tools/index.ts` 缓存上限；改造 `AtlasPane.tsx`（`autoOpen` 非阻塞提示、外部跳图经 `guard()`、`retainedLayouts` 清理、macOS 快捷键）。
4. **阶段 D — 工具失败状态对齐与全量核验（P3 / FR-014 + 验证）**：
   - 在 `src/server/tools/index.ts` 落地 `AtlasToolError` 对齐 `dsh-tools` `isError: true`；更新并补全全部单测与集成测试；运行 `npm run typecheck`、`npm run test`、`npm run build`、`npm run pack:plugin -- --dry-run` 核验后，交付用户按 [quickstart.md](quickstart.md) 完成 DSH Desktop 真机人工验收。

## Complexity Tracking

无宪章违规项，无需额外复杂度豁免。
