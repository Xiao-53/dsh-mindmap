# 调研：节点笔记 LaTeX 公式预览与编辑

2026-11-18。依据官方文档与本项目安装的目标 DSH 版本源码整理。以下是进入技术规划前的判断，未在 DSH 或离线导出中实测。

| 方案 | 官方能力 | 对本项目的判断 |
| --- | --- | --- |
| KaTeX | 通过 API 逐条渲染，可输出视觉 HTML 和无障碍 MathML。可为错误提供单条回退，支持分式、矩阵与对齐环境。[API](https://katex.org/docs/api)、[选项](https://katex.org/docs/options.html)、[支持范围](https://katex.org/docs/supported) | **优先验证**。逐条处理适合正文、单式预览和离线复用。打包时需核验样式、字体的本地加载与单文件嵌入，不使用示例 CDN。[浏览器安装说明](https://katex.org/docs/browser) |
| MathJax | 支持 TeX 输入与多种输出，动态更新通常通过异步接口。v4 字体或扩展可能分批加载，也支持自托管。[动态排版](https://docs.mathjax.org/en/latest/web/typeset.html)、[本地托管](https://docs.mathjax.org/en/latest/web/hosting.html) | 若正式样例有 KaTeX 无法满足的命令，再按样例比较。现有需求的单式即时预览与单文件分发都需处理异步及资源依赖，先不并行集成。 |
| MathLive | 提供可交互的公式输入组件，支持读写 LaTeX 表达式。[入门](https://mathlive.io/mathlive/guides/getting-started/)、[公式输入 API](https://mathlive.io/mathlive/api/) | 适合后续需要直接操作分式、根号模板或虚拟键盘时评估。当前用局部 LaTeX 输入与实时预览即可检验用户流程。 |

## 与现有项目的衔接

- 目标版本 DSH 的官方 `@deepseek-ai/dsh-client-ui-primitives` 公开导出 `MarkdownText`，本地已安装源码显示其用 KaTeX 渲染数学内容并支持复制 TeX。该组件同时接管段落样式、链接与图片，且明确允许直接渲染 HTTP(S) 图片。直接替换整个笔记阅读器会改变现有资源与引用行为，也不能直接复用于独立导出。建议参考宿主的公式渲染和复制方式，保留地图自己的正文呈现与资源边界。源码见仓库内安装包 `node_modules/@deepseek-ai/dsh-client-ui-primitives/src/markdown/MarkdownText.tsx` 和 `katex.tsx`。
- 阅读侧使用 `note-sections.ts` 与 `render-note.tsx`，编辑侧 `note-rich-text.ts` 也用 Marked 分词并将可视正文序列化为 Markdown。规划时优先验证共享的行内/块公式分词，保护反斜杠、下划线、定界符，以及代码和金额的优先级。Marked 提供专用分词扩展；全页扫描排版难以维持所见即所得编辑的公式原式和撤销边界。[Marked 扩展文档](https://marked.js.org/using_pro#custom-extensions)
- 单美元符号和金额存在歧义。常用美元定界符值得保留，同时给容易混淆的表达式提供括号定界符，明确转义、代码和数字紧跟结束符的行为。MathJax 也明确指出单美元默认不开启是因为常见价格文本可能误识别。[MathJax 定界文档](https://docs.mathjax.org/en/latest/input/tex/delimiters.html)
- 独立导出入口已在 `scripts/build.mjs` 打包为单文件阅读器的一部分。规划时验证公式样式与字体打包后能在断网 `file://` 中使用，检查包大小、首次打开时间与窄栏溢出。另检验保存原式与引用复制时不重复视觉层、无障碍层上的内容。
- 公式输入按不可信正文处理。验证信任选项关闭、宏定义互不串扰、展开和尺寸有界，错误文字作纯文本呈现。官方明确提示信任命令可能加载资源、改动属性，错误消息可能含未转义的 LaTeX 源码。[KaTeX 安全说明](https://katex.org/docs/security)、[持久宏说明](https://katex.org/docs/api#security-of-persistent-macros)

下一步按 [规格](spec.md) 核对定界、局部编辑、保存和撤销，以及断网导出的可行性，再确定版本和打包方式。

## Phase 0 决策

### 1. 共享分词，不扫描渲染后的整页

**Decision**：使用一个私有 Marked 17 实例注册行内/块公式扩展，结合 `start` 提示和有界扫描。阅读、编辑初始化、整篇复制、离线和服务端资源枚举共用该实例。公式 token 为不含子节点的叶子，保留原式、形式与内容。服务端只分词，无公式计算或渲染依赖。

**Rationale**：分词时即可隔离公式中的反斜杠、下划线与 Markdown 外观文本。若服务端仍用另一份分词器，公式内字面链接可能被错误当成资源路径。章节标题要保留 tokens，表格和列表递归处理。实例预先配置 GFM 与换行选项，调用 `.lexer(markdown)` 时不传覆盖默认配置的普通选项。代码范围交由现有 Markdown lexer；边界复杂样例见契约和验收指南。[Marked 自定义扩展](https://marked.js.org/using_pro#custom-extensions)

**Alternatives considered**：页面级自动渲染难以关联持久化源式与可编辑 DOM。仅用正则预替换整个 Markdown 会跳过代码与链接上下文。

### 2. 逐条使用 KaTeX 0.19.1

**Decision**：使用已存在于 npm 的官方 KaTeX `0.19.1`，锁定版本并复用统一的客户端适配。通过独立的公式容器调用公开 API，生成视觉/MathML，出错回落到普通文本。禁用所有 trust 扩展能力，使用每式独立宏环境、有界公式长度、宏展开和显式尺寸。识别被禁止的命令时标为回退而不是把带提示的红色输出当成有效式。错误仅提示固定可读文案和原式。

**Rationale**：项目顶层未装 KaTeX。目标 DSH 的官方 primitives 声明了私有 KaTeX 依赖并导出整篇 MarkdownText，而当前插件需要保留自己的笔记样式、图片策略、选文与离线文件。独立依赖可为三处复用同一排版，不依赖宿主内部资源位置。[官方发布页](https://github.com/KaTeX/KaTeX/releases/tag/v0.19.1)、[安全说明](https://katex.org/docs/security)、[选项](https://katex.org/docs/options.html)

**Alternatives considered**：采用 DSH 整篇 Markdown 组件会接管图片和链接；MathJax 意味着额外的异步排版和离线资源验证；MathLive 的公式输入组件不是这次直接键入的必要条件。

### 3. 独立处理 CSS 后嵌入离线阅读器

**Decision**：用现有 esbuild 先处理 KaTeX 的 CSS 和内嵌字体，再将编译结果作为本地样式字符串注入在线入口与离线 IIFE。以 WOFF2 为默认，按固定版本校验每个字体族和字重有可嵌入的资源，构建期对未解析的 CSS URL 报错。作用域限定在公式控件，避免宿主较旧版本的 KaTeX 样式或字体定义交叉影响。随安装包和单文件带上适用的第三方声明。

**Rationale**：当前 `.css: 'text'` 只读 CSS 文本，不处理内部 `url()`。单独以 CSS bundling 和 data URL loader 处理字体后再嵌入，才能同时保证宿主容器与断网新目录可打开。官方版本字库包含 20 个 WOFF2 文件合计约 260 KB，三种格式总计约 1.08 MB；这是资源体积比较，最终 JS 和导出体积需构建后实测。[esbuild Content Types](https://esbuild.github.io/content-types/#data-url)、[KaTeX 字体](https://katex.org/docs/font)

**Alternatives considered**：加载 CDN 或在 HTML 旁放字体无法满足单文件断网要求。暂不引入第二套构建流程或字体子集工具。

### 4. 将原位预览作为同一次内容编辑的显示结果

**Decision**：沿用既有 contenteditable，解析受影响范围时先识别用户输入的源码，再走 Markdown 转义。只更新公式出现的局部范围；光标用逻辑位置保存。正文由有界的语义历史负责 Ctrl+Z/Y 和可拦截的原生撤销事件。预览不写入、不计步。连续输入合组、整次粘贴、IME 提交、显式公式应用/删除分别是内容动作。带图像或其他格式的正文操作继续经过同一历史入口。

**Rationale**：浏览器原生编辑加上另一次 DOM 替换无法保证聚合为一次撤销。识别前若先用现有 Markdown 转义会改变 LaTeX。组字中的临时 DOM 无需刷新。保留可编辑原式直到定界闭合有效，后续数字紧邻定界时允许恢复文字投影。[编辑事件规范](https://www.w3.org/TR/input-events-2/)

**Alternatives considered**：整篇重建会打断光标和输入法；仅依赖两次原生编辑操作不能确保合并。现有导图 30 步历史粒度为自动保存批次，不适合作为正文内历史。

### 5. 局部草稿与选文原式

**Decision**：单式未应用草稿按会话、工作区、地图、节点、视图和出现位置留存。保存前核对目标原式和编辑版本。插件可控离开先处理局部草稿，再沿用现有 autosave flush；宿主同步关闭不等待提示，保留在当前会话内。整篇复制及选文引用采用同一原式投影，回跳也用同一投影映射至可见范围。

**Rationale**：编辑输入和取消不能误触发保存，同一源式可能在笔记出现多次。KaTeX 视觉层和 MathML 层会导致按 DOM 文本直接选择或复制时重复内容。可参考宿主的 `copy-tex.ts`，本项目保留原定界方式及原引用失败回退。

**Alternatives considered**：用当前普通正文草稿保存未应用公式会污染持久化，按公式字符串定位会修改错误位置。浏览器 Range 失效后必须重新定位，不能自动应用失配草稿。

Phase 0 已明确设计决策。目标宿主版本的 CSS 隔离、真实输入法与原生撤销行为、打包及离线验证留待实现阶段按 [quickstart.md](quickstart.md)验收。
