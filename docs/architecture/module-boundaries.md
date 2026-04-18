# 模块边界

## 目标边界

系统代码未来应按责任而不是技术栈层次分布。任何模块都应能回答三个问题：它负责什么，它依赖什么，它不应该做什么。

## 推荐目录

```text
src/
  main/
  preload/
  renderer/
    app/
    components/
    stores/
    views/
  core/
  extensions/
    providers/
    panels/
```

## 模块职责

### `src/main/`

Electron 主进程入口、窗口生命周期、应用启动恢复、菜单与系统集成。

### `src/preload/`

通过 `contextBridge` 暴露有限 API，禁止把原始 `ipcRenderer` 直接泄露给前端。

### `src/renderer/`

纯前端展示层，包含页面视图、UI 组件、Pinia store 和 xterm.js 集成。Pinia 在这里被定义为后端权威状态的 projection/cache，以及极少量局部展示态，不得成为第二事实来源。

### `src/core/`

放置真正的系统核心：Session Manager、PTY 宿主、Webhook Server、状态存储、CLI 适配协调逻辑。这个目录是架构的稳定中枢。

### `src/extensions/providers/`

CLI 适配层。未来若支持多种 agent CLI，这里负责对接不同 provider 的命令参数、hook 注入策略和 session 恢复方式。

### `src/extensions/panels/`

附加数据面板，比如状态详情、事件流、调试面板等。允许自由访问共享 store，但不得反向侵入核心运行时逻辑。

## 边界禁令

- Renderer 不得直接创建子进程。
- UI 组件不得直接读写 `state.json`。
- Extension 不得绕过 Session Manager 私自维护第二份工作区真状态。
