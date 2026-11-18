# Data Model：编辑、图片、排版与历史

设计状态：预览代码已落地；写入开放与运行验收待完成。沿用 [存储契约](../../docs/mindmap-storage-format.md)，以下为需在实施时同步的增量。

## 1. 持久化实体

### NodeDetails

沿用 KnowledgeNode 的 id/title/summary/notePath 和 notes[nodeId] 正文；不新增独立节点身份。UI 只能改 title、summary、markdown，Host 由 nodeId 分配或保留合法 notePath。标题 trim 后不能为空；摘要/正文可空。空正文无既有笔记时不创建空文件；清空既有正文走 remove_note，撤销恢复原 notePath 和正文，不能误删另一节点引用的文件。共享 nodeId 所有出现处共用详情，候选需拒绝互不相同 nodeId 非法共用可写 notePath 导致越界修改。

### ImageAsset v1（新增）

| 字段 | 规则 |
| --- | --- |
| schemaVersion | 1，独立于 map/layout 版本 |
| kind | 固定 image |
| id | 客户端随机生成的操作内稳定资源 ID，Host 严格验证；无文件路径语义 |
| mimeType | image/png、image/jpeg、image/webp |
| encoding | 固定 base64 |
| byteLength | 解码后的正整数长度，受限额保护 |
| sha256 | Host 对解码字节复核，不信任来参 |
| data | 规范 base64，无任意 URL 或脚本 |

Host 唯一推导路径 `assets/<id>.image.json`，同 ID 同摘要可复用；同 ID 不同内容拒绝。资源不可变、仅 createIfAbsent；引用形式为相对 notePath 的 Markdown 图片引用，默认 notes 下为 `../assets/<id>.image.json`。客户端预览使用内存解码结果，临时 URL 不写入文件。

新资源与引用正文同一事务发布。删除引用、撤销加图和历史淘汰不删除资源；事务失败仅回退该事务新建且版本仍匹配的文件。原二进制资源继续读取；共享资源不复制。资源不能包含凭据、本机绝对路径、会话或历史。

### MapLayout v2（新增写格式）

顶层 `schemaVersion:2, mapId, views`。ViewLayout 保留 viewId/nodes/groups，新增 `mode:vertical|grid|columns`。NodeLayout 保持 nodeId/x/y/width/manual，GroupLayout 保持 groupId/x/y/width/height；高度仍由实际卡片测量提供，知识内容不写入布局。

读取 v1 时界面/命令将 mode 解释为 vertical，原始 v1 对象及坐标保留；仅阅读不写升级文件。新图实际布局保存或旧图第一次布局修改写 v2；详情自动保存不顺带升级无变化布局。未知版本/非法坐标拒绝，不按“缺失布局”重建。旧插件 strictObject 不认识 v2，新文件不承诺降级可读。

显式重排清除目标视图 manual 标记，其他视图原样保留；重置等于 relayoutView(vertical)。拖动设置该节点 manual:true；取消拖动恢复 x/y/manual 等完整起始状态。

## 2. 内存实体

### EditSession

- key：sessionId + workspaceKey + mapId；所有异步回调校验该身份与 generation。
- baseline：最近确认的完整磁盘 snapshot/fingerprint。
- working：本地已应用内容与布局、资源引用；不等同于磁盘已保存。
- inputDraft：当前节点的字段值、composition 状态、有效性、批次开始前值；每次输入同步捕获，800ms 定时器仅负责结束批次。
- revisions：localRevision、persistedRevision、inFlightRevision；新输入不被旧回执覆盖。
- status：clean / dirty / saving / failed / conflict / recovery_required / readonly。
- queue：串行待提交批次，operationId 与请求摘要固定；响应丢失用相同 ID 重试。
- resourcePool：按 assetId/摘要去重的新增图片内容；历史项只引用 ID。

由插件会话级 coordinator 拥有；React 面板订阅状态，不持有唯一副本。面板 tab.signal 不用于中止已认领的保存/回退；宿主会话或插件销毁仍是能力终点，不保证跨重启。

### HistoryEntry / HistoryCursor

字段：entryId、kind(details/move/layout)、viewId、可选 nodeId、before、after、assetIds、localRevision。详情保存 title/summary/正文与 notePath 语义，布局操作保存目标视图的模式、全部位置和组矩形；移动只保存目标出现位置前后值。不可存整图 base64 副本。

entries 最多 30 项，cursor 表示本地已应用条目数。追加有效动作先删 cursor 后分支，再追加；溢出删最早项并调整 cursor。undo/redo 不新增条目；批次内多字段/多图片合并，一次拖动只一步。

自动保存失败不回退本地 cursor，重试不追加历史；无效输入停留在 inputDraft，不计有效历史。saving 时 undo/redo 先改 working 并排在在途提交之后；failed（已确认回滚或未写入）时 undo/redo 照常改 working 并保持 dirty/failed 标记。恢复保存时按 working 与 baseline 的净差异，以新 operationId 提交受影响的详情/视图，替代失败期间排队的中间批次；净差异为空则直接 clean，不写入。提交状态未确定时先用原 operationId 查询回执；conflict / recovery_required 暂停图级 undo/redo，先处理再继续，不伪造已保存。

### ReadResult（扩展 MapSnapshot）

完整结果：MapSnapshot 的现有字段及 writable:true、diagnostics:[]（不另加 snapshot 包装层）。

资源降级结果：最近有效结构/正文/可读资源、writable:false、逐项诊断（nodeId、相对引用、code、message）；不提供可用于写入的完整 fingerprint。初次无效结构、越界路径仍为错误。读图降级仅为图片缺失/损坏等可定位资源问题，写入候选一律严格模式。

## 3. 状态迁移与竞争规则

1. 输入 → inputDraft → 停顿/失焦/离开前结束有效批次 → working + history + dirty。
2. dirty → saving，捕获不可变请求与 baseline；续输留在后续批次。
3. 成功回执 → 更新 baseline/persistedRevision，保留更高 revision，继续队列；全部追平后 clean。
4. 失败回退 → failed，保留 working/草稿；冲突 → conflict；不能恢复 → recovery_required，禁止继续写。
5. 观察通知先比较已知提交回执/指纹：自有写不清历史；外部变更冻结旧基线，不自动把旧历史套到新版本。无本地未保存修改时直接载入外部版本并清空 entries/cursor，提示“导图已被外部更新，撤销记录已清空”；有未保存修改时进入 conflict，最终载入外部版本后同样清空历史。
6. 插件内切换等待 flush；失败提供处理选择。宿主直接关闭先前输入已在会话副本，协调器继续提交有效批次；无效/失败草稿在重开时提示，旧历史清空。隐藏或折叠面板并不等于关闭地图，不清历史。
7. undo/redo 生成新的受控提交，使用当前 baseline 和新的 operationId；只有同一请求的网络重试复用 ID。操作本地结果与保存状态分别报告。
8. saving / failed 下的 undo/redo：只改 working 与 cursor，保持 dirty/failed；未开始的排队批次作废。恢复保存时按受影响目标（nodeId 详情或 viewId 布局）比较 working 与 baseline，逐目标生成净差异 commitEdit 串行提交；某目标净差异为空即跳过，全部为空则 clean。按目标独立提交，部分成功只推进成功目标的 baseline。

## 4. 布局过程

先测卡片并按现有三列规则布局各组局部矩形；空组保留最小标题区。grid 每行使用该行最大高度和固定组间距，两列宽度按对应列最大组宽确定。columns 仅在当前视图分组数（无组节点合计一组）≥7 时可选：7～12 组 3 列、≥13 组 4 列，逐行左到右，行高/列宽规则同 grid。grid 需 ≥2 组。读到当前已不可用的已保存 mode 时保留坐标、不自动重排。最后整体平移到留白正坐标。

无组节点用临时 bucket 参与排布，不持久化虚构 Group。日常补位保留旧节点并扩展组边界；内容变长允许改变卡片高度但不暗中移动旧节点，不把“仅正文编辑”当显式重排。自动排版无重叠目标针对完成测量后的显式排版结果。
