# Tasks: 导图手动编辑、自动保存、分组排版与操作历史

**Input**: `specs/002-edit-layout-history/` 的 [spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/editor.md](contracts/editor.md)、[quickstart.md](quickstart.md)。

**Prerequisites**: 以上设计已生成；以规范顶部 2026-11-18 自动保存增量覆盖原显式保存/取消描述。当前 Git 分支 main。

**Tests**: 不采用 TDD，不新增界面自动测试任务，不运行浏览器或视觉检查。人工验收由用户执行；内部提交/恢复证据另行明确授权后验证。任务中的条件验证不是本轮授权，未执行保持未勾选。构建打包不代表验收通过。

**Organization**: 按 US1 详情与图片、US2 排版、US3 历史分组，三者均为 P1。编号接续全项目现有最大 T145，避免与旧任务重复。2026-11-18 用户授权本轮同步任务后继续 implement；实现和验收仍分别记录。

## Format: `[ID] [P?] [Story] Description`

- `[P]` 表示在所列前置条件完成后，可与指定不同文件任务并行；不意味着现在启动代理或跳过前置任务。
- `[US1]`、`[US2]`、`[US3]` 对应规范故事；路径相对仓库根目录，标明新增文件处待实施时创建。
- 实现、内部验证、人工验收分别勾选；没有用户结果不代为勾选验收。不得自行推送、发布或升级依赖。

## Phase 1: Setup — 既有工程与契约对齐

**Purpose**: 复用现有工程，不重新初始化、不增加框架、测试平台或占位目录。

- [X] T146 在 specs/002-edit-layout-history/research.md 核对并记录实施起点：package.json 的 DSH 0.2.2-rc.3/Node >=24.9.0、现有 Git 修改及官方 node_modules/@deepseek-ai/dsh-fs/src/index.ts 的条件文本写、sidebar-right 关闭能力；仅发生契约变化时修订设计，不猜测 writeBytes/beforeClose。
- [X] T147 在 docs/mindmap-storage-format.md 补充本增量的 layout v2、文本图片资源、仅会话草稿/历史和旧版拒读边界，并在 specs/002-edit-layout-history/contracts/editor.md 明确受限请求与验证门槛；同步旧契约但不改 map.json 的知识职责或恢复旧命令。（依赖 T146）

## Phase 2: Foundational — 共用提交与会话保存

**Purpose**: 统一基础类型、事务入口、错误、保存生命周期与变更通知，供三个故事复用。

- [X] T148 在 src/shared/map-types.ts、src/shared/validate-layout.ts 定义读 v1/v2、写 v2 的布局类型与 ReadResult；落实“schemaVersion:2, mapId, views”“mode:vertical|grid|columns”“读取 v1 时界面/命令默认 mode 为 vertical，保留原始对象及坐标”“未知版本/非法坐标拒绝”；节点 x/y 有限、width 为正、manual 为布尔，组尺寸为正，身份唯一/mapId 匹配；完整结果为“MapSnapshot 顶层字段、writable:true、diagnostics:[]”，降级结果“writable:false”且“不提供可用于写入的完整 fingerprint”。（依赖 T147）
- [X] T149 在 src/server/edit-service.ts（新增）、src/server/tools/index.ts 抽取现有候选叠加、完整读集校验、指纹复核、事务提交和回执读取；UI 与 AI 共用服务，保留原 atlas_* 工具公开 schema、预览/授权及行为，不向模型开放布局/路径参数。（依赖 T148）
- [X] T150 在 src/server/transaction.ts、src/server/tools/storage.ts 完善提交请求摘要和小型回执：提供不重放写入的 operationId 回执查询；同 operationId 同请求可重试，不同摘要报 operation_conflict；区分响应丢失后的已提交状态和后来外部版本，保留条件写、活动认领、取消后回退，不按超时接管；不在摘要/回执中复制图片 payload。（依赖 T149）
- [X] T151 在 src/server/map-service.ts 增加 commitEdit 严格请求边界，要求 op/mapId/expectedWorkspaceKey/expectedFingerprint/operationId，edit 仅 details 或 layout；绑定现有 workspaceFileScope/Gateway 权限及 serializeMap，拒绝任意文件清单，结构化返回 code/message/diagnostics/operationId/提交状态；正常成功含 committedFingerprint/snapshot/noChange。未通过验证的新写分支不得对用户开放。（依赖 T150）
- [X] T152 在 src/client/host-adapter.ts 保留结构化错误并增加 commitEdit，读取完整/降级结果；重试保持原请求及 operationId，新的动作或撤销使用新 ID；禁止降级结果作写入基线，回执已提交但快照前进时进入冲突处理。（依赖 T151）
- [X] T153 在 src/client/edit-session.ts（新增）实现会话级协调器与订阅：key 为“sessionId + workspaceKey + mapId”，回调核对 generation；保存 baseline/working/inputDraft/localRevision/persistedRevision/inFlightRevision，状态为“clean / dirty / saving / failed / conflict / recovery_required / readonly”；每图串行队列、操作前后值事件及去重 resourcePool；新输入不被旧回执覆盖，失败保留副本，retry 不重复动作，后台 saveLayout 与编辑队列互斥。（依赖 T152）
- [X] T154 在 src/client/register-sidebar.tsx、src/client/AtlasPane.tsx 将协调器置于插件会话生命周期，面板仅订阅；落实“面板 tab.signal 不用于中止已认领的保存/回退”，输入变化即捕获、宿主直接关闭后继续有效批次并保留失败草稿，重开复核后恢复/放弃；隐藏或折叠不清会话，关闭/切图发出历史结束事件，不承诺进程退出落盘。（依赖 T153）
- [X] T155 在 src/client/refresh-map.ts、src/client/AtlasPane.tsx 统一自有提交通知与外部变化：按回执/指纹识别自有写，刷新不得覆盖续输；外部新版本冻结旧基线，无本地修改时载入外部即清历史并提示；有本地修改先进入冲突，最终载入外部后清历史；failed/conflict/recovery_required 禁止盲目排队重写，保留原手动布局与可读旧画面。（依赖 T154）
- [ ] T156 在 specs/002-edit-layout-history/quickstart.md 和 docs/validation/edit-layout-history-internal.md（新增）列出共用提交验证证据与精确运行范围：幂等、响应丢失、取消回退、外部并发、跨 Host 认领、权限和只读拒写；复用 tests/integration/transaction.test.ts、tests/integration/atlas-tools-internal.test.ts，仅在用户另行授权后补充必要案例并执行指定内部测试，不运行 npm test/UI 测试；记录实际结果，证据不足保持新写入口关闭。没有授权时此项保持未完成，继续不依赖实际写入的实现。（依赖 T155；实际写入开放门槛）

**Checkpoint**: T148～T155 为实现基础；T156 是新通用写入口开放门槛，不阻止完成候选、算法和界面开发。阶段布局不是恢复旧五阶段开发顺序，也不是新增授权请求。

## Phase 3: User Story 1 — 详情、图片与自动保存 (Priority: P1)

**Goal**: 在详情内编辑标题/摘要/正文，管理本地图片，自动保存并保持共享节点一致、失败不丢内容。

**Independent Test**: 使用已有详情与无正文节点，停顿保存后重开；导入三种图片后移动原文件并离线阅读；正文图片移除不影响另一共享引用。历史恢复部分在 US3 集成后联合验收，不阻止独立检查编辑/图片链路。

- [X] T157 [P] [US1] 在 src/shared/image-resource.ts（新增）定义 ImageAsset 校验，逐项落实 schemaVersion“1，独立于 map/layout 版本”、kind“固定 image”、id“客户端随机生成的操作内稳定资源 ID，Host 严格验证；无文件路径语义”、mimeType“image/png、image/jpeg、image/webp”、encoding“固定 base64”、byteLength“解码后的正整数长度，受限额保护”、sha256“Host 对解码字节复核，不信任来参”、data“规范 base64，无任意 URL 或脚本”；单张 8 MiB、单提交新增图片 16 MiB、编码请求 24 MiB、序列化事务日志 48 MiB 在写入前校验，保留草稿并定位超限项。（依赖 T148；与 T161 可并行）
- [X] T158 [US1] 在 src/server/map-files.ts 增加 assets/<id>.image.json 严格读取/解码、MIME/字节头/长度/摘要复核，保持原 PNG/JPEG/GIF/WebP 二进制资源读取；路径相对 notePath 解析并检查真实 assets 边界。UI 图片缺失/损坏返回逐项只读降级，正文仍可读；非法结构和越界路径继续拒绝，提交候选一律严格读取。（依赖 T157、T148）
- [X] T159 [US1] 在 src/server/transaction.ts、src/server/tools/storage.ts 仅扩展受控 assets/<id>.image.json 白名单，落实“同 ID 同摘要可复用；同 ID 不同内容拒绝”“资源不可变、仅 createIfAbsent”“新资源与引用正文同一事务发布”；失败只删除本事务新建且版本匹配的资源，不删共享、未知或外部已修改文件，历史淘汰/撤销引用不触发清理。（依赖 T158、T150）
- [X] T160 [US1] 在 src/server/edit-service.ts 实现 details 候选，UI 仅改 title/summary/markdown；落实“标题 trim 后不能为空；摘要/正文可空”“空正文无既有笔记时不创建空文件”“清空既有正文走 remove_note，撤销恢复原 notePath 和正文”；Host 保留原合法路径/分配默认路径，禁止不同 nodeId 非法共用可写 notePath，图片 ID 推导路径且资源与正文一起验证，不改无关节点/关系/坐标。（依赖 T159）
- [X] T161 [P] [US1] 在 src/client/components/NoteInspector.tsx、src/client/styles/atlas.css 添加标题、摘要、Markdown 输入和安全预览，明确共享节点影响；每次输入同步通知协调器，保留 input/textarea 原生撤销及 IME，不引入富文本库。阅读和编辑均可发现，离线不显示编辑入口；无效输入保留草稿，不恢复已自动保存内容的旧“取消”语义。（依赖 T153；与 T157 可并行）
- [X] T162 [US1] 在 src/client/edit-session.ts 实现 800ms 无新输入且 composition 结束后关闭批次、失焦/受控离开 flush、图片动作立即批次；保留批次开始 before 和完成 after，保存期间续输另成下一批次。一次有效批次一次动作通知，无效/空操作不计步；协调器调用 T160 的 details 提交，保持本地与磁盘状态独立。（依赖 T160、T161、T153）
- [X] T163 [US1] 在 src/client/components/NoteInspector.tsx 增加本地 PNG/JPEG/WebP 选择、解码预览、当前正文位置插图和指定引用移除；临时 URL 不落盘，取消选择不计步；多字段/图片合入当前批次后立即提交，图片 bytes 进入去重资源池，移除引用不删资源，错误定位图片且不破坏文字撤销。（依赖 T157、T162）
- [X] T164 [US1] 在 src/client/AtlasPane.tsx、src/client/components/SaveStatus.tsx 接入自动保存状态与插件可控切节点/切图/关闭 flush：成功直接离开，仅失败/冲突/无效草稿提示重试、保留并取消离开或明确放弃；更新卡片、详情、搜索、共享节点内容，宿主关闭重开显示未完成副本处理，不向 DSH 输入框发送内容。（依赖 T163、T154、T155）
- [X] T165 [US1] 在 src/client/render-note.tsx、src/client/export-html.ts、src/client/offline.tsx 复用解码 resources 显示图片与缺失诊断，设置保持比例/适应详情宽度；全图导出先 flush 当前有效修改，失败或只读降级不伪装完整最新导出。离线文件仅含内容、必要资源和阅读功能，不含历史、会话、本机路径或宿主编辑动作。（依赖 T164、T158）
- [ ] T166 [US1] 在 docs/validation/edit-layout-history-internal.md 补充并取得图片联合提交证据：图片创建/正文/回执各阶段失败、条件回退、资源外部变化、编码及日志上限、响应丢失、取消、读取降级拒写；另获内部专项授权后在 tests/integration/transaction.test.ts、tests/integration/atlas-tools-internal.test.ts 实施必要验证并记录实际结果，未通过保持 details 写入口关闭，不以旧内部记录替代。（依赖 T156、T160、T165；实际图片写入开放门槛）
- [ ] T167 [US1] 由用户按 specs/002-edit-layout-history/quickstart.md 执行详情自动保存、连续输入、IME、无效标题、宿主直接关闭重开、共享图片、原图移走后离线阅读、外部冲突与降级阅读场景，在 docs/validation/edit-layout-history.md（新增）记录通过/失败/未执行及 SC-001；Agent 只记录用户结果，图片撤销另见 T183。（依赖 T166；候选产物由 T185 提供）

**Checkpoint**: 详情与图片可独立交付验证；本版完整发布仍须 US3 撤销保护及 US2 排版。T167 未执行不把实现状态冒充验收通过。

## Phase 4: User Story 2 — 分组排版与一键重置 (Priority: P1)

**Goal**: 在“全部导图”旁选择纵向、田字型，分组 ≥7 时另可选多列，单击重置当前视图到默认纵向，自动保存模式及位置。

**Independent Test**: 不编辑详情，使用现有地图切换三模式、拖动、重置和重开，核对其他视图/知识未变、全部节点可访问；撤销重置在 US3 联合验收。

- [X] T168 [P] [US2] 在 src/shared/layout.ts 新增 relayoutView，先按实测卡片及现有三列组内顺序求矩形，再按 vertical 纵排、grid 两列按行、columns 在 7～12 组 3 列/≥13 组 4 列按行排列；grid 与 columns 均用行最大高度/列最大宽度，结果平移到正坐标。落实“显式重排清除目标视图 manual 标记，其他视图原样保留”“无组节点用临时 bucket 参与排布，不持久化虚构 Group”，同内容与尺寸结果确定。（依赖 T148；与 T170 可并行）
- [X] T169 [US2] 在 src/shared/layout.ts、src/client/measure-nodes.ts 修正普通 fillLayout：保留已有节点和模式，仅补缺项并扩展组边界；内容变长不暗中重排旧坐标。区分缺布局、v1 内存归一化和实际布局修改，只在真正保存新布局时输出 v2，详情保存和单纯阅读不顺带升级。（依赖 T168）
- [X] T170 [P] [US2] 在 src/client/components/MapHeader.tsx 添加 `.atlas-path-row .atlas-host-tools` 中“全部导图”旁模式选择和同一行重置，映射“纵向（默认）/vertical、田字型/grid、多列/columns”，按当前视图分组数只列出可用模式（grid ≥2 组、columns ≥7 组；不可用的已保存模式仍显示为当前项且不自动重排），显示当前模式、键盘标签和不可用状态；重复选择当前模式不发动作，窄栏可达且不挤掉必要导航。（依赖 T148；与 T168 可并行）
- [X] T171 [US2] 在 src/server/edit-service.ts 实现 layout 候选，仅接受目标 viewId 的合法节点/分组和有限正尺寸，替换目标 ViewLayout 并严格复核其余视图未变；内容与资源不改，版本基线、幂等回执及新格式通过共用提交保护。（依赖 T149、T151、T169）
- [X] T172 [US2] 在 src/client/AtlasPane.tsx、src/client/edit-session.ts 接入模式切换/重置命令：测量就绪后一次发布目标视图，立即自动保存并发出完整 before/after 动作；重置重算 vertical 与 manual:false，空图/无变化不计步，保存失败保留本地模式位置，普通导航不重排。（依赖 T170、T171、T153；与 T162 对共享文件修改串行整合）
- [X] T173 [US2] 在 src/client/components/MapScene.tsx、src/client/components/MapViewport.tsx 调整正坐标画布边界及适配，确保空组、无组节点、大小悬殊组、多行多列边界均可平移访问；保持端点和连线跟随及既有风格，不删边/藏节点来减少交叉，不改子图 0.5 秒过渡。（依赖 T172）
- [ ] T174 [US2] 在 docs/validation/edit-layout-history-internal.md 记录 layout v1 读/不写、v2 条件保存、未知版本拒绝、目标视图隔离、自动补位与编辑竞争、重排响应丢失等保存证据；若需内部执行须另获授权并仅补充 tests/integration/atlas-tools-internal.test.ts 的对应范围，未验证保持新布局提交入口关闭，不把实际旧版兼容检查变成静默迁移。（依赖 T156、T173）
- [ ] T175 [US2] 由用户按 specs/002-edit-layout-history/quickstart.md 在 docs/validation/edit-layout-history.md 记录 0/1/2/6/7/12/13 组和 120 节点可用模式及模式失效后保留坐标、重置/重开/其他视图隔离；记录 SC-002 的 2 秒目标、三张固定图 SC-003 至少两张交叉减少 20% 的前后数量及环境，未达标如实记失败，不自行浏览器验收。（依赖 T174；候选产物由 T185 提供）

**Checkpoint**: 排版可在既有内容地图独立检查，不依赖图片编辑；重置的一步撤销依赖 US3。

## Phase 5: User Story 3 — 30 步撤销与重做 (Priority: P1)

**Goal**: 对详情自动保存批次、图片、拖动和排版提供按时间排序的 Ctrl+Z/Y 历史，保证焦点隔离、保存保护与跨子图定位。

**Independent Test**: 先仅拖动既有节点 31 次验证 30 步边界，再混合 US1/US2 操作验证内容和位置恢复；重做分支与焦点不依赖新排版算法。

- [X] T176 [P] [US3] 在 src/client/edit-history.ts（新增，供 edit-session.ts 调用）实现 HistoryEntry/HistoryCursor：字段 entryId、“kind(details/move/layout)”、viewId、“可选 nodeId”、before/after/assetIds/localRevision；“entries 最多 30 项”“追加有效动作先删 cursor 后分支，再追加；溢出删最早项并调整 cursor”“undo/redo 不新增条目”，历史只保留局部前后值/资源引用，“不可存整图 base64 副本”；无效/空操作、导航、缩放不新增。（依赖 T153；与 T177 可并行）
- [X] T177 [P] [US3] 在 src/client/components/MapScene.tsx、src/client/components/NodeCard.tsx 将拖动 start/commit/cancel 规范化为单动作边界：保存完整起始 NodeLayout，取消恢复 x/y/manual 及脏状态，最终位置无变化不计步，正常松手“拖动设置该节点 manual:true”；保留 7px 阈值、连线跟随与点击抑制。（依赖 T148、T153；与 T176 可并行，和 T173 不同时编辑 MapScene.tsx）
- [X] T178 [US3] 在 src/client/edit-session.ts 将 T162 详情批次、T172 布局及 T177 拖动动作接入统一历史；一次批次内字段/图片合并、一次拖动/模式/重置一项，失败重试不重复。旧阅读前进后退历史独立；新增有效编辑清重做分支，资源共享引用不被历史淘汰清理。（依赖 T176、T177；对应适配需要 T162、T172）
- [X] T179 [US3] 在 src/client/edit-session.ts、src/server/edit-service.ts 实现 undo/redo 的受控提交：前后内容与 notePath 语义/图片引用/布局模式一并恢复，以当前 baseline 和新 operationId 保存；“自动保存失败不回退本地 cursor，重试不追加历史”“保存中/普通失败时 undo/redo 仍改本地并标记未保存，恢复后按 nodeId/viewId 比较 working 与 baseline，逐目标串行提交净差异最终状态，成功目标单独更新基线，净差异为空不写入”“提交状态未确定先查原 operationId 回执，冲突/待恢复时暂停图级 undo/redo”，已提交结果可重开读取。（依赖 T178、T160、T171）
- [X] T180 [US3] 在 src/client/AtlasPane.tsx、src/client/focus-management.ts 实现局部 Ctrl+Z/Y，过滤 input/textarea/select/contenteditable、composition、event.repeat、模态输入及 conflict/recovery_required（普通 saving/failed 不禁用本地撤销）；有效命令才阻止默认事件，画布鼠标操作后恢复焦点，不安装全局撤销监听或抢占 DSH 输入框，空历史不修改地图。（依赖 T179）
- [X] T181 [US3] 在 src/client/edit-session.ts、src/client/AtlasPane.tsx 接入跨子图恢复定位和历史生命周期：同图切子图保留历史，撤销目标布局定位视图、详情定位节点；正常关闭/切图及宿主直接关闭结束旧历史，隐藏/折叠不清除；未保存草稿与旧历史分离，重开先复核磁盘再恢复，外部更新禁止重放旧历史；外部版本（含 AI 工具修改）载入后清空 entries/cursor 并提示“导图已被外部更新，撤销记录已清空”，自有提交回执不清。（依赖 T180、T154、T155）
- [ ] T182 [US3] 在 docs/validation/edit-layout-history-internal.md 记录 undo/redo 版本条件、响应丢失、失败保留 cursor、重试不重复、保存续输/关闭竞争、资源撤销重做与跨工作区隔离证据；需要内部执行时另获授权，仅补充现有 tests/integration/atlas-tools-internal.test.ts 的相关案例，不扩展到 UI 自动测试；未取得证据不得声明新恢复路径安全通过。（依赖 T181、T166、T174）
- [ ] T183 [US3] 由用户在 docs/validation/edit-layout-history.md 按 specs/002-edit-layout-history/quickstart.md 记录 31 次混合动作、30 次撤销/重做、重置一次撤销、拖动取消、输入焦点/IME、跨子图/跨地图、关闭重开和外部冲突结果，对应 SC-004～006；文字停顿按自动保存批次统计，未执行项保持未完成。（依赖 T182；候选产物由 T185 提供）

**Checkpoint**: 三个故事的混合历史完整，内容、布局、图片与保存状态可独立核对；不以按钮可点击代替 30 步验证。

## Phase 6: Polish & Cross-Cutting Concerns — 交付与状态对齐

- [X] T184 在 docs/plugin-development.md、docs/mindmap-storage-format.md、docs/mindmap-authoring-prompts.md 同步最终自动保存、图片封装、layout v2/旧版拒读、会话恢复及当前实际入口说明；核对模型仍只提供知识内容、无坐标/任意资源路径；不恢复 /minimap 或扩大公开工具范围。（依赖各故事实现落定，不要求人工验收先通过）
- [X] T185 根据 package.json、scripts/build.mjs 执行 npm run pack:plugin 生成用户可安装候选，在 docs/validation/edit-layout-history.md 记录准确文件名、实际开放入口、验证门槛和未验证项；可在各故事就绪后重复用于人工交接，禁止以构建当验收、自动安装/发布或附带 npm test/typecheck。（依赖所交付故事实现及相应内部写入门槛；不依赖 T167/T175/T183，避免验收循环）
- [ ] T186 在 specs/001-sidebar-knowledge-atlas/tasks.md、docs/validation/release-status.md 根据实际实现与用户验收反馈注明旧 T047～T051 的已覆盖子集和剩余范围，链接本增量任务；不将 T048 的完整节点/关系/分组编辑或无关旧专项一并勾选，不改既有用户修改。（依赖 T167、T175、T183，失败/未执行仍原样标识）
- [ ] T187 在 specs/002-edit-layout-history/tasks.md、docs/validation/edit-layout-history.md 完成最终静态范围/文件链接/完成状态核对并检查 Git 状态，列出安装产物、已验证项、未验证项和风险；只在证据对应时勾选相关任务，不自行推送、发布或继续下一 Spec Kit 步骤。（依赖 T184～T186）

## Dependencies & Execution Order

### Phase Dependencies

```text
T146 → T147 → T148 → T149 → T150 → T151 → T152 → T153 → T154 → T155
                                                基础实现就绪 ──┬─ US1 实现 T157～T165
                                                              ├─ US2 实现 T168～T173
                                                              └─ US3 核心 T176～T177
US1/US2 动作就绪 + US3 核心 → T178～T181 混合集成
共用写入证据 T156 → US1 图片证据 T166 / US2 布局证据 T174 → US3 恢复证据 T182
故事实现 + 对应写入证据 → T185 候选构建 → T167 / T175 / T183 用户人工验收
最终实现 → T184 文档；人工结果 → T186 状态对齐 → T187 交付核对
```

T156/T166/T174/T182 中执行内部验证需授权与真实证据；缺少授权时先完成其余实现和可读预览，保留未完成标记，不能绕过门槛开放新的写入路径。无需在本轮征求未来测试授权。

### User Story Dependencies

- US1 可在基础实现后独立开发和验证编辑/图片；其撤销验收由 US3 汇合，不用等待新排版。
- US2 可在基础实现后独立开发，使用已有内容地图；其重置撤销验收由 US3 汇合，不依赖 US1 图片。
- US3 核心和拖动可先做，混合详情/排版历史集成依赖 T162/T172；不能宣称三个故事完全无依赖。
- 同文件任务顺序整合：edit-session.ts 的 T153→T162/T172→T178～181，AtlasPane.tsx 的 T154→T155→各故事集成，transaction.ts 的 T150→T159，edit-service.ts 的 T149→T160/T171→T179。无论故事是否并行，都不能覆盖对方更改。
- T185 是可重复执行的候选构建，不等待用户验收；每次代码修正后只重做必要构建与受影响验证，不要求重复无关检查。

### 旧任务复用映射

| 原任务 | 本轮对应 | 保留边界 |
| --- | --- | --- |
| T047 | T153～155、T162、T176～181 | 仅本轮编辑/历史/自动保存范围，不自行扩大通用会话功能 |
| T048 | T157～165 | 只标题/摘要/正文/图片；结构 CRUD 未纳入 |
| T049 | T168～174、T177～181 | 复用已有拖动，只补排版/重置/撤销及取消语义 |
| T050 | T149～156、T164 | 复用现有工具提交，不另建 UI 文件写链 |
| T051 | T167、T175、T183 | 按实际用户结果记录本轮子集，旧量化专项不自动通过 |

## Parallel Examples

- **US1**：基础就绪后，T157 的 image-resource.ts 校验与 T161 的 NoteInspector.tsx/样式可并行；后续 T158～160 与 UI 结果在 T162 汇合。T163 与 T161 都改 NoteInspector.tsx，不能同时做。
- **US2**：基础就绪后，T168 的布局算法与 T170 的 MapHeader.tsx 控件可并行，T172 集成前均须完成；T173 与 US3 T177 共享 MapScene.tsx 必须串行。
- **US3**：基础就绪后，T176 的独立 edit-history.ts 与 T177 的拖动边界可并行，T178 汇合；快捷键 T180 必须等历史提交行为 T179 就绪。

共 6 项 `[P]`，构成三组明确机会；标记不自动授权并行代理执行。

## Implementation Strategy

1. 先对齐契约并复用保存基础，所有新写入始终受门槛约束；没有证据时仍可完成候选、界面和算法。
2. 建议最小可验收切片为 US1 自动保存详情/图片，加 US3 的基础撤销保障。US1 编辑和图片可单独检查，但不把缺失撤销的切片标为本版完整完成。
3. 并行机会仅限列明的不同文件；可按 US1→US2→US3 顺序实现，避免共享组件冲突。现有拖动可先用于 US3 的独立历史检查。
4. 生成候选后交用户分别验收，再核对跨故事混合操作；失败记失败，未执行记未执行。完整首版包含全部三个 P1 故事。

## Completeness & Format Validation

| 需求范围 | 实现/验证任务 |
| --- | --- |
| FR-001～006、自动保存增量、SC-001 | T148～167；关闭/冲突重点 T153～155、T164 |
| FR-007～011、SC-002～003 | T168～175 |
| FR-012～016、SC-004～006 | T176～183，复用 T153～155、T162、T172 |
| FR-017、旧格式/资源兼容、离线边界 | T146～152、T158～165、T173、T184～187 |

共 **42 项**：Setup 2、基础 9、US1 11、US2 8、US3 8、收尾 4。任务 ID 为 T146～T187，使用复选框分别记录实现和验证状态；故事任务均带对应 US 标签，各任务包含具体文件路径。每个故事均有独立验收标准、实现任务和单独人工结果任务，未创建新测试框架。

## Notes

- 本轮前后检查均未发现 `.specify/extensions.yml`，无钩子需执行。
- 已有 README.md 修改保持不动；已运行构建及打包，未运行产品测试、类型检查或浏览器验收。
- 本轮依据用户明确授权在 tasks 后继续 implement。标记完成的 32 项表示对应代码/契约已落实，不表示运行验证通过；不自行进入下一 Spec Kit 步骤。


## 2026-11-18 实施结果

32/42 项已完成代码/契约工作，10 项保持未完成。详情见 [交接记录](../../docs/validation/edit-layout-history.md)。

- T156/T166/T174/T182：已列明精确内部场景，未获本增量执行授权，未编写或运行新专项测试；新提交门槛继续关闭。
- T167/T175/T183：没有用户运行结果，均未验收，不填写性能/交叉减少的虚构数字。
- T185：`0.4.0-preview.1` 预览候选已构建打包；可实际保存的完整候选仍未交付，因此任务保持未完成。
- T186：已追加旧任务范围映射与当前状态；按用户验收结果完成最终覆盖核对仍待进行。
- T187：本轮静态检查、文件链接、Git 状态与预览交接已完成；依赖完整写入候选/最终验收的首版收尾仍未完成。

实现落点细化：NodeEditor.tsx 为 NoteInspector 的输入组件；HistoryEntry 的 move 只保留目标 NodeLayout；editStatus 在同一 MapService 提供只读回执查询；布局保存仅替换目标视图，其他视图除升级必需的默认 mode 外不改坐标。keepMounted 与同步 close handler 分别处理隐藏和关闭，不能当作异步关闭守卫。


## preview.2 交互与保存增量

用户要求以一个小按钮在当前可用排列中顺序切换，并直接编辑笔记，不再显示编辑/阅读开关。界面及对应保存入口已更新。用户授权保存专项后，两份现有内部测试文件共 17 项通过，实际自动保存已开放，T185 的可保存候选已构建。各专项任务中仍需实机或进一步取证的部分保留，人工验收未执行。见 [交接记录](../../docs/validation/edit-layout-history.md)。
