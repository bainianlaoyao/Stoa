# 系统术语表

## A

- **Active Workspace**：当前在界面中被选中并显示主终端视图的工作区。

## C

- **CLI Session ID**：CLI 工具内部用于恢复历史上下文的真实会话标识。
- **Control Flow**：用户输入或界面操作向后端调度能力传递的命令流。

## D

- **Dual-Channel Architecture**：视觉流与状态流分离的双通道系统设计。
- **Dumb UI**：不持有真实业务状态，只做渲染和指令转发的前端层。

## H

- **Hook Sidecar**：注入到 CLI 环境中的外挂脚本，用于捕获结构化事件并回传后端。

## M

- **Main Process**：Electron 主进程，负责系统级能力、进程控制与状态协调。

## P

- **PTY Host**：使用 `node-pty` 托管 shell 或 CLI 进程的后端模块。

## R

- **Renderer Process**：Electron 中运行 Vue 界面的渲染进程。
- **Resurrection**：应用重启后基于持久化指针和 CLI 内部上下文恢复工作现场的过程。

## S

- **Session Manager**：主进程中的会话协调器，负责维护工作区、CLI session、运行状态与恢复元数据。
- **Smart Backend**：承载真实状态、业务判断和生命周期控制的后端层。
- **State Channel**：传递结构化状态事件的信令通道。

## V

- **Visual Channel**：传递原始终端输出供人类查看的展示通道。

## W

- **White-Box Extension**：直接运行在主工程内部、可访问共享状态与模块能力的扩展机制。
- **Workspace**：一组项目路径、终端实例、会话指针和 UI 卡片状态的聚合单元。
