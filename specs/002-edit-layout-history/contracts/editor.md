# UI 与 Host 契约：编辑、自动保存与历史

状态：preview.2 已启用自动保存，保存专项通过，DSH 人工验收待执行。现有单入口 `dshAtlas/request`、workspaceFileScope lookup、Gateway 授权和地图串行队列继续使用；不新增公开 AI 工具或 HTTP 服务。

## 1. commitEdit（新增领域请求）

所有字段在 Host 用严格 schema 复核，不信任 UI 对象。

| 字段 | 含义 |
| --- | --- |
| op | 固定 commitEdit |
| mapId | 目标地图稳定 ID |
| expectedWorkspaceKey | 捕获的工作区身份，与实际 scope 核对 |
| expectedFingerprint | 最近完整保存基线的内容指纹 |
| operationId | 一次实际提交 ID，网络重试保持相同；新批次/undo/redo 使用新 ID |
| edit | 以下 details 或 layout 变体之一，不接收文件清单 |

`details`：kind、nodeId、title、summary、markdown、images[]。images 项为 ImageAsset v1，包含 schemaVersion、kind、id、mimeType、encoding、byteLength、sha256、data，Host 推导路径，不接收本机绝对路径。只提交该正文引用的新增资源；编辑既有内容保留未涉及字段。撤销清空/恢复笔记通过该受限语义重建候选，不能让 UI 任意指定 notePath；Host 保留此前合法路径，无路径则按节点分配默认路径。

`layout`：kind、viewId、完整目标 ViewLayout（v2 mode/nodes/groups）。仅可含该视图合法的 nodeId/groupId，不可夹带其他视图或正文；Host 在当前基线布局中替换一个视图。拖动、切模式、重置、布局撤销共用此请求。客户端负责计算布局，Host 负责范围、数值及身份校验。

### Host 顺序

1. 检查 scope、权限、schema 和资源/request 限额；验证请求身份并生成稳定规范化摘要（不把 raw base64 重复写入回执）。
2. 进入已有 `${workspaceRoot}\0${mapId}` serializeMap 队列；优先核对 operationId 的既有回执，同 ID 不同摘要报 operation_conflict。
3. 严格读取完整基线并比较 expectedFingerprint，检查无待恢复活动记录；创建候选，复用现有内容操作/布局校验。
4. 新图片封装与正文/必要 map.json 变更叠加成完整候选；严格读取候选确保引用有效；无变化返回 noChange，不写事务或追加历史。
5. 使用现有 Transactions.commit、条件写和活动记录认领；提交前复核读集，逐文件条件写，失败按既有机制回退。精确增加 `assets/<id>.image.json` 白名单，不放开任意 JSON/资源路径。
6. 提交后严格读取并记录回执，返回新的完整快照/指纹；必要时只记录小型结果，重试复读当前快照。若回执后已有外部变化，必须区分该操作确已提交与当前快照已前进，客户端进入冲突处理，不能以当前状态伪装本次提交结果。

返回成功：`ok:true`，value 含 operationId、committedFingerprint、snapshot、noChange。返回错误：`ok:false`，含 code、message、diagnostics（可选）、operationId 和提交状态说明。snapshot 必须对应可说明的提交版本；响应丢失不得仅凭客户端异常判定未写入。

## 2. 错误与客户端行为

| code | 行为 |
| --- | --- |
| invalid_data / invalid_image / resource_too_large | 保留草稿，定位字段/图片，修正前不提交 |
| version_conflict / operation_conflict | 停止队列，保留副本；复读后明确处理，不自动覆盖 |
| permission_denied | 保留副本，允许权限恢复后重试，不绕过官方写接口 |
| failed_rolled_back / storage_failure | 显示未保存；确认回滚或查询回执后重试，不重复历史 |
| recovery_required | 保留副本和恢复资料，禁止继续写入，不按超时接管 |

HostAdapter 应保留 code 与提交状态，不能只转成字符串 Error。retry 复用原 operationId 和完全相同请求；在状态确定前不可重新生成 ID 重发。

旧 saveLayout RPC 保留 v1 兼容入口；阅读中的 fillLayout 仅内存补位，本版不再后台提交派生布局，避免与编辑队列竞争。手动布局动作迁入 commitEdit 以获得回执和同一串行规则。

## 3. 自动保存 UI 契约

- title/summary/markdown 输入每次更新会话副本，800ms 无新输入且非 composition 时形成批次。失焦或插件内离开先结束当前有效批次；图片增删和布局动作立即形成批次并排队。
- 保存期间允许继续输入并形成后续批次；不覆盖旧批次的 before，也不将旧回执重置为最新草稿。同地图每次只有一项磁盘提交。
- 输入文字使用原生输入撤销；图片按钮通过受控正文插入/移除操作与文字编辑缓冲协调，不能破坏 textarea 已有编辑记录。图级 Ctrl+Z/Y 仅在非输入区域生效。
- 批次形成时一次记入本地历史，保存失败仍保留；状态指示区分本地记录和磁盘成功。无效或取消的输入不形成有效历史，取消未应用草稿不撤销已保存批次。
- 保存中或普通失败时 undo/redo 仍改本地并保持“未保存”；恢复保存时按目标提交 working 与 baseline 的净差异（每个详情节点或视图一个 commitEdit、新 operationId），净差异为空不发请求。提交状态未确定先复读原 operationId 回执。外部版本载入后清空本图历史并提示“导图已被外部更新，撤销记录已清空”。
- 插件内切换/关闭 flush 成功即离开；仅失败、冲突或无效草稿时提示处理。宿主直接关闭通过同步 registerCloseHandler 捕获清理通知，协调器继续保存；不等待异步关闭弹窗；重开对未完成草稿显示恢复/放弃入口并复核磁盘版本。
- 导出只能封装完整有效阅读快照。存在未保存输入时，先 flush 成功再按当前全图导出；失败时保留草稿并提示，不能把旧内容称为最新导出。离线 HTML 不包含编辑控件、历史、请求、会话、本机路径或新模型调用。

## 4. 快捷键、导航与排列控件

在 `.atlas-path-row .atlas-host-tools` 的“全部导图”旁放模式循环按钮和重置。单次点击前进到下一可用模式。选项映射为纵向/vertical、田字型/grid、多列/columns；只列出当前视图可用项（grid ≥2 组，columns ≥7 组），重复选择当前项无操作。重置重算当前视图纵向布局，是一次历史动作。

根区域局部处理 Ctrl+Z/Y，排除 input、textarea、select、contenteditable、输入法 composition、event.repeat、弹窗内输入、冲突与待恢复状态。保存中或普通保存失败时仍执行本地 undo/redo，保持“未保存”标记并在后续提交最终状态。只有执行了有效命令才阻止默认事件；不安装 document 全局撤销监听。画布鼠标操作后恢复适当焦点。无历史可操作时不修改地图。

同图子图共享编辑历史，undo/redo 定位其真实目标；阅读前进后退历史保持独立。关闭/切换地图清空旧历史；外部版本（含 AI 工具修改）载入后清空本图历史并提示，自有提交回执不清；宿主非受控关闭保留的是未保存草稿，不是旧 30 步记录。

## 5. 读取与资源契约

现有 `read` 的 UI 返回允许完整或资源降级结果，见 [数据模型](../data-model.md)。AI 编辑/提交、候选验证仍调用严格读取。资源解析先按 notePath 计算相对路径，再校验真实目标在本图 assets 内；不得仅用字符串前缀代替 contains 校验。

新 image.json 验证后转换为 `resources[nodeId + ':' + href] = data:<mime>;base64,...`，复用 RenderNote 和 export-html；既有二进制图像继续原读取路径。缺失或损坏只显示可定位诊断，writable:false，禁止用不完整读集提交或声明完整离线导出。越界路径与非法结构不能降级绕过。

## 6. 兼容与实施门槛

- 新插件读 layout v1/v2，写布局修改用 v2；旧插件不可读 v2。图片文本封装同样要求新读取器，不能把旧版安装包视为回退后继续编辑方案。
- 本次不修改公开 atlas_* 工具 schema；工具共用提交服务后继续保持旧语义，提示词仍不要求模型计算坐标或编码资源。
- 新资源日志恢复、条件创建、取消、响应丢失及冲突的内部验证证据齐备前，不开放此新多文件写路径。只读预览可先交付，但不算自动保存需求完成；旧版内部专项通过不覆盖本增量。

## 7. 已实现的 editStatus 只读查询

参数严格限制为 `op:editStatus`、mapId、expectedWorkspaceKey、operationId、requestDigest。摘要由双方 canonicalJson（递归排序对象键，数组顺序不变）后计算 SHA-256，不发送或保存第二份图片正文。查询只读取 active/result 记录及当前完整快照，不回放写入、不清理活动记录。

返回 state 为 committed 或 absent，以及 snapshot；committed 还含 committedFingerprint。活动操作返回 recovery_required；已有回执之后版本前进返回 version_conflict，不能把外部快照伪装成本次写入。客户端先解析未决操作：已提交推进基线，已确定不存在且基线未变才按当前净差异创建新操作 ID。普通失败时本地撤销保持可用，但未决期间不发新的写请求。

错误结构增加 operationId 与 commitState（not_applied / rolled_back / unknown）；适配器保留它们。实际 ReadResult 复用 MapSnapshot 顶层字段并增加 writable/diagnostics，未再套一层 snapshot；降级 fingerprint 为空字符串，不可作为写基线。v1 mode 由渲染/命令层解释为 vertical，保留原始 v1 对象以免无意写升级。

原 notePath 由 Host 按 session/workspace/map 保存从完整快照读取的路径，清空使用 remove_note；同会话恢复时复用原路径。外部版本使路径记忆失效，目标已被其他文件占用则拒绝，不接受 UI 指定路径；不承诺重启后的编辑撤销。
