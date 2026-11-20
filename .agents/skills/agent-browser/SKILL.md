---
name: agent-browser
description: Browser automation CLI for AI agents (`agent-browser`). Use when opening local or web apps, inspecting interactive accessibility trees (`snapshot -i`), clicking/filling/dragging UI elements, checking browser `console`/`errors`, downloading exported files, capturing verification screenshots, or running headless E2E UI verification.
---

# agent-browser 使用指南（agy / Windows 11 环境）

本机已全局安装 `agent-browser 0.43.0` 与缓存 Chrome（位于 `%USERPROFILE%\.agent-browser\browsers`）。

## Windows 11 / PowerShell 关键约束

- 本机 PowerShell 执行策略禁止直接运行 `.ps1` 包装脚本（`agent-browser.ps1`、`npm.ps1`）。
- **PowerShell 中请调用 `agent-browser.cmd`（不要只敲 `agent-browser`）**；在 Node 脚本中可直接调用原生二进制 `%APPDATA%\npm\node_modules\agent-browser\bin\agent-browser-win32-x64.exe`。
- **必须显式指定 `--session <name>`**（例如 `--session dsh-mindmap-e2e`），切勿使用未命名的默认会话，避免污染用户或其它任务的浏览器状态。
- 所有任务结束或出错退出时，**必须执行 `agent-browser.cmd --session <name> close`** 释放浏览器进程。

## 核心闭环

```powershell
# 1. 配置视口并打开目标 URL（DSH Web 必须使用带 ?token= 的完整 URL）
agent-browser.cmd --session dsh-mindmap-e2e set viewport 1440 900
agent-browser.cmd --session dsh-mindmap-e2e open "http://127.0.0.1:3099/?token=..."

# 2. 获取交互式可访问性树与 @eN 引用
agent-browser.cmd --session dsh-mindmap-e2e snapshot -i

# 3. 基于 @ref 执行交互并在页面变化后重新 snapshot
agent-browser.cmd --session dsh-mindmap-e2e click @e3
agent-browser.cmd --session dsh-mindmap-e2e wait --text "思维导图"
agent-browser.cmd --session dsh-mindmap-e2e snapshot -i
```

## 常用命令速查

| 场景 | 命令 |
| --- | --- |
| 打开页面 | `agent-browser.cmd --session <s_id> open "<url>"` |
| 获取交互快照 | `agent-browser.cmd --session <s_id> snapshot -i`（可加 `--json` 或 `-s "<css>"`） |
| 点击 / 填写 | `click @e3`、`fill @e4 "文本"`、`type @e4 "文本"` |
| 富文本/CodeMirror 输入 | `focus @e4` 后 `keyboard inserttext "文本"` 或 `keyboard type "文本"` |
| 拖拽 | `drag @e1 @e2` 或精细指针控制 `mouse move x y` / `mouse down left` / `mouse move x2 y2 --steps 10` / `mouse up left` |
| 等待条件 | `wait 1500`、`wait --text "已保存"`、`wait "<css>"`、`wait --fn "<js>"`、`wait --download "<path>"` |
| 下载文件 | `download @e5 "<save_path>"` |
| 执行页面 JS | 复杂脚本优先用管道 `... | agent-browser.cmd --session <s_id> eval --stdin` |
| 检查报错与日志 | `errors`（未捕获异常）、`console`（控制台输出，支持 `--clear`） |
| 关键步骤截图 | `screenshot "<path>.png"`（或 `--full`） |
| 标签页管理 | `tab`、`tab new "<url>"`、`tab t2`、`tab close t2` |
| 环境自检与关闭 | `agent-browser.cmd doctor`、`agent-browser.cmd --session <s_id> close` |

## 常见排障

- **Ref 失效 / `Element not found: @eN`**：页面已更新，先等待目标出现再重新 `snapshot -i`。
- **点击被遮挡（`covered by ...`）**：先关闭前置引导弹窗或浮层（如 DSH 首次启动的「预览版说明」与「开始使用」弹窗），再重拍 `snapshot -i`。
- **CodeMirror / 自定义编辑器 `fill` 无效**：先 `click` 或 `focus` 编辑区域，再使用 `keyboard inserttext` / `keyboard type`。
- **不要使用未带 `--session` 的环境变量**：多命令跨子 shell 执行时，每条命令必须显式传 `--session`。
