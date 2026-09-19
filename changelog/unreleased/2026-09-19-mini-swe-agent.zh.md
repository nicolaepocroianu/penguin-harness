# mini-swe-agent 编码插件

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `skills`, `core`, `cli`, `desktop`, `docs`

[English](2026-09-19-mini-swe-agent.md)

在智能体插件库中新增了按需安装的 `use-mini-swe-agent` 插件。

## 细节

- 提供了编码技能和固定使用 mini-swe-agent 2.4.6 的 Python 运行器，要求指定工作目录、模型、任务文件及正数运行限额。
- 每次运行将执行轨迹和结果摘要保存到新目录中；未提交结果的退出被报告为失败。
- 记录了提供商凭据配置、Windows 上的 WSL 执行方式及委派变更的审查流程。
