# Tasks: 节点正文 Markdown 实时预览编辑

**输入**　[功能规范](spec.md)、[实施计划](plan.md)、[技术调研](research.md)、[数据模型](data-model.md)、[交互契约](contracts/live-preview.md)和[验收指南](quickstart.md)。

**编号**　沿用仓库现有的全局任务编号，从 T231 开始。所有路径相对于仓库根目录。标有 `[P]` 的任务可在列出的前置任务完成后并行，`[US1]` 至 `[US3]` 对应用户故事。

**验证**　故事下的独立验收条件用于候选交付与人工复验。构建、类型检查和静态核对记录实际结果。自动测试、浏览器检查及内部故障注入依项目约定另行授权。

## 阶段 1　准备

**目标**　为现有插件引入在线编辑所需依赖，复用现有构建。

- [X] T231 在 `package.json` 和 `package-lock.json` 锁定互相兼容的 CodeMirror 6 state、view、commands、language、lang-markdown 依赖。Markdown 包至少 6.5.0 且公开导出可配置的列表回车命令。核对依赖树共用一个状态模块，确认在线闭包可打包依赖，保留工作区中无关包配置改动。

## 阶段 2　基础能力

**目标**　处理源码、保护、历史和保存，使正文格式和控件都复用同一条变更路径。

- [X] T232 [P] 在 `src/client/note-editor-source.ts` 建立 LF 编辑文档和原文的双向 UTF-16 边界映射。保留「CRLF、LF、单独 CR、结尾空行及未改变的围栏定义」。用事务前的坐标一次映射全部变更，只拼接改动范围。「新行遵循原文的首个换行风格，空笔记默认 LF。」核对候选原文的归一化结果与编辑事务一致。为后续 DSH 定位提供可拒绝 CRLF 中间和 Unicode 代理对中间的映射。
- [X] T233 [P] 在 `src/client/note-editor-history.ts` 适配既有正文 `BodyAction` 规则。「由同一次文档变更的原文、选区前后值和操作类别组成」，记录选区方向并支持跨混合换行的精确恢复。依现有规则合并连续输入、保留最近 30 步、结束分支时丢弃相应重做条目。选区、滚动和自动保存回执不创建正文条目。回放只接受当前编辑身份下经过记录的变更。
- [X] T234 在 `src/shared/note-markdown.ts` 核对并复用 `lexNote`、`noteBlocks` 及现有范围逻辑，按需补足嵌套列表、引文、重复 token 与旧换行的定位。返回可用源码验证的公式和图表范围，保留公式类别、起止点、定界符和表达式，图表支持既有 ID 和坏块诊断。无法可靠定位的公式保留可编辑原文。禁止把渲染 DOM 或首次同名子串当成编辑位置。
- [X] T235 在 `src/client/note-editor-source.ts` 接入候选事务保护。对普通键入、剪切、粘贴及范围替换，在原始 Markdown 上运行 `sameNotePlots` 等现有校验，检查图表围栏原文、顺序及由块外编辑导致的解析变化。坏块原文保持。只有经明确命令验证的整图变更和与当前正文匹配的历史回放可改变图表集合或顺序。拒绝时保留原文、选区和历史并使用现有图表提示。
- [X] T236 在 `src/client/components/MarkdownNoteEditor.tsx` 建立真实 `EditorState` 与 `EditorView`，保留文档、选区方向及可见正文位置。编辑实例「绑定当前会话、工作区、地图、节点及出现视图」，相同节点跨视图复用同一笔记。为异步操作提供可复核身份。真文档变更才接入 T232、T233、T235，当前只读或冲突状态拒绝本地文档写入。明确编辑扩展、资源控件及引用回调的接入边界。
- [X] T237 在 `src/client/components/MarkdownNoteEditor.tsx`、`src/client/edit-session.ts` 接通 `EditSession.input`。普通停顿约 800 毫秒提交，中文组字期间暂停并维持组合范围，确认或取消后恢复既有草稿的提交安排。保留本地正文及选区以应对延迟回执。相同正文的保存回执只更新基线，外部版本实际载入、丢弃草稿、改变正文的导图历史回放或编辑实例失效时同步现有内容并清理过期正文历史。沿用失败重试、冲突与同会话关闭恢复。

**完成条件**　基本正文事务经坐标映射和受保护块校验进入既有编辑会话，纯展示变化不触发写入。

## 阶段 3　用户故事 1：在阅读排版里连续编辑正文（P1，MVP）

**目标**　通过「复制内容」旁的「编辑」原位编辑正文，用光标和选区控制格式标记显示。可在列表中正常回车、退格及粘贴。

**独立验收**　使用长笔记对照三种标题、加粗、斜体、组合格式和两类列表。切换模式仍看到原段落，移动光标可进入真实标记。验证列表续写、空项退出、退格合并、选择、粘贴和中文输入。详见[验收指南第 2 节](quickstart.md#2-排版选区与输入sc-001sc-002)。

- [X] T238 [P] [US1] 在 `src/client/note-editor-format.ts` 用当前 Markdown 语法树给标题、列表、强强调、强调及嵌套组合应用样式和标记装饰。活动行或与选区相交的格式显露其真实字符；范围外保留排版。避免误处理转义、代码、公式等不透明片段。视口、选区和语法树变化时刷新必要装饰，组字时暂缓改变组合区域位置的替换。
- [X] T239 [P] [US1] 在 `src/client/note-editor-keys.ts` 配置 `insertNewlineContinueMarkupCommand({ nonTightLists: false })`、`deleteMarkupBackward` 及基础键位。补齐紧密列表第二空项退出、嵌套退层、同级相邻条目合并。保留作用层级、未触及条目、预期编号和合并点。对普通选区、代码与仍在组字的输入使用对应的基础或平台行为。
- [X] T240 [P] [US1] 在 `src/client/styles/atlas.css` 将已有正文排版复用于读态和 CodeMirror 显示。保持侧栏宽度、换行、缩进、字距和行距。正文一至三级的色彩、字重及字号易辨，正文一级低于节点主标题。布局适配现有窄侧栏和焦点提示。
- [X] T241 [US1] 在 `src/client/index.tsx`、`src/client/AtlasPane.tsx`、`src/client/components/NoteInspector.tsx`、`src/client/components/NodeEditor.tsx` 和 `src/client/components/MarkdownNoteEditor.tsx` 接通在线编辑组件、格式、列表键位与只读投影。保留标题、摘要和「编辑／完成」入口，以可见段落恢复读写切换位置。编辑器获得焦点时 Ctrl+Z／Ctrl+Y 进入一次正文历史回放，画布焦点仍由 `EditSession` 管理导图历史。离线读取入口只依赖共享读态与注入类型。

## 阶段 4　用户故事 2：连续编辑公式及相邻文字（P1）

**目标**　行内公式原位切换源码与排版，独立公式在源码下显示一处预览。公式和相邻正文使用同一个选区与输入流程。

**独立验收**　在普通段落和有序列表依次编辑 `$eee$`，再编辑相邻的单行和多行独立公式。用鼠标及方向键进入，删除 `$` 和 `$$`，跨公式选区删除并撤销。离开后行内只显示一个公式，独立公式编辑时额外预览最多一处。详见[验收指南第 3 节](quickstart.md#3-行内和独立公式sc-003)。

- [X] T242 [P] [US2] 在 `src/client/note-editor-math.ts` 复用 `src/client/note-math.ts` 的受限 KaTeX 渲染及 T234 的验证范围。有效行内公式使用选区感知替换，方向键和鼠标点击可进入源码，公式范围在键盘导航中保留可达性。用直接提供的块装饰替换非激活独立公式。激活时仅在源码下方生成一处预览。未闭合、范围无法证实或 KaTeX 拒绝的输入保留源码。
- [X] T243 [P] [US2] 在 `src/client/styles/atlas.css` 复用阅读态公式颜色、行高及 KaTeX 字体，为公式定界符和源码设置适度区分的文字样式，保证与中文正文衔接。独立预览随侧栏宽度布局，编辑源码、单个预览和数学辅助文本各有确定的显示边界。
- [X] T244 [US2] 在 `src/client/components/MarkdownNoteEditor.tsx` 接入公式装饰、组件点击到真实源码位置、进出范围、选区及组字结束刷新。使 Enter、Backspace、Delete、剪贴与撤销重做直接作用于 Markdown，允许删掉定界符后照常输入、跳转、点击「完成」和保存。一次仅由当前正文编辑器处理输入。

## 阶段 5　用户故事 3：延续节点详情的保存和图表工作流（P1）

**目标**　保留混合笔记中的图片、图表、DSH 引用、冲突保护和离线阅读。整图移动、删除及恢复继续受既有写入规则保护。

**独立验收**　用一篇含图片、函数图、统计图、公式的笔记和一个已有 DSH 草稿，验证图片和整图操作、拒绝普通跨图修改、自动保存重开、文字点／段后／空白行引用及回跳。检查 31 次独立导图历史批次只可撤销其中最近 30 步。详见[验收指南第 4 至 7 节](quickstart.md#4-图片图表与精确原文sc-004)。

- [X] T245 [P] [US3] 在 `src/client/components/NotePlot.tsx` 复用既有函数图和统计图组件，向在线编辑宿主提供触发拖动、删除及加入 DSH 的接口。以既有图表 ID 和受验证围栏稳定渲染，坏块保持可读诊断与原文查看。确保图例、控件和图面不会成为正文输入或取点位置。
- [X] T246 [P] [US3] 在 `src/client/note-editor-position.ts` 从鼠标位置或编辑器光标取得可复核原文偏移，区分文本和合法顶层块间隙。沿用「v1 `block/start` 或 v2 `gap`、节点身份、原文摘要与邻居上下文」。用 `captureNoteAnchor`、`captureNoteGap` 和 `locateNoteAnchor` 绑定到已保存版本。拒绝虚拟占位、折行空白、图表和无效边界。异步完成时重验正文、编辑身份与基线，保留唯一命中及失效反馈。
- [X] T247 [P] [US3] 在 `src/client/selection.ts` 接入编辑态源范围到选文投影的映射，沿用「当前读者投影的文字、前文和后文，排除图表控件与公式重复排版」。普通选区可复制选中文本的源码并跳过保护图表定义，公式贡献一次源码。编辑态加入 DSH 使用可读投影和上下文，保留原有只读复制与引用行为。
- [X] T248 [US3] 在 `src/client/components/MarkdownNoteEditor.tsx` 复用现有图片文件入口、`src/shared/image-resource.ts` 验证和会话资源池。真实文档显示图片引用。图片验证完成后复核原节点、工作区、写入状态及可核对的插入位置。把图像与引用放入同一变更，按既有流程立即排队。移除仅改变目标引用，正文撤销可恢复图片。
- [X] T249 [US3] 在 `src/client/components/MarkdownNoteEditor.tsx` 挂载 T245 图表投影并保护其源码导航，编辑候选仍经 T235 核对。用 `changeNotePlot` 实现「拖动或删除整图」，提供合法顶层块、首尾落点指示，取消、越界、目标无变化或过期时保留原文。围栏、图表 ID 和相邻源码保持。显式整图操作先结束普通正文批次，按现有规则立即排队。
- [X] T250 [US3] 在 `src/client/components/MarkdownNoteEditor.tsx`、`src/client/components/NoteInspector.tsx`、`src/client/AtlasPane.tsx`、`src/client/reference-navigation.ts` 接通右键与键盘菜单「添加图表/公式」、现有图表和选文引用，以及确认目标后回跳。保持原会话和草稿中的文字、引用与附件，由用户手动发送。原有服务端规则仍决定字符点、段后与块间空白的有效落点。回跳先遵守现有离开、保存保护，再用读态实际位置定位，失效时保留可读快照。
- [X] T251 [US3] 在 `src/client/edit-session.ts` 与 `src/client/components/MarkdownNoteEditor.tsx` 接通图片与整图操作的正文历史回放、资产复用及快速保存。按现有规则保留导图最近 30 步以及保存失败后的本地撤销。静态核对请求沿用 `src/server/edit-service.ts` 的版本、图表 `manualPlotDelta`、`removedPlots`、恢复账本和回执，撤销恢复原围栏及资源，冲突由现有流程保护磁盘版本。

## 阶段 6　整理与交付

- [X] T252 在 `src/client/components/NodeEditor.tsx`、`src/client/note-rich-text.ts`、`src/client/edit-session.ts`、`src/client/AtlasPane.tsx`、`src/client/styles/atlas.css` 移除已由在线编辑器替换的 DOM 回读、单条公式／强调草稿、独立源码输入框及对应的编辑拦截。先核对读态、引用回跳和只读离线入口，再清理无调用的代码。
- [X] T253 在 `src/client/components/MarkdownNoteEditor.tsx`、`src/client/note-editor-format.ts`、`src/client/note-editor-math.ts` 核对长笔记开销。纯光标／滚动更新复用解析结果，仅更新必要装饰，保留未变化公式与图表组件，避免编辑器重建、重复 KaTeX 排版与图面重挂载。用现有渲染和备选源码显示覆盖语法树暂未就绪的范围。
- [X] T254 在 `src/client/offline.tsx`、`src/client/index.tsx`、`scripts/build.mjs` 静态确认独立 HTML 阅读入口的依赖图只走阅读路径。检查编辑组件只从在线入口注入，并核对 KaTeX 字体、图表、图像资源及已保存阅读投影的内嵌路径。
- [X] T255 在 `tsconfig.host.json`、`tsconfig.client.json` 和 `package.json` 对应的现有命令入口执行 `npm run typecheck`、`npm run pack:plugin` 并核对 Git 差异与生成的本地候选包。确认在线产物包含编辑依赖、离线 HTML 产物排除 CodeMirror 与宿主草稿动作，候选只包含 007 的已核对变更。若工作区有并行未提交修改，基于明确的版本基线和 007 的变更准备本地构建输入。
- [X] T256 在 `docs/validation/release-status.md` 记录实际构建、打包结果及其对应产物，引用 `specs/007-markdown-live-preview/quickstart.md` 交接人工验收。分别列出已执行的静态核对、待做的 DSH 真机／断网阅读及未获授权的专项验证，保留原有已发布版本记录。

## 依赖与执行顺序

- **准备与基础**　T231 → T232、T233。T232 → T234 → T235。T233、T235 → T236 → T237，随后进入各用户故事。
- **US1**　T238、T239、T240 的输出汇入 T241。T241 接通在线编辑入口后，用普通 Markdown 笔记独立验收。
- **US2**　T242、T243 与接入完成的 T241 汇入 T244。公式验收只依赖已完成的正文编辑基础和本故事功能。
- **US3**　T245、T246、T247 可单独开发，T248 → T249 → T250 → T251 完成联动。其中 T249 依赖 T245，T250 依赖 T246、T247，涉及同一正文组件的合并在 T244 后顺序进行。混合笔记用例可在同一候选内独立验收。
- **交付**　三个故事完成后执行 T252 → T253 → T254 → T255 → T256。

## 并行示例

- **US1**　T238 处理格式装饰，T239 处理列表键位，T240 处理共享样式。由 T241 汇合。
- **US2**　T242 开发公式范围的显示逻辑，T243 调整公式样式。由 T244 汇合。
- **US3**　T245 处理图表组件接口，T246 处理定位引用映射，T247 处理选文投影。之后按顺序接入同一个编辑器。

## 实施策略

先完成准备、基础和 US1，用普通 Markdown 首次验收编辑链路。再增加 US2 复验公式源码和列表键盘操作。US3 接通混合笔记、DSH 引用和保存后撤销。完整候选在三个故事和跨用途核对均完成后构建交付。人工验收以 quickstart 的实际结果单独记录。
