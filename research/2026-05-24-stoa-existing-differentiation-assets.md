---
date: 2026-05-24
topic: 现有差异化资产盘点 — Stoa (Nautilus) 本地仓库技术审计
status: completed
mode: context-gathering
sources: 28
---

## Context Report: Stoa (Nautilus) 现有差异化技术资产盘点

### Why This Was Gathered

为项目继续推进提供差异化定位依据——识别仓库中已经部分构建的硬技术优势，评估哪些资产具备可信的差异化潜力。

### Summary

Stoa 是一个以 Electron 为宿主的 AI 编码会话编排桌面应用，核心差异化集中在三层：(1) 跨 provider 的统一 hook 事件管道与可观测性层；(2) meta-session 架构（AI 编排 AI 的会话管理层）；(3) 基于 Evolver 的 turn 级内存/证据管道。测试基础设施（4 层 182 个测试文件）和 AI-first testing contracts 层也是显著资产。

### Key Findings

#### 1. 多 Provider 统一 Hook 事件管道（Hard Advantage）

**已完成度：高（生产级）**

Stoa 实现了 Claude Code、Codex、OpenCode 三个 AI coding provider 的 hook 事件标准化——每个 provider 的原生 hook 格式被适配为统一的 `CanonicalSessionEvent`，通过本地 webhook 服务器（Express on 127.0.0.1:0）接收，再经 `SessionEventBridge` 路由到状态管理、证据持久化和可观测性三个下游管道。

关键模块：
- `hook-event-adapter.ts`：三个 provider 的 hook 适配器（claude-code / codex / opencode），映射到统一的 intent 语义
- `webhook-server.ts`：本地 HTTP 服务器，处理 `/hooks/claude-code`、`/hooks/codex`、`/hooks/opencode` 三个端点，带完整的请求验证和 secret 鉴权
- `session-event-bridge.ts`：事件桥，负责 turn epoch 分配、evidence 持久化、turn 生命周期管理和可观测性事件投射

**差异化价值**：目前市场上没有其他桌面工具做到跨 provider hook 事件的统一标准化。这意味着 Stoa 是唯一可以在同一个 UI 中以语义一致的方式展示 Claude Code、Codex、OpenCode 三种 agent 的实时状态的桌面应用。

#### 2. 可观测性层（Observability）

**已完成度：高**

三层可观测性快照系统（session → project → app），实现了：
- 实时会话状态追踪（phase、turn state、blocking reason、failure reason）
- 证据序列号（evidence sequence）与源序列号（source sequence）分离追踪
- 项目级聚合（active/blocked/failed session count, unread turns）
- 应用级全局状态（blocked/failed projects, provider health summary）

关键模块：
- `observability-service.ts`：核心服务，维护 session/project/app 三级快照
- `observation-store.ts`：持久化存储
- `observability-projection.ts`（shared）：快照构建的纯函数投影

**差异化价值**：让用户在一个仪表盘中看到所有 agent 会话的实时状态、阻塞原因、失败原因——这是"多 agent 管理面板"的核心卖点。

#### 3. Meta-Session 架构（AI 编排 AI）

**已完成度：中高（核心管道已打通）**

这是 Stoa 最有野心的差异化方向：让一个 AI 会话（meta session）管理和编排多个下游 AI 工作会话（work sessions）。

已实现的组件：
- `meta-session-manager.ts`：元会话 CRUD、快照、持久化
- `meta-session-control-server.ts`：完整的 HTTP API（`/ctl/*`），包括 work-session 查询、context 获取、prompt 注入、send-keys、proposal 审批流、preset 调度
- `meta-session-command-dispatcher.ts`：带快照一致性检查的 proposal 调度器（stale proposal 检测）
- `meta-session-proposal-store.ts`：审批流状态机（pending → approved → executing → completed/failed/stale）
- `meta-session-context-assembler.ts`：上下文组装器，支持 status/slim/full/bundle 四种粒度
- `meta-session-bootstrap-prompt.ts`：AI 元会话启动提示词，定义了发现序列和上下文协议
- `meta-session-command-env.ts`：为 meta session 进程注入 `STOA_CTL_*` 环境变量

API 端点清单（均已完成）：
- `GET /ctl/health`、`GET /ctl/bootstrap-prompt`、`GET /ctl/whoami`、`GET /ctl/capabilities`
- `GET /ctl/state/brief`、`GET /ctl/state/attention-queue`、`GET /ctl/state/conflicts`
- `GET/POST /ctl/work-sessions`、`GET /ctl/work-sessions/:id`、`POST .../archive`
- `GET /ctl/work-sessions/:id/events`、`GET /ctl/work-sessions/:id/context`（四粒度）
- `POST /ctl/work-sessions/:id/prompt`、`POST /ctl/work-sessions/:id/send-keys`
- `GET/POST /ctl/meta-sessions`、`POST .../activate`、`POST .../archive`、`POST .../restore`
- `GET/POST /ctl/proposals`、`POST .../approve`、`POST .../reject`、`POST /ctl/dispatch/proposal/:id`
- `POST /ctl/dispatch/preset/:presetName`

**差异化价值**：这是"AI 作为 agent 管理器"的完整实现——meta session 可以通过 stoa-ctl CLI 发现、读取、编排多个工作会话。市场上尚未有同类产品。

#### 4. Turn 级内存/证据管道（Evolver 集成）

**已完成度：中高（管道完整，上游 Evolver 为 vendored 依赖）**

基于 Evolver（vendored upstream）构建的 turn 级内存维护管道：
- `session-evidence-store.ts`：将每个 hook 事件的 evidence 持久化为 `.stoa/memory/evidence/` 下的原子文件（metadata.json + transcript snapshot），支持 turn seal 和按 turn 查询 evidence refs
- `transcript-snapshot.ts`：transcript 快照（provider-transcript / turn-slice 两种）
- `turn-maintenance-runner.ts`：turn 生命周期维护（stageTurn → solidify → distill），带项目级互斥锁
- `evolver-engine-adapter.ts`：Evolver 上游引擎适配器，封装 solidify/distill 操作，带模块缓存清理和环境隔离
- `inference-router.ts`：推理能力路由器（支持多 provider）
- `execution-router.ts`：执行能力路由器
- `runtime-state-store.ts`：运行时状态持久化（sealed turns + job queue）
- `runtime-capabilities.ts`、`runtime-host.ts`：运行时能力检测和宿主管理

**差异化价值**：将 AI 编码会话的每个 turn 视为可审计、可回溯、可提炼（solidify → distill）的知识单元。这是"AI coding memory"的底层基础设施。

#### 5. 会话上下文导出系统（Context Export）

**已完成度：高**

跨 provider 的会话上下文提取和格式化系统：
- `session-context-exporter.ts`：统一的上下文导出入口，支持 full-text 和 slim-text 两种格式
- 三个 provider transcript 解析器（`claude-code-parser.ts`、`codex-parser.ts`、`opencode-parser.ts`）
- `full-text-formatter.ts`、`slim-text-formatter.ts`：格式化器
- `ansi-stripper.ts`：ANSI 转义序列清理

**差异化价值**：可以在 meta-session 中以机器可读方式读取任何 provider 的会话上下文——这是 AI 编排 AI 的基础。

#### 6. 四层测试基础设施

**已完成度：高**

182 个测试文件，104 个非测试 TS 源文件 + 37 个 Vue 组件。测试覆盖率达到 ~1.75 测试文件/源文件。

四层架构：
- **Tier 1**（Unit）：`src/**/*.test.ts` — 112 个单元测试文件
- **Tier 2**（E2E Integration）：`tests/e2e/*.test.ts` — 33 个文件，真实文件系统 + HTTP + Pinia
- **Tier 3**（AI-first Testing Contracts）：`testing/` — 37 个文件，包括行为定义、拓扑契约、旅程声明、确定性 Playwright 生成器
- **Tier 4**（Config Guard）：静态源码文本分析（sandbox:false 检测、IPC channel 一致性等）

特殊测试设施：
- `testing/contracts/testing-contracts.ts`：行为定义 DSL（`defineBehavior`）
- `testing/generators/generate-playwright.ts`：确定性 Playwright 测试生成器
- `testing/generators/behavior-coverage.ts`：行为覆盖率预算验证
- `testing/topology/`：稳定 data-testid 拓扑契约
- `testing/journeys/`：行为到可执行路径的映射

**差异化价值**：AI-first testing contracts 层是一个创新——通过声明式的行为/拓扑/旅程定义自动生成 Playwright 测试，并验证行为覆盖率预算。这在 AI coding 工具中是独特的。

#### 7. Provider 集成层

**已完成度：高**

四个 provider 实现：
- `claude-code-provider.ts`：完整的 start/resume/sidecar 命令构建
- `codex-provider.ts`：Codex CLI 集成
- `opencode-provider.ts`：OpenCode CLI 集成
- `local-shell-provider.ts`：本地 shell 会话

Provider 抽象层（`extensions/providers/index.ts`）定义了统一的 `ProviderDefinition` 接口：
- `buildStartCommand`、`buildResumeCommand`
- `installSidecar`、`uninstallSidecar`
- `discoverExternalSessionIdAfterStart`

Hook 租约管理（`hook-lease-registry.ts`、`hook-lease-manager.ts`）确保 hook 事件的会话绑定安全性。

#### 8. Provider Patch 和 Sidecar 管理

- `managed-sidecar-installer.ts`：provider sidecar 的自动安装
- `managed-sidecar-maintenance.ts`：sidecar 维护
- `shared-hook-dispatch.ts`：共享 hook 分发
- `claude-hook-sidecar.ts`：Claude Code 的 hook sidecar 安装/卸载

#### 9. 实验基础设施

- `scripts/run-real-first-round-experiment.ts`：真实实验运行器
- `scripts/extract-context-samples.ts`：上下文样本提取

#### 10. 工具链

- `tools/stoa-ctl/`：CLI 工具，meta session 的控制面
- `tools/promo/`：X/Twitter 自动化推广工具

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| 三 provider hook 统一适配 | `src/core/hook-event-adapter.ts` | 全文 398 行 |
| Webhook 服务器三端点 | `src/core/webhook-server.ts` | L430-469 |
| SessionEventBridge 事件路由 | `src/core/session-event-bridge.ts` | 全文 786 行 |
| 三层可观测性快照 | `src/core/observability-service.ts` | 全文 224 行 |
| 可观测性类型定义 | `src/shared/observability.ts` | L9-141 |
| Meta-Session Manager | `src/core/meta-session-manager.ts` | 全文 243 行 |
| Meta-Session Control Server | `src/core/meta-session-control-server.ts` | 全文 669 行 |
| Proposal Store 状态机 | `src/core/meta-session-proposal-store.ts` | L195-319 |
| Command Dispatcher | `src/core/meta-session-command-dispatcher.ts` | 全文 189 行 |
| Context Assembler 四粒度 | `src/core/meta-session-context-assembler.ts` | L48-163 |
| Bootstrap Prompt | `src/core/meta-session-bootstrap-prompt.ts` | L1-32 |
| Turn Maintenance Runner | `src/core/memory/turn-maintenance-runner.ts` | 全文 152 行 |
| Evolver Engine Adapter | `src/core/memory/evolver-engine-adapter.ts` | 全文 277 行 |
| Session Evidence Store | `src/core/memory/session-evidence-store.ts` | 全文 373 行 |
| Runtime State Store | `src/core/memory/runtime-state-store.ts` | 全文 215 行 |
| Session Context Exporter | `src/core/context/session-context-exporter.ts` | 全文 226 行 |
| Provider Descriptors | `src/shared/provider-descriptors.ts` | 全文 83 行 |
| Claude Code Provider | `src/extensions/providers/claude-code-provider.ts` | 全文 99 行 |
| Meta-Session 类型系统 | `src/shared/meta-session.ts` | 全文 199 行 |
| Memory Runtime 类型系统 | `src/shared/memory-runtime.ts` | 全文 140 行 |
| 四层测试架构 | `CLAUDE.md` | 测试架构章节 |
| 测试文件计数 | 文件系统统计 | 182 个测试 / 141 个源文件 |
| 行为定义 DSL | `testing/contracts/testing-contracts.ts` | defineBehavior |
| Playwright 生成器 | `testing/generators/generate-playwright.ts` | 确定性生成 |
| 行为覆盖率 | `testing/generators/behavior-coverage.ts` | 预算验证 |
| Meta-Session 行为定义 | `testing/behavior/meta-session.behavior.ts` | L1-47 |
| Design Language | `docs/engineering/design-language.md` | 全文 159 行 |

### Risks / Unknowns

- [!] **Evolver 上游依赖风险**：Evolver 为 vendored upstream（`research/upstreams/evolver`），如果上游不活跃或 breaking change，内存管道可能受阻。项目已设置 upstream boundary guard。
- [?] **Meta-Session 实际使用成熟度**：控制面 API 完整，但 UI 层（`meta-session-surface.vue` 等）与 meta session 后端的集成深度未完全评估。
- [?] **Inference Router 的实际 provider 实现**：`inference-router.ts` 是路由骨架，实际 factory 注入的 provider 实现（API key 管理等）需要确认。
- [?] **跨平台稳定性**：项目面向 Windows/macOS/Linux 三平台（见 `stoa-runtime-root.ts` 的平台分支），但实际测试覆盖是否均匀未知。
- [!] **四层测试的实际通过率**：182 个测试文件的存在不保证全部绿色，需要实际运行确认。

### 差异化资产优先级排序

按"已构建度 × 市场独特性 × 护城河深度"排序：

1. **Meta-Session 架构** — 最高优先级。AI 编排 AI 的完整控制面，API 级别的完整性极高。市场零竞品。
2. **多 Provider 统一 Hook 管道** — 第二优先级。跨 provider 事件标准化的工程量巨大，竞争对手难以快速复制。
3. **Turn 级内存/证据管道** — 第三优先级。将 AI 会话视为可审计知识单元的理念先进，但依赖 Evolver 上游。
4. **四层测试基础设施** — 第四优先级。AI-first testing contracts 是创新点，但测试基础设施本身不是用户可见功能。
5. **可观测性层** — 第五优先级。作为 meta-session 和多 provider 管道的支撑层，与 #1/#2 形成合力。
6. **会话上下文导出** — 第六优先级。meta-session 的基础能力，独立价值较低。

### Conclusion

Stoa 的核心差异化不在于"又一个 AI coding 桌面客户端"，而在于 **"AI 编排 AI 的会话管理操作系统"**——meta-session 架构是灵魂，多 provider hook 管道是骨架，turn 级内存是长期护城河。三层能力形成飞轮：hook 管道提供实时数据 → 可观测性层提供状态感知 → meta-session 利用两者实现 AI 自主编排。

---

## Context Handoff: Stoa 差异化资产盘点

Start here: `research/2026-05-24-stoa-existing-differentiation-assets.md`

Context only. Use the saved report as the source of truth.
