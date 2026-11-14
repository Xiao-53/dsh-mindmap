# DSH 官方文档与工具索引

核查日期：2026-11-14。项目名称：`dsh-mindmap`；工作区根目录为当前 `learn/`，未另建嵌套项目目录。
本页只记录资料入口与工具状态，不确定插件形态、依赖、实现方式或界面设计。

针对 DSH v0.2.2-rc.3 的侧栏接入、输入框联动及画布/HTML 方案比较，见 [侧栏调研](sidebar-integration-research.md)。用户已确认原生接入、引用加入草稿并回跳、最小稳定画布与文件数据；完整产品范围与分期以[产品规范](../specs/001-sidebar-knowledge-atlas/spec.md)为准，调研中的备选能力不自动进入范围。
Archify 的结构化数据与统一渲染机制见 [Archify 调研](archify-reference.md)。

当前已建立[项目宪章](../.specify/memory/constitution.md) `1.0.0`，并完成产品规范、JSON + Markdown [存储契约](mindmap-storage-format.md)及参考[提示词](mindmap-authoring-prompts.md)的整理；尚未进入技术规划或实现。下文初始化命令及检查结果是历史记录，不代表当前仍处于空模板、无功能目录状态。

## DSH 官方资料

官方文档站由官方仓库 README 链接确认；以下源码文档来自 `deepseek-ai/deepseek-harness`。
`master` 链接会变化，进入实际开发时需重新核对目标 DSH 版本及其对应文档。

| 入口 | 用途 |
| --- | --- |
| [官方仓库与运行入口](https://github.com/deepseek-ai/deepseek-harness) | 项目来源、发行运行方式、文档入口 |
| [官方文档站](https://deepseek-harness.github.io/deepseek-harness/) | 官方文档导航；本次可访问，正文抓取为空，已改查官方仓库原文 |
| [Releases](https://github.com/deepseek-ai/deepseek-harness/releases) | 开发前核对目标版本与变更 |
| [第一个插件](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md) | 插件开发教程入口 |
| [插件配置](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md) | 官方教程目录中的配置参考 |
| [插件打包与安装](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) | 安装、发布与版本兼容规则 |
| [扩展参考](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/extension-cookbook.md) | 扩展点文档导航 |
| [子系统索引](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/README.md) | 查找交互、会话及客户端契约 |
| [侧面板参考](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/sidebar-right.md) | 查询侧面板契约；本项目已确认原生侧栏，目标版本依据见侧栏调研 |
| [Web Client Slots](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/slots.md) | 查询 UI 扩展点；不代表已选择前端方案 |
| [扩展与运行时检查](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/extensions.md) | 查询动态扩展、运行时检查和 Inspector 服务 |
| [CLI 参考](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cli-help.md) | 核对 `dsh`、`dsh plugin` 等命令 |
| [官方开发指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/development.md) | 查询上游源码开发环境与检查命令；不直接照搬上游工程配置 |

官方 README 提供 `npx @deepseek-ai/dsh web` 运行入口；CLI、插件安装及 Inspector 仅登记为后续可查工具，本次未运行、安装或配置 DSH。
未引入社区插件脚手架或第三方开发 Skills。

## 工作区工具与 Spec Kit

复用本机已有工具：Git `2.51.0.windows.1`、Codex CLI `0.167.0`、uv `0.12.17`、Specify CLI `1.4.1.dev0`、PowerShell `7.7.0`、Python `3.12.10`、Node.js `24.19.0`、npm `12.2.1`、pnpm `11.22.0`。
Specify 使用独立 uv 工具环境，其中 Python 为 `3.14.7`。这些是环境盘点，不构成项目依赖或版本约束。
`dsh` 不在 PATH；未执行插件构建或运行验证。上游源码指南当前指定 pnpm `11.28.5`，本机版本不同；本次仅索引该要求，不升级工具或套用至本项目。

- [GitHub 官方 Spec Kit](https://github.com/github/spec-kit)：本机 uv 安装来源为 `git+https://github.com/github/spec-kit.git`，提交 `f29319d550d1f05404f7184b92e995600ca2293f`。
- [官方 Codex 集成说明](https://github.com/github/spec-kit/blob/main/docs/integrations/codex.md)：使用项目级 Skills 和 `$speckit-…` 调用语法。
- [Codex Skills 官方说明](https://learn.chatgpt.com/docs/build-skills)：仓库级发现路径为 `.agents/skills/`。
- [AGENTS.md 官方说明](https://learn.chatgpt.com/docs/agent-configuration/agents-md)：项目约定入口。

初始化阶段执行过的命令（历史记录）：

```powershell
specify init --here --integration codex --integration-options '--skills --events false' --script ps --non-interactive
specify workflow remove speckit
git init -b main
```

以上仅为初始化记录，不要在已初始化工作区重复运行。仅启用 Codex；未安装扩展、预设或自动化工作流，未启用事件钩子。
初始化结束时，官方 constitution 模板尚未填写，也未创建功能规范、计划或任务；后续已建立宪章与功能规范，当前状态见本文开头。

检查配置可使用 `specify check`、`specify integration status`、`specify artifact list`。
若当前 Codex 会话未显示新安装的 Skills，可重新打开项目会话后查看。

初始化阶段验证（历史记录）：Codex app-server 的 `skills/list` 实际发现并启用 9 个仓库级 Skills，加载错误为 0；
Spec Kit 集成状态正常，托管文件缺失或修改为 0；6 个 PowerShell 脚本语法与 5 类模板解析通过。
初始化阶段尚无功能目录，`check-prerequisites.ps1 -PathsOnly -Json` 当时提示先建立功能目录，属于该阶段的预期状态。
当前已有 `specs/001-sidebar-knowledge-atlas/`；后续检查须结合当前阶段解释结果，不为使检查通过而生成无关产物或机器本地状态。
