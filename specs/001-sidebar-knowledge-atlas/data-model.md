# 数据模型

日期：2026-11-15。依据：[规范](spec.md)、[存储契约](../../docs/mindmap-storage-format.md)。本文细化运行时模型，不增加或更名 v1 持久化字段。

当前增量说明：选择收纳使用独立library.json，其Folder及mapFolders字段、无环/引用校验和条件保存以 [存储契约的收纳章节](../../docs/mindmap-storage-format.md#思维导图选择与收纳2026-11-15) 为准，不改地图身份和物理路径。下文EditSession与ExportSnapshot为完整能力设计；当前仅接入布局工作副本及全图下载，不代表完整编辑或分享预检已实现。

## 持久化实体

| 实体／位置 | 字段与身份 | 关系和校验 |
| --- | --- | --- |
| Map／`map.json` | `schemaVersion: 1, id, title, rootViewId, nodes[], views[], relations[]` | `id` 与目录名一致；入口指向唯一根视图 |
| Node／`nodes[]` | `id, title, summary, category, icon`；可选 `notePath, childViewId` | 全图身份唯一；摘要可空；正文与子图跨出现位置共享 |
| View／`views[]` | `id, title, parentViewId, groups[], occurrences[], relationIds[]`；可选 `centerNodeId` | 根父级为 null，其他父级最终到根且无环；子图中心节点与其 childViewId 双向一致 |
| Group／视图内 | `id, title, number, category` | 身份在视图内唯一，数组顺序决定分组顺序 |
| Occurrence／视图内 | `nodeId`；可选 `groupId` | 组合身份 `(viewId,nodeId)`；同一视图不重复，分组必须属于本视图 |
| Relation／全图 | `id, fromNodeId, toNodeId, type`；可选 `label` | 端点存在；显示此关系的视图必须包含两个端点；知识关系可成环 |
| Note／独立 Markdown | 默认 `notes/<nodeId>.md`，已有合法路径保持 | 一份文件只对应一个知识节点；无正文不创建空文件 |
| Layout／`layout.json` | `schemaVersion: 1, mapId, views[]` | mapId 必须匹配；不包含正文或知识关系 |
| ViewLayout | `viewId, nodes[], groups[]` | 与有效结构的出现位置及分组对应 |
| NodeLayout | `nodeId, x, y, width, manual` | 坐标有限、宽度为正；高度由实际内容测量；manual 为布尔值 |
| GroupLayout | `groupId, x, y, width, height` | 数值有限、尺寸为正，容纳卡片及标题 |

ID 使用非空字母、数字、下划线或短横线，不以标题、数组索引或坐标代替。category 为 `blue/sage/plum/gold/terra`；icon 枚举严格沿用存储契约；关系 type 为 `dependency/supplement`，方向从 fromNodeId 指向 toNodeId。合法空地图仍有一个合法根视图，其节点、关系和出现位置数组可为空。

笔记可选二级标题按“简介、核心理解、关键公式 / 规则、典型示例、学习提醒”组织。原始 HTML 作为非执行内容处理。notePath 的真实目标限制在本图目录，本地资源真实目标限制在本图 assets 内，检查解析后的符号链接；宿主权限是额外必要条件。

## 运行时实体（不进入地图文件）

| 实体 | 所需数据 | 生命周期 |
| --- | --- | --- |
| MapSnapshot | 结构、笔记、资源、布局及实际文件内容指纹，校验诊断 | 完整候选加载校验成功后替换最近有效快照 |
| ReferenceSnapshot | mapId、nodeId、originViewId、原文、前后文、内容指纹、显示来源；宿主绑定的工作区资源地址 | 随宿主草稿引用保存；不可因来源变化改写原文 |
| PendingInsertion | ReferenceSnapshot、捕获的会话身份及宿主插入锚点 | 插入成功后清除；失败保留供原会话重试，生命周期结束取消异步提交 |
| ReadingState | 工作区／会话／地图身份、当前 viewId、每视图缩放和平移、选中节点、详情滚动及焦点来源 | 会话内保存，不进入分享；关闭后按已保存内容重开 |
| SearchResult | nodeId、viewId、父级路径、命中字段及片段 | 从当前有效快照派生，重复标题不合并身份 |
| EditSession（后续） | 基础指纹、工作副本、撤销记录、受影响对象 | 保存成功更新基线；失败或冲突保留副本 |
| ExportSnapshot（第三期） | 范围、有效内容与布局、资源内嵌结果、缺失项、未保存标记 | 一次导出的冻结副本，无宿主绑定 |

指纹覆盖实际读取的结构、笔记、资源及布局；提交检查至少包含本次读集和影响操作的依赖。schemaVersion 只用于格式兼容性，不能作内容版本。仅修改笔记不要求重写 map.json。

## 状态转换与不变量

- 加载：未加载 → 加载中 → 有效／空图／错误。有有效快照后刷新失败 → 旧版本可读并展示诊断；初次失败无伪造画面。过期异步响应不能替换较新快照。
- 布局：缺失布局 → 测量与补齐 → 可读派生布局；新增节点只补缺项，删除对象清理派生记录。错误或错图布局不是缺失，不能自动覆盖。持久化失败须报告，不能声称已保存。
- 导航：有效视图 → 180ms 退出 → 切换目标 → 320ms 淡入；同一时刻只有一次有效切换，不叠加画布，减少动态效果模式减少运动。父级路径决定返回，共享节点不创建第二套子图。
- 引用：有效非空选区 → 待插入 → 已插入／失败可重试；空选区不复用历史内容。回跳结果为精确、节点级降级或来源失效，任何结果都保留原文。
- 编辑：已保存 → 未保存 → 校验／提交 → 已保存；校验或写入失败进入失败，基线变化进入冲突。关闭时保存／放弃／取消；冲突时保留本地副本或显式放弃后加载外部版本。
- 删除：移除出现位置只改变该视图及无法显示的关系引用；全图删除先形成影响清单，经既有或新确认后执行，保留仍被引用的知识。

多文件提交和失败恢复未验证前，EditSession 仅能形成变更提案，不能将顺序写文件当作已满足事务要求。该限制不改变最终产品必须完成写入保护的验收要求。

## 插件恢复元数据

`.transactions/`按需保存operationId、请求摘要指纹、文件前后指纹、前镜像、候选内容和提交状态，不属于map.json知识字段。其生命周期及恢复状态见 [persistence.md](contracts/persistence.md)。没有聊天、凭据和机器绝对路径；不参与知识搜索、内容版本指纹或HTML分享。

## 0.2.1 阅读历史（T084）

ReadingState的可选history含back/forward两个ReadingLocation数组；每项只记录viewId、selectedNodeId、detailScroll、focusSource和该次camera。作用域沿用会话store及workspaceKey/mapId，读取时同时核对sessionId。新导航记入back并清空forward，历史导航将当前位置送入相反方向；刷新移除失效视图、节点和出现位置。本节中心节点仍可作为详情目标。历史不进入map.json、layout.json或分享快照，T085人工验收未执行。
