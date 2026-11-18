# 可行性调研：KaTeX 与 JSXGraph

2026-11-18。根据官方文档和现有预览版源码评估。

- **基本绘图好做**：现有 KaTeX 继续负责函数式的数学排版。JSXGraph 官方提供坐标轴、可配置的视窗和单变量函数曲线，曲线可接收项目控制的数学求值函数。这个组合适合在笔记中加一个函数图块，图像与原公式可并排使用。[KaTeX API](https://katex.org/docs/api) · [JSXGraph Functiongraph](https://jsxgraph.org/docs/Functiongraph.html) · [坐标范围示例](https://jsxgraph.org/share/example/bounding-box)
- **产品接入难度中等**：需要单独定义可安全求值的数学表达式范围、间断与非定义域的绘制规则，以及图块在笔记、撤销和独立导出之间的往返。官方 Functiongraph 也接受 JessieCode 字符串，但直接把笔记输入当该语言执行不满足本项目的输入边界。规划时优先验证受限数学求值后交给绘图库，无需用 KaTeX 反推函数含义。[JSXGraph Functiongraph](https://jsxgraph.org/docs/Functiongraph.html)
- **离线可行性待核对**：JSXGraph 官方提供可本地分发的脚本和样式。现有构建已经内嵌离线阅读器及 KaTeX 资源。下一阶段核对绘图库的本地打包、许可证声明、组件生命周期、断网单文件和包体变化，当前未在目标 DSH 中验证。[JSXGraph 安装文档](https://jsxgraph.org/home/start/gettingstarted/)
- **首版取舍**：用同一组函数表达式生成曲线和图例，先支持 y=f(x)、清楚的坐标范围及最多三条曲线。自动从任意 LaTeX 推导图像会扩大到语法转换和数学语义识别，留待有明确需求再评估。

## 产品方向更新

用户明确要求函数图与统计图作为知识说明，只读显示，增删改统一通过 DSH AI。右键将指定图块引用到提问框，保留原草稿并由用户手动发送。原设想的手动插入、预览草稿、字段编辑及图块撤销已撤回。离线导出整个阅读器不提供编辑或宿主动作。

JSXGraph 的 Chart 官方支持柱状与折线等样式，首版选择柱状图、折线图作为统计入口。优先核对图块引用是否能复用现有来源身份、快照、回跳和版本保护。函数、统计数据、图块局部错误及发布体积仍需验证。[JSXGraph Chart 文档](https://jsxgraph.org/docs/Chart.html)

## 规划结论

### 1. 图块存储与函数语法

- **决定**。复用 Marked 的块解析入口，顶层 `dsh-plot` 围栏包含独立版本、稳定 ID 和纯 JSON 数据。共享模块保存源码片段并验证数据。已有 KaTeX 继续渲染公式，并从白名单表达式生成函数图图例；求值使用完整消费输入的受限 AST。
- **依据**。当前 `src/shared/note-markdown.ts` 已用 Marked 扩展向节点详情和编辑器提供共享 token。原文片段可在手动编辑时原样保留，服务端可验证 AI 候选，独立 HTML 可直接复用同一笔记。KaTeX API 输入是 TeX 排版内容；它不提供绘图求值。 [Marked 扩展文档](https://marked.js.org/using_pro#extensions) · [KaTeX API](https://katex.org/docs/api)
- **考虑过**。按独立图块文件保存会新增路径、同步和导出处理。直接执行 JessieCode 或从任意 LaTeX 推导数学语义会扩张输入边界。

### 2. 数值绘图与生命周期

- **决定**。实施时固定 JSXGraph `1.14.3`。SVG Board 的视窗顺序为 `[xMin, yMax, xMax, yMin]`。对可能跨定义域或极点的抽样间隔继续细分，不能确认连续就断开；裁切后将明确分段的数值坐标交给 JSXGraph `Curve`。统计折线沿用分段，柱用固定 `Polygon`，主要图例和可复制数据由 React 以纯文本呈现。
- **依据**。`Curve` 支持数组坐标，SVG 渲染使用 NaN 停笔。现有 `Chart` 数据入口以数值数组为契约，缺值保留及系列分组更适合直接用图元明确表达。图块可见且有尺寸再初始化，用容器尺寸观察调整，卸载调用 `freeBoard`。不注册绘图库拖动、缩放、键盘等交互；右键由正文图块处理。 [Curve](https://jsxgraph.org/docs/Curve.html) · [SVG 渲染源码](https://github.com/jsxgraph/jsxgraph/blob/v1.14.3/src/renderer/svg.js#L1085-L1094) · [Chart](https://jsxgraph.org/docs/Chart.html) · [Polygon](https://jsxgraph.org/docs/Polygon.html) · [Board API](https://jsxgraph.org/docs/JXG.JSXGraph.html)
- **考虑过**。用 `Functiongraph` 回调可减少渲染接线，但由库自动猜断点无法交付这里的确定性规则。单靠固定稀疏采样可能刚好跨过极点。 [Functiongraph](https://jsxgraph.org/docs/Functiongraph.html)

### 3. 草稿引用与修改保护

- **决定**。延用注册过的 source，增加图块身份和可读快照。原会话中捕获 `draftRev`，将现有选区折叠到末端后插入，防止宿主替换被选内容。草稿 chip 支持来源回跳。发送时 codec 把 ID 和内容快照写入消息文本；发送后的原生消息历史只保证可读来源。客户端回跳的工作区地址不序列化进消息。
- **依据**。官方 rc.3 实现的 `insertReference` 替换传入范围，发送链路将引用序列化为文本，与附件交给普通消息发送入口。现有 `reference-source.ts` 和 `reference-navigation.ts` 已使用这套契约。 [官方插入实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/client/ui-conversation/src/client/input/facade.ts#L491-L505) · [官方引用 source 契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/client/ui-input-trigger/src/types.ts) · [官方发送实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/client/ui-conversation/src/client/input/facade.ts#L680-L698)
- **写入**。用现有 `atlas_read` 和 `set_note`，在候选阶段识别图块删除，使它进入 `atlas_preview` 和 `atlas_apply` 的审批链。改写前重读和核对图块由 `/mindmap` 提示，提交继续由 `expectedFingerprint`、写前重核和事务兜底。普通保存另校验图块原始序列，即使编辑器事件漏拦也不写入图块变更。
- **考虑过**。另开原生工具或另建引用协议会重复现有能力。把整篇旧引用版本当作图块版本会阻断用户仅编辑旁边文字的情况。

### 4. 本地资源和离线只读

- **决定**。用 esbuild 在现有客户端工厂与独立 HTML IIFE 内嵌 JSXGraph，服务端只加载数据验证器。使用局部样式，保留 npm 固定版本的 MIT 文本。该包 ESM 根入口会写 `window.JXG`，在构建适配里隔离这一个入口赋值并核对匹配，避免覆盖宿主全局。离线入口只注入阅读能力，去除现有内存 `saveLayout` 和编辑相关回调。
- **依据**。官方包提供 ESM 入口，`exports` 未公开 `distrib` 子路径。现有 `scripts/build.mjs` 已将离线 IIFE 和 KaTeX CSS/字体内联，`export-html.ts` 只注入地图、笔记、资源和布局。从源码判断可扩展为同一单文件构建，实际体积和宿主兼容性尚未测量。 [官方安装文档](https://www.jsxgraph.org/home/start/gettingstarted/) · [固定版本包清单](https://github.com/jsxgraph/jsxgraph/blob/v1.14.3/package.json) · [入口全局赋值](https://github.com/jsxgraph/jsxgraph/blob/v1.14.3/src/index.js#L229-L248) · [MIT 许可](https://github.com/jsxgraph/jsxgraph/blob/v1.14.3/LICENSE.MIT)
- **考虑过**。CDN 会让离线文件依赖网络；另一个离线渲染库会在有无 DSH 时产生不同的图和错误边界。实施时测量两个产物的实际体积和 320 px 的详情渲染时间。
