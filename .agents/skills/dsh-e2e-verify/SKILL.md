---
name: dsh-e2e-verify
description: Automated two-layer E2E verification workflow for dsh-mindmap on Windows 11 using isolated DSH Web instances and agent-browser. Use after modifying code, styles, build scripts, or refactoring to verify build, config schema, plugin boot, UI interactions, Markdown inline editing, KaTeX/JSXGraph rendering, single-level folder drag sorting, and offline HTML export.
---

# dsh-mindmap 两层自动化 E2E 验证流程

**触发原则：仅在用户明确要求由 Agent 执行自动化验收时才使用本技能运行 E2E；其余日常开发改动完成后，UI 视觉与交互验收默认仍交由用户确认。**

验证方式为：**轻量脚本仅负责构建检查与隔离 DSH Web 启停，Layer 2 由 Agent 亲自调用 `agent-browser` 交互式逐项实测**，全部通过后再向用户交付简明验收报告与截图。

## 核心命令

- **仅第一层无头快检**（`build` + `typecheck` + 临时 `DSH_HOME` 下 `--dump-config` + 启动日志检查，自动清理）：
  ```powershell
  npm.cmd run verify:layer1
  ```
- **启动隔离 DSH Web 测试环境**（先跑第一层快检，再在临时 `DSH_HOME`、`e2e-workspace`、`3099` 端口拉起 `--profile web --no-open`，输出带 `?token=` URL 至 `test-artifacts/e2e-env.json`）：
  - 在 Agent 沙箱/作业控制环境中（命令退出会回收子进程），使用长驻守护模式启动（调用工具时设 `IsDaemon: true`）：
    ```powershell
    npm.cmd run verify:e2e:serve
    ```
  - 在普通独立 PowerShell 终端中，可使用后台分离模式：
    ```powershell
    npm.cmd run verify:e2e:start
    ```
- **强制收尾清理**（无论成功或失败，结束必跑：关闭 `agent-browser` 测试会话、`taskkill` 杀掉 DSH 测试进程树、删除临时 `DSH_HOME`）：
  ```powershell
  npm.cmd run verify:e2e:stop
  ```

## 环境与隔离铁律（Windows 11 / PowerShell）

1. **DSH CLI 来源**：优先使用 PATH 中的 `dsh.cmd`，未命中时回退绝对路径 `"C:\Users\Xiao\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"`（路径含空格加引号）。**严禁**重装 `@deepseek-ai/dsh`。
2. **彻底隔离状态**：
   - 使用独立临时 `DSH_HOME`（`$env:TEMP\dsh-mindmap-e2e-...`）与独立测试工作区（`storages/workspace.json`），严禁触碰 `~/.dsh`、`desktop` profile 或日常默认工作区。
   - 仅使用独立会话 `agent-browser.cmd --session dsh-mindmap-e2e`（用户想围观时首次 `open` 加 `--headed`，默认无头）。
   - **不得改动默认的 `AGENT_BROWSER_SOCKET_DIR`**，以便随时通过 `agent-browser.cmd dashboard` 实时观看或接管页面。
3. **PowerShell 调用规范**：本机禁止加载 `.ps1`，PowerShell 中必须使用 `npm.cmd`、`agent-browser.cmd`、`dsh.cmd`。

## Layer 2（Agent 亲自使用 `agent-browser` 逐项实测）

1. 在 Agent 环境中先启动隔离 DSH Web（`IsDaemon: true` 运行 `npm.cmd run verify:e2e:serve`），从输出（或 [e2e-env.json](../../../test-artifacts/e2e-env.json)）获取 `tokenUrl` 与 `mapsRoot`。
2. 为避免 Windows 作业对象在单条命令退出后回收 `agent-browser` daemon，可用一条 `IsDaemon: true` 命令完成 `open` 并 `Wait-Process` 保活 daemon（需要围观时加 `--headed`；需要下载时加 `--download-path`）：
   ```powershell
   $before = @(Get-Process -Name "agent-browser-win32-x64" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
   & agent-browser.cmd --session dsh-mindmap-e2e set viewport 1440 900
   & agent-browser.cmd --session dsh-mindmap-e2e open "<tokenUrl>"
   $after = @(Get-Process -Name "agent-browser-win32-x64" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
   $daemonPid = $after | Where-Object { $before -notcontains $_ } | Select-Object -First 1
   if ($daemonPid) { Wait-Process -Id $daemonPid -ErrorAction SilentlyContinue }
   ```
   后续即可在独立命令中随时用 `agent-browser.cmd --session dsh-mindmap-e2e snapshot -i` / `click @ref` 交互；在 PowerShell 中执行 `eval` 时请用 `@' ... '@ | agent-browser.cmd --session dsh-mindmap-e2e eval --stdin` 避免引号与 `$` 变量被转义；输入含 `$` 的公式文本时注意用单引号或反引号转义 `$`。
3. 依次关闭首次弹窗（「预览版说明」→「继续」；「开始使用」→「关闭」），点击「打开右侧边栏」→「思维导图」→「全屏」，按 5 大核心清单逐项实测并用 `screenshot` 保存关键截图到 `test-artifacts/`：
   1) **画布加载、节点增删改与基础交互**：验证画布节点/连线渲染、点击「核心定理」钻取子图与「01 导图总览」返回、拖动节点保存 `layout.json`、搜索弹窗、排列切换与重置、修改工作区 `map.json` 节点后点击「刷新地图」同步增删。
   2) **节点级 Markdown 行内实时编辑与预览**：点击「编辑」，修改标题/摘要与 CodeMirror Markdown（含公式），验证实时预览，点击「完成」后核验只读预览、画布节点标题更新与磁盘 `notes/*.md` 落盘。
   3) **KaTeX 数学公式与 JSXGraph 图表渲染**：打开 `n-math` 节点详情，滚动 `.inspector-body` 触发全部图块 `IntersectionObserver`，核验公式与函数图/柱状图 SVG 正常渲染且无报错提示。
   4) **单层文件夹拖拽排序**：在目录页新建文件夹，验证文件夹拖拽重排及将根目录导图拖入文件夹，核验 `library.json` 顺序持久化且所有文件夹保持 `parentId: null` 单层结构。
   5) **单文件离线 HTML 导出**：点击「导出离线 HTML」配合 `--download-path` 保存（或转移至 `test-artifacts/exported-mindmap.html`），核验无外链且包含最新内容；再用 `tab new` 在独立标签页离线打开复验画布、KaTeX 与 JSXGraph 渲染。
4. 运行 `agent-browser.cmd --session dsh-mindmap-e2e errors` 与 `console` 排查前端报错；如有报错或渲染异常，先定位修复并重跑，再交付简明验收报告和关键截图路径。
5. **最后务必执行 `npm.cmd run verify:e2e:stop`** 清理浏览器、测试进程与临时目录。
