# 首期内容边界核对

已执行的证据：

- Markdown 渲染为 React 元素，原始 HTML/脚本作为文字显示；DOM 自动测试拒绝脚本、事件属性和 javascript 链接执行；本地图片只采用 Host 校验并读取的本图 assets 数据。
- 文件访问通过目标版本的 workspaceFiles 和 fs 服务。真实官方文件服务测试拒绝解析后的 junction 越界，模拟测试拒绝非相对路径、未知目录、错误布局和不完整读集。
- 使用真实 Cordis/Typert/Gateway 装配构建后的模块，验证 workspaceFileScope lookup 的 Session resource、两个会话的工作区绑定、调用授权拒绝和严格参数解析。插件没有 Node fs 读写业务路径。
- 引用序列化只返回原文及地图/节点可读身份；草稿绑定、工作区绝对路径和 resourceAddress 不进入模型序列化。引用失败保留原文；源码没有 setDraft、submit 或 send 调用。
- 安装包使用files白名单，只交付lib与cordis.yml；测试样本、原型、提示词、会话、本地数据和.transactions不进入包。以上为历史证据；0.2.0已接入全图HTML下载和单文件布局/收纳写入，完整内容编辑及原生AI写工具仍未实现，不对未纳入能力宣称通过。

未执行：最终0.2.0在DSH实例中的草稿/附件保留、权限实际配置、真实发送内容及模型请求计数，以及全图离线HTML的人工内容边界检查；按 [当前候选人工验收](current-candidate.md) 交用户执行，不因旧版局部测试或T069历史勾选而标通过。
