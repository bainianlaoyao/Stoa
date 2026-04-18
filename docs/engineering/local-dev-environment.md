# 本地开发环境基线

## 目标

这份文档定义未来工程初始化时必须满足的最低开发环境要求，重点确保 Electron 与 `node-pty` 能在本机完成开发和构建。

## 推荐版本

- Node.js：22 LTS 或更高
- 包管理器：pnpm 10+
- Git：最新版稳定版
- 操作系统：Windows 11 为 Phase 1-3 必须支持的平台；macOS 仅作为后续兼容设计目标，当前阶段不承诺构建通过

## Windows 必备依赖

由于 `node-pty` 涉及原生模块编译，Windows 需要额外准备：

- Python 3
- Visual Studio Build Tools
- 可用的 C++ 构建工具链

## 工程初始化建议

当进入实现阶段时，建议初始化以下基础：

1. 使用 `pnpm` 创建 Electron + Vite + Vue + TypeScript 工程。
2. 安装 `pinia`、`express`、`node-pty`、`@xterm/xterm`、`@xterm/addon-fit`。
3. 配置 preload 与 `contextBridge`。
4. 引入 Electron native module rebuild 流程。

## 开发链路要求

- 开发模式下能同时运行 Electron 主进程与 Vite renderer。
- 修改 renderer 代码后支持热更新。
- 修改主进程代码后具备可接受的重启流程。
- `node-pty` 在当前 Electron 版本下可成功加载。

## 当前已验证结果（2026-04-18）

当前仓库已验证通过：

- `npx pnpm test`
- `npx pnpm typecheck`
- `npx pnpm build`
- `npx electron-vite preview`（应用已实际启动并保持运行）
- `node -e "require('node-pty')"`（`node-pty` 已在本机成功加载）

当前仓库已经完成最小 native 终端能力接入：`node-pty` 在主进程侧成功加载，`xterm.js` 已在 renderer 侧挂载，输入/输出/resize 通过 preload 白名单 API 走 IPC 回传。

补充说明：安装阶段若 `pnpm` 忽略了 `electron` 或 `node-pty` 的 build scripts，可能需要显式执行依赖重建或二进制下载流程，否则 `preview` 虽能构建但无法真正启动 Electron 或加载 native addon。

## 风险提示

- `node-pty` 不应在 renderer 中加载。
- Electron 升级后必须重新验证 native rebuild。
- 打包时需要处理 native addon 和可能的 `spawn-helper` 问题。

## 当前阶段支持范围声明

- Phase 0-3：只以 Windows 11 为必测与必保平台。
- macOS：允许提前设计兼容点，但在当前文档阶段和第一轮实现阶段不作为交付门槛。
- Linux：当前不纳入正式支持承诺。
