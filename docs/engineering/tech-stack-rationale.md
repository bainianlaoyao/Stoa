# 技术栈选型依据

## Electron

Electron 提供桌面壳、窗口生命周期、主进程系统能力和成熟的 preload / IPC 模式。这个项目需要本地进程管理与文件系统访问，Electron 是最直接的实现路径。

## Vue 3 + Pinia

Vue 3 的响应式模型适合构建状态映射型 UI，而 Pinia 轻量、清晰，适合做“后端状态镜像层”。这与 dumb UI 的原则一致。

## node-pty

`node-pty` 是终端管理基石，能够在 Node 环境中稳定创建和维护伪终端。其代价是 native 编译与 Electron ABI 重建成本较高，因此环境文档和打包基线必须围绕它设计。

## xterm.js

`xterm.js` 负责前端终端渲染。它的价值是成熟、稳定、支持 addon 体系，并且明确适合作为 PTY 可视化终端层。

## Express

Express 作为轻量本地 webhook 服务器，适合接收 hook sidecar 发来的结构化状态事件。它不承担业务核心，只承担本地 HTTP 接入层职责。

## TypeScript

项目跨主进程、preload、renderer 与扩展目录，状态模型和事件模型跨度大。TypeScript 用于提前固定类型边界，降低多模块演进时的接口漂移风险。
