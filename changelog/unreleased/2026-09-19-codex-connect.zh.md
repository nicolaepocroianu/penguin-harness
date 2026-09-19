# 从 Codex 插件连接 ChatGPT

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `skills`

[English](2026-09-19-codex-connect.md)

为 Use Codex 插件卡片添加了 **连接 ChatGPT** 按钮。项目所有者可通过设备码对话框登录，同时安装 Codex 技能并配置所选智能体的 MCP 服务器。

## 细节

- 添加了连接状态、账号断开功能，以及新建已选中 Codex 技能对话的快捷入口。
- 通过现有 Codex ACP 桥接器继续按项目管理凭据。委派任务保留了工作区写入权限和按需人工审批。
- 保留了已有技能和其他 MCP 配置，并在自定义 Codex 配置发生冲突时报告问题而不覆盖它。
- 添加了中英文连接控件，并更新了插件配置说明。
