# dsh-mindmap

## 项目背景与当前边界

开发 DSH（DeepSeek Harness）辅助学习插件，目标是在 DSH 侧面板中使用可与 DSH 交互的思维导图。
工作区已有技术规划、任务清单及0.2.0本地候选；DSH真机与离线HTML人工验收待完成。当前范围和剩余工作见产品规范、tasks.md及docs/validation/release-status.md。

## 已确认方向

- 目标宿主为 DSH `v0.2.2-rc.3`，使用原生侧栏接入，不将 Better Sidebar 作为必需依赖。
- 原首期与输入框的交互闭环为“选中文本 → 加入输入框 → 点击引用回跳”；后续0.2.0入口扩展见下一条，均由用户自行发送，不自动提交现有草稿或直接发起模型请求。阅读、搜索和外部文件刷新等能力以产品规范为准。
- 用户后续指定0.2.0纳入选择收纳、v17整体移植、拖动与布局保存、节点引用、问题草稿文本及全图离线HTML下载；均待人工验收。问题草稿的稳定来源引用、显式重排/撤销、完整分享预检/范围/默认保存及DSH原生CRUD工具仍有剩余任务。提问只生成可编辑草稿，由用户手动发送。
- 以用户提供的 HTML v17 为视觉基准，桌面侧栏专用；输入为雾霾蓝实心圆，输出为灰豆沙空心圆（2px 描边）；进入或退出子图每次完整过渡均为0.5秒，无重影回弹。
- 使用 JSON 地图结构（`map.json`）、Markdown 详情及独立 JSON 布局（`layout.json`）；插件首次创建地图时自动建立工作区专用数据目录，每图独立文件夹。同名地图不覆盖，改标题不改变身份。默认目录名暂定 `dsh-knowledge-maps/`。
- 分享导出使用可离线阅读的独立 HTML，不提供 JSON 分享导出。
- 使用最小、稳定的画布界面与独立文件数据，保持呈现风格一致，便于 AI 局部修改内容；不以每次生成整份 HTML 作为主工作模式。
- HTML v17 仅供开发插件参考。插件维护完整界面模板，用 JSON 结构与 Markdown 内容填充并渲染侧栏，负责生成和维护 `layout.json`。DSH 提示词只包含内容格式与生成/修改规则，不要求模型读取原型、编写界面、计算坐标或完成视觉验收；省略角色宣告与目标口号。
- 参考 Archify 的结构化数据、统一渲染及结构校验思路；不直接引入它的整套 CLI、Viewer 或交付流程。
- 接入依据见 [侧栏调研](docs/sidebar-integration-research.md)，Archify参考结论见 [Archify调研](docs/archify-reference.md)。最新范围见 [知识图谱规范](specs/001-sidebar-knowledge-atlas/spec.md)，后续用户增量优先于早期分期描述。JSON/Markdown及字段职责见 [存储契约](docs/mindmap-storage-format.md)，内容规则见 [提示词](docs/mindmap-authoring-prompts.md)；当前工程沿用宿主React Slot、DOM/SVG和会话内状态，不额外引入图形库或全局状态库。

## 开发约定

- 使用中文沟通和编写项目文档；保留官方命令、API 和标识符的原名。
- 保持最小改动，优先复用官方工具；不生成演示代码、占位组件或无用途目录。
- 不提前选择尚未确认的前端框架、图形库、状态管理或架构细节；选型应有需求和当前 DSH 官方契约支持。
- DSH 文档入口见 [docs/dsh-development.md](docs/dsh-development.md)。社区资料不能替代官方 API 和兼容性依据。
- 不提交凭据、会话记录和机器本地状态；保留并纳入版本控制的内容包括 `.agents/skills/` 与 Spec Kit 配置、模板和脚本。
- 界面、交互等可由用户手动检查的改动，完成后直接交付；不自行运行自动测试、浏览器检查或视觉验收，除非用户另行要求。构建与打包用于生成可安装产物，不等同于验收通过；交付时说明未验证项。未建立产品工程前，不添加构建、测试框架、CI 或 Agent 编排系统。

## 工作流程

- 使用 GitHub 官方 Spec Kit，Codex 集成为 `.agents/skills/speckit-*/SKILL.md`，辅助脚本使用 PowerShell（`pwsh`）。
- 项目已执行 `$speckit-specify`、`$speckit-clarify` 和 `$speckit-constitution`；后续按任务需要手动调用相应步骤，包括 `$speckit-plan` → `$speckit-tasks` → `$speckit-analyze` → `$speckit-implement`，不自动推进。
- [项目宪章](.specify/memory/constitution.md)版本为 `1.0.0`；`specs/001-sidebar-knowledge-atlas/` 已有规范、计划、任务和本地实现。任务编号唯一；实现完成和人工验收分别记录，当前人工交接见 [验收清单](docs/validation/current-candidate.md)。已撤回的五阶段开发顺序不恢复；未完成任务只按用户选择推进，不自动进入下一Spec Kit步骤。
- 开始和结束工作时检查 Git 状态；不覆盖已有用户修改，不自行推送或发布。
- 已有 `.specify/` 时先运行 `specify integration status`；修复或升级使用 `specify integration install codex` / `specify integration upgrade codex`，不要重复执行 `specify init`。
- 初始化检查使用 `specify check`、`specify integration status`；不为了验证工具而生成产品规范或执行实现命令。

## 2026-11-15 最新实施

- 0.3.11将创建完整校验前置；失败占位由插件受控释放并保留请求指纹。回收站标题右侧新增“未完成创建”二级清理入口，DSH新增atlas_cleanup_create，共用服务并保留作废标记防止旧请求复活；不删除完整地图、未知内容或活动恢复记录，不递归删目录。仅静态核对及构建，人工/内部失败边界均待相应验证，见docs/validation/0.3.11.md；本轮不运行自主测试或故障注入。
- 0.3.10按真实反馈优化skill创建契约与完整参数示例：新建无需先列图，读图用于任务内容或用户指定参考；明确中心节点不必出现在自身子图画布。已构建打包，实际工具选择及生成效果待人工验收，见docs/validation/0.3.10.md。仅静态核对和构建，不运行自主测试或浏览器检查。
- 0.3.9按用户最新选择改为DSH原生`/mindmap` skill入口，旧`/minimap`及其恢复子命令完全删除；skill新增内容组织与局部修改规则。用户手动发送后执行；2026-11-15用户确认人工验收通过，T139完成，含原生输入框引用及模型实际效果，见docs/validation/0.3.9.md。人工编辑器、撤销和显式重排暂缓；下条0.3.0命令说明为历史记录。
- 产品定位扩展为通用思维导图，包括架构设计、流程与学习知识；不强制学习专用笔记章节。
- 0.3.0已实现下阶段工具及保存保护，DSH命令为`/minimap`（内嵌skill名mindmap）；不自动发起模型请求。人工验收见docs/validation/0.3.0.md。
- 本轮用户单独授权仅运行保存/恢复内部故障注入测试，不扩展到界面、浏览器或视觉检查；未来自主测试仍遵守原约定。

## 2026-11-20 自动化 E2E 验证工作流

- 仓库已接入 `agent-browser`（`.agents/skills/agent-browser/SKILL.md` 及全局 `~/.gemini/config/skills/agent-browser/SKILL.md`）与两层自动化 E2E 验证工作流（`.agents/skills/dsh-e2e-verify/SKILL.md`、`scripts/e2e-env.mjs`、`npm.cmd run verify:layer1`、`npm.cmd run verify:e2e:start`、`npm.cmd run verify:e2e:serve`、`npm.cmd run verify:e2e:stop`）。
- 后续**仅在用户明确要求由 Agent 执行自动化验收时**，才由 Agent 先用 `verify:e2e:serve`（独立终端可用 `verify:e2e:start`）启动隔离的临时 `DSH_HOME`、`e2e-workspace`、`--profile web --no-open` 与独立端口测试实例，再用 `agent-browser.cmd --session dsh-mindmap-e2e`（保留默认 `AGENT_BROWSER_SOCKET_DIR`，支持 `--headed` 或 `agent-browser dashboard` 实时围观）交互式跑完测试并排查前端报错，最后执行 `npm.cmd run verify:e2e:stop` 清理并汇报验收报告与 `test-artifacts/` 关键截图；其余日常开发改动完成后，UI 验收仍交由用户手动确认（`test-artifacts/` 已加入 `.gitignore`）。
- Windows 11 / PowerShell 环境下避免调用被执行策略拦截的 `.ps1`，应使用 `npm.cmd`、`agent-browser.cmd` 与 DSH Desktop 内置 `dsh.cmd`；测试结束必须关闭浏览器会话、终止后台 `dsh` 进程树并清理临时 `DSH_HOME`。

## 2026-11-24 预览包自动打包约定

- 每次影响插件产物的改动（`src/`、构建脚本、依赖及随包文档）完成后，Agent 自动执行 `npm.cmd run pack:plugin` 生成预览包，不需要用户另行要求；打包不等同于验收通过，交付时仍须说明未验证项。仅改 `AGENTS.md`、`specs/`、`docs/validation/` 等不进入产物的文件、纯问答与只读调查的回合不打包。
- 预览包版本号固定为 `0.4.7-preview.n`，产物位于 `dist/previews/xiao-53-dsh-mindmap-0.4.7-preview.n.tgz`。
- 命名前必须先列出 `dist/previews/` 目录，取已有 `preview.n` 的最大 n，新版本为 n+1：不重复已有编号，不跳号，目录为空时从 `preview.1` 开始。
- 确定编号后先把 `package.json` 与 `package-lock.json`（根节点 `version` 及 `packages[""].version`）的版本同步改为 `0.4.7-preview.(n+1)`，再打包；打包后核对输出的 tgz 文件名与目录中无重复。
- 同一回合内如有多次改动，只在该回合全部改动完成后打包一次，避免无意义地消耗编号。
- 基础版本号（`0.4.7`）升级或正式发布仍须用户明确指示；预览包不创建 Git 标签、不推送、不发布。

## 2026-11-24 交付前 Git 本地保存约定

- 每次产生工作区文件改动并准备向用户交付前，Agent 必须先执行本地 Git 保存（暂存变更并 `git commit`）作为可回退检查点；纯问答与只读调查（无工作区改动）不创建空提交。
- 若本回合同时触发“预览包自动打包约定”，应先完成全部文件修改、版本号同步与 `npm.cmd run pack:plugin`，再执行本地 Git 提交（`dist/`、`lib/`、`*.tgz` 已由 `.gitignore` 忽略，不纳入提交）。
- 提交前必须先检查 `git status -s`，确认不包含凭据、密钥、会话记录、机器本地状态或其他不应入库的文件。
- 仅执行本地 `git commit` 保存检查点，不自行 `git push`、不创建 Git 标签、不发布；提交信息使用简洁中文（涉及预览包时标明当前版本号），并在交付回复中附上本次 commit 短哈希与提交说明，便于随时回退。
