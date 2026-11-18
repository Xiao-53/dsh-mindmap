# 运行时提示词编辑入口

0.3.11补充：失败占位由插件处理；skill提醒模型不扫描或删除地图及事务文件，不把atlas_list.incompleteCreates当成可读取地图。仅用户明确要求时调用atlas_cleanup_create清理指定mapId/operationId并由宿主授权；手动入口在回收站标题右侧“未完成创建”。清理会作废旧请求，不自动重新建图。具体规则见[交付说明](validation/0.3.11.md)。

插件内嵌的mindmap skill没有独立SKILL.md副本，正文和发现描述来自`src/server/prompts/authoring.ts`中的mindmapAuthoring/mindmapDescription；同目录`register.ts`只注册skill。0.3.9起使用DSH原生`/mindmap` skill入口，旧`/minimap`指令及其恢复子命令完全删除。提示词目录为`src/server/prompts/`，编辑后需重新构建安装包并在DSH更新插件。工具参数由`src/server/tools/schemas.ts`校验，修改文案不会改变schema。

## v0.4.1 节点详情与单页组织

`/mindmap` 可根据实际工具说明如何开启详情编辑、原位改公式、移动图片或整张图表，以及何时通过图表和正文位置引用让 DSH 修改内容。新建和扩展时预估每个视图的 `occurrences`，提交前逐页复核默认 20 个以内，并通过子图和详情保留材料覆盖。侧栏交互、自动保存和离线显示按实际观察验收。参见 [本轮可复制验收提示词](validation/dsh-regression-prompt.md#v041-定向验收提示词)。

## 0.3.9 使用流程与内容规则

0.3.10补充：运行时skill已将新建与已有图阅读/修改拆成独立路径，明确新建无需列图查重；已有图身份未知时才列图定位，读图限于本次所需内容或用户指定参考。新增完整创建参数示例和字段语义：nodes/occurrences、relations/relationIds、notes正文映射及子图双向关联；centerNodeId不要求同时出现在子图画布。格式由skill及工具schema提供，不为学习格式读取其他地图、搜索源码或试建地图；用户明确要求复用已有内容时仍可读取。示例只在运行时正文维护，本文件不复制，实际效果见[0.3.10人工场景](validation/0.3.10.md)。

在输入框输入`/`并选择`mindmap`，或直接填写`/mindmap 根据这些材料创建项目架构图`，继续编辑后手动发送。原生skill引用保留在草稿中，由宿主技能界面识别显示；选择或输入skill本身不调用模型，随需求发送时由宿主加载正文。输入框的引用表示已选择，实际创建/修改是否成功以atlas工具结果为准。目标DSH v0.2.2-rc.3的宿主需启用原生`dsh-client-ui-skill`与`dsh-tool-skill`；插件不自造同名命令或第二套输入框标记。当前内嵌skill无文件路径，宿主不会提供SKILL.md文件预览。

本次规则重点：按任务定位地图，按需分页读取正文；区分节点、同层分组和子图；按架构/流程/知识主题组织内容；复用共享节点和已有子图；局部修改保留无关字段，正文补充先读完整目标笔记；区分移除出现位置与全图删除，删除沿用宿主预览/授权。精确布局、背景尺寸和对齐尚未开放工具时如实说明，不生成坐标或改界面文件。

例如`/mindmap 给「服务架构」中的缓存节点补充失效策略，保留其他正文`、`/mindmap 展开订单处理节点的子图`、`/mindmap 只从总览移除缓存节点，保留其他视图`。只有`/mindmap`而没有任务时仅说明可用能力，不新建空图。要求明确时直接执行，目标或删除范围有实质歧义时再询问。真实使用效果交人工验证，见[0.3.9交付](validation/0.3.9.md)。

仓库`.agents/skills/`是Codex/Spec Kit开发技能，与DSH运行时mindmap skill不同。下文为内容格式与示例参考，不会由插件自动读取。关系label为可选，只有必要时才填写；默认可不带解释文字，图中不会补造关系标签。

# 思维导图生成与修改提示词

插件维护完整界面模板，将 JSON 结构与 Markdown 详情填入模板，生成侧边栏界面。布局计算、连线、动画、交互及布局持久化由插件负责。开发参考 HTML 不进入 DSH 上下文。

下方三个代码块是提供给 DSH 的内容：公共数据格式 + 生成或修改任务。字段和枚举完整列在公共块中，DSH 无需读取项目规范、开发文档或界面源码。任务中的方括号由调用方用本次材料、要求和目标对象替换，已有上下文直接复用。（此提示词仅供参考，不作为最终提示词使用，之后按照需求优化调整）

## 工具模式与文件候选模式

地图工具可用时，DSH只提供知识参数，由插件写盘、保存回退和刷新；不调用通用文件工具直接维护地图。工具签名、字段归属和工具模式提示词见[内容与模板契约](../specs/001-sidebar-knowledge-atlas/contracts/authoring.md)。以下公共格式继续作为知识内容规则；其中完整文件输出及路径说明用于无工具时的候选交付，不要求工具模式重复输出文件或计算路径。新图mapId和笔记路径由插件分配，已有身份与合法路径保持。五个atlas工具已注册；运行时模板为src/server/prompts/authoring.ts，由用户随需求手动发送`/mindmap`或模型按需加载skill，不再提前执行加载指令。

## 公共数据格式

```text
生成或修改的内容为 map.json 和节点 Markdown 笔记。插件负责读取数据并显示地图。

map.json 字段（? 表示可选，无值时省略）：
- 顶层：schemaVersion: 1，id: string，title: string，rootViewId: string，nodes: Node[]，views: View[]，relations: Relation[]。
- Node：id: string，title: string，summary: string，category: Category，icon: Icon，notePath?: string，childViewId?: string。
- View：id: string，title: string，parentViewId: string | null，centerNodeId?: string，groups: Group[]，occurrences: Occurrence[]，relationIds: string[]。
- Group：id: string，title: string，number: string，category: Category。数组顺序就是分组顺序。
- Occurrence：nodeId: string，groupId?: string。表示某节点属于该视图及分组，同一视图内不重复出现。
- Relation：id: string，fromNodeId: string，toNodeId: string，type: dependency | supplement，label?: string。
- Category：blue | sage | plum | gold | terra。
- Icon：book | atom | layers | branch | target | spark | flask | check | alert | formula | link | grid | idea | arrows。

数据规则：
- ID 使用字母、数字、下划线或短横线；同类对象内唯一，分组 ID 在所属视图内唯一。标题不是身份，改名保留 ID。summary 是卡片摘要，可为空，正文不放进 JSON。
- rootViewId 指向唯一根视图，其 parentViewId 为 null；其他视图沿父级最终到达根视图，不形成循环。
- 节点通过 childViewId 关联一个子图，子图的 centerNodeId 指回该节点。同一知识节点可在多个视图复用，正文和子图入口共用。中心节点不必出现在自己的子图画布上。
- occurrence 引用已有节点，groupId 属于当前视图。relationIds 引用全图关系，显示关系的两个端点都必须出现在当前视图。
- dependency 从前置条件/提供方指向依赖它的对象；supplement 表示补充或对比，仅在含义或方向不够明确时用 label 说明，通常省略，不为每条线重复解释。知识关系可以成环，分组和父子视图不自动产生知识关系。
- 逐个核对视图中的节点是否具有有依据的前置、后继或补充关系；relationIds 包含应显示的全部关系，箭头方向与 label 的句意一致。不要把孤立的“关键词校验”等测试卡片当成学习内容，也不要为了把图连满而编造关系。只有归类关系时使用分组。
- category 和 icon 只填写上述枚举；不添加坐标、尺寸、连线曲线或样式字段。

笔记规则：
- 有正文的节点使用 notePath，默认 notes/<节点ID>.md，相对地图目录；无正文则省略 notePath，不建空文件。共享节点共用笔记。
- 二级标题按主题自定，按作者顺序阅读；架构可使用职责、接口、约束、数据流等，学习可使用核心理解、公式、示例等，细分内容用三级标题。
- 公式保留适用条件、符号定义和必要单位。LaTeX 行内用 `$…$`，长公式用独立成行的 `$$…$$`。公式仅放在节点正文，普通美元金额用转义美元。例题保留题设、步骤和结论。缺少依据的结论标明待核实，不编造来源或页码。
- 本地图片链接相对笔记文件解析，资源须实际存在且位于本图 assets/ 内；外部来源可以保留为链接。

交付方式：
- 有插件地图工具时，按工具声明的参数提交内容，以工具返回结果判断保存状态。
- 没有地图工具时，按相对文件路径提供候选内容，并标明未保存。JSON 必须可解析，候选新文件提供全文，不用省略号代替内容。
```

## 生成思维导图

```text
根据以下输入生成一张新地图：
材料或主题：[材料正文、可读取材料，或主题]
范围与用途：[架构边界、流程范围、知识主题或学习目标及其他要求]

1. 从材料中提取组件、职责、流程、概念或规则。一个节点表达一个可独立解释的对象；同一概念复用，含义不同的同名概念分开。
2. 用入口视图组织整体脉络。每个视图按 occurrences 计数，默认最多 20 个显示节点，能清楚说明就少放。较长的结构按主题或阶段放入子图，具体解释写入节点详情。同页的多个 groups 仍共用一个节点数。新增节点时检查受影响视图，保留用户未要求重组的既有结构。
3. 仅建立能够说明依据的依赖、补充或对比关系。材料相邻的两个标题不因此构成依赖关系。
4. 生成符合公共数据格式的 map.json 和实际需要的 Markdown。新地图使用新 ID，即使已有同名地图也不复用其身份。只给主题时可以补充一般知识，但区分自行补充与材料已有内容。
5. 检查必填字段、枚举、ID、对象引用、视图父级和笔记路径。材料中的未决结论保留缺口，不能用虚构内容补齐。
6. 按交付方式提交。完成后简述地图标题、ID、内容范围及保存结果；仅有候选内容时不报告创建成功。
```

## 修改已有思维导图

```text
修改指定地图：
目标：[地图 ID，以及节点/视图/关系 ID 或引用上下文]
要求：[本次修改内容]
依据：[补充材料；没有则省略]

1. 读取目标地图当前结构、相关笔记与引用依赖，使用读取结果中的版本信息提交修改。同名目标无法唯一定位时，只询问用于区分目标的信息。
2. 按修改类型确定数据变化：
   - 改名：只改对应 title，保留 ID、笔记路径和关联。
   - 纠错或补充：改对应 Markdown 段落；summary 因此失实时一并更新。
   - 扩展子图：已有 childViewId 就扩展原子图；没有才创建并关联。相同概念复用原节点。
   - 修改关系：修改对应 Relation，并检查所有引用该关系的视图。
   - 从当前视图移除：只删该 occurrence 和本视图中失去端点的 relationIds，保留全图节点、笔记、关系定义及其他视图。
   - 全图删除：先列出受影响的出现位置、关系、笔记和子图。按已确认的影响范围处理，已有确认不再重复询问；保留仍被其他知识使用的对象，不留下悬空引用。
3. 保留未涉及的字段、对象、正文和文件顺序。修改共享节点的正文会作用于所有出现位置，不为局部修改复制整张图。
4. 检查修改后的数据规则及本次差异，再按交付方式提交。工具报告版本冲突时重新读取，不能用旧内容覆盖新版本。
5. 无插件地图工具时，给出目标地图、变更文件路径和局部补丁；新文件给全文。完成后只报告实际修改、保存结果和未解决项。
```

## 插件接入约束

以下内容供插件开发使用，不拼入模型提示词：

- 插件持有完整的界面模板和渲染逻辑。DSH 的 JSON 选择内容、分组、关系及既有类别；模板将它们映射到实际界面。
- `layout.json` 由插件生成和维护，不作为模型输出。缺少布局的新图或新节点由插件安排位置；已有手动位置保留，布局变化不反写笔记。
- 模型只接收内容格式、当前任务、所需数据和实际注册的工具契约；不注入原型 HTML、CSS、动画参数或开发验收流程。
- 文件路径检查、数据校验、版本冲突检查、完整提交及失败恢复由插件工具执行。提示词描述内容操作，不承担事务实现。
- 当前文档未实现插件工具。工具签名已在上述技术规划契约中定义，待实现注册；文中的“插件地图工具”不是预设的 API 名称。

## 后续验证案例

| 输入 | 检查结果 |
| --- | --- |
| 新建地图 | 输出结构与笔记；布局由插件生成 |
| 修正公式 | 只改必要正文和失实摘要，既有身份与布局保留 |
| 扩展子图 | 复用原子图，新增知识由插件安排位置 |
| 移除当前视图中的共享节点 | 其他视图和正文仍存在 |
| 删除存在外部引用的节点 | 按已确认影响处理，无悬空引用或误删 |
| 提交时版本变化 | 插件拒绝覆盖，模型依据新版本处理 |
| 没有地图工具 | 返回候选内容或补丁，明确未保存 |

这些案例待插件接入后验证，不是已执行的测试结果。

## 0.3.0 实际工具参数示例

`atlas_create`接受`{operationId, content:{title,rootViewId,nodes,views,relations}, notes:{nodeId:markdown}}`，不传mapId、schemaVersion、notePath。新图operationId对应独立身份，重复请求复用ID，另建同名图使用新operationId。`atlas_read({mapId})`返回完整结构、每页最多10个节点笔记及nextCursor，后续读取保留筛选参数；版本变化cursor过期。

局部改名：`changes:[{op:"set_map_title",title:"新名称"}]`。改公式或接口约束：`[{op:"set_note",nodeId:"目标ID",markdown:"新正文"}]`；不会改写未变结构。扩展子图使用`add_view`的`view`及`set_child_view`的nodeId/viewId，已有childViewId则扩展原视图。增加节点使用`add_node`的`node`，出现位置使用`put_occurrence`的viewId/nodeId/groupId。

移除单个出现位置：`[{op:"remove_occurrence",viewId:"视图ID",nodeId:"节点ID"}]`，全图节点和笔记保留。全图删除使用delete_node；有子图时先明确解除关联并处理视图，禁止悬空引用。删除先atlas_preview，再将返回previewToken原样传atlas_apply；宿主确认影响，模型不能自填授权字段。previewToken绑定工作区/地图/版本/完整changes，插件重载后需重新预览。

所有修改回传atlas_read返回的expectedFingerprint（读取结果字段名为fingerprint），apply还需operationId；version_conflict时重读并重新评估。恢复要求及人工案例见[0.3.0交付](validation/0.3.0.md)。

## 0.4.0 编辑预览边界

本增量没有新增模型工具或改变 `/mindmap` 入口。模型仍只组织知识结构和 Markdown，不计算坐标、不改 layout.json、不生成图片封装或任意文件路径。手动编辑预览不自动提交聊天草稿；AI 修改经原工具写入后视为外部更新，插件载入该版本时清空旧手动撤销历史。预览的手动保存门槛及验收状态见 [交接记录](validation/edit-layout-history.md)。

## 0.4.0-preview.6 节点笔记图块

`/mindmap` 支持用节点 Markdown 的 `dsh-plot` 围栏表达函数图、柱状图与折线图。函数式、范围和真实统计数据按 [图块契约](../specs/004-function-plot/contracts/plot-markdown.md) 组织。用户手动发送明确指令后，按地图、节点和图块 ID 重读并核对快照，随后沿用 `set_note` 和读取所得版本；删除图块也走现有预览和宿主授权。

## 0.4.0-preview.8 正文位置引用

用户在编辑正文时右键选择「添加图表/公式」，引用带来源地图、节点、点击点和段落。用户手动发送明确任务后，运行时 skill 指导 DSH 读取目标笔记与地图版本，并将原 `anchor` 交给单项 `insert_note_content`。服务端校验实际源码位置和插入片段。目标失效时请用户重新选点。图块引用仍用于按 ID 修改对应图表。具体行为见 [定位契约](../specs/005-unify-note-presentation/contracts/dsh-insertion-reference.md)。
