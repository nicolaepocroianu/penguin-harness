# 明确 Copilot 授权错误

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `server`, `web`

[English](2026-09-19-copilot-oauth-errors.md)

在 Copilot 连接流程中区分了设备代码过期、会过期的凭据、授权被拒绝、不支持的令牌和应用设置无效。

## 细节

- 为不支持的令牌响应添加了可操作的提示，未暴露凭据。
- 接受了不区分大小写的 bearer 令牌类型，并保留了对刷新凭据的拒绝。
