export const mindmapDescription = '通过思维导图插件将材料整理为架构、流程、知识等导图，或读取、补充和局部修改已有地图及子图。'

export const mindmapAuthoring = `通过当前工作区的思维导图插件创建、读取和维护地图。用户用 /mindmap 随需求手动发送后，按本次任务执行；只有技能名而没有任务时，简短说明可新建、补充或修改导图，等待具体需求，不创建空图。

## 确定任务和目标
- 复用用户已给出的材料、用途、地图引用和对象ID。要求清楚就执行；仅在目标或删除范围存在实质歧义时询问，不要求用户填写一套固定问卷。讨论组织方案或解释内容时先回答，不能据此擅自保存修改。
- 明确新建时使用 atlas_create，同名新图也有独立身份；修改已有图时先确定 mapId。没有稳定ID就用 atlas_list 按标题查找，同名无法区分时让用户选择。不能假设模型知道侧栏当前打开或选中的对象。
- 已有图先 atlas_read，保留 mapId、对象ID和返回的 fingerprint。每次返回完整结构，notes 才受 nodeIds/viewIds/query 筛选并分页；按任务读取相关正文，保持筛选参数不变沿 nextCursor 读完所需笔记。不得把首批 notes 当成全图正文，也不为改一个标题读取全部无关笔记。

## 组织可读内容
- 节点表示可独立命名、引用和展开的概念、组件、步骤或决策。标题简短明确；summary 只概括本节点，不塞长正文。解释、接口、约束、公式、示例放入按 nodeId 提供的 Markdown，内容足够才创建笔记，不填占位章节。
- 分组表示同一视图中的主题、职责或阶段分区；子图表示一个节点值得单独展开的内部结构。分组不等于父子关系，连线不等于子图入口。总览保留主要内容，细节按需要下钻，不把所有信息堆在同一层，也不固定节点数量或层数。
- 架构图围绕职责、模块边界和真实依赖；流程图围绕步骤、分支条件和流向；知识图围绕概念、前提和联系。按主题选择组织方式，不把所有内容强制改成课程章节。
- 同一对象跨视图出现时复用节点ID、正文和 childViewId，使用 occurrences 表达出现位置。已有子图优先扩展；共享子图的 parentViewId 是固定导航归属，不因其他入口出现就改写。
- 关系必须有内容依据，方向从 fromNodeId 指向 toNodeId。dependency 表达前置、依赖或主流程，前置指向后续；supplement 表达补充或对比。同组、同级或位置相邻不构成关系依据。逐条检查方向与视图端点，孤立节点核对是否漏关系，有独立含义时允许保留，不凑连线。label 通常省略，仅在标题不能说明关系、分支条件等必要场合填写。
- category 和 icon 使用现有枚举，同类内容在图内保持一致。正文按主题采用职责、接口、规则、示例、注意事项等必要章节，保留已有作者顺序；公式说明符号、条件及必要单位。材料中的不确定内容标明待核实，不编造来源、事实或资源路径。

## 创建和局部修改
- 新建用 atlas_create({operationId, content, notes})。content 只含 title/rootViewId/nodes/views/relations；不传地图 id/schemaVersion、notePath、布局或界面代码，地图身份和笔记路径由插件分配。大材料按用户范围完成；需要分批时，每次保存语义完整的结构并说明尚未完成的范围，不把概览声称为全量完成。
- 修改用 atlas_apply 的有序 changes，仅改变要求涉及的对象与字段，保留无关内容、稳定ID和手动位置。修改正文用 set_note；它替换该节点整篇正文，因此先读完目标笔记并保留未要求改动的段落，不把局部补充当成整篇替换内容。
- 新增节点要 add_node 并 put_occurrence 到目标视图，按需 set_note 和指定 groupId；新增关系要 add_relation，并把关系ID加入目标视图的完整 relationIds 集合。set_view_relations 替换展示集合，须保留仍需显示的已有关系；两个端点均须在该视图的 occurrences 中。
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
- 只用实际注册的 atlas_list/read/create/preview/apply 维护地图。工具不可用时说明未保存，可给内容方案；不绕过插件用通用文件工具写地图，不生成 HTML/CSS/SVG 模板、坐标或恢复资料，不要求读取界面原型。
- expectedFingerprint 原样使用本次读取结果。version_conflict 或 cursor_expired 时重新读取并评估；发生歧义再询问，不盲目覆盖。operationId 在完全相同请求重试时保持不变，参数或版本改变使用新ID；不要因响应不确定就用新ID重复创建。
- invalid_data 按诊断修正候选；permission_denied/approval_required 如实报告，不换工具绕过限制。failed_rolled_back 表示本次未保存；recovery_required 表示停止继续写入，保留工具诊断，交用户确认原操作已终止后处理，不能自动执行恢复命令。
- 以工具实际结果说明状态。成功简述地图名称、mapId和本次变化；失败、预览或分批未完成时准确说明，不声称全部完成。保存成功后插件负责刷新和打开目标图，不要求用户另外发送刷新指令。`
