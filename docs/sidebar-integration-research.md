# DSH 侧栏与输入框联动调研

核查日期：2026-11-14。目标宿主：用户指定的 **DSH v0.2.2-rc.3**。
本次仅进行文档与源码调研，不安装插件、不实现功能、不确定前端框架或图形库。

## 用户已确认的方向

以下决定来自后续用户指示，优先于本文中的备选方案和早期建议：

- 使用 DSH 原生侧栏接入；Better Sidebar 作为参考，不作为必需依赖。
- 首期与输入框的交互为“选中文本 → 加入输入框 → 点击引用回跳”。用户自行编辑并发送草稿；不做直接提问，不自动调用发送接口，也不自动提交输入框。首期的阅读、搜索和外部文件刷新等能力以[产品规范](../specs/001-sidebar-knowledge-atlas/spec.md)为准。
- 使用最小稳定画布 + 独立文件数据，以稳定呈现风格并便于 AI 修改。整份 HTML 不作为主编辑和内容存储方式；导出需求尚未纳入首期范围。
- 参考 Archify，结论见 [Archify 调研](archify-reference.md)。现已确认 `map.json` 知识结构、独立 Markdown 详情和插件维护的 `layout.json` 布局，见[存储契约](mindmap-storage-format.md)；框架、图形库和布局算法仍待技术规划。

回跳关联原地图、节点、来源视图及选文快照；定位线索与来源变化后的降级规则已在产品规范和存储契约中确定，具体宿主接入仍待验证。选区或源内容变化时不得静默跳到无关内容，引用仍须保有可读文本。
下文“直接发送”和 HTML 路径仅保留为已调研备选能力，不是当前开发要求。

## 调研结论

已确认采用 **DSH 原生侧栏页签 + 稳定的画布界面 + 独立保存的导图数据及内容文件**，后续验证目标版本的具体接入。
Better Sidebar 仅作参考与共存验证对象，不作为必需依赖；如以后改变依赖范围，须另行决定。
整份 HTML 适合独立分享、一次性展示和导出；若用于长期编辑并与 DSH 双向交互，还需要宿主桥接与数据持久化，整体不一定更省事。
原生接入与稳定画布方向现已获用户确认；本报告不是完整产品规范，其他备选能力不自动进入开发范围。

## 版本与证据范围

- DSH 核心结论依据发布标签 [`dsh-v0.2.2-rc.3`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.3)，Git 引用为 `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`，不以滚动的 master 作为版本依据。
- Better Sidebar 参考标签 [`v0.32.1`](https://github.com/omdsh-dev/DSH-better-sidebar/tree/v0.32.1)，该标签解析到提交 `06d21351a50b60063010c178590fc24ecd76fb74`；未获知用户实际安装的插件版本。
- Better Sidebar 的版本说明声明支持 DSH `0.2.2-rc.2+`。这覆盖目标版本的声明范围，**不等于已经完成 rc.3 真机兼容性验证**。[B1]
- 没有启动 DSH，也没有进行 Web/桌面端挂载、输入或保存实验。本报告区分已查证接口与建议行为。

## 侧栏接入方式

### 直接接入 DSH 原生侧栏

一个原生页签由两部分组成：用 `ctx.sidebarRightTabs.register(definition)` 注册类型，再在会话级 keyed Slot `sidebar.right.pane.tab` 注册正文组件，两者使用同一个 definition `id`。注册跟随插件 effect 生命周期释放。[D1]

- `ctx.sidebarRight.openTab(kind, options?)` 打开功能页面；`openResource(address, options?)` 打开 `dsh-resource://…` 资源。
- 页面适合一个“思维导图”入口；资源认领适合点击某类导图文件后直接用画布打开。二者可按需求选择，不必现在实现自定义资源协议。
- 文件地址可用官方 `fileAddressFor(sessionId, cwd, path)` 构造，不手工拼接 Windows 路径；文件读取最终由宿主检查权限。
- Tab 的资源身份为 `(kind, address)`。`params` 是导航参数，不能用它代替导图文件身份或内容存储；同一页面仅更换参数不代表新开了一个独立文件页签。
- 正文由 `useTabInfo()` 获得导航、可见性、关闭动作及生命周期信息。`keepMounted` 可以保留已访问页签的运行实例，但不等于业务数据已持久化。
- 原生侧栏已经提供停靠、分栏与浮动承载。插件无需自行实现整套侧栏容器。

这些是 rc.3 宿主的 Slot/组件契约；不据此预先选定本项目的图形库和状态管理。[D1]

### 通过 Better Sidebar 接入

Better Sidebar 自 v0.19.0 起已把右侧栏交给 DSH 原生承载，自己保留底部工作台及扩展服务。
消费插件可用客户端服务 `ctx.betterSidebar.registerTab(...)` 注册功能页，用 `registerFileViewer(...)` 注册文件预览器；通常 `openTab`/`openFile` 的目标是原生右侧栏，也可指定底部工作台。[B2]

| 路径 | 获得的能力 | 需要承担的成本 |
| --- | --- | --- |
| 原生页签 | 官方侧栏、会话绑定、导航与会话级输入动作 | 自己提供导图界面及必要入口 |
| Better Sidebar 的 Tab | 封装后的页签描述、底部工作台及其设置接入 | 增加社区插件依赖及版本适配 |
| 文件预览器 | 点击文件进入对应导图视图 | 要核对文件路由认领、编辑及保存生命周期 |

原生资源认领按优先级、匹配模式长度及注册顺序排序。Better Sidebar 自己也会认领部分文件类型，所以不能假定注册了任意预览器就一定收到文件。[D1][B2]

对本项目的建议：先用原生接口判断是否满足需求。需要与 Better Sidebar 共存，不等于必须依赖它；若后续确实需要底部展示，再评估它的适配层。

## 侧栏与文本发送框联动

### 侧栏 → 草稿：优先让用户编辑后发送

rc.3 在会话级标准组件属性中提供 `useInput` 和 `inputActions`，原生侧栏正文属于会话级 Slot，因此可沿宿主标准属性获得当前会话输入能力。[D2]

| 需求 | 已有接口 | 关键语义 |
| --- | --- | --- |
| 将节点内容加入输入框 | `inputActions.insertQuote(text, summary?)` | 加入原子引用；实际发送内容是 Markdown 引用块 |
| 异步准备文本后插入 | `captureInsertion()` + `insertText(text, span)` | 保留既有引用与撤销语义；草稿版本改变或编辑器锁定时返回 false |
| 添加可点击节点引用 | `conversation.input.for(actx).insertReference(ref, span)`，配合自有 input-trigger source | source 负责点击回跳和发送时的序列化 |
| 整框替换文本 | `setDraft(text)` | 会移除已有引用 chip，不适合作为默认追加操作 |

这些方法是不同用途的接口，不应把草稿转成普通字符串再整体写回。一次插入失败时应保留待插入内容供重试，不覆盖用户刚输入的文字。[D3]

Better Sidebar 的“添加到对话”值得参考：文件树引用与编辑器划选经过 `conversation.input.for(sessionScope)` 插入，自己的 `betterSidebarQuote` source 使用 `openReference` 回到原文件，并用 `codec.serialize` 决定模型收到的内容。它还处理了引用 chip 的坐标投影和 `draftRev` 检查。[B3][B4]

对 dsh-mindmap，首期必须一起验证“选文加入草稿”和“点击草稿引用回跳”，不能将回跳降为可选能力；引用 source 的具体接入方式留待技术规划。手动发送时模型必须获得所选文本和可读来源，不自动补入父子或相邻节点。完整版本的节点引用范围按产品规范执行，单独发送节点名、文件路径或画面不等于提供了内容。

### 侧栏 → 直接发送：接口调研记录，不用于产品交互

本节仅保留接口语义及风险依据。当前产品不提供“立即提问”或自动发送；完整版本的“针对内容提问”也只准备可编辑草稿，由用户手动发送。

rc.3 的 `ctx.conversation.send(text)` 将独立文本交给调用方绑定的会话，并使用 `queue` 模式。
实现内部调用的是 `session.prompt([{ type: 'text', text }], 'queue')`；它不等同于点击主输入框 Send，也不负责提交那里的现有草稿、引用或附件。[D4]

`SessionInput.submit(mode?, source?)` 则进入输入框自己的提交流程。若只想就某个节点提问，不应隐式提交用户尚未写完的整份草稿。[D3]

产品的引用插入操作必须捕获来源所属会话，不使用执行时的全局当前会话作为兜底；用户切换会话后，旧异步回调不能将内容插入或发送到新会话。上述发送接口的存在不改变用户手动发送的约定。
请求被宿主接收或进入队列，也不代表模型已经完成回复。Better Sidebar 的 Side Chat 是子线程能力，不应误用为主会话发送通道。[B2][D4]

### 输入框/模型 → 侧栏

- 节点引用的 `openReference` 可以将带身份的引用重新导航到导图与节点；这是建议接入行为，不是 DSH 已有的思维导图功能。
- 模型修改导图数据或内容文件后，可沿官方资源/文件变化观察机制刷新视图。存在未保存的画布编辑时，应处理冲突，不能直接用磁盘内容覆盖。
- 普通聊天文字不会自动变成可靠的节点定位指令。若需要这种行为，应另行确定显式引用或命令格式，不持续解析用户输入框里的每个键盘事件。
- 不通过查询 DOM、查找 textarea 或模拟点击发送按钮实现联动；宿主已有输入、会话和导航接口。

文件观察能力依据官方 Workspace Files 与 Resource 文档；当前侧栏参考中的文件服务描述了读取、列举和变化订阅，不能由此推定已有任意业务保存 API。画布编辑的写入及冲突规则留到后续验证。[D1]

## 固定画布 + 文件节点，还是整份 HTML？

这里把“固定画布”理解为**稳定的渲染界面，数据独立更新**，而非固定像素大小、禁止缩放或不能响应侧栏尺寸变化。

| 维度 | 稳定画布 + 独立文件数据 | 整份 HTML 同时保存内容与界面 |
| --- | --- | --- |
| 初次制作 | 需要明确节点、连线、文件关联等最小数据结构 | 生成一个可见页面较直接 |
| 持续修改 | 渲染界面复用，修改集中在数据和内容 | 容易同时改动内容、样式、脚本与事件 |
| 输入框联动 | 原生页签能沿会话接口调用宿主输入动作 | 普通 HTML 预览缺少现成的主输入框联动桥 |
| Agent 修改与 Git 审阅 | 节点身份和文件内容可稳定定位，差异较集中 | 依赖 HTML 写法；整页重写会放大差异并可能影响交互 |
| 内容复用 | 内容文件可被单独阅读、引用和改写 | 需要从页面中抽取，或另存一份数据 |
| 分享与离线打开 | 通常需要导出 | 自包含 HTML 的优势明显 |
| 长期成本 | 维护数据格式及文件引用 | 维护页面代码、数据与宿主桥接的一致性 |

这些成本判断是基于本项目“持续学习、改图、节点提问”的使用目标作出的工程推断，尚无性能或开发工时测量。

### HTML 路径的实际边界

DSH rc.3 官方 HTML 预览有两种策略：Coding Tools 关闭时是清理后的静态文档，脚本不运行；开启时允许脚本，但 iframe 只有 `sandbox="allow-scripts"`，不授予 `allow-same-origin`。普通 HTML 不能直接调用父页面的 DSH 服务。[D5]

Better Sidebar 的 HTML 预览也默认隔离。其发布版本的 `HtmlPreviewFrame` 没有通用的“发送到主输入框”消息处理器；官方 rc.3 的 `HtmlBody`/bootstrap 也未提供这类通道。[B5][D6]

因此，“一个 HTML 文件里放按钮”可以实现页面内部交互，却不自动获得 DSH 输入、文件保存或会话能力。
若坚持 HTML 作为主交互页面，需要额外实现插件外壳及受限消息桥，例如 iframe 发送请求、外壳验证来源窗口和消息结构，再调用绑定会话的输入接口。隔离 iframe 的 origin 不能当成唯一认证依据，还要绑定对应的 frame、会话与生命周期。**这是需要新建的机制，并非本次查到的现成功能**。

关闭沙箱不是该联动机制的替代品。自包含 HTML 内部也可以保留结构化数据，做到较好的维护性；一旦要求受控联动和可靠保存，它同样需要考虑数据与宿主边界，单文件本身不再决定复杂度。

### 已确认的数据拆分与简化边界

采用稳定画布时，`map.json` 集中保存地图身份、节点、视图、分组、关系和摘要；有正文的节点关联独立 Markdown 笔记，没有正文不创建空文件。`layout.json` 独立保存插件计算和维护的布局，不能把关系、位置及正文混存。
节点应有稳定身份，文件路径只是关联信息；这样重排画布不会改变内容身份，也能逐步处理文件移动后的引用维护。
具体字段与文件职责以存储契约为准。DSH 仅生成和修改 JSON 知识结构与 Markdown 内容；插件维护完整模板，负责布局和侧栏渲染。HTML v17 仅供开发参考，分享使用后续由插件导出的独立离线 HTML，不成为日常内容编辑源。

## 后续最小验证范围（本次未执行）

1. 在真实 rc.3 上打开一个原生页签，验证侧栏尺寸变化、切换会话、关闭与恢复。
2. 输入框已有文字和引用 chip 时，插入选文引用并点击回跳；验证草稿变化、来源变化、忙碌提交、会话切换及失败重试。
3. 验证“加入输入框”不会发起提问、自动提交或发送用户已有草稿；实际发送仍由用户操作宿主输入框。
4. 模型改文件时验证视图刷新；同时存在用户未保存编辑时验证不被覆盖。
5. 若用户已安装 Better Sidebar，验证原生页签与它共存；不因共存测试而新增底部工作台或 HTML 通信桥。

## 一手来源

[D1]: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/subsystems/sidebar-right.md
[D2]: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/client/ui-conversation/src/client/contract/slots.ts#L395
[D3]: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/client/ui-conversation/src/client/contract/input.ts#L184
[D4]: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/client/ui-conversation/src/client/service.ts#L209
[D5]: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/client/ui-sidebar-documentpreview/README.md
[D6]: https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.3/packages/client/ui-sidebar-documentpreview/src/client/html
[B1]: https://github.com/omdsh-dev/DSH-better-sidebar/blob/v0.32.1/README.md
[B2]: https://github.com/omdsh-dev/DSH-better-sidebar/blob/v0.32.1/docs/external-plugin-guide.md
[B3]: https://github.com/omdsh-dev/DSH-better-sidebar/blob/v0.32.1/src/client/conversation-draft.ts
[B4]: https://github.com/omdsh-dev/DSH-better-sidebar/blob/v0.32.1/src/client/selection-quote.ts
[B5]: https://github.com/omdsh-dev/DSH-better-sidebar/blob/v0.32.1/src/client/HtmlPreviewFrame.tsx
