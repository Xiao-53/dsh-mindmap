# Quickstart & Validation Guide: 插件架构隐患排查与健壮性加固

**Feature**: `009-plugin-reliability-hardening` | **Date**: 2026-11-19

本文档定义实现完成后的本地自动化核验与 DSH Desktop 真机人工验收步骤。具体代码任务见后续 `tasks.md`。

---

## 1. 本地构建与自动化核验（开发者/CI）

在仓库根目录执行：

```powershell
# 1. Host 与 Client 双目标类型检查
npm run typecheck

# 2. 全量单元测试与集成测试（含新增的加固回归用例）
npm run test

# 3. 构建产物与发布包检查
npm run build
npm run pack:plugin -- --dry-run
```

### 自动化验证覆盖要点（对应 `spec.md` 与 `contracts/hardening-contracts.md`）

1. **依赖与清单契约（SC-001）**：断言 `package.json` 中 `zod` 位于 `peerDependencies`（`^4.0.0`）而非 `dependencies`，且 `dsh.client.inject` 包含全部 10 个直接依赖包；验证客户端与宿主启动隔离在模拟服务缺失、重名 skill 及畸形事件帧下零未捕获异常。
2. **工具模式与失败语义（FR-002, FR-014）**：验证 6 个工具均通过真实 `@deepseek-ai/dsh-tools` `defineTool` 校验，且失败调用经真实工具执行流水线返回 `isError: true` 并携带完整 JSON 诊断。
3. **永久删除并发收敛与目录压实（SC-002）**：模拟 `purge` 期间并发写入 `library.json`，验证 CAS 自动合并成功不卡死；模拟大量作废/已删目录，验证 `ctx.fs.listDir` 不被 2000 上限截断、`compactRetired` 先落 `library.json` 后删标记文件，且旧 `operationId` 仍被 `create_discarded` 拒绝。
4. **孤儿图片延迟回收（FR-006）**：验证删除图片并保存后、撤销栈未清前文件保留且 `Ctrl+Z` / `Cmd+Z` 可恢复；会话 `detach` 或显式触发 `cleanupOrphanAssets` 后孤儿 `.image.json` 被安全删除，未脱离引用的图片与未知文件不受影响。
5. **本地非图片附件精简（FR-007）**：验证包含 `[说明](../assets/doc.pdf)` 与 `[文本](../assets/a.txt)` 的笔记能正常读取整图且不加载对应文件字节，界面显示只读提示而非 `data:` 链接。
6. **监听收敛、载荷保护与内存释放（SC-003, SC-004）**：验证 50 导图管理页观察流 ≤ 3 条且无首帧冗余刷新；50 节点 20 附件单图观察流 ≤ 5 条；`EditSession.acceptReceipt` 释放已保存图片池；多会话关闭后干净 `EditSession` / `retainedLayouts` / 过期 `previews` / `notePaths` 均被回收。
7. **防打断跳转、macOS 快捷键与 Windows 路径规范化（SC-005）**：验证编辑/拖拽/引用核对期间收到 `autoOpen: true` 仅弹轻量“查看更新”提示而不丢稿不清空引用；验证 `Meta+Z` / `Meta+Shift+Z` 触发画布撤销/重做；验证 `C:\Work\` 与 `c:/work` 识别为同一工作区并共享串行队列。

---

## 2. DSH Desktop 真机人工验收（需用户实机确认）

> 遵循项目约定：本地自动化测试与构建打包不等同于真机验收通过，界面交互与真实宿主兼容性须由用户在 DSH Desktop 上核实。

1. **安装与升级共存检查（SC-001）**：
   - 将打包后的 `.tgz` 安装到 DSH Desktop（`0.2.2-rc.5` 或更高 `0.2.x`），重启 DSH。
   - 确认用户 profile 的 `node_modules` 中未出现重复冲突的 `@deepseek-ai/*` 或 `zod` 副本；主对话区、原生右侧栏「思维导图」及 `/mindmap` 均可正常打开使用。
2. **后台改图防打断检查（FR-011）**：
   - 在侧栏打开一张导图并进入某节点「编辑」态输入半段文字（或按住节点拖动中），同时在对话区让 AI 用 `/mindmap` 创建新图或修改另一张图。
   - 确认当前输入/拖动不被强行打断，顶部或底部弹出带「查看更新」的轻量通知；点击「查看更新」时正常走未保存确认保护。
3. **孤儿图片撤销与清理检查（FR-006）**：
   - 在节点笔记中上传一张图片 → 删除该图片引用并等待自动保存 → 立刻按 `Ctrl+Z`（macOS 用 `Cmd+Z`）确认图片能完整恢复。
   - 再次删除图片并保存 → 关闭导图返回「全部导图」或点击「清理未引用图片」→ 确认对应 `assets/<id>.image.json` 已被安全回收。
4. **回收站与历史记录清理检查（FR-004, FR-005）**：
   - 执行批量移入回收站并永久删除，确认回收站刷新正常且无残留卡死项；在回收站二级入口触发历史记录清理后，重新查看导图列表正常。
5. **非图片链接只读提示检查（FR-007）**：
   - 在节点笔记中手动写入 `[测试](../assets/sample.pdf)` 并查看详情，确认导图正常打开，链接处显示只读不支持提示且点击无报错。
