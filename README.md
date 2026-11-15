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

## 构建与安装

克隆项目并在 PowerShell 中执行：

```powershell
git clone https://github.com/Xiao-53/dsh-mindmap.git
cd dsh-mindmap
npm ci
npm run pack:plugin
```

当前版本生成 `dsh-mindmap-0.3.9.tgz`。使用已有 DSH 的 CLI 安装，将下面的 profile 和路径替换为实际值：

```powershell
dsh plugin --profile <当前profile> add <安装包的绝对路径>/dsh-mindmap-0.3.9.tgz
```

按原有启动方式重启或重新加载插件，然后在原生右侧栏中打开“思维导图”。

## 使用

在 DSH 输入框选择或输入 `/mindmap`，补充具体需求后手动发送，例如：

```text
/mindmap 把这份材料整理成思维导图，总览保留主要概念，细节放入子图。
```

也可以指定已有地图，要求补充节点、调整关系或修改正文。保存成功后，插件会刷新并打开目标导图。

数据默认保存在当前工作区的 `dsh-knowledge-maps/` 下，每张地图使用独立目录，包含 `map.json`、Markdown 正文和 `layout.json`。

## 当前状态

当前版本为 **0.3.9**，新增的原生 `/mindmap` 入口及模型实际效果仍待人工验收。人工编辑器、撤销和显式重排暂缓。

更多说明：[开发与安装](docs/plugin-development.md) · [存储格式](docs/mindmap-storage-format.md) · [当前版本验收](docs/validation/0.3.9.md)

## 许可证

[MIT License](LICENSE)
