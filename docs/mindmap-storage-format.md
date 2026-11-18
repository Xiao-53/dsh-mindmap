# 思维导图存储格式与内容契约

## 0.3.11 创建占位与失败记录

atlas_create先校验完整候选，再写`.transactions/<operationId>/reservation.json`。进入占位后的可安全清理失败，先持久化`failed.json`（kind为failed_create，包含operationId/request哈希/code），再按版本删除reservation；事务回退仍负责内容文件。失败请求记录保留同ID不同请求拒绝，成功结果仍由result.json重放。完整校验未通过的新请求不创建目录，也不建立请求预留。

管理页与atlas_list通过严格目录清单、operationId派生mapId和请求哈希识别无地图的创建记录，单列incompleteCreates，不把它们当可读取地图。历史只有reservation的记录保留，用户可在回收站二级入口或通过atlas_cleanup_create显式清理：先持久化`.transactions/discarded-create.json`（kind为discarded_create，mapId/operationId/request），再按版本删除reservation/failed文件；保留作废标记拒绝旧请求重试，清理完成不再列出，中途失败为cleanup_pending可重试。活动、待恢复、未知内容和成功结果缺失地图的情况不作纯占位处理。文件服务不提供目录删除，本版不递归清除目录，保留必要标记/空目录。真实失败边界尚未进行本轮故障注入验证，详见[0.3.11](validation/0.3.11.md)。下方旧状态描述为历史规划，当前状态见release-status。

状态：JSON + Markdown已确认，当前候选已接入读取、校验、单文件布局/目录保存、空白建图和全图HTML下载，人工验收待完成；多文件事务与原生AI工具仍未实现。本文定义v1数据契约，不代表完整能力已经通过验证。产品范围以 [spec.md](../specs/001-sidebar-knowledge-atlas/spec.md) 为准，呈现直接遵循 [HTML v17](knowledge_atlas_demo_v17.html)。

本文是插件开发契约。HTML 仅供开发插件使用；插件维护完整界面模板，将 JSON 和 Markdown 内容填入模板并渲染侧栏。DSH 只接收内容字段与操作规则，负责知识内容和结构；布局、连线、动画及视觉验证由插件承担。供 DSH 使用的完整内容格式已单独列在[提示词](mindmap-authoring-prompts.md)中，不将本文的布局和开发参考部分发给 DSH。

## 文件职责

```text
dsh-knowledge-maps/<mapId>/
├── map.json                 地图身份、节点、视图、分组、关系
├── layout.json              插件维护的各视图节点与分组几何位置
├── notes/<nodeId>.md        节点的 Markdown 详情，按需创建
├── assets/                  实际使用的本地资源，按需创建
└── exports/                 独立 HTML 分享文件，导出时创建
```

根目录名称沿用规范的暂定值。每张图的目录名使用地图 ID，不用标题；同名新图创建新 ID，改标题保留原 ID 和目录。JSON 与 Markdown 使用 UTF-8。JSON 不包含注释、尾逗号或可执行表达式。无需另外创建索引数据库、占位笔记或空资源目录。

## map.json

顶层对象的必填字段：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `schemaVersion` | 整数 | 本契约为 `1`；不是内容修订号 |
| `id` | 字符串 | 稳定地图 ID，与目录名一致 |
| `title` | 字符串 | 地图显示名称 |
| `rootViewId` | 字符串 | 入口视图 ID |
| `nodes` | 对象数组 | 全图唯一的知识节点 |
| `views` | 对象数组 | 阅读视图及其中的出现位置 |
| `relations` | 对象数组 | 全图唯一的知识关系 |

以下表格中标注“可选”的字段在无值时省略；其余必填。ID 是不随标题变化的非空标识，采用字母、数字、下划线或短横线，同类对象内唯一；新 ID 不得与已有对象冲突。不得用数组下标、显示名称或坐标承担身份。

| 对象 | 字段 |
| --- | --- |
| `nodes[]` | `id: string`、`title: string`、`summary: string`、`category: string`、`icon: string`、可选 `notePath: string`、可选 `childViewId: string` |
| `views[]` | `id: string`、`title: string`、`parentViewId: string \| null`、可选 `centerNodeId: string`、`groups: object[]`、`occurrences: object[]`、`relationIds: string[]` |
| `views[].groups[]` | `id: string`、`title: string`、`number: string`、`category: string`；数组顺序为分组顺序 |
| `views[].occurrences[]` | `nodeId: string`、可选 `groupId: string`；同一节点在同一视图中只出现一次 |
| `relations[]` | `id: string`、`fromNodeId: string`、`toNodeId: string`、`type: string`、可选 `label: string` |

`summary` 是卡片上的简短说明，长正文只放 Markdown；无摘要时可为空字符串。`category` 只选择 v17 现有的 `blue`、`sage`、`plum`、`gold`、`terra`，不保存自定义 CSS。`icon` 只选择原型已有的 `book`、`atom`、`layers`、`branch`、`target`、`spark`、`flask`、`check`、`alert`、`formula`、`link`、`grid`、`idea`、`arrows`，不保存 SVG 源码。

`type` 为 `dependency`（概念依赖，箭头从前置概念指向依赖它的概念）或 `supplement`（补充/对比，沿用原型虚线箭头，可用 `label` 解释）。不因节点相邻、同组或同级而自动添加关系。知识关系允许成环；视图父级不允许成环。

节点共用一个 `childViewId`，不按出现位置复制子图。根视图的 `parentViewId` 为 `null`，其余视图必须沿父级最终到达根视图；面包屑和上一级按该路径生成。子图的 `centerNodeId` 指向所属知识节点，该节点的 `childViewId` 指回此子图。中心节点无需出现在子图画布上，仍可通过“本节笔记”打开详情；若它出现在自身子图中，点击打开详情而非再次进入。

关系定义集中在 `relations` 中，视图用 `relationIds` 选择显示内容；显示的每条关系的两个端点必须都出现在该视图。移除某视图中的关系展示，不等于删除全图关系。分组 ID 在所属视图内唯一；出现位置的 `groupId` 必须属于该视图。

## layout.json

此文件由插件生成、更新和持久化，不属于 DSH 的生成或修改输出。

顶层为 `schemaVersion: 1`、`mapId: string`、`views: object[]`，`mapId` 必须与 `map.json.id` 一致。

| 对象 | 必填字段 |
| --- | --- |
| `views[]` | `viewId: string`、`nodes: object[]`、`groups: object[]` |
| `views[].nodes[]` | `nodeId: string`、`x: number`、`y: number`、`width: number`、`manual: boolean` |
| `views[].groups[]` | `groupId: string`、`x: number`、`y: number`、`width: number`、`height: number` |

位置是视图画布中的未缩放坐标，尺寸为正数，所有数值必须有限。插件按固定模板的字体、宽度和实际内容测量节点高度；连线曲线、箭头与端点由插件计算，不写入内容文件。分组矩形需容纳实际卡片及标题空间。插件处理后布局与结构中的视图、出现位置和分组一一对应；合法空视图使用空数组。

`manual: true` 表示用户手动放置的位置。常规内容修改保留全部已有位置；新增节点只补自身布局，不能借机重排已有节点。只有用户明确要求重新布局某视图时才可调整该视图；拖动节点标记为手动位置。正文不因拖动而修改。

新图没有 `layout.json`、新增节点尚无位置，均是合法内容输入。插件读取结构后为缺少布局的对象计算位置，并清理已移除对象的布局记录；保留其他有效位置，尤其是手动位置。缺少布局不得作为要求 DSH 补坐标或读取原型的理由。已有布局文件若格式错误或绑定其他地图，报告具体错误并保留最近有效状态，不静默覆盖。节点测量、避让和视觉验收属于插件实现与验证工作。

## Markdown 与资源

默认每个有详情的节点使用 `notes/<nodeId>.md`；空笔记省略 `notePath` 且不建空文件。已有合法 `notePath` 保持不变。v1 的一份笔记文件对应一个知识节点；同一节点的多处出现共用这份笔记。

详情按下列可选二级标题组织，顺序对应 v17：`## 简介`、`## 核心理解`、`## 关键公式 / 规则`、`## 典型示例`、`## 学习提醒`。不适用的段落省略；需要进一步分节时在相应段落下使用三级标题。节点标题以 `map.json` 为准，不在笔记中另存一份元数据。保留段落、列表、符号说明和可读公式，不将整段 Markdown 塞入 JSON 字符串。

公式注明变量、条件及必要单位。支持行内 `$…$`、`\(…\)` 和独立块 `$$…$$`、`\[…\]`。仍保存 Markdown 中的定界和源式。普通价格可用转义美元符号，代码保持文本，错误公式显示原式。原始 HTML、脚本和指令性文本都不能作为可执行内容。可在对应段落中记录真实的教材章节、页码或来源链接，无法核实的来源不能编造。

`notePath` 相对地图目录解析，真实目标必须位于所属地图目录；Markdown 中本地资源路径相对笔记文件解析，例如 `../assets/figure.png`，解析并检查链接后的真实资源目标必须位于本图 `assets/` 内。不能借绝对路径、符号链接或路径跳转绕过相应边界。资源实际存在才可声明已纳入；导出时将所需资源封装进独立 HTML。

## 引用、版本和写入边界

- 草稿引用携带地图 ID、节点 ID、来源视图、原文快照、前后文定位线索及内容指纹；来源工作区/资源地址由宿主绑定。会话绑定、草稿、引用快照和临时阅读位置不写入地图文件，也不进入分享文件。
- 内容指纹由实际读取的结构、笔记、资源和布局计算；不得用 `schemaVersion`、时间戳或模型自行猜测的修订号代替冲突检查。仅修改笔记不要求顺带重写 `map.json`。
- 修改前读取相关文件及其引用依赖；提交时由工具检查读取以来是否变化。只要影响本次操作的内容发生变化，就重新读取并评估，不覆盖新版本。不能仅靠提示词保证并发安全。
- 多文件操作需要工具提供完整校验、提交和失败恢复能力。未验证这种能力时只输出变更提案，不用顺序覆盖多个文件冒充事务；具体宿主写入实现留待技术规划验证。
- 删除必须区分“从视图移除出现位置”和“全图删除节点”。删除前列出受影响的关系、出现位置、子图入口及笔记，按产品规范确认影响；不递归删除仍被其他对象引用的知识。无权限或操作失败如实返回。
- 无效 JSON、重复身份、悬空内容引用、父级循环、错图布局、缺失笔记或路径越界均不得静默修复后写回；新图或新增节点缺少派生布局按上文由插件补齐。未知格式版本先报告，不能当 v1 强行重写。

配套提示词见 [生成与修改提示词](mindmap-authoring-prompts.md)。本文件只定义数据契约，不选择前端框架、图形库、事务机制或 DSH API。

## 插件内部恢复资料

受控写入时按需建立本图 `.transactions/`，保存操作记录、受影响文件前镜像与候选内容，用于失败回退、重启恢复和本次编辑撤销。它不是新的知识数据源，不改变map.json、Markdown和layout.json职责；不含聊天、凭据或本机绝对路径，不进入内容指纹、搜索或分享。具体格式和清理规则见[保存与回退设计](../specs/001-sidebar-knowledge-atlas/contracts/persistence.md)。本条为规划设计，功能尚未实现。

## 思维导图选择与收纳（2026-11-15）

用户可见名称统一为“思维导图”，技术标识与已有数据目录保持兼容。
手动打开进入选择页，由用户选择导图；不自动打开第一张或记忆中的导图。引用回跳携带 mapId，仍直接进入来源。画布可返回“全部导图”。

收纳目录与导图内的节点／子图层级独立：按学科或项目创建文件夹，再按章节建立子文件夹；导图归属于一个文件夹，未归档的显示在根目录。目录可折叠，标题搜索跨文件夹；开启“整理”后选择导图的目标文件夹。文件夹名允许重复，以完整路径区分；导图同名以稳定 ID 区分，不覆盖。

`dsh-knowledge-maps/library.json` 是插件维护的单文件目录索引：

```json
{
  "schemaVersion": 1,
  "folders": [{ "id": "physics", "title": "原子核物理", "parentId": null }],
  "mapFolders": { "map-id": "physics" }
}
```

文件夹使用稳定 ID 与 parentId；父级必须存在且无环，mapFolders 的值必须指向已有文件夹。索引缺失合法，已有地图显示在根目录；无效索引报告错误，不静默覆盖，导图内容仍可在根目录读取。外部删除地图遗留的归档记录不创建虚假地图。目录刷新重新读取索引，不自动观察目录索引。

归档只原子更新索引，不移动 `dsh-knowledge-maps/<mapId>/`，不修改 map.json、Markdown、layout.json 或引用地址。采用宿主 createIfAbsent / replaceIfVersion，过期写入失败后由用户刷新重试。所有读写绑定来源工作区，并检查真实路径边界。索引不交给模型维护。

“新建导图”只创建根目录下一张合法的空白 map.json（随机 UUID、空根视图），不生成示例知识、空笔记或占位资源目录；用户通过选择页打开，再准备知识内容。同名地图获得不同 ID。创建后可通过整理归档，两个操作各自保存，不作为一次跨文件事务。布局由插件按原有规则补齐。此增量不提供文件夹删除／改名、拖拽归档或地图内容编辑。

## 0.2.2 管理增量

library.json增加可选deletedMapIds（稳定地图ID数组），缺省视为空。列表在正常目录中排除这些地图，回收站中可恢复；文件保持原路径，恢复只移除标记。已删除地图拒绝正常读取/重命名/布局保存，引用保留原文并提示先恢复。mapFolders可保留回收站图的归档关系；删除文件夹将其直接子文件夹和归属图改到该文件夹的parentId，根级则移除mapFolders记录。操作整体使用library.json版本条件写入。

管理页地图重命名只条件写map.json.title；根视图标题等于旧地图标题时同步改名，其他视图标题保持，ID/目录/notePath/layout.json不变。不存在递归内容删除或多文件事务。移除空白新建导图界面入口，保留历史底层创建代码，不代表AI创建工具已注册。

## 0.3.1 回收站元数据

library.json在原schemaVersion:1下增加可选字段：deletedMapTitles为mapId到标题的映射，用于内容文件已部分删除时保留回收站名称；purgingMapIds为已开始永久删除、只能继续删除的地图ID数组；purgedMapIds为已永久删除的身份墓碑，防止残留目录重新进入有效目录。原deletedMapIds仍表示回收站条目，mapFolders保存还原位置；还原清除deletedMapIds和对应标题，永久删除成功另清除mapFolders。文件夹删除只调整索引，导图及子文件夹上移。

`.transactions/purge.json`记录mapId、deleting/completed状态和已读取内容文件的相对path/version，不存正文、凭据或会话。永久删除不是可回退编辑事务：按版本条件删除结构、布局、笔记及已引用资源，map.json最后删除；中断保留清单并继续，外部新版本不覆盖。已开始删除的地图不能还原，未知文件、未引用资源、已有exports和必要内部记录保留。删除过程认领active.json（kind:purge），不能与内容工具并行；进程退出残留认领经用户明确确认原操作结束后释放，再从回收站继续删除。

## 0.4.0 编辑与自动保存增量

代码支持 layout v1/v2；v2 顶层为 schemaVersion:2、mapId、views，每个视图新增 mode（vertical/grid/columns），节点/组身份与坐标字段沿用。v1 按纵向解释模式但保留坐标，只读不升级；首次实际布局修改才写 v2，详情编辑不升级布局。目标以外视图的坐标保持；升级时仅补模式默认值。旧插件会拒绝 v2，不承诺降级可读。

新图片使用 `assets/<id>.image.json`：schemaVersion:1、kind:image、id、mimeType（PNG/JPEG/WebP）、encoding:base64、byteLength、sha256、data。Host 复核规范编码、字节头、长度和摘要，通过官方条件文本写创建，不引入 writeBytes。单图 8 MiB、新增图像合计 16 MiB/请求、请求 24 MiB、事务日志 48 MiB（另预留小型回执及版本字段空间）。图片不可变，同 ID 同内容可复用，冲突拒绝；引用删除和撤销不删除磁盘资源。

新图片与引用正文同一事务。新资源回退必须匹配 writeText 返回的实际写版本；无法证明时保留恢复资料。清空正文删除原笔记引用及文件；同会话撤销从 Host 保留的原合法路径恢复，路径被其他文件占用时拒绝。无既有笔记的空正文不创建文件。

资源缺失或损坏允许 UI 只读降级，提供逐项诊断、writable:false、空 fingerprint；结构错误、路径越界不能降级绕过。提交候选始终严格读取。原二进制资源继续支持，导出只打包当前有效内容与必要资源。

工作副本、800ms 编辑批次、最多 30 步历史和资源池仅在插件会话内。正常切图/关闭清历史；宿主直接关闭保留未保存副本并由协调器继续处理，重开先复核版本；应用退出或插件卸载不承诺恢复。公开模型工具不接收布局、图片编码或任意路径。

0.4.0-preview.2 已启用自动保存，保存专项结果见 [内部记录](validation/edit-layout-history-internal.md)。

## 0.4.0-preview.6 节点笔记只读图块

图块保存在节点 Markdown 的独立 `dsh-plot` 围栏中，字段含 `version: 1`、节点内唯一的 `id` 和 `kind`（`function`、`bar` 或 `line`）。函数式与统计数据见 [图块格式](../specs/004-function-plot/contracts/plot-markdown.md)。旧笔记无需迁移，历史坏块可以局部原文回退。手动保存保留已有围栏原文，AI 写入候选在保存前校验。离线分享读取已保存的 Markdown、布局和资源。

## 0.4.0-preview.8 整图编辑与固定分组背景

编辑器可整体移动和删除有效且 ID 唯一的图表，保留围栏定义和旁边原文。保存后的撤销只接受本次编辑作用域中已确认删除的同一围栏。普通画布节点移动保留已有分组矩形，单独保存节点位置，显式排列或重置继续生成当前视图布局。两项沿用现有文件格式和事务。详见 [节点详情契约](../specs/005-unify-note-presentation/contracts/note-detail.md) 和 [分组背景设计](../specs/005-unify-note-presentation/plan.md#画布背景修复与验收)。

## 008 管理页手动排序增量

`library.json` 继续沿用 `schemaVersion: 1`，新增可选字段 `rootMapOrder`（根目录导图 ID 数组）与 `folderMapOrders`（`folderId -> 导图 ID 数组` 映射），分别记录根目录和各文件夹内部的导图展示顺序；文件夹排序直接沿用 `folders` 数组顺序。`folderMapOrders` 的键必须指向已有文件夹，各排序列表内部禁止重复 ID，且同一 `mapId` 不得同时出现在多个排序列表中。

管理页强制单层文件夹（新建及文件夹重排统一写 `parentId: null`，不嵌套文件夹；schema 保留 `parentId` 校验以兼容历史索引）。未收录在排序列表中的新增或还原导图按原目录先后追加至对应层级末尾；删除导图（移入回收站）或永久删除同步从排序列表移除该 ID（保留 `mapFolders` 供还原使用），删除文件夹时将其导图按原文件夹顺序追加至根目录末尾（若已有排序）。详见 [008 数据模型](../specs/008-library-drag-sort/data-model.md)。
