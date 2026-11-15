# 技术研究：DSH 侧栏知识图谱

核查日期：2026-11-15；目标标签 `dsh-v0.2.2-rc.3`。本次重新读取官方版本文档，未安装或运行宿主。以下区分选型决定、已查证契约和仍未验证的实现门槛。

## 1. 原生侧栏与界面栈

- Decision：采用 TypeScript 插件与宿主 React Slot，注册独立 kind 的原生侧栏页签；注册定义和正文共享 id，以 effect/inject 生命周期释放。使用宿主匹配版本，不自行打包第二份 React。
- Rationale：官方教程定义 TypeScript apply 模块，Slots 明确为 React 组合体系；页签已提供会话作用域、导航和挂载机制。不是凭原型预选前端框架。
- Alternatives considered：Vue/独立 iframe 需要额外桥接；Better Sidebar 增加非必要依赖。均不采用。
- Evidence：[插件教程](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/user/develop/basic/index.md)、[Slots](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/subsystems/slots.md)、[Sidebar](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/subsystems/sidebar-right.md)。

## 2. 渲染、状态和自动布局

- Decision：DOM 卡片及详情配合 SVG 连线；以宿主 slot store 保存阅读状态，局部界面状态使用 React；不引入独立全局状态框架。布局使用确定性分组排列，先保留手动位置，再为无坐标节点寻找不相交空位；显式重排才移动已有节点。
- Rationale：基准每视图最多30个节点，需要文字选区、键盘访问及 v17 的精确样式；无需大规模 GPU 画布。单一渲染器可供第三期离线导出复用，导出不装载宿主适配器。
- Alternatives considered：React Flow 等完整图库带来默认节点、交互和样式适配成本；通用力导向布局可能扰动手动位置；Canvas 需额外实现文本选区和无障碍层。当前规模选最小实现，性能最终以 SC-004 检验，不宣称已测通过。
- 算法需按实测卡片尺寸计算间距、组边界及卡片边缘端点，关系环不参与视图父级排序。180ms退出后320ms淡入只保留一份活动画布；减少动态效果采用无空间运动切换。

## 3. 可点击引用与手动发送

- Decision：自有 input-trigger source 承载快照、openReference 与 serialize；在原会话捕获 captureInsertion 的 TokenSpan，以 conversation.input.for(actx).insertReference 插入，失败保留快照。禁止 setDraft、submit 或 conversation.send。
- Rationale：官方输入契约提供带版本保护的插入和回跳/序列化接口；普通 insertQuote 不能单独满足稳定来源回跳。发送序列化返回选文及可读来源，来源失效也保留快照。
- Alternatives considered：DOM 操作输入框、整框替换、仅路径引用均不满足草稿保护。
- Evidence：[input.ts](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/client/ui-conversation/src/client/contract/input.ts)。仍须在真实 rc.3 验证 source 注册及重载后快照恢复、附件保留与会话切换。

## 4. 文件读取与外部刷新

- Decision：通过 session 绑定的 workspaceFiles 读取、列举、订阅；完整读取后校验，再原子替换内存有效快照。观察结构、布局及各笔记文件，目录观察仅覆盖直接子项，不能误认为递归。权限及大小限制失败明确显示，不静默截断。
- Rationale：官方服务提供版本及变化流，但明确没有写操作。读到分页时必须处理 eof 和版本一致性；更新期间不将混合版本当作有效地图。
- Alternatives considered：浏览器直接访问本地路径不可用；借用全局当前会话会串工作区。
- Evidence：[workspace-files](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/api/workspace-files/README.md)。插件还需额外实施地图目录包含性限制，宿主文件读取权限本身不等于本项目目录边界。

## 5. 插件维护保存与回退

- Decision：采用 [保存契约](contracts/persistence.md)。DSH调用地图工具，插件统一校验、串行写入、备份与失败恢复；界面编辑使用同一服务。创建使用createIfAbsent，更新使用replaceIfVersion，操作记录支持重启恢复。提交完成才通知侧栏刷新。
- Rationale：宿主提供单文件原语，业务级多文件恢复应由插件实现。上一版把“宿主没有多文件事务”误判成规划阻塞，混淆了宿主原语和插件职责。实现前未验证不等于不能完成设计。
- Alternatives considered：无记录逐文件覆盖不能恢复；版本目录和提交指针会改变既有知识存储形式，当前不采用。外部并发修改使用条件检查，发生冲突不强制回滚覆盖外部内容。
- Evidence：[fs契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/fs/fs/README.md)。多文件恢复是本项目设计，并非官方提供的现成功能；实现需故障注入验证。

## 6. DSH 原生工具

- Decision：使用 ctx.tools.register(defineTool(...))，明确 parameters、output.schema、output.render 与 execute；工具调用进入与界面相同的校验/提交服务，使用稳定 mapId/nodeId 和版本。
- Rationale：官方工具教程支持类型化参数与规范返回。插件必须自行实现领域一致性及事务，注册工具不意味着已有地图 CRUD 能力。
- Alternatives considered：要求模型重写 HTML 或仅依赖提示词校验均不能保障文件完整性。
- Evidence：[工具教程](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/user/develop/basic/tool.md)。只读查询可独立设计；写工具使用上一节插件保存服务，完成恢复验收后启用。

## 研究结论与证据状态

React/TypeScript、原生 Slot、输入引用、读取观察和单文件 guarded mutation 有目标版本官方依据。图形与状态选择是基于本项目规模的工程决定，未做性能或视觉实验。多文件保存已确定插件侧备份与恢复设计，规划不再因此阻塞；实现、真机兼容和故障恢复测试尚未执行。侧栏与提示词设计分别见 [sidebar.md](contracts/sidebar.md) 和 [authoring.md](contracts/authoring.md)。
