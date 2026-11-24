export const mindmapDescription = '在工作区创建、读取与维护思维导图，按视图组织节点和详情，按文本、图表或正文位置引用查找和修改内容。'

export const mindmapAuthoring = `通过当前工作区的思维导图插件创建、读取和维护地图。用户用 /mindmap 随需求手动发送后，按本次任务执行；只有技能名而没有任务时，简短说明可新建、补充或修改导图，等待具体需求，不创建空图。

## 确定任务和目标
- 复用用户已给出的材料、用途、地图引用和对象ID。要求清楚就执行；仅在目标或删除范围存在实质歧义时询问，不要求用户填写一套固定问卷。讨论组织方案或解释内容时先回答，不能据此擅自保存修改。
- 新建：依据本次材料组织 content 和 notes，直接 atlas_create；无需先列图检查同名，新图同名也有独立身份。仅当用户要求查找、查重或复用已有图时，才为该任务查询已有地图。
- 阅读或修改已有图：先确定目标 mapId；仅在目标身份未知时用 atlas_list 按标题定位，同名无法区分时让用户选择。已有明确 mapId 就直接 atlas_read。不能假设模型知道侧栏当前打开或选中的对象。
- atlas_read 用于获取本次任务确实需要的已有内容。每次返回完整结构，notes 才受 nodeIds/viewIds/query 筛选并分页；按任务读取相关正文，保持筛选参数不变沿 nextCursor 读完所需笔记，修改时保留返回的 fingerprint。不得把首批 notes 当成全图正文，也不为改一个标题读取全部无关笔记。
- 创建格式依据本skill的契约、示例及工具参数，不依赖用户历史地图。不要为了学习格式而搜索插件源码、读取无关地图或先创建试验图；只有本次内容任务需要或用户指定参考时才读对应地图。历史实例中的一种合法写法不构成必填规则；校验失败时按工具诊断修正实际任务的候选。

## 组织可读内容
- 起始节点独立性自检：生成或扩展后逐一核对无前置（入度为 0）的节点，确认它是独立入口、前置在范围外，还是漏连了真实依赖。允许多个合理起始节点并存；严禁为了凑“唯一根节点”或把画布连满而在并列模块间编造 dependency。
- summary 与笔记正文禁止使用“了解 XX / 理解原理 / 掌握用法 / 负责相关处理 / 进行下一步”等不可检验的空泛套话。架构节点写明核心职责、接口与上下游边界/失效约束；流程节点写明触发条件、处理动作与分支判据/产出；学习与知识节点写明核心机制边界与可观察的检验标准，例如能自行推导结论或排查某类典型错误。
- 节点表示可独立命名、引用和展开的概念、组件、步骤或决策。标题简短明确；summary 只概括本节点，不塞长正文。解释、接口、约束、公式、示例放入按 nodeId 提供的 Markdown，内容足够才创建笔记，不填占位章节。
- 先确定总览要回答的问题，只放主要主题、关键步骤和必要关系。可独立展开的结构放进所属节点的子图；属于同一对象的定义、解释、参数、公式和示例写进详情。比如 30 步流程可在总览展示几个有意义的阶段，再在各阶段的子图或详情完整保留具体步骤。
- 默认每个视图最多 20 个显示节点，能讲清楚就少放。按每个视图的 occurrences 计数，同页多个 groups 合计。生成或扩展前预估，提交前复核。预计超出时按实际主题或阶段拆分，并确认材料仍能在子图或详情找到。用户明确要求同页展示时按要求组织。
- 分组用于同层分区，子图用于展开某个节点的内部结构。根据内容决定是否继续下钻，优先复用已有子图。
- 架构图围绕职责、模块边界和真实依赖；流程图围绕步骤、分支条件和流向；知识图围绕概念、前提和联系。按主题选择组织方式，不把所有内容强制改成课程章节。
- 同一对象跨视图出现时复用节点ID、正文和 childViewId，使用 occurrences 表达出现位置。已有子图优先扩展；共享子图的 parentViewId 是固定导航归属，不因其他入口出现就改写。
- 关系必须有内容依据，方向从 fromNodeId 指向 toNodeId。dependency 表达前置、依赖或主流程，前置指向后续；supplement 表达补充或对比。同组、同级或位置相邻不构成关系依据。逐条检查方向与视图端点，孤立节点核对是否漏关系，有独立含义时允许保留，不凑连线。label 通常省略，仅在标题不能说明关系、分支条件等必要场合填写。
- category 和 icon 使用现有枚举，同类内容在图内保持一致。正文按主题采用职责、接口、规则、示例、注意事项等必要章节，保留已有作者顺序；公式说明符号、条件及必要单位。LaTeX 行内用 $…$，长公式用独立成行的 $$…$$，公式放在 Markdown 正文。材料中的不确定内容标明待核实，不编造来源、事实或资源路径。

## 节点详情的编辑与引用
- 需要指导用户操作时，从详情底部「复制内容」旁的「编辑」开始。标题、粗斜体、列表和公式可在正文原位改，光标进入时可编辑 Markdown 标记，离开后恢复排版。完成输入后自动保存，正文内可用 Ctrl+Z / Ctrl+Y 撤销或重做。
- 用户可在编辑态直接拖动图片、用把手拖动图表到正文块之间，也可删除对应引用或整张图。图表数据由用户描述需求后通过下文的 atlas 流程更新。已有图片路径按原引用保留，上传图片和导出只读 HTML 通过侧栏界面完成。
- 需要请 DSH 添加内容时，引导用户在编辑态正文右键选择「添加图表/公式」，或在块间空白选「添加此位置到正文」，然后写明需求并手动发送。修改已有图表可先用图表右键加入引用。读到用户发来的选文、图表或位置引用时，以其中的来源标识定位。

## 节点笔记图块
- 用户要求绘图时，在目标节点正文插入顶层 dsh-plot 围栏，首行用三个反引号接 dsh-plot，末行用三个反引号，中间只放 JSON，围栏前后留空行。只给数据，由插件绘制。
- 函数图示例：{"version":1,"id":"quadratic","kind":"function","title":"二次函数","series":[{"expression":"x^2"}]}。同轴可放 1–3 条式子，每式至多 256 字符，label 可选。使用 x、pi/e、四则、显式乘号、括号、幂和 sin、cos、tan、sqrt、abs、exp、ln；三角函数用弧度。xRange/yRange 各默认 [-5,5]，可分别给两个严格递增有限数。
- 柱状图示例：{"version":1,"id":"counts","kind":"bar","categories":["甲","乙"],"series":[{"label":"计数","unit":"次","values":[0,3]}]}。kind 也可用 line，折线可省略 categories，按 1 起的序号绘制。每图 1–3 系列，每系列 1–100 个等长值，统一按类目顺序；null 表示缺值，0 是已知数值。保留原单位和真实数据；缺少所需数据时说明或按用户授权取得，不推测成事实。
- 图块 ID 在节点笔记内唯一，修改保留 ID。同名图按地图、节点和图块 ID 定位。

## 新建契约与完整示例
- atlas_create 参数为 operationId、content、notes。content 只含 title/rootViewId/nodes/views/relations；不传地图 id/schemaVersion、notePath、布局或界面代码，地图身份和笔记路径由插件分配。notes 是节点ID到Markdown字符串的对象；无正文的节点省略对应键，全部无正文时传 {}。正文不写进 nodes，notes 中的每个键必须对应本次 content.nodes 的节点ID。
- nodes 定义对象，views[].occurrences 决定哪些节点显示在该视图；定义节点本身不会自动让它显示。groups 定义视图内分区，groupId 只能引用同一视图的分组；groups 可以为空，未分组的出现位置省略 groupId。必填数组即使为空也要提供。
- relations 定义全图关系，views[].relationIds 决定该视图显示的关系；只定义全图关系不会自动展示。展示关系的两个端点都必须在该视图的 occurrences 中，centerNodeId 不替代出现位置。
- centerNodeId 表示子图所属节点，不是每张图都需要的“画布中心”。普通根视图省略它；有子图时，所属节点的 childViewId 与子图的 centerNodeId 双向对应，子图 parentViewId 指向其导航父视图。所属节点可以不出现在自己的子图画布；只有需要展示它或让它参与本视图连线时才把它加入 occurrences。不因设置 centerNodeId 就复制节点或强制加入分组。

下面是两节点、一分组、一关系、一根视图及节点正文的完整创建参数示例，仅说明字段组合。实际任务按材料组织内容并分配本次 operationId，不照搬主题、节点数量或先保存此示例。
{
  "operationId": "example-request-flow-001",
  "content": {
    "title": "请求处理流程",
    "rootViewId": "overview",
    "nodes": [
      {"id": "receive", "title": "接收请求", "summary": "读取并校验请求参数", "category": "blue", "icon": "arrows"},
      {"id": "process", "title": "处理请求", "summary": "依据有效参数执行处理", "category": "blue", "icon": "check"}
    ],
    "views": [{
      "id": "overview", "title": "流程总览", "parentViewId": null,
      "groups": [{"id": "main", "title": "处理流程", "number": "1", "category": "blue"}],
      "occurrences": [{"nodeId": "receive", "groupId": "main"}, {"nodeId": "process", "groupId": "main"}],
      "relationIds": ["receive-process"]
    }],
    "relations": [{"id": "receive-process", "fromNodeId": "receive", "toNodeId": "process", "type": "dependency"}]
  },
  "notes": {"receive": "## 职责\\n读取并校验请求参数，校验通过后交给处理步骤。"}
}
示例中根视图没有 centerNodeId；正文只属于 receive，process 没有笔记；receive-process 同时有全图定义和视图展示引用。实际内容需要子图时，在同一次创建中补齐所属节点 childViewId 与子图 centerNodeId/parentViewId，无需另找历史地图作格式样例。

大材料按用户范围完成；需要分批时，每次保存语义完整的结构并说明尚未完成的范围，不把概览声称为全量完成。

## 局部修改
- 按已有图表引用修改时，先用 atlas_read 重读目标节点，按图块 ID 和引用快照核对。只有周围文字变动时，用最新 fingerprint 继续；目标图块已变化、找不到或无法核对时，说明情况并请用户重新引用。
- 修改用 atlas_apply 的有序 changes，仅改变要求涉及的对象与字段，保留无关内容、稳定ID和手动位置。修改正文用 set_note；它替换该节点整篇正文，因此先读完目标笔记并保留未要求改动的段落，不把局部补充当成整篇替换内容。
- 常规图块增删改用 set_note。删除图块先用 atlas_preview 核对图块删除影响，再提交同一版本、同一候选和 previewToken，由宿主处理授权。版本冲突后重读时重新核对目标图块，不按同名或位置猜测。
- 新增节点要 add_node 并 put_occurrence 到目标视图，按需 set_note 和指定 groupId；新增关系要 add_relation，并把关系ID加入目标视图的完整 relationIds 集合。set_view_relations 替换展示集合，须保留仍需显示的已有关系；两个端点均须在该视图的 occurrences 中。
- 用户带「正文位置」引用明确要求添加图表或公式时，用 atlas_read 按引用的 mapId、nodeId 重读，取得最新 fingerprint。将引用里的 anchor 对象原样传给 atlas_apply 的唯一变更项 {op:"insert_note_content",nodeId,anchor,kind,markdown}。kind 为 inline_formula、display_formula 或 plot，markdown 只含一项完整内容。行内公式优先用 \\(…\\)，独立公式用独立块，图表用带新且唯一 ID 的 dsh-plot 围栏。段落文字定位时，插件将行内公式插到点击处，将独立公式或图表放在该段后。空白定位（anchor.kind 为 gap）时，插件将请求内容放在选中的块间或正文首尾。
- 定位插入失败时保留现有笔记。位置变更或不唯一时请用户重新右键选点。遇地图版本冲突可重读并用原 anchor 重新核验。定位错误不能用 set_note 绕过，不能按同名或可读快照猜位置。仅收到引用或用户只提问时不写入。
- 扩展已拥挤的视图时，优先补到合适节点的详情或子图，已有结构的重组依用户需求执行。
- 扩展子图先查节点 childViewId；没有时 add_view 并 set_child_view，设置正确 parentViewId 和 centerNodeId，关联两端一致。add_node 不接收 childViewId，修改时通过 set_child_view 关联。一次 changes 可组合相关操作，最终候选必须整体合法。
- 调整分组归属使用 put_occurrence，移除分组前显式安排原成员去向。只在某视图移除节点用 remove_occurrence，保留全图对象及其他视图；全图 delete_node 会影响所有出现位置、关系和正文，有子图时先明确处理关联。delete_view 也须处理子视图父级和节点入口，不能暗中级联删除共享内容。
- 分区可调整分组内容、归属和现有 category；精确排布、背景尺寸与对齐等未开放工具的操作，说明当前能力边界，不用重建对象或生成坐标冒充完成。
- 删除或移除正文、关系、分组、出现位置、视图等先 atlas_preview 核对 removals，再以同一版本、完全相同的 changes 和 previewToken 调用 atlas_apply。用户授权由宿主确认，不自填 confirmed，不以对话文字替代宿主授权；预览本身不代表已保存。

## 字段速查
- ID 为非空字母、数字、下划线或短横线组合，同类对象内唯一；改标题不改身份。
- Node：id/title/summary/category/icon；新建 content 中可选 childViewId。category：blue/sage/plum/gold/terra；icon：book/atom/layers/branch/target/spark/flask/check/alert/formula/link/grid/idea/arrows。
- View：id/title/parentViewId/groups/occurrences/relationIds，可选 centerNodeId；根 parentViewId 为 null，其余父级最终到根且无环。Group：id/title/number/category；分组数组顺序表达分区顺序。Occurrence：nodeId，可选 groupId；同一视图不重复节点。
- Relation：id/fromNodeId/toNodeId/type，可选 label；type 为 dependency/supplement，关系允许成环。具体 changes 的 op 和参数结构以实际工具 schema 为准，不猜测不存在的操作。

## 保存与反馈
- 新建或重组完成后，简明说明本图覆盖范围、刻意未纳入的外部范围及推荐的默认阅读起点节点。AI 生成内容不代表待核实事实已确认。
- 新建或新增节点前，复核每个新建或扩展视图的 occurrences 数量，并检查拆分后各视图的关系端点仍在该视图内。
- 只用实际注册的 atlas_list/read/create/preview/apply 维护地图，atlas_cleanup_create 仅处理用户明确要求的未完成创建清理。工具不可用时说明未保存，可给内容方案；不绕过插件用通用文件工具写地图，不生成 HTML/CSS/SVG 模板、坐标或恢复资料，不要求读取界面原型。
- expectedFingerprint 原样使用本次读取结果。version_conflict 或 cursor_expired 时重新读取并评估；发生歧义再询问，不盲目覆盖。operationId 在完全相同请求重试时保持不变，参数或版本改变使用新ID；不要因响应不确定就用新ID重复创建。
- invalid_data 按诊断修正候选；permission_denied/approval_required 如实报告，不换工具绕过限制。failed_rolled_back 表示本次未保存；recovery_required 表示停止继续写入，保留工具诊断，交用户确认原操作已终止后处理，不能自动执行恢复命令。
- 创建失败的回退和占位清理由插件负责；不要自行扫描或删除地图目录及事务文件。atlas_list 的 incompleteCreates 是未完成创建记录，不是可读取地图。用户明确要求清理时，从该列表确定 mapId/operationId，调用 atlas_cleanup_create 并由宿主授权；不使用内容删除工具，不在新建成功后顺便清理其他记录。清理会作废原创建请求，create_discarded 时停止重试该ID，用户重新要求建图后才使用新ID创建。
- 以工具实际结果说明状态。成功简述地图名称、mapId和本次变化；失败、预览或分批未完成时准确说明。保存成功后插件负责刷新和打开目标图。被问及验收时，atlas 工具可核对结构、正文和提交结果，侧栏交互、自动保存及离线呈现以实际操作观察为准。`
