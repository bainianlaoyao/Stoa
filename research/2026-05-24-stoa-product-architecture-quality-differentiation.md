---
date: 2026-05-24
topic: Stoa 产品能力、架构范围、UX 表面、测试/质量态势与差异化竞争分析
status: completed
mode: context-gathering
sources: 35
---

## Context Report: Stoa (Nautilus) 产品全貌与差异化分析

### Why This Was Gathered
为对比 Stoa 与其他"浏览器/Agent 工作区"产品的实际能力差异，搜集本地仓库的产品能力、架构范围、UX 表面、测试/质量态势及当前差异化定位。

### Summary
Stoa (代号 Nautilus) 是一款基于 Electron 的**本地桌面 AI 多会话调度台**，核心定位不是 IDE 或通用终端，而是为"多终端、多 Agent、多工作区、低状态丢失"的并发 AI 编程场景提供稳定的桌面容器。产品当前处于 v0.3.0 原型阶段，已实现完整的多工作区管理、三 Provider 支持（Claude Code / OpenCode / Codex）、双通道状态架构、元会话编排、会话恢复、i18n、自动更新和结构化测试流水线。架构文档极为完善，但大量 Provider 可观测性数据尚未被利用。

### Key Findings

#### 1. 产品身份与定位

- **产品名**: Stoa（包名 `stoa`，仓库代号 Nautilus）
- **版本**: v0.3.0，Apache-2.0 许可
- **定位**: "Vibecoding 极简多会话管理框架"——面向 AI 并发编程场景的本地调度台（`docs/overview/vision-and-principles.md:5`）
- **三个核心价值主张**:
  1. 会话不轻易丢失（会话恢复 + 持久化）
  2. UI 切换不打断终端工作流（零延迟工作区切换）
  3. Agent 内部状态通过结构化侧信道反馈给 GUI，不靠脏解析

#### 2. 架构范围

| 架构层 | 技术 | 职责 |
|--------|------|------|
| 桌面壳 | Electron 37 | 窗口生命周期、系统集成、自动更新 |
| 主进程 | Node.js + Express + node-pty | 真实状态管理、PTY 托管、Webhook Server、Session Manager |
| 前端 | Vue 3 + Pinia + xterm.js | Dumb UI——仅做状态映射与指令转发 |
| 状态通道 | Webhook → CanonicalSessionEvent → IPC → Pinia | 结构化事件驱动，不依赖终端输出解析 |
| 视觉通道 | PTY → IPC → xterm.js | 原始终端字符流，零解析 |
| 持久化 | JSON 文件 (`~/.stoa/state.json`) + SQLite (better-sqlite3) | 工作区状态、会话指针、恢复元数据 |

**核心架构原则**:
- 双通道模型: 视觉流与状态流严格分离（`docs/architecture/dual-channel-model.md`）
- 前端极度降智: Vue 渲染层不拥有会话控制权（`docs/architecture/system-architecture.md:30`）
- 白盒扩展: 无沙箱，明确目录边界下的直接扩展（`docs/architecture/extension-model.md`）
- 原生机制代理: 复用 Electron/PTY/CLI 自有能力，不重复造轮子

#### 3. Provider 支持

| Provider | 状态 | 会话恢复 | 结构化事件 | Sidecar 类型 |
|----------|------|----------|-----------|-------------|
| Claude Code | ✅ 支持 | ✅ `--resume` | ✅ HTTP hooks (5 events) | `.claude/settings.local.json` |
| OpenCode | ✅ 支持 | ✅ `--session` | ✅ TS plugin (4 events) | `.opencode/plugins/stoa-status.ts` |
| Codex | ✅ 支持 | ✅ `resume <id>` / `resume --last` | ✅ notify + hooks (legacy + new) | `.codex/notify-stoa.mjs` + `config.toml` |
| Local Shell | ✅ 支持 | N/A | 生命周期仅 | 无 sidecar |

**关键**: Provider 能力契约定义了 Level 0/1/2 三级能力（`docs/architecture/provider-capability-contract.md:30-45`），系统根据 provider 能力自动降级。

**大量未利用的可观测性数据**（`docs/architecture/provider-observable-information.md`）:
- Claude Code: 30+ hook events，当前仅用 5 个做粗粒度状态转换
- OpenCode: 29 个 plugin events + SQLite 数据库，当前仅订阅 4 个事件，不读 SQLite
- Codex: 5-event hooks 系统 + OTel 指标 + legacy notify，当前仅用 legacy notify

#### 4. UX 表面

**布局**: 绝对二元分区——左侧工作区控制台 + 右侧主终端视图（`docs/product/workspace-console-ux.md:5`）

**核心组件**（`src/renderer/components/`）:

| 组件 | 职责 |
|------|------|
| `AppShell.vue` | 应用外壳 |
| `GlobalActivityBar.vue` | 全局活动栏 |
| `WorkspaceList.vue` | 工作区卡片列表 |
| `TerminalViewport.vue` | xterm.js 终端视图 |
| `CommandSurface.vue` | 命令面板（项目创建、Provider 选择） |
| `TerminalSessionDeck.vue` | 终端会话堆叠 |
| `MetaSessionSurface.vue` | 元会话编排面板 |
| `ArchiveSurface.vue` | 会话归档 |
| `InboxQueueSurface.vue` | 收件箱队列 |
| `ContextTreeSurface.vue` | 上下文树 |
| `SettingsSurface.vue` | 设置面板 |
| `UpdatePrompt.vue` | 自动更新提示 |
| `MemoryToastHost.vue` | 内存系统通知 |

**交互模式**:
- 点击式工作区切换（不依赖快捷键记忆）
- 工作区层级面板（项目 → 会话层级）
- Session 右键菜单
- Provider 径向选择菜单
- 终端元信息栏
- 快捷操作栏

**设计语言**: Modern Minimalist Glassmorphism + Clean UI（`docs/engineering/design-language.md`），使用设计令牌系统（`var(--canvas)`, `var(--surface)`, `var(--accent)` 等）。

**i18n**: 支持英文和中文（`src/renderer/i18n/en.ts`, `src/renderer/i18n/zh-CN.ts`）

#### 5. 元会话系统 (Meta-Session)

**核心模块**: `src/core/meta-session-*.ts`（约 8 个模块）

| 模块 | 职责 |
|------|------|
| `meta-session-manager.ts` | 元会话 CRUD、快照、归档 |
| `meta-session-command-dispatcher.ts` | 命令派发到子会话 |
| `meta-session-context-assembler.ts` | 上下文组装 |
| `meta-session-control-server.ts` | 控制服务器 |
| `meta-session-proposal-store.ts` | 提案存储 |
| `meta-session-provider-patch.ts` | Provider 补丁 |
| `meta-session-state-store.ts` | 状态持久化 |
| `meta-session-bootstrap-prompt.ts` | 引导提示 |

**元会话概念**: 在多个 Provider 会话之上建立一个"元会话"编排层，实现跨会话的上下文组装、命令派发和提案管理。这是与简单"多标签终端"的核心架构差异点。

#### 6. 内存/上下文系统

**模块**: `src/core/memory/`（12 个模块）

| 模块 | 职责 |
|------|------|
| `bundled-evolver.ts` | Evolver 引擎绑定（当前为 no-op adapter） |
| `evolver-engine-adapter.ts` | 上游引擎适配层 |
| `execution-router.ts` | 执行路由 |
| `inference-router.ts` | 推理路由 |
| `runtime-capabilities.ts` | 运行时能力检测 |
| `runtime-host.ts` | 运行时宿主 |
| `runtime-state-store.ts` | 运行时状态存储 |
| `session-evidence-store.ts` | 会话证据存储 |
| `transcript-snapshot.ts` | 转录快照 |
| `turn-maintenance-runner.ts` | Turn 维护运行器 |
| `upstream-boundary-guard.ts` | 上游边界守卫 |

**Evolver 集成状态**: 硬边界，adapter 当前为 no-op。调查发现无干净的上游入口点可用，因此保持只读边界，不做任何内部修改（`docs/engineering/evolver-data-flow.md`）。

#### 7. Promotional/Autopilot 系统

**模块**: `src/core/promo/`

| 模块 | 职责 |
|------|------|
| `x-engagement.ts` | X 平台自动发布 |
| `claude-cli.ts` | Claude CLI 集成 |
| `daily-orchestrator.ts` | 每日编排 |
| `fact-pack.ts` | 事实包生成 |
| `history-store.ts` | 历史记录存储 |
| `webbridge-client.ts` | Kimi Webbridge 客户端 |
| `promo-paths.ts` | 路径管理 |

这是一个产品推广自动化系统，通过 Webbridge 控制 X 发布。

#### 8. 测试/质量态势

**测试规模**: 155 个测试文件
- Tier 1 (单元测试, `src/**/*.test.ts`): 112 个文件
- Tier 2 (E2E 集成测试, `tests/e2e/*.test.ts`): 20 个文件
- Tier 3 (Playwright 旅程测试, `tests/e2e-playwright/*.test.ts`): 7 个文件
- Tier 4 (AI-first 测试资产, `testing/**/*.test.ts`): 16 个文件

**测试架构亮点**:
- 四层测试金字塔: 单元 → E2E 集成 → Playwright 旅程 → 行为覆盖
- 行为驱动测试层: `testing/behavior/`, `testing/topology/`, `testing/journeys/` 定义可执行行为契约
- 确定性生成测试: `testing/generators/` 自动生成 Playwright 旅程，不手写
- 配置守卫: 静态分析验证 webPreferences、IPC 通道注册、preload 类型契约
- 完整 CI 流水线: `npm run test:all` = generate → typecheck → vitest → playwright → behavior-coverage

**验证覆盖链路**（`docs/architecture/hook-signal-chain.md`）:
- Codex: hook payload 已 live-captured，webhook 34 测试通过，adapter 14 测试覆盖所有分支
- Claude Code: adapter 有 6 单元测试，但无 live CLI capture
- OpenCode: E2E spawn 测试通过，无 live capture
- 全链路: webhook → manager → state → IPC → Pinia → UI computed 已有 E2E 覆盖

**已知测试盲区**:
- Claude Code 无 live CLI 集成测试
- OpenCode 无 live capture
- Codex interactive PTY submit 在 Windows 上有已确认的失败模式

#### 9. 当前差异化定位

**与"浏览器/Agent 工作区"产品的差异点**:

| 维度 | Stoa | 典型浏览器 Agent 工作区 |
|------|------|------------------------|
| 运行形态 | Electron 桌面应用 | 浏览器 Web 应用 |
| 终端管理 | node-pty + xterm.js，原生 PTY | Web 终端 / 远程 PTY |
| 状态来源 | 结构化 Hook/Sidecar 事件 | 终端输出解析 / API 轮询 |
| 多 Agent 支持 | 3 Provider + Local Shell，统一能力契约 | 通常单 Provider |
| 元会话编排 | 跨 Provider 会话编排层 | 无 |
| 会话恢复 | 基于 CLI session ID 的应用重启恢复 | 依赖浏览器 session |
| 隐私 | 本地优先，loopback-only webhook | 云端处理 |
| 扩展模型 | 白盒扩展，直接访问共享状态 | 插件沙箱 / 无扩展 |
| 设计语言 | Modern Minimalist Glassmorphism | 通常 VS Code-like / IDE-like |
| 可观测性深度 | 大量 Hook 事件可用但未利用 | 基础状态 |

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| 产品名 Stoa, v0.3.0 | package.json | `:2-3` |
| 架构: Electron + Vue + Pinia + Express + node-pty | docs/architecture/system-architecture.md | full file |
| 双通道模型设计 | docs/architecture/dual-channel-model.md | full file |
| Provider 能力契约 Level 0/1/2 | docs/architecture/provider-capability-contract.md | `:30-45` |
| 三个 Provider: Claude Code / OpenCode / Codex | docs/architecture/hook-signal-chain.md | `:73-165` |
| 大量未利用的可观测性 | docs/architecture/provider-observable-information.md | Part 1-4 |
| UX 二元分区布局 | docs/product/workspace-console-ux.md | `:5` |
| 设计语言 Glassmorphism | docs/engineering/design-language.md | `:1-10` |
| 元会话管理器 | src/core/meta-session-manager.ts | `:1-50` |
| 内存系统 12 模块 | src/core/memory/*.ts | directory listing |
| Evolver 集成 no-op 硬边界 | docs/engineering/evolver-data-flow.md | `:1-35` |
| 测试文件 155 个 | find src tests testing -name "*.test.ts" | bash output |
| Hook signal chain 验证状态 | docs/architecture/hook-signal-chain.md | `:270-360` |
| Codex PTY Windows 已知问题 | docs/architecture/hook-signal-chain.md | `:370-387` |
| i18n 支持 en + zh-CN | src/renderer/i18n/ | directory listing |
| Promo autopilot 系统 | src/core/promo/ | directory listing |
| 会话恢复设计 | docs/architecture/lifecycle-and-session-resurrection.md | full file |
| 工作区状态机 8 状态 | docs/architecture/workspace-identity-and-state-machine.md | `:52-82` |
| 白盒扩展模型 | docs/architecture/extension-model.md | full file |
| 渲染器 30+ 组件 | src/renderer/components/ | directory listing |
| Session ID 对账设计 (proposed) | docs/architecture/session-id-reconciliation.md | full file |

### Risks / Unknowns

- [!] **Provider 可观测性利用率极低**: Claude Code 30+ events 仅用 5 个、OpenCode 29 events 仅用 4 个、Codex hooks 系统未启用。大量高价值数据（model identity、token usage、tool calls、conversation content）唾手可得但未接入。
- [!] **Evolver 内存系统当前为 no-op**: 内存/上下文系统有 12 个模块但 adapter 是空壳，上游无干净入口点可用。
- [!] **Codex PTY 交互在 Windows 上有已知失败**: text 到达 Codex TUI 但不被视为 submit，无 hook 触发。
- [!] **Claude Code 无 live CLI 验证**: adapter 仅有单元测试，无真实 Claude CLI 运行集成测试。
- [!] **大量架构设计文档存在 but 未全部落地**: 如 session-id reconciliation、SessionStart hook 注册等处于 proposed 状态。
- [!] **Promo 系统依赖 Kimi Webbridge**: 外部浏览器控制依赖，增加脆弱性。
- [?] **与"浏览器 Agent 工作区"产品的直接竞争态势**: Stoa 当前定位为纯本地桌面工具，无云端/协作能力。在 Agent 工作区逐渐向浏览器化演进的背景下，桌面优先策略的长期竞争力需要持续评估。
- [?] **元会话系统成熟度**: 架构完整但实际使用场景和用户验证状态未知。
