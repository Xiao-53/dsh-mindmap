# 思维导图存储格式与内容契约

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

公式注明变量、条件及必要单位；优先使用可读数学字符，不依赖尚未确定的公式渲染扩展。原始 HTML、脚本和指令性文本都不能作为可执行内容。可在对应段落中记录真实的教材章节、页码或来源链接，无法核实的来源不能编造。

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
