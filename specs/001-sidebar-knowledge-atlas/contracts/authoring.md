# 内容、模板与工具职责契约

## 唯一主路径

DSH生成知识内容 → 调用插件工具 → 插件校验并写入地图目录 → 插件读取已提交文件 → 固定模板渲染侧栏。

“DSH写入内容”指DSH提供工具参数，不指模型自行操作磁盘。地图工具可用时，不要求模型调用通用文件工具维护地图，也不让模型编写HTML、CSS、SVG、坐标或恢复记录。没有地图工具时仍可提供未保存的JSON/Markdown候选内容，不能声称创建成功。

## 逐项归属

| 对象 | DSH提供／选择 | 插件维护 |
| --- | --- | --- |
| 界面模板 | 无 | 标题栏、面包屑、画布、分组框、卡片、详情栏目、搜索、菜单、按钮及空/错误状态 |
| 呈现规则 | category、icon枚举值 | 枚举对应的颜色和图标、字体、间距、端点样式、连线路径、动画、侧栏适配 |
| 地图知识结构 | 标题、节点、分组、视图父级、出现位置、子图关联、关系方向及类型 | 校验、稳定身份保护、序列化为map.json、读取索引 |
| 节点详情 | 简介、核心理解、公式/规则、示例、提醒等Markdown正文 | 按栏目渲染，缺项不占位；文本选择、复制和引用；笔记路径分配及文件保存 |
| 地图身份与路径 | 修改时引用读取结果的mapId及对象ID；新内容可提出对象ID | 新图分配mapId/目录，校验对象ID唯一，已存在ID不可因改名改变；保存schemaVersion |
| 布局 | 无坐标；只表达节点属于哪个视图/分组 | 测量尺寸、初始布局、新节点补位、手动位置、layout.json及连线几何 |
| 内容版本 | 原样回传工具读取的版本token | 从真实文件计算版本、提交检查、返回新版本；不让模型猜版本 |
| 保存与删除 | 对象级变更及明确删除范围 | 实际读写、删除、备份、回退、撤销、恢复记录与完成通知 |
| 引用与问题草稿 | 用户发送后针对所给内容回答；不决定草稿发送 | 原文快照、来源身份、草稿插入、回跳；问题按钮只准备可编辑草稿 |
| HTML分享 | 无 | 从有效快照生成自包含HTML，封装资源、去掉宿主动作和会话数据 |
| 提示词 | 本次知识任务、材料及补充要求来自用户 | 内容规则模板、工具说明及本次必要上下文的组合；不把原型和渲染实现发送给DSH |

文件的内容作者与写入者不同：map.json的知识字段和notes的正文由DSH准备、插件写盘；layout.json和恢复记录由插件生成并写盘；界面模板是插件代码，不放入每张地图内容目录。

## 工具设计

以下是插件实际注册的工具名称，不是DSH内置API。运行时schema见src/server/tools/schemas.ts；0.3.9起内嵌skill名称为mindmap，使用DSH原生`/mindmap`引用随需求手动发送，或由模型按需加载。插件不注册同名命令，旧`/minimap`及恢复子命令已删除。工作区由调用上下文绑定，不接受模型传任意绝对路径。

- `atlas_list()`：返回有效地图的mapId、title及摘要；同名地图保留不同身份。
- `atlas_read({mapId, nodeIds?, viewIds?, query?, cursor?})`：未指定过滤时读取全图结构与笔记；指定时返回相关对象、笔记及依赖、fingerprint。较大结果显式分页，返回nextCursor，不能静默截断。版本变化后旧cursor失效。
- `atlas_create({operationId, content, notes})`：content为存储契约Map去掉id和schemaVersion，notes为nodeId到Markdown的映射。节点内容不传notePath，由插件分配；content中的节点/视图/关系ID在候选内唯一且关联有效。插件分配地图ID、路径和schemaVersion=1；创建同名地图不会覆盖。
- `atlas_preview({mapId, expectedFingerprint, changes})`：返回具体变更和删除影响清单、预览token；不写知识文件。删除在此展示影响；token绑定版本和changes摘要，不能拿旧确认执行新删除。
- `atlas_apply({mapId, operationId, expectedFingerprint, changes, previewToken?})`：验证完整候选后作为一个操作保存；已确认的删除范围可复用，不重复询问。previewToken仅证明预览内容，用户授权仍来自宿主交互上下文，不能让模型自填confirmed=true冒充确认。

`changes`为有序对象操作列表，先在内存应用全部操作再校验，不要求每个中间状态都合法：

| op | 参数与规则 |
| --- | --- |
| set_map_title | title；不改mapId或目录 |
| add_node / update_node | add携带完整Node内容字段；update携带nodeId及限定的title/summary/category/icon字段；不允许修改id或直接传notePath |
| set_note / remove_note | nodeId及markdown；插件维护notePath，无正文可明确移除笔记；共享节点不复制正文 |
| add_view / update_view | 新建携带View字段；更新携带viewId及title/parentViewId/centerNodeId变更；childViewId关联通过下述操作一起提交 |
| set_child_view | nodeId、viewId或null；校验子图centerNodeId双向一致，复用已有子图 |
| add_group / update_group / remove_group | viewId、groupId及Group字段；移除时明确相关出现位置的归属，不暗中删除节点 |
| put_occurrence / remove_occurrence | viewId、nodeId及可选groupId；移除时清理本视图失去端点的relationIds，保留全图节点 |
| add_relation / update_relation / remove_relation | Relation字段或relationId及限定变更；全图移除同步清理各视图relationIds |
| set_view_relations | viewId、relationIds；只修改该视图展示集合，端点必须在该视图 |
| delete_node / delete_view | 稳定对象ID；按预览确认的影响清单处理；仍被使用的知识保留，父级和子图引用不得悬空 |

所有工具拒绝知识schema之外的HTML模板、CSS、布局字段或任意文件命令。成功返回status、operationId、mapId、affectedIds、新fingerprint及可读摘要；失败区分invalid_data、version_conflict、failed_rolled_back、recovery_required等，不将部分写入返回success。保存细节见 [persistence.md](persistence.md)。

## 提示词装配

公共内容规则复用 [现有提示词](../../../docs/mindmap-authoring-prompts.md) 的字段、枚举、知识关系和Markdown约束。工具模式下，用工具schema表达参数，不重复要求模型输出一份落盘文件；以下任务片段和公共规则组合。工具仅在实际注册后提供给DSH，不能在未实现阶段注入虚假工具名。

### 工具模式公共规则

```text
通过地图插件工具读取、创建和修改知识内容。不要调用通用文件工具改地图，也不要生成界面、样式或布局坐标。
读取已有地图后，保留mapId和对象ID，提交时原样回传fingerprint；版本冲突先重新读取再评估，不盲目重复旧变更。
只修改本次要求的知识；共享节点复用正文和子图。摘要写在节点，长正文写为Markdown笔记。
新增内容使用约定的字段和枚举，关系必须有知识依据。没有依据的结论标明待核实，不编造来源。
删除先核对工具返回的影响清单，沿用用户已确认范围；范围变化再说明。
以工具返回的保存结果为准。失败说明实际状态，不报告完成；备份、写入、回退和刷新由插件处理。
```

### 新建地图任务

```text
根据[材料]，围绕[范围与用途]整理地图。
提取概念及关系，组织入口视图和必要子图；正文按简介、核心理解、关键公式/规则、典型示例、学习提醒按需编写。
通过atlas_create提交结构和节点笔记，不传路径或布局。材料过大时先创建语义完整的概览，再按用户要求逐步扩展，并说明已完成范围。
完成后简述地图ID、内容范围及工具报告的保存状态。
```

### 局部修改任务

```text
对[mapId及目标对象ID]执行[修改要求]，依据为[补充材料]。
先atlas_read读取相关内容及依赖。用最小changes修改需要的字段、关系或笔记，不重写无关节点；已有子图优先扩展。
删除先atlas_preview核对影响；已获授权的范围不重复询问。通过atlas_apply提交，版本使用本次读取结果。
工具成功后概括实际变更；失败按结果说明，不尝试绕过插件直接写文件。
```

### 侧栏“针对内容提问”草稿

这是完整版本的固定交互模板，不在用户点击时自动调用模型：插入所选内容引用，并追加可编辑文字“请解释这段内容的含义、适用条件和与当前知识点的关系。”用户可改写后手动发送。不自动加入邻居、子图或整份笔记。原首期仅提供选文引用；后续0.2.0已加入节点/选文问题草稿文本入口，默认问题统一和稳定来源引用仍为T031剩余工作，不能将普通来源文字等同于此处完整契约。

## 验证

分别用新建、改公式、扩展子图、移除共享节点出现位置、全图删除、版本冲突验证：工具参数只含知识字段；无界面代码和坐标；插件保存的无关字段与文件保持；渲染不需要模型刷新指令。格式约束由工具校验落实，提示词不替代程序校验。
