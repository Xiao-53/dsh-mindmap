# 节点详情阅读与编辑样式统一研究

## 在同一张详情页切换读写状态

- **决定** 以当前编辑态的标题、摘要、分隔线和正文布局为基准。读写状态使用同一个详情滚动容器、Markdown 投影和样式，按能力启用编辑。离线详情复用相同的阅读投影。
- **理由** `NoteInspector` 目前按状态切换 `NodeEditor` 与按节输出的 `RenderNote`，后者通过 `note-sections` 特殊处理 `## 简介` 等内容；编辑器用 `loadRichNote` 按顶层 token 顺序展示。保留现有快照和引用来源身份，旧选文若因为投影变化无法精确定位，继续展示可读快照并回到来源节点。详见 [NoteInspector](../../src/client/components/NoteInspector.tsx)、[正文编辑投影](../../src/client/note-rich-text.ts)、[引用定位](../../src/client/reference-navigation.ts)。
- **考虑过的方案** 给两个渲染器同步补 CSS，仍需维护两套结构和特殊分节。引入编辑器框架会改变现有序列化、中文输入和保存路径。
- **样式决定** 沿用节点主标题的 22 px 和现有正文基准，正文三级标题先按 16 / 14 / 13 px、递减字重与留白设计，标题使用同一易读色系并与正文区分。精确色值从现有详情配色确定，窄栏换行、色彩和实际可见段落交实机对照。

## 原子图块与 Markdown 往返

- **决定** 读写共用 `NotePlot`，在正文的非编辑图块容器中挂载它。渲染器继续负责图面、图例、回退和板实例释放。图块控制和图例排版与正文序列化、正文公式编辑、定位索引隔离。
- **理由** 当前编辑器用文字占位，现有 `NotePlot` 已维护 JSXGraph、尺寸观察和释放。图块移动、删除按 `PlotToken.start/end/source` 操作原有 Markdown 范围，只为保持顶层合法边界添加必要分隔。现有 `readRichNote` 会归一化块间空白，直接用它搬图会改变无关空白、行尾或围栏。操作前后重解析，确保其他内容块与图块定义保持。详见 [绘图组件](../../src/client/components/NotePlot.tsx)、[Markdown 解析](../../src/shared/note-markdown.ts)、[既有图块契约](../004-function-plot/contracts/plot-markdown.md)。
- **考虑过的方案** 复制图表渲染器会分化函数和统计图行为；把围栏交给浏览器原生剪贴或拖放会绕开编辑历史和原文保护。以 React portal 将同一个图表组件挂入专用容器可以沿用宿主 React，并让画布生命周期与正文 DOM 投影分开。

## 图块保存和撤销

- **决定** 本地动作走既有正文历史和 `EditSession`。替换客户端与服务端对 `sameNotePlots` 的绝对顺序限制，识别明确的整图删除和移动，保留对新图块、定义变更和越界操作的拦截。保存后撤销只能恢复同一宿主编辑作用域和版本链中已提交删除的原始图块。Host 维护有界的来源证明，待提交记录须由事务成功或当前版本的原提交回执确认，再成为恢复依据。
- **理由** 只允许当前图块子集会拒绝已经自动保存的删除撤销。历史来源需绑定工作区、地图、节点、图块身份及原围栏摘要。外部版本、跨作用域和失效历史不能沿用证明。旧坏块及重复 ID 保留原文回退，不参与可确认的移动、删除或恢复。沿用已有权限、版本检查、事务及失败恢复。详见 [编辑保存服务](../../src/server/edit-service.ts)、[编辑会话](../../src/client/edit-session.ts)、[事务](../../src/server/transaction.ts)。
- **考虑过的方案** 仅由客户端传入旧源码无法证明来源。单独持久化图块撤销栈超出当前会话级历史范围。现有事务回执机制可用于确认待定提交。

## 从正文点击位置生成定位引用

- **决定** 在菜单接管焦点前取右键坐标所命中的 DOM 插入点，把它和所属段落映射到原始 Markdown。记录已保存正文的摘要、段落源码范围及摘要、段内点击点、可读上下文和原作用域。未保存内容只有在目标可核对到已保存正文时才生成引用，无法核对时提示保存后重新选点。空正文可引用开头。硬换行、转义、行内标记、CRLF 和代理对均通过源映射确认边界。
- **理由** 可见文本投影用于选文，不能直接拼成 Markdown 偏移。浏览器的 `caretPositionFromPoint` 确定 DOM 命中，仍需验证点位属于正文，并排除图表生成的内容。目标宿主对该能力的实际支持及原有焦点行为待人工确认。见 [CSSOM View](https://www.w3.org/TR/cssom-view-1/#dom-document-caretpositionfrompoint)、[既有选文投影](../../src/client/selection.ts)。
- **宿主证据** 已安装的官方 `@deepseek-ai/dsh-client-ui-conversation@0.2.2-rc.3` 的 `src/client/contract/input.ts`、`src/client/input/facade.ts` 定义 `captureInsertion` 和带 `draftRev` 的 `insertReference`，后者按传入范围插入。复用 [原会话检查](../../src/client/register-sidebar.tsx)、[引用插入](../../src/client/insert-reference.ts) 和 [source codec](../../src/client/reference-source.ts)，把已有草稿选区折叠到末端。序列化仅向模型交付可读快照和定位所需数据；工作区绝对路径、会话 ID 和资源地址留在连接端。宿主实际保留附件、引用及处理焦点的行为待人工验证。
- **考虑过的方案** 只保存可见段落文本无法还原格式内位置或区分重复段落；插入引用时主动保存会把一次草稿操作变为正文写入。

## 发送后限定插入范围

- **决定** 在现有 `atlas_preview` 和 `atlas_apply` 的变更集合中增加 `insert_note_content` 变更项。用户发送后按地图和节点 ID 用 `atlas_read` 读取当前版本，带引用定位及单项内容走既有工具。服务端在候选中验证段落和原始边界、拼接并重解析，仅增加所需公式或图表；目标变化后只有原段能唯一核实时才继续，否则要求重新选点。
- **理由** `set_note` 能校验地图版本，但整个替换正文的形式无法约束引用选点和局部范围。有约束的变更项让规则在服务端生效，并复用工具注册、作用域、权限和事务。空节点第一次写入复用原笔记路径保护，拒绝接管未被地图引用的文件。依据见 [工具参数](../../src/server/tools/schemas.ts)、[候选处理](../../src/server/tools/candidate.ts)、[工具提交](../../src/server/tools/index.ts) 和 [现有提示词](../../docs/mindmap-authoring-prompts.md)。
- **考虑过的方案** 只改 `/mindmap` 提示词无法提供定位校验。独立工具会增加新的工具入口，现有条件提交流程已能承载一项约束明确的变更。

上述技术决定采用本地候选和目标版本契约。读写布局、真实 DSH 草稿与模型调用链、离线回归及保存后撤销的验证场景见 [快速验收](quickstart.md)。
