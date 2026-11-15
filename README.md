# dsh-mindmap

面向 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai/deepseek-harness) 的原生侧栏思维导图插件，用于整理知识、梳理流程和设计系统架构。

在对话中通过 `/mindmap` 描述需求，由模型调用插件工具创建或局部修改导图，再在侧栏中阅读、拖动和探索内容。

## 功能

- **原生侧栏**：查看节点、关系、分组和可逐层进入的子图，阅读 Markdown 详情。
- **对话协作**：通过 `/mindmap` 创建、读取、补充和修改导图；请求由用户手动发送。
- **内容引用**：将节点或选中的正文加入 DSH 输入框，通过引用回到来源。
- **布局与管理**：拖动节点并保存布局，搜索导图，使用文件夹和回收站管理内容。
- **离线导出**：下载可独立阅读的全图 HTML。
- **本地文件存储**：地图结构、Markdown 正文和布局分别保存，便于持续维护。

## 环境要求

- DSH `0.2.2-rc.3`，使用原生侧栏，无需 Better Sidebar。
- Node.js `>=24.9.0`（从源码构建时需要）。
- 使用 `/mindmap` 需在宿主中启用 `dsh-client-ui-skill` 和 `dsh-tool-skill`。

## 安装

直接把下面这段话发给 DSH，让它帮你安装：

```text
请帮我安装 dsh-mindmap 思维导图插件。
项目地址：https://github.com/Xiao-53/dsh-mindmap
请从 GitHub 最新 Release 下载 .tgz 安装包，安装到我当前使用的 DSH profile，
保留已有配置，并在完成后告诉我是否需要重启或重新加载。
```

安装完成并按提示重启或重新加载后，在原生右侧栏中打开“思维导图”。

也可以前往 [最新 Release](https://github.com/Xiao-53/dsh-mindmap/releases/latest) 下载安装包。仓库保留源码，安装包通过 Release 提供。

## 使用

在 DSH 输入框选择或输入 `/mindmap`，补充具体需求后手动发送，例如：

```text
/mindmap 介绍一下一战爆发前国际形势。
```

也可以指定已有地图，要求补充节点、调整关系或修改正文。保存成功后，插件会刷新并打开目标导图。

数据默认保存在当前工作区的 `dsh-knowledge-maps/` 下，每张地图使用独立目录，包含 `map.json`、Markdown 正文和 `layout.json`。

## 当前状态

当前版本为 **0.3.9**。

## 许可证

[MIT License](LICENSE)
