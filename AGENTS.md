# dsh-mindmap

## 项目背景与当前边界

开发 DSH（DeepSeek Harness）辅助学习插件，目标是在 DSH 侧面板中使用可与 DSH 交互的思维导图。
工作区已初始化，已完成侧栏接口调研；用户确认的方向见下文，尚未开始功能实现。

## 已确认方向

- 目标宿主为 DSH `v0.2.2-rc.3`，使用原生侧栏接入，不将 Better Sidebar 作为必需依赖。
- 首期与输入框的交互仅限“选中文本 → 加入输入框 → 点击引用回跳”；由用户在输入框中自行发送，不提供直接提问，也不自动提交现有草稿。首期的阅读、搜索和外部文件刷新等能力以产品规范为准。
- 完整产品范围增加节点引用、针对内容准备问题草稿、DSH 原生工具增删改查节点与关系、自动布局及递归子图。提问暂按生成可编辑草稿理解，仍由用户手动发送；新增能力未在本轮排期。
- 以用户提供的 HTML v17 为视觉基准，桌面侧栏专用；输入为雾霾蓝实心圆，输出为灰豆沙空心圆（2px 描边）；进入或退出子图每次完整过渡均为0.5秒，无重影回弹。
- 使用 JSON 地图结构（`map.json`）、Markdown 详情及独立 JSON 布局（`layout.json`）；插件首次创建地图时自动建立工作区专用数据目录，每图独立文件夹。同名地图不覆盖，改标题不改变身份。默认目录名暂定 `dsh-knowledge-maps/`。
- 分享导出使用可离线阅读的独立 HTML，不提供 JSON 分享导出。
- 使用最小、稳定的画布界面与独立文件数据，保持呈现风格一致，便于 AI 局部修改内容；不以每次生成整份 HTML 作为主工作模式。
- HTML v17 仅供开发插件参考。插件维护完整界面模板，用 JSON 结构与 Markdown 内容填充并渲染侧栏，负责生成和维护 `layout.json`。DSH 提示词只包含内容格式与生成/修改规则，不要求模型读取原型、编写界面、计算坐标或完成视觉验收；省略角色宣告与目标口号。
- 参考 Archify 的结构化数据、统一渲染及结构校验思路；不直接引入它的整套 CLI、Viewer 或交付流程。
- 接入依据见 [侧栏调研](docs/sidebar-integration-research.md)，Archify 参考结论见 [Archify 调研](docs/archify-reference.md)。最新产品范围见 [知识图谱规范](specs/001-sidebar-knowledge-atlas/spec.md)，优先于调研中的早期范围描述。JSON + Markdown 已确定，字段与文件职责见 [存储契约](docs/mindmap-storage-format.md)，生成及局部修改规则见 [提示词](docs/mindmap-authoring-prompts.md)；前端框架和图形库尚未确定。

## 开发约定

- 使用中文沟通和编写项目文档；保留官方命令、API 和标识符的原名。
- 保持最小改动，优先复用官方工具；不生成演示代码、占位组件或无用途目录。
- 不提前选择尚未确认的前端框架、图形库、状态管理或架构细节；选型应有需求和当前 DSH 官方契约支持。
- DSH 文档入口见 [docs/dsh-development.md](docs/dsh-development.md)。社区资料不能替代官方 API 和兼容性依据。
- 不提交凭据、会话记录和机器本地状态；保留并纳入版本控制的内容包括 `.agents/skills/` 与 Spec Kit 配置、模板和脚本。
- 按变更范围执行必要验证并报告结果；未建立产品工程前，不添加构建、测试框架、CI 或 Agent 编排系统。

## 工作流程

- 使用 GitHub 官方 Spec Kit，Codex 集成为 `.agents/skills/speckit-*/SKILL.md`，辅助脚本使用 PowerShell（`pwsh`）。
- 项目已执行 `$speckit-specify`、`$speckit-clarify` 和 `$speckit-constitution`；后续按任务需要手动调用相应步骤，包括 `$speckit-plan` → `$speckit-tasks` → `$speckit-analyze` → `$speckit-implement`，不自动推进。
- [项目宪章](.specify/memory/constitution.md)已建立，版本为 `1.0.0`；现有 `specs/001-sidebar-knowledge-atlas/` 规范已完成文档一致性复核，尚未进入技术规划或实现。用户补充文字中的五阶段开发顺序已明确撤回，不据此调整已有分期或自动进入实现。
- 开始和结束工作时检查 Git 状态；不覆盖已有用户修改，不自行推送或发布。
- 已有 `.specify/` 时先运行 `specify integration status`；修复或升级使用 `specify integration install codex` / `specify integration upgrade codex`，不要重复执行 `specify init`。
- 初始化检查使用 `specify check`、`specify integration status`；不为了验证工具而生成产品规范或执行实现命令。
