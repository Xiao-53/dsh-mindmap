# Research：编辑、自动保存、资源与排版

日期：2026-11-18。只读研究现有源码和安装的官方目标版本包，未运行产品或测试；没有采用变化中的上游 master 文档替代固定版本契约。以下路径均相对仓库根目录。

## 1. 编辑界面与现有技术

**Decision**：扩展 NoteInspector，提供标题、摘要输入和 Markdown textarea、图片选择及受限预览；复用 React 18、marked 和现有 RenderNote，不引入富文本库。

**Rationale**：`src/client/components/NoteInspector.tsx` 当前纯阅读；`src/client/render-note.tsx` 已将 Markdown 转为受限 React 元素，图片只取已校验的 resources data URL。`package.json` 固定 DSH 0.2.2-rc.3，Host/Client 构建已经存在。摘要与正文中的“简介”要在编辑区分字段，避免原有显示优先级掩盖摘要更新。

**Alternatives considered**：新增富文本编辑器扩大格式和撤销复杂度；外部文件编辑不能满足内部编辑；复用官方 MarkdownText 会引入该组件默认外部资源/图片浮层行为，现有阅读器更符合地图边界。

## 2. 图片的安全条件写

**Decision**：新导入图像保存在 `assets/<assetId>.image.json`，内容为版本、MIME、base64、字节长度和 SHA-256；原 Markdown 引用该相对路径。读取时转换到既有 resources 映射，导出继续封装 data URL。

**Rationale**：官方 `node_modules/@deepseek-ai/dsh-fs/src/index.ts` 的 writeText 支持 createIfAbsent/replaceIfVersion，未提供 writeBytes；`dsh-api-workspace-files/src` 也没有上传接口。`src/server/tools/storage.ts` 的 transactionPort 和 `src/server/transaction.ts` 均为文本事务。使用真实 `.image.json` 后缀可复用官方原子条件写而不伪装二进制文件。

仅接受本次 UI 指定的 PNG/JPEG/WebP；客户端解码检查可读，Host 复核编码、长度、摘要及格式头，不能仅信任扩展名或客户端 MIME。图片读失败只读降级，不以格式头检查宣称完整解码安全。现有二进制 PNG/JPEG/GIF/WebP 阅读保持兼容，不迁移。

首版工程限额：每张解码后 8 MiB、每提交新增图像合计 16 MiB、JSON 请求 24 MiB、完整序列化事务日志 48 MiB。现有文件读取上限 64 MiB，必须把 base64 和日志/回执复制开销算入；回执/请求指纹只保留规范化请求摘要，不重复图像 payload。超限在写入前拒绝，真机验证请求可达性后可收紧但不无提示丢图。

**Alternatives considered**：Node fs/shell 二进制写绕过宿主权限和条件写；把 base64 塞进 Markdown 会复制资源并放大编辑历史；独立上传会留下正文与图片不一致窗口。均不采用。

## 3. 复用现有提交与读取分级

**Decision**：从 `src/server/tools/index.ts` 抽取候选验证/提交到共用服务，UI 仅允许详情字段和布局目标，不暴露任意文件写。新资源与正文同一事务。工具公开 schema 不增加排版和原始路径写入。

**Rationale**：`tools/candidate.ts` 已支持 update_node/set_note/remove_note；已有提交包含 overlay 候选读取、fingerprint、Transactions.commit、operationId 和 map-queue 的 serializeMap。`map-service.ts` 目前没有详情写 RPC；`host-adapter.ts` 会丢弃结构化错误 code，须保留错误类型。`transaction.ts` 的 parseJournal 白名单必须只增加精确的 `assets/<id>.image.json`，不能放开任意资源文件。

`map-files.ts` 当前资源缺失使整图读取失败，与规范要求其余正文可读不符。新增 UI read 的只读降级结果，附逐资源诊断和 writable:false；写入、候选、指纹完整性仍严格检查。缺失/损坏可降级，路径越界和无效结构仍拒绝。降级图不开放编辑，也不把不完整导出声称为完整离线文件。

**Alternatives considered**：另建 UI 保存链会重复保护；直接重放旧文件版本会覆盖外部更新；把降级快照当写基线会漏掉读集。均拒绝。

## 4. 自动保存与历史

**Decision**：输入立即写入会话副本，800ms 停顿形成有效编辑批次；图片、拖动结束和布局动作立即形成批次。每图单队列串行提交，保存请求离开面板后仍可完成，任何续输形成下一批次。历史最多 30 项，仅记录局部前后值和资源引用。

**Rationale**：用户追问自动保存，现有 `AtlasPane.tsx` 已有 LayoutDraft、revision/saveAgain、retainedLayouts 和拖动松手保存。扩展为会话级 coordinator，分开本地应用游标与已保存 revision。保存失败不删历史/草稿；重试不追加步骤。undo/redo 用新的 operationId 与最新磁盘基线提交，不重用旧版本号。工作副本保留与历史跨重开清空是两件事。

**Alternatives considered**：每个按键一步很快耗尽 30 步；只在关闭保存依赖不存在的宿主钩子；将整个 snapshot（含 base64）复制 30 次浪费内存；把阅读历史当编辑历史语义错误。

### 4.1 保存失败期间的撤销/重做（澄清 Q1）

**Decision**：saving 与普通 failed（已确认回滚、权限拒绝、存储失败且回执确认未写入）状态下，undo/redo 只改 working 和 cursor，状态保持 dirty/failed。恢复保存（自动重试或用户点重试）时不再重放排队的中间批次，而是对受影响目标（详情节点或视图布局）计算 working 与 baseline 的净差异，每个目标以新 operationId 生成一个 commitEdit，串行提交；净差异为空的目标丢弃请求，全部为空则直接 clean。提交状态未确定（响应丢失）时先用原 operationId 复读回执，确定后再按上述规则处理；conflict / recovery_required 暂停图级 undo/redo。

**Rationale**：用户澄清选择 A。现有提交以单目标 details/layout 为单位，净差异按目标拆分可沿用同一请求形态和 Host 校验，不需要新的批量写接口；按目标独立提交时部分成功是可接受的，成功目标更新 baseline，其余目标继续保持 dirty。复读原回执避免“已写入但客户端以为失败”时用新 ID 重复写入。

**Alternatives considered**：失败时冻结历史（原设计）使磁盘异常时无法撤回误拖；逐步重放失败期间的每个批次会产生无意义的中间写入并放大冲突面；新增多目标原子提交接口超出首版需要。

### 4.2 外部更新与历史清空（澄清 Q3）

**Decision**：沿用 `AtlasPane.tsx` 已有 `host.watch` → refresh 链路。刷新结果先与本会话已知提交回执/committedFingerprint 比对：匹配为自有写，不清历史；不匹配视为外部版本（含 AI 通过 atlas_* 工具的修改）。无本地未保存修改时直接载入外部版本、清空本图 entries/cursor 并提示“导图已被外部更新，撤销记录已清空”；有未保存修改时进入 conflict，用户最终载入外部版本后同样清空。

**Rationale**：用户澄清选择 A。AI 修改不进入手动历史，保留旧条目只会让 Ctrl+Z 尝试把旧前值套到新版本上；按目标比对保留部分历史需要额外的影响分析，首版收益低。自有回执比对可避免自动保存本身触发清空。

**Alternatives considered**：按目标保留未受影响的历史（实现与解释成本高）；设置不可越过的分界线（与清空效果接近但状态更复杂）。

## 5. 宿主关闭契约

**Decision**：插件内可控切换/关闭先 flush 并等待；正常成功直接离开。宿主直接关闭时继续已捕获的自动保存，失败/无效输入保留会话副本，重开复核后提示；不承诺跨重启恢复。

**Rationale**：官方 `node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/src/client/contract/slots.ts` 只有 refresh 命令，actions.close():void；tab.signal 在记录消失或插件卸载后才 abort。`tab-registry.ts` 有 keepMounted，没有 beforeClose/canClose；`tab-domain.ts` 关闭直接调用 navigator。keepMounted 不是关闭守卫。该限制已记录到规范自动保存增量。

**Alternatives considered**：声称能事前拦截所有关闭不符合官方契约；卸载清理中才发保存无法保证数据捕获与完成；自动发送模型草稿无关且禁止。

## 6. 排版和格式兼容

**Decision**：保留 fillLayout 补缺语义，新增显式 relayoutView；先布局组内，再布局分组矩形。vertical 纵排、grid 两列、columns 3/4 列，最后平移到正坐标。模式可用性按当前视图分组数计算（无组节点合计一个临时 bucket）：<2 组仅 vertical，≥2 组可选 grid，≥7 组可选 columns（7～12 组 3 列，≥13 组 4 列）。grid 与 columns 共用“逐行左到右、行高取该行最高组、列宽取该列最宽组”的网格算法，仅列数不同。已保存但当前不可用的 mode 保留坐标、不自动重排。米字型/radial 已按用户澄清（Q2）取消。layout v2 在每视图增加 mode；v1 读取默认 vertical 但保留所有坐标，首次实际布局修改再升级写入。

**Rationale**：`src/shared/layout.ts` 目前纵向组排列、组内三列、已有坐标保留，旧组矩形直接复用；补位需要扩展组边界但不能移动旧节点。`validate-layout.ts` 为 strictObject，旧版本不接受新字段，不能假称添加可选字段即双向兼容。`MapViewport.tsx`/`MapScene.tsx` 对画布正坐标和最小缩放有假设，显式重排须保持可到达，必要时改善 fit，不放大承诺为所有大图一屏清晰。

**Alternatives considered**：在 map.json 加 mode 破坏职责；每次阅读自动重排破坏手动位置；图形库不是网格类矩形布置的必要依赖；米字型八方向在组数少时偏向一侧，且在窄侧栏中占用更大画布，已取消。布局 v2 不自动降级，旧插件拒读需交付说明。

## 7. 性能与验证结论

**Decision**：用稳定分组顺序和确定性几何布局，按规范固定三张图验证交叉改善，不引入全局搜索或宣称必然减少交叉。尺寸测量后一次发布有效布局，沿用已有端点排序和动画。

**Rationale**：旧版本已撤回曲线交叉搜索；节点位置、分组大小及边分布共同决定交叉。120 节点/2 秒、20% 改善、图片完整显示与新事务失败边界均待验证。

**Alternatives considered**：用删边或隐藏节点达标违背需求；仅凭构建通过声明视觉/性能通过没有证据。

研究未遗留技术选型或产品范围待澄清项；运行能力与失败保护属于实施验证门槛，不能写成研究已证明可用。

## 8. 2026-11-18 实施核对

实施起点为 0.3.12，目标 DSH 0.2.2-rc.3、Node >=24.9.0；Git 原有 README.md 修改保留，未覆盖。`specify integration status` 正常，未重新初始化，未升级依赖。

补充官方关闭契约：`dsh-client-ui-sidebar-right/src/client/service.ts` 的 `registerCloseHandler(kind, handler)` 是同步关闭/替换清理通知，Context 的 sidebarRight 类型为 SidebarRightController；不是 Promise 型 beforeClose。实现用它结束会话历史并继续保存捕获的副本，注册 `keepMounted:true` 避免隐藏/折叠被误当关闭。不用抛异常模拟异步关闭弹窗，仍不承诺退出进程后恢复。

`dsh-fs/src/index.ts` 的 writeText 返回 FsWriteOutcome.version。新增图片事务记录这个确切版本；回退只在版本一致时删除新文件。若写成功却未取得/记录版本，进入 recovery_required 并保留资料，而不是猜测文件归属。旧文本事务保持原机制，新图片路径仍关闭，证据任务 T156/T166/T174/T182 尚未执行。

仅构建与静态核对，不以构建证明运行正确。预览交付与剩余项目见 [实施记录](../../docs/validation/edit-layout-history.md)。
