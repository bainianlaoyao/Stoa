<p align="center">
  <img src="docs/assets/readme/stoa-icon.png" alt="Stoa" width="96" height="96">
</p>

# Stoa

[English](README.en.md)

Stoa 是一个完全开源、本地优先的 AI 编程工作台，让同时管理 10 个 Agent 如喝水般轻松写意。

它为多项目、多 Agent、多 CLI 会话提供一个简洁专注的控制台。核心路径由 200+ 个测试文件维护，覆盖单元测试、集成测试、Electron、Web、生成式 Playwright journey 和行为覆盖检查，目标是把 AI CLI 工作流从临时终端体验推进到稳定、可恢复、可长期使用的生产级体验。

## 项目截图

![Stoa 中运行 Claude Code 会话](docs/assets/readme/stoa-claude-code-session.png)

_在 Stoa 中运行 Claude Code，会话状态、工作区列表和终端上下文保持在同一个本地控制台里。_

![Stoa 中运行 OpenCode 会话](docs/assets/readme/stoa-opencode-session.png)

_OpenCode 会话同样可以作为 provider 接入，和其他 CLI Agent 一起被统一管理。_

## 为什么使用 Stoa

### 200+ 测试文件守护的稳定体验

Stoa 不是只展示概念的 demo。项目用单元测试、集成测试、Stoa Server 路由测试、Electron E2E、Web Playwright、生成式 Playwright journey 和行为覆盖检查共同维护核心路径，让多会话 AI 编程工作流具备接近生产级应用的稳定性。

### 简洁专注的 UI

Stoa 不试图替代 IDE，也不堆叠复杂面板。界面围绕一个核心工作流设计：左侧管理工作区和会话状态，右侧专注终端。你可以在多个项目和多个 Agent 会话之间切换，而不让界面本身成为负担。

### 支持多个 CLI 工具

Stoa 以 provider 方式接入 AI CLI 工具，而不是绑定单一厂商或单一命令。Codex、Claude、OpenCode 等 CLI 工具都可以成为 Stoa 工作台中的会话后端。

### 完全开源，可审计、可扩展

桌面壳、状态管理、provider 接入方式、行为资产和测试体系都在仓库中开放。你可以直接审计 Stoa 如何管理会话、恢复状态、承载终端，也可以基于自己的 AI CLI 工作流扩展它。

### 本地优先的会话调度台

Stoa 是本地桌面应用，不是云端平台。它负责在本机组织项目、承载终端、管理会话状态和协调恢复流程。各 AI CLI 工具自身的联网、认证和模型访问行为仍由对应工具决定。

### 桌面运行时、Server API、Web 与移动端接续

Electron 负责原生 PTY 运行时和桌面集成。内嵌 Stoa Server 提供带 token 保护的 REST 与 WebSocket API，承载 Web renderer，并通过 runtime bridge 让浏览器或移动端客户端与桌面运行时保持同步。手机尺寸视口会进入专用移动端 shell，提供工作区/会话接续、固定宽度 xterm、横向滚动、快捷按键轨和后端健康状态反馈。

## Stoa 解决什么问题

- 同时管理多个项目、多个工作区和多个 AI CLI 会话。
- 切换工作区时保持终端会话运行，降低上下文丢失风险。
- 用结构化状态通道反馈 Agent 状态，而不是从终端字符流里猜测。
- 通过浏览器或手机尺寸布局接续会话，同时不改变桌面核心工作流。
- 把 AI 编程会话从零散终端窗口收束到一个稳定的本地控制台。
- 为长期、多任务、并发式 AI 编程提供可恢复、可验证的工作流基础。

## 当前能做什么

- 创建、切换和管理工作区。
- 在桌面应用中承载真实 CLI 终端会话。
- 保持后台会话运行，减少切换带来的中断。
- 运行内嵌 Stoa Server，提供 REST、WebSocket、静态 Web 客户端和 runtime bridge。
- 在手机竖屏和横屏视口中使用移动端 shell，包括工作区 drilldown、会话搜索、固定宽度终端、快捷按键轨和健康状态锁定。
- 通过状态侧信道展示运行中、等待输入、错误、恢复等状态。
- 在启动、恢复、重启、provider 断开和 runtime 重连路径上同步 runtime alive/exited 状态。
- 通过 provider 模型接入不同 AI CLI。
- 用生成式 journey、行为覆盖、Electron E2E 和 Web E2E 测试验证关键路径。

## Coming Soon: 项目级自动进化

Stoa 的下一阶段目标是让项目本身成为可持续进化的对象。

未来的项目级自动进化功能会围绕需求理解、计划生成、实现执行、测试验证、行为资产沉淀和回归检查形成闭环。目标不是简单地让 AI 改代码，而是让每一次改动都能经过上下文理解、计划约束、自动验证和经验沉淀，让项目越用越稳定，越改越清晰。

## 快速开始

### 下载应用

从 [GitHub Releases](https://github.com/bainianlaoyao/Stoa/releases) 下载安装包：

- Windows: 下载 `.exe` 安装包或 portable `.exe`
- macOS / Linux: 打包目标已经配置，正式产物会在对应平台完成验证后发布

安装后启动 Stoa，即可添加工作区并创建 AI CLI 会话。

## CLI 工具要求

Stoa 负责管理工作区、会话状态和终端容器；实际 AI 能力来自你本机安装的 CLI 工具。

使用对应 provider 前，请先在本机安装并登录相关 CLI：

- Claude Code
- OpenCode
- Codex

如果 Stoa 无法自动检测到 CLI 可执行文件，可以在设置里的 Providers 页面手动配置 executable path。

### Provider 支持

| Provider | CLI 命令 | 会话恢复 | 结构化状态 | 说明 |
| --- | --- | --- | --- | --- |
| Claude Code | `claude` | 支持 | 支持 | 通过 Claude hooks 回传状态事件。[安装文档](https://docs.anthropic.com/en/docs/claude-code/setup) |
| OpenCode | `opencode` | 支持 | 支持 | 通过工作区 sidecar plugin 回传状态事件。[安装文档](https://opencode.ai/docs) |
| Codex | `codex` | 支持 | 支持 | 通过 provider 适配层接入。[项目地址](https://github.com/openai/codex) |
| Shell | 系统 shell | 不支持 | 不支持 | 用于普通本地终端会话。 |

## 隐私与本地优先

Stoa 本身是本地桌面应用。工作区组织、终端承载、会话状态和恢复信息优先保存在本机。

Stoa 不提供云端同步，也不代理模型请求。Claude Code、OpenCode、Codex 等 CLI 工具的登录、联网、模型访问和遥测行为由对应工具自身决定。

## 安全说明

- 只在你信任的工作区中运行 AI CLI 会话。
- Provider sidecar 会在对应工作区写入必要配置，例如 Claude hooks 或 OpenCode plugin 文件。
- Stoa 不会替你绕过各 CLI 工具的认证、权限确认或模型策略。
- 如果开启 Claude Code 的跳过权限确认能力，请只在明确理解风险的工作区中使用。

## 状态存储

Stoa 的应用状态、工作区索引、会话元数据和恢复信息保存在本机。Provider 需要的 sidecar 配置会写入对应项目目录，例如 `.claude/` 或 `.opencode/`。

内嵌 Stoa Server 还会在 `~/.stoa` 下使用本地 token 和端口元数据，让桌面运行时、Web renderer 和 `stoa-ctl` 能发现并认证到同一个本地控制平面。

状态恢复设计见 [状态存储与恢复](docs/operations/state-storage-and-recovery.md)。

## 支持平台

Stoa 基于 Electron 构建，目标支持 Windows、macOS 和 Linux。

当前公开发布优先提供 Windows 产物：NSIS 安装包、portable 可执行文件、更新 blockmap 和 `latest.yml` 元数据。macOS 和 Linux 打包目标已经配置，但需要在对应平台完成构建、签名和 smoke 验证后再作为正式下载发布。

## Stoa 不是什么

- 不是 IDE 替代品。
- 不是通用终端模拟器项目。
- 不是云端 Agent 平台。
- 不从终端输出里猜测 Agent 状态。
- 不接管各 CLI 工具自己的认证、模型选择或云端行为。

## Roadmap

- 基于当前 Stoa Server、Web runtime 和移动端 shell 代码线切出并 smoke-test 下一版 Windows 发布。
- 稳定 Windows、macOS、Linux 安装包发布链路。
- 继续强化 Claude Code、OpenCode、Codex 等 provider 的状态回传和恢复能力。
- 继续推进 Stoa Server/client 分离，让桌面、Web 和未来移动端客户端共享同一套状态与 runtime-control 模型。
- 推进项目级自动进化：上下文理解、计划生成、执行、测试验证和行为资产沉淀。
- 增强工作区模板、provider 配置和长期会话管理体验。

## 使用方式

1. 启动 Stoa。
2. 添加或选择一个工作区。
3. 在工作区中创建 AI CLI 会话。
4. 在右侧终端中与 CLI Agent 协作。
5. 通过左侧工作区列表切换项目和会话。
6. 通过状态指示理解会话当前处于运行中、等待输入、错误或可恢复状态。
7. 在手机尺寸视口中，通过移动端 shell 找到工作区/会话，进入固定宽度 xterm，并用按键轨发送终端快捷键。

## 项目状态

Stoa 仍处于 API 和功能形态快速演进阶段；核心使用路径按生产级稳定性维护。

当前阶段所有改进默认允许 breaking change，不维护兼容迁移逻辑。仓库优先保证产品方向、架构边界、测试体系和用户体验的正确性。

## 文档导航

- [愿景与设计原则](docs/overview/vision-and-principles.md)
- [系统总体架构](docs/architecture/system-architecture.md)
- [工作区控制台交互设计](docs/product/workspace-console-ux.md)
- [仓库布局规范](docs/engineering/repository-layout.md)
- [设计语言](docs/engineering/design-language.md)
- [本地开发环境](docs/engineering/local-dev-environment.md)
- [状态存储与恢复](docs/operations/state-storage-and-recovery.md)
- [发布与更新流程](docs/operations/release-and-update-runbook.md)

## 社区与友链

- [LINUX DO](https://linux.do) — 高质量中文技术社区，Stoa 认可并积极参与其中。

## 常见问题

### 找不到 CLI 工具怎么办？

先确认对应 CLI 已在系统中安装并完成登录。如果 Stoa 没有自动检测到可执行文件，请在 Settings -> Providers 中手动配置路径。

### 为什么会话状态和终端内容不完全一样？

终端内容只用于人类阅读。Stoa 的运行中、等待输入、错误、恢复等状态来自结构化状态通道，这样可以避免从终端文本中做不可靠推断。

### 关闭或切换工作区会丢会话吗？

Stoa 的设计目标是降低会话丢失风险。支持恢复的 provider 会尽量使用 CLI 自身的 session 能力恢复上下文；普通 shell 会话不具备同等级别的外部恢复能力。

## 贡献与质量门禁

项目包管理器是 pnpm。下面的质量门禁命令保留 `npm run` / `npx` 形式，是当前仓库约定的验证入口。

### 开发环境要求

- Node.js 24 或兼容版本
- pnpm 10.33.0
- 支持 Electron 的本地桌面环境

### 本地开发

```bash
pnpm install
pnpm run dev
```

### 构建

```bash
pnpm run build
pnpm run build:stoa-server
pnpm run package
pnpm run verify:release-smoke
```

生成式测试资产是项目行为契约的一部分。不要手动编辑 `tests/generated/` 下的文件。

提交实现变更前，先重新生成确定性的测试资产：

```bash
npm run test:generate
```

完整质量门禁：

```bash
npm run test:generate
npm run typecheck
npx vitest run
npm run test:e2e
npm run test:behavior-coverage
```

一键验证：

```bash
npm run test:all
```

如果新增用户可见行为，通常需要同步更新：

- `testing/behavior/`
- `testing/topology/`
- `testing/journeys/`

然后运行 `npm run test:generate` 重新生成 Playwright journey。

## 技术架构

Stoa 使用 Electron 作为本地桌面外壳，并内嵌 Stoa Server 作为共享 API 与状态边界。Electron 负责原生桌面能力和 PTY 进程，Stoa Server 暴露 REST/WebSocket surface 和服务端业务逻辑，Vue renderer 通过 preload adapter 或 HTTP/WebSocket client 映射状态到界面。

核心技术栈：

- Electron
- Stoa Server
- Hono REST 与 WebSocket 路由
- Vue 3
- Pinia
- xterm.js
- node-pty
- TypeScript
- Vitest
- Playwright

核心架构边界：

- Renderer 不直接拥有真实会话控制权。
- `node-pty` 只存在于 Electron runtime 进程或受控后端模块。
- Stoa Server 通过明确的 runtime bridge 发送 launch、input、resize、interrupt、replay 和 child-session 请求。
- 终端字符流只负责给人看，不负责给系统推断状态。
- Agent 生命周期、工具调用、错误信号和会话指针优先通过结构化侧信道回传。
- provider 通过明确能力契约接入，不把单一 CLI 的行为写死到 UI 中。

## License

Stoa 使用 [Apache License 2.0](LICENSE) 发布。
