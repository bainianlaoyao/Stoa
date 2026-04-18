# 路线图

## Phase 0：文档定基

目标是建立统一的产品语言、架构边界、环境基线和执行计划。完成标志是文档库结构稳定，后续实现不再需要重新定义基础概念。

## Phase 1：工程引导层

初始化 Electron + Vue + TypeScript + Pinia + Express + node-pty 的最小可运行工程，验证本地开发链路、原生依赖编译与基础窗口启动能力。

## Phase 2：核心运行时

实现主进程的 Session Manager、PTY Host、Webhook Server 和基础持久化能力，打通单工作区的视觉流、状态流和控制流。

## Phase 3：多工作区与恢复

支持多个工作区并行运行、卡片切换、状态灯反馈，以及基于 `last_cli_session_id` 的应用重启恢复。

## Phase 4：白盒扩展与面板能力

开放 `extensions/providers` 和 `extensions/panels` 机制，引入附加数据面板、CLI 适配层与调试辅助能力。

## Phase 5：打包与稳定性

处理 `node-pty` 打包、native rebuild、错误日志、状态迁移和异常恢复，形成可长期使用的桌面工具形态。
