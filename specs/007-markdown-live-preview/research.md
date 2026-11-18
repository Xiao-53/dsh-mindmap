# Obsidian Live Preview 调研

调研日期为 2026-11-18。范围为桌面 Markdown 编辑、表示层、选区和原有节点笔记能力的衔接。

## 官方资料确认的行为和机制

- **Live Preview 保留 Markdown 的编辑能力。** Obsidian 用户文档说明，Live Preview 会在正文中显示格式，隐藏大部分 Markdown 标记。光标进入格式化内容时显露对应标记。完整源码模式与只读模式是另外两种呈现。[Obsidian 帮助 · Views and editing mode](https://obsidian.md/help/edit-and-read)
- **Obsidian 的 Markdown 编辑器使用 CodeMirror 6。** 官方插件文档说明，插件可以从 `MarkdownView` 取得 CodeMirror 6 编辑器并与扩展、状态字段交互。文档中示例使用的私有字段只说明宿主内部所用编辑器，我们的实现可评估直接使用 CodeMirror 的公开入口。[Obsidian 开发文档 · Communicating with editor extensions](https://docs.obsidian.md/Plugins/Editor/Communicating%20with%20editor%20extensions)
- **编辑器状态保存文本和选区，装饰决定显示方式。** CodeMirror 的事务更新文档与选区。Obsidian 官方文档演示按语法树找到列表标记并加装饰。标记装饰可以设置文字外观，替换装饰可以隐藏源字符或显示组件。改变垂直布局的装饰由状态字段直接提供，可用于独立公式和图表等块内容的技术评估。[CodeMirror System Guide](https://codemirror.net/docs/guide/) · [Obsidian 开发文档 · Decorations](https://docs.obsidian.md/Plugins/Editor/Decorations)

公开文档覆盖上述架构和可观察行为。公式、列表与输入法在 Obsidian 内部如何组合这些机制，公开资料未给出完整实现细节。

## 对照当前 DSH 节点编辑器

当前 [NodeEditor.tsx](../../src/client/components/NodeEditor.tsx) 在正文可编辑 DOM 外，维护单独的公式和文字格式草稿，打开时挂载额外输入框。焦点、选区和编辑提交需要在两处协调，历史截图里的“请先完成或取消当前源码编辑”来自这条保护路径。行内公式显示旧排版又出现源码，属于切换显示与编辑状态的问题。[note-math.ts](../../src/client/note-math.ts) 调用的 KaTeX 负责将 LaTeX 排版成公式，正文选区、列表回车和删除由编辑器层处理。

本项目已有 [Markdown 与图表解析](../../src/shared/note-markdown.ts)、[自动保存与撤销](../../src/client/edit-session.ts) 和 [节点详情规范](../005-unify-note-presentation/spec.md)。更换正文编辑机制时，应以旧笔记原文、图表保护、保存批次和 DSH 引用作为验收依据。

## 建议在规划阶段验证

优先评估直接采用 CodeMirror 6，让编辑器的工作文档和选区成为当前编辑状态。用同一份 Markdown 确定标题、列表和加粗斜体的显示位置，再用随选区变化的装饰控制标记是否显露。行内公式在同一范围切换源码和 KaTeX 排版。独立公式与图表按块处理，继续用已有公式排版和图表数据验证。具体编辑颜色和排版沿用 DSH 导图自己的样式。

规划需要核对三个投产条件：

1. Markdown 语法范围与现有公式、图表、转义和旧换行兼容。点击图表周围、选中混合正文或在公式内输入中文时，实际文本位置仍可用于输入和 DSH 引用。
2. 块预览、列表换行和撤销在 DSH 侧栏正常工作。加载装饰及切换模式时无需重写原文。
3. 编辑正文更新进入现有保存协调流程。图表的整图拖动、删除及撤销均继续受图表定义校验和原版本保护。

本次已完成官方资料和仓库代码核对。候选编辑器组合、DSH 宿主输入行为及旧笔记兼容性留到后续验证。

## Phase 0 技术决策

### D1　CodeMirror 6 管理输入与选区

- **决定**　在线正文接入 `EditorState`、`EditorView` 和语言支持。输入、选择、键盘移动和滚动使用编辑器事务。普通格式用样式及隐藏标记装饰。行内公式与图片的有效预览由组件替换；独立公式和图表等影响文档高度的装饰通过 `StateField` 直接提供。
- **依据**　官方文档支持从文档和选区状态更新装饰。查看范围适用于行内装饰。只读继续使用现行阅读投影，在线入口传入编辑组件并阻断离线入口对新编辑器的依赖。活动范围从选区及输入法状态计算。靠近组合区时暂缓会改变几何位置的装饰切换，组字结束后重算。
- **备选**　继续协调可编辑 DOM、临时输入框和反向 Markdown 转换，会保留截图中的两处焦点与提交路径。全屏源码和双栏预览会改变既定操作入口和侧栏布局。
- **参考**　[CodeMirror 官方装饰示例](https://codemirror.net/examples/decoration/)、[CodeMirror API](https://codemirror.net/docs/ref/)、[Obsidian 编辑器装饰](https://docs.obsidian.md/Plugins/Editor/Decorations)。

### D2　列表委托上游命令，按验收补边界

- **决定**　使用 CodeMirror Markdown 解析器与列表命令。在 Markdown 键盘映射中配置 `nonTightLists: false`，用于关闭紧密列表的第二空项转成松散列表的默认行为。Backspace 先复用 `deleteMarkupBackward` 的上下文判断，并为验收明确的空项退层和相邻条目合并补范围限定。普通选区、非 Markdown 上下文和代码使用对应基础命令。
- **依据**　上游默认对紧密列表的第二个空项有特例，Backspace 也可能先把标记替换成缩进空格。增量语法树有可能尚未包含视口以外内容，行内显示随新树刷新，依赖上下文的命令必须使用完整的局部语法。优先 CommonMark 和既有支持的 GFM 子集。公式、图表保留项目语义，并排除公式、代码等不透明区域内的装饰误用。
- **备选**　直接使用整套默认键位难以满足空项退出。用字符特判代替 Markdown 的列表结构判断会误处理续行、缩进和嵌套。
- **参考**　[Markdown 命令官方源码](https://github.com/codemirror/lang-markdown/blob/main/src/commands.ts)、[Markdown 更新记录](https://github.com/codemirror/lang-markdown/blob/main/CHANGELOG.md)、[Markdown 包 API](https://www.npmjs.com/package/%40codemirror/lang-markdown)。

### D3　源码范围、混合换行与正文历史

- **决定**　持有原始 Markdown 和当前编辑坐标间的可逆映射。CodeMirror 事务里的变化范围映射回事务开始时的原文，再拼接替换。未触及的源片段原样保留。新增逻辑换行使用本笔记首个换行风格，空正文默认 LF。更新原文后反向检查它归一化得到的编辑文档与事务结果一致。
- **依据**　CodeMirror 在普通配置下使用 LF 连接逻辑行，单个 `lineSeparator` 只能指定一种分隔符。共享 `noteBlocks` 可映射顶层范围，嵌套列表和引文等 Token 文本可能已去缩进，须验证源范围。若无法可靠定位，保留原文可编辑。保护判定仍对候选的完整原文执行。
- **决定**　适配已有正文 `BodyAction` 历史语义，包括最多 30 步和连续输入合批。记录事务前后的原文和选区，或能无损恢复它们的差量。CM 键位触发这套历史，编辑器只有一个正文撤销入口。这样在混合换行及图表删除后，撤销能恢复原始定义。
- **备选**　整篇序列化会令无关换行变化。仅记录归一化的 CodeMirror 原生历史无法还原原始换行。可以扩展原生历史同步存储换行和整图操作信息，本轮优先适配既有局部历史以减小双向状态风险。
- **参考**　[CodeMirror 状态参考](https://codemirror.net/docs/ref/#state.EditorState.lineSeparator)、[共享 Markdown 范围解析](../../src/shared/note-markdown.ts)、[当前正文历史](../../src/client/components/NodeEditor.tsx)。

### D4　公式和图表投影的行为区别

- **决定**　公式沿用项目现有识别规则和受限 KaTeX。合法行内公式在失活时用排版取代源范围，在激活时还原源字符并允许逐字选择和删除。独立公式在活动源码后显示一处块预览。无法证实范围、定界符不配对或公式无法渲染时显示原文。图表围栏留在文档中，作为受保护的整块导航与渲染。
- **依据**　CodeMirror 的 `atomicRanges` 用于光标跳过范围，普通替换仍须独立的事务校验。真实文档变化用 `sameNotePlots` 核对原文和顺序，能检测在围栏之外输入导致解析范围改变的情形。仅受控图表命令与可信历史回放可变更图表集合或顺序，已有服务器校验和恢复账本继续核对。
- **备选**　把公式也标成原子块会影响方向键与定界符的编辑。让图表定义与全文一样可直接输入会破坏整图保护。
- **参考**　[CodeMirror 装饰与原子范围](https://codemirror.net/examples/decoration/)、[共享图表变更检查](../../src/shared/note-markdown.ts)、[Host 保存服务](../../src/server/edit-service.ts)。

### D5　沿用写入和引用契约

- **决定**　正文事务经过 `EditSession.input` 加入详情草稿。组合输入期间停用定时提交，最终值进入 800 毫秒批次。图片与对应 Markdown 一起提交，显式图表操作按现有流程结束普通批次后立即排队。保留正文历史和导图 30 步历史的焦点范围。成功保存回执只推进已保存版本，相同正文不重建编辑器。
- **依据**　现行版本检查、资源池、保存失败重试和关闭恢复已留在 `EditSession` 和 Host 写入服务。DSH `v0.2.2-rc.3` 继续使用原生页签、引用写入和手动发送。位置捕获以编辑器坐标取得点击点，转换成原始正文字符边界，交由已有锚点规则核对已保存快照。已发布插件和当前配置均以同版宿主为目标。
- **备选**　正文另行直接写文件或修改位置载荷会绕开原有事务和引用回跳机制。
- **参考**　[固定版本侧栏官方文档](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/subsystems/sidebar-right.md)、[宿主接入证据](../../docs/sidebar-integration-research.md)、[存储契约](../../docs/mindmap-storage-format.md)、[运行时提示词契约](../../docs/mindmap-authoring-prompts.md)、[保存会话](../../src/client/edit-session.ts)。

以上为技术选型和接入决定。候选造包、包内依赖边界、长笔记滚动、输入法、公式边界、图表撤销以及宿主快捷键优先级需实际验证，记录见[快速验收](quickstart.md)。
