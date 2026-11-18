# 0.4.0-preview.2 原位编辑与自动保存

新候选已启用自动保存。安装包和交互说明见 [交接记录](validation/edit-layout-history.md)。以下为先前候选的历史记录。

# 0.4.0-preview.1 编辑预览

本地候选为 `dsh-mindmap-0.4.0-preview.1.tgz`。节点内部编辑、PNG/JPEG/WebP 图片、纵向/田字型/多列与重置、30 步撤销/重做的预览代码已完成。**本预览不开放手动修改写入，包括拖动保存**；当前已验收稳定版本仍是 0.3.12。不要把此包作为已完成自动保存的版本使用。

新写入由 `src/server/edit-service.ts` 的 EDIT_WRITES_VERIFIED 门槛控制；不能仅改开关就视为验证通过。完整条件及未执行项见 [交接记录](validation/edit-layout-history.md) 与 [内部证据清单](validation/edit-layout-history-internal.md)。本轮仅静态核对、构建、打包；无自动测试、类型检查、浏览器检查、安装或发布。

# 0.3.12 当前交付

本地安装包`dsh-mindmap-0.3.12.tgz`，修正回收站分类点击：点击“回收站”返回其列表，点击“未完成创建”进入其列表，重复点击不反向切换。已构建，未运行自动测试、类型检查、浏览器或视觉验收；见[人工交接](validation/0.3.12.md)。

# 0.3.11 历史交付

本地安装包`dsh-mindmap-0.3.11.tgz`：创建候选校验通过后才预留目录；后续失败受控释放reservation并保留请求指纹。回收站标题右侧“未完成创建”二级入口与DSH的atlas_cleanup_create共用清理服务，先作废旧请求再删除记录；完整地图、未知内容及活动事务保留。仅静态核对与构建，未运行自动测试、类型检查、故障注入、浏览器或视觉验收；边界与人工交接见[0.3.11说明](validation/0.3.11.md)。

# 0.3.10 历史交付

当前本地安装包为`dsh-mindmap-0.3.10.tgz`。仅优化`src/server/prompts/authoring.ts`中的skill：明确新建无需先列图，补齐创建字段语义及完整示例，避免为推断格式读取无关地图。已构建打包，未运行自动测试、类型检查、浏览器或视觉验收；实际模型行为见[0.3.10人工场景](validation/0.3.10.md)。

# 0.3.9 历史交付

当前安装包为仓库根目录`dsh-mindmap-0.3.9.tgz`。统一使用DSH原生`/mindmap` skill随需求手动发送，删除旧`/minimap`及其恢复子命令；优化内容组织和局部修改规则。运行时正文与描述在`src/server/prompts/authoring.ts`，注册在`register.ts`；宿主需启用原生skill输入及consumer。已构建打包，未运行自动测试、类型检查、浏览器或视觉验收。变化与人工场景见[0.3.9交付](validation/0.3.9.md)。以下保留历史记录，旧命令安装说明及恢复入口不再适用。

# 0.3.8 历史交付

当前安装包为仓库根目录`dsh-mindmap-0.3.8.tgz`。修正拖动整页重绘/端点反复排序，补上可见的短跟随动画；实际CPU及交互仍待用户复验，见[0.3.8交付](validation/0.3.8.md)。本轮仅静态核对与构建打包，未运行自动测试或浏览器检查。

# 0.3.7 当前交付

当前安装包为仓库根目录`dsh-mindmap-0.3.7.tgz`。布局保存提示改为右上角状态图标和按需操作弹层；人工场景见[0.3.7交付](validation/0.3.7.md)。仅构建打包，未运行自动测试或浏览器验收。

# 0.3.6 当前交付

当前安装包为仓库根目录`dsh-mindmap-0.3.6.tgz`。四边统一端点排序，最终包不含开发中的曲线交叉搜索；加入140ms节点位移过渡。仅构建打包，人工场景及限制见[0.3.6交付](validation/0.3.6.md)。

# 0.3.5 当前交付

当前安装包为仓库根目录`dsh-mindmap-0.3.5.tgz`。本轮端点排序、模板、提示与自动打开调整见[0.3.5交付](validation/0.3.5.md)。运行时skill正文及注册均在`src/server/prompts/`；编辑authoring.ts后重新构建安装包并更新DSH插件。仅构建打包，未进行自动或浏览器验收。

# 0.3.4 当前交付

当前安装包为仓库根目录`dsh-mindmap-0.3.4.tgz`。鼠标侧键仅记录页面切换，主管理页和回收站可后退/前进；知识笔记操作不占历史。已构建打包，人工复验见[0.3.4交付](validation/0.3.4.md)。未运行自动测试、类型检查、浏览器或视觉验收。以下为历史记录。

# 0.3.3 当前交付

当前安装包为仓库根目录`dsh-mindmap-0.3.3.tgz`。回收站入口、勾选框、删除成功消息和展开箭头按用户反馈调整；搜索与既有管理功能保留。已构建打包，未运行测试或浏览器验收，见[0.3.3交付](validation/0.3.3.md)。以下为历史记录。

# 0.3.2 当前交付

当前安装包为仓库根目录`dsh-mindmap-0.3.2.tgz`。恢复管理页搜索区，修正目录读取整图内容及重复刷新导致的等待；已有目录直接呈现，后台读取结构摘要更新。打开地图仍完整校验。详情及人工复验见[0.3.2交付](validation/0.3.2.md)。仅构建打包，未运行自动测试或浏览器验收。

# 0.3.1 当前交付

当前安装包为仓库根目录`dsh-mindmap-0.3.1.tgz`。管理页及回收站统一为紧凑列表与菜单，删除不二次确认；批量操作只在选择模式显示。新增回收站永久删除和清空，失败项目可继续删除。实际操作与人工验收见[0.3.1交付](validation/0.3.1.md)。仅构建打包，未执行测试或浏览器验收。以下保留历史记录。

# 0.3.0 当前交付

安装包：仓库根目录`dsh-mindmap-0.3.0.tgz`。按下文既有安装方式安装，目标DSH版本不变。新增实际DSH命令`/minimap`，加载内嵌mindmap skill后，用户手动发送架构、流程、知识等创建/修改需求。五个atlas工具随Host服务tools/commands/skills/approval就绪后注册，卸载由Cordis释放。直接依赖固定为0.2.2-rc.3，未引入新图形或状态库。

内部保存/恢复专项10项通过，已构建打包，未进行DSH真机或界面验收。详情、工具边界、恢复命令和人工场景见[0.3.0交付](validation/0.3.0.md)。不再提供DSH更新提示词。

工具依据：[目标版本官方教程](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/user/develop/basic/tool.md)，本轮重新读取；命令、skill、agent.inject及approval.request另核对本地同版本官方包src契约（dsh-commands、dsh-skill、dsh-agent、dsh-user-approval）。以下为既有安装说明及历史记录。

# 插件开发与加载

目标：DSH `0.2.2-rc.3`，官方标签 `dsh-v0.2.2-rc.3`，提交 `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`。当前交付为 0.2.0 原型移植增量：完整 v17 SVG／样式与连线端口、节点拖动、滚轮缩放、节点引用、问题草稿和离线 HTML 导出，并保留目录、阅读和外部刷新。下列是实现依据，不代表真机验收通过。

当前候选版本为0.2.0。0.1.0真实加载失败：浏览器产物被误打成普通ESM，没有调用宿主的ModuleLoader注册方法。现按[官方客户端打包契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/client/tsdown.client.ts)输出 `window.__ModuleLoader__.load({ id, factory })` 闭包；React、Cordis、zod和client-store使用[宿主平台模块表](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/client/web/src/platform.ts)，其余依赖随客户端打入。Host/Typert保持ESM。不要将普通ESM客户端直接交给 `/plugins` 路由。

0.1.2 真机已显示思维导图选择页，但目录请求因 `cannot get property "remote.dshAtlas" without inject` 失败，新建功能不可用。0.2.0 在 `$mount(atlasRemote)` 完成后，通过 `ctx.inject(['remote.dshAtlas'], registerClient)` 注册侧栏、引用入口和样式，确保后续回调使用声明了远程命名空间依赖的上下文。不能直接将该命名空间加入顶层 inject，否则其挂载逻辑会先等待自身尚未创建的服务。依据本地固定版本官方 `dsh-api-gateway/src/client/index.ts`、`dsh-typert-protocol/src/remote-info.ts` 和 `cordis/src/reflect.ts`。新增回归测试加载实际 ModuleLoader 产物，用真实 Cordis 插件上下文与官方客户端 Gateway 验证侧栏发起目录请求及卸载清理；连接传输和界面服务为测试替身，不替代 DSH 真机验收。

## 已核对的官方契约

- [插件入口](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/user/develop/basic/index.md)：模块导出 `name`、`inject`、`apply(ctx)`；注册由 Cordis effect 管理。
- [bundle 与安装](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/user/develop/basic/publish.md)：`dsh.bundle.patch` 指向配置层；`engines.dsh` 限定宿主；客户端从包的 `./client` 导出加载。需共享实例的包同时声明 peer/dev 依赖。
- [原生侧栏](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/subsystems/sidebar-right.md)：`sidebarRightTabs.register` 注册类型，`slots.inject` 等待正文插槽，`sidebar.right.pane.tab` 的 key 与类型 id 相同；`useTabInfo` 提供导航、可见性、关闭和取消信号。
- [Slots](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/subsystems/slots.md)：使用宿主 React 18，依赖只导入其他功能包的类型，服务投影为注册 `inject` 的回调；不从其他插件导入运行时组件。
- [通信协议源码](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/typert/protocol/src/remote-info.ts)：使用公开 `createTypertRemoteInfo` 建立有边界 schema 的 Remote 描述，Host 注册到 Typert，Client `$mount` 并通过 descriptor `invoke` 调用。请求绑定官方 `workspaceFileScope` lookup，其 Session resource 交给 Gateway 授权。业务 payload 在 Host 重新校验。
- [文件读取](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/api/workspace-files/README.md)：Host 通过会话派生的 scope 调用 `workspaceFiles`。处理分页、版本变化、列表截断及观察失败；目录观察不递归。插件额外通过 `fs.resolve` / `contains` 检查真实目录边界，不能把文件服务权限当作地图包含性。
- [文件写入](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/fs/fs/src/index.ts)：保存派生 `layout.json`、目录索引 `library.json` 和首次创建的 `map.json`，使用 `createIfAbsent` 或 `replaceIfVersion`，不得无条件覆盖。`ctx.fs` 是宿主提供者，不能用 Node 文件系统绕过它。
- [引用契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/client/ui-conversation/src/client/contract/input.ts)：捕获 `captureInsertion`，在原会话 `conversation.input.for(actx).insertReference`；source 承载快照，负责 serialize/openReference。插件不调用 setDraft、submit 或 send。
- [引用 source 类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/client/ui-input-trigger/src/types.ts)：注册 `inputTriggers.registerSource`，引用内容保存在 ref 中，恢复不依赖插件内存缓存。

Markdown 已核对官方纯组件 `@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText`：支持非执行 HTML、数学公式与 `pathImages`，但默认还包含全局图片浮层、外部图片和上层文件打开委托。本插件需要固定的 v17 栏目以及面板内交互和本图资源边界，因此使用 Markdown tokenizer 生成受限 React 元素；原始 HTML 作为文字展示，图片只取 Host 校验过的本图 assets，外部链接限制协议。不向 DOM 注入内容 HTML。该选择不是宿主缺少安全 Markdown 能力。

## 验证边界

类型检查、构建、纯逻辑和故障案例在本仓库执行。原生挂载、草稿附件/撤销保留、重载后引用恢复、六种侧栏尺寸、视觉与动画耗时，以及首次使用者试用，需要在真实 rc.3 中执行；未执行不得记通过。用户将自行加载并验证，操作与验证提示词已附于下文。

## 实际工程命令（手动验收约定）

在插件仓库根目录使用 PowerShell，Node.js 至少 24.9：

```powershell
npm ci
npm run pack:plugin
```

`typecheck` 分别检查 Host / Client，避免把宿主两端同名的 Context 服务声明混在一起。`test` 使用 Node 自带测试运行器，前置构建插件及 DOM 测试模块；jsdom 只用于验证组件和选区，不作为浏览器视觉验收。`build` 使用 esbuild，将样式作为文本随客户端入口携带，不打包第二份 React。DSH 包固定为 `0.2.2-rc.3`。

构建输出为 `lib/index.js`、`lib/client.js` 和 `lib/typert.js`。GitHub Release 和本地安装继续使用 `npm run pack:plugin` 生成的 `dsh-mindmap-<版本>.tgz`，包名仍为 `dsh-mindmap`。npm 官方仓库包使用 `npm pack`，由 `prepack` 先构建，再生成 `xiao-53-dsh-mindmap-<版本>.tgz`，包名为 `@xiao-53/dsh-mindmap`。同一 profile 只安装其中一种。

两个安装包均包含三个构建入口、`package.json`、`cordis.yml`、`README.md` 和 `LICENSE`。测试、开发文档、用户数据及本地状态不打包。`lib/`、`node_modules/`、tgz 属于被忽略的本地产物。

## 在已有 DSH 中加载

先确认运行实例是 `0.2.2-rc.3`，并确认它使用的 profile。以下命令遵循官方 bundle 安装流程，**尚未在本轮真实 DSH GUI 中执行**。将占位参数换成实际值，不重置已有 profile：

```powershell
dsh plugin --profile <当前profile> add <安装包的绝对路径>/dsh-mindmap-<版本>.tgz
dsh --profile <当前profile> --dump-config
```

本机没有 `dsh` 命令时，应使用已有 DSH 安装的 CLI 入口；也可用官方 `npx @deepseek-ai/dsh@0.2.2-rc.3` 代替上面命令中的 `dsh`。不要混用其他版本。然后按当前安装的原启动方式重启或重新加载插件，避免结束正在执行验证的会话宿主。

配置输出应出现 `dsh-mindmap` bundle 层及同名插件行。客户端从 `./client` 加载，Typert Loader 从 `./typert` 自动注册严格 RPC 描述；公开 `./package.json` 支持宿主解析。自定义请求命名空间为 `dshAtlas`，不是供模型调用的地图编辑工具。

打开原生右侧栏的新增/导航入口，选择“思维导图”。手动打开先进入导图选择页，不自动打开第一张或上次阅读的导图；没有有效地图时显示创建引导。新建导图在根目录建立独立空白地图，再通过“整理”移入文件夹；新建文件夹可选择父级。只有显式创建或保存时才建立数据目录。首期读取当前会话工作区下 `dsh-knowledge-maps/<mapId>/map.json` 及 Markdown，缺少布局时计算并条件保存 `layout.json`；不注册 `atlas_*` 内容编辑工具；右键菜单提供节点加入正文与问题草稿，工具栏可导出离线 HTML。

目录支持折叠层级、全目录标题搜索、创建文件夹和通过“整理”归档导图；画布“全部导图”返回选择页，引用回跳仍直接进入来源导图。面板中的地图菜单可切图；节点点击下钻或阅读，右键 / Shift+F10 打开节点菜单；Ctrl+F 在面板内搜索；画布方向键平移、加减缩放、Home 适配；详情文字可选择并“加入选文”。按 Escape 关闭顶层浮层并返回焦点。

交给 DSH 的内容仅用[加载验证提示词](dsh-first-release-validation-prompt.md)；人工外观和交互验收见[首期验证记录](validation/first-release.md)。

## 0.2.0 原型移植与交付边界

图标元素和界面样式直接移植自 v17；侧栏使用自身容器宽度适配。连线先按关系分配输出／输入端口，再沿卡片侧边按另一端位置分散，每条边的端点独立，按原型曲线绘制；不根据卡片位置臆造知识关系。节点拖动超过 7px 启动、按当前缩放换算坐标、实时重绘连线，松手条件保存 layout.json 并标记 manual，190ms 内抑制误点击下钻。已有节点及分组布局保留；缺失布局使用原型宽幅分组。

文件写入使用来源会话的 sandboxPolicy.resolve({session})，将策略作为 ctx.fs.writeText 的第五参数传入，不再误用部署默认根；只读会话明确拒绝写入。布局失败保留当前内存副本，可重试或明确放弃重新读取。离线 HTML 使用同一阅读组件与内嵌资源，不依赖 DSH、CDN 或原工作区路径；离线拖动只保存在页面内存。提问按钮生成可编辑文字草稿，经原会话 scoped insert-text 插入，由用户手动发送。

按用户最新要求，后续可手动验收的界面与交互改动不自行运行测试或浏览器验收，仅构建打包交付。0.2.0 最终改动及 DSH 真实加载／权限／草稿行为由用户手动验收，不能沿用此前结果宣称该版本已验收通过。

## 0.2.1 侧键导航交付

T084已核对补齐保留代码，支持面板内鼠标侧键3返回、4前进，历史限定原会话/工作区/地图，恢复视图、详情、相机及滚动，刷新跳过失效出现位置。新导航清除前进分支，跨视图复用180ms退出和320ms淡入；过渡期间重复侧键忽略，问题草稿打开时暂停导航。历史仅保留在会话中，不写入地图、布局或导出数据。

本次仅执行构建打包，未运行测试、类型检查、浏览器检查或视觉验收。T085及既有人工验收继续待执行。安装包为dsh-mindmap-0.2.5.tgz；[更新提示词](dsh-update-prompt.md)可直接交给DSH，人工检查见[当前清单](validation/current-candidate.md)。

## 0.2.2 人工反馈修正

当前更新包为dsh-mindmap-0.2.5.tgz；此次问题与修正见[反馈记录](validation/feedback-0.2.1.md)，仅构建打包，待人工复验。新建空白图及提问入口已移除；管理页每行“···”提供改名/删除/移动，地图可直接拖到文件夹或全部导图。删除进入回收站保留文件，可恢复；文件夹删除把内容移到上一级。详情左边缘可拖宽，选文自动弹出添加到正文。

0.2.3按截图精简阅读标题栏并修正刷新图标；仅构建打包，T094交用户人工复验。

0.2.4将端点圆与连线统一至画布坐标，并修正marker尖端锚点；构建打包后交T096人工复验。

0.2.5取消随线宽缩放的marker，两类箭头统一使用长8宽7的SVG三角形并通过短柄连接曲线，T098人工复验待执行。
