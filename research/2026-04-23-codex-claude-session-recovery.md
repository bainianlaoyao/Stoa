---
date: 2026-04-23
topic: codex-and-claude-code-session-recovery
status: completed
mode: context-gathering
sources: 15
---

## Context Report: Codex + Claude Code Session Recovery

### Why This Was Gathered
为新增 `codex` 和 `claude code` session 类型确定最优恢复方案，并评估它们如何映射到当前项目的 `resume-external` 架构。

### Summary
两者都可以纳入 `resume-external`，但强度不同。`Claude Code` 有一条明显更强的方案：启动时直接传入我们自己生成的 UUID 作为 `--session-id`，后续用 `--resume <uuid>` 恢复，不需要额外探测。`Codex` 也支持按 `SESSION_ID` 恢复，但当前公开 CLI 能力里没有等价的“启动时指定 session id”入口，因此最佳方案是“启动后发现并持久化 externalSessionId”，恢复时再走 `codex resume <uuid>`，`--last` 只能作为降级兜底。

### Key Findings

- `Claude Code` 适合做**显式可控恢复**。
  CLI 本身支持 `--session-id <uuid>`、`--resume [value]`、`--continue` 和 `--fork-session`。这意味着我们可以在创建 session 时就分配外部 UUID，并立即持久化到 `externalSessionId`，无需像 `opencode` 那样靠 sidecar 回传 ID。官方文档还明确说明 Claude Code 会在 `~/.claude` 下保存本地会话数据，并支持恢复先前会话。

- `Codex` 适合做**启动后发现 ID 的强恢复**，不适合做“启动前指定 ID”的强绑定。
  OpenAI 官方 CLI 文档确认 `codex resume [SESSION_ID] [PROMPT]` 可以恢复先前交互式会话，`--last` 可以继续最近一次会话。当前本机 `codex --help` / `codex resume --help` 也显示可以按 `SESSION_ID` 或 thread name 恢复，并且默认按当前工作目录过滤 picker。问题在于，当前可见 CLI 能力里没有 `--session-id` 这样的启动参数，所以外部系统不能像 Claude 那样在创建时预先注入稳定 ID。

- `Codex` 的最佳可实现方案是**文件系统 watcher + 会话元数据匹配**。
  本机 `~/.codex/sessions/.../rollout-*.jsonl` 的首行 `session_meta` 记录了 `payload.id` 和 `payload.cwd`；`~/.codex/session_index.jsonl` 也记录了 `id` 与 `thread_name`。因此在 PTY 启动 `codex` 后，可以监视新的会话文件，读取第一行元数据，用 `cwd + 启动时间窗口` 识别“刚刚创建”的 codex 会话，再把该 UUID 写回 `externalSessionId`。后续恢复时走 `codex resume <uuid>`。这是比 `--last` 更可靠的方案。

- `--last` / `--continue` 只能做兜底，不适合当主恢复协议。
  `claude --continue` 只是“当前目录最近一次会话”，`codex resume --last` 也是“最近一次记录的会话”。如果同目录存在多个会话、fork 过会话、或用户手工开了额外终端，这两种方式都可能恢复到错误线程。

- 当前仓库对“新 provider = 新 executable 名称”的假设不成立，`claude-code` 会被卡住。
  `detectProvider(providerId)` 现在直接把 `providerId` 当成可执行文件名去解析。若 session type 或 provider id 使用 `claude-code`，当前检测逻辑会去找 `claude-code.cmd` / `claude-code`，而真实 CLI 名称是 `claude`。这意味着新增 provider 时必须把“会话类型名 / provider 逻辑名 / 可执行文件名”拆开建模。

- 当前运行时的 shell wrap 逻辑也需要从“按 session type 特判”改为“按 provider 元数据判定”。
  本机 `Get-Command codex` 解析到的是 `codex.ps1`，而 `Get-Command claude` 解析到的是 `claude.exe`。这意味着 Windows 上如果用户配置的是 `codex.ps1` 路径，Codex 很可能和 OpenCode 一样需要通过 PowerShell 包一层；但 Claude 不需要。当前 `session-runtime.ts` 仅对 `opencode` 特判 shell wrap，无法正确泛化。

- `Claude Code` 没有必要做 sidecar / webhook 型结构化事件集成作为第一阶段目标。
  当前项目的 event bridge 是围绕 `opencode` sidecar 设计的：provider 往本地 webhook 发 canonical event，再更新 `externalSessionId` 和状态。对 Claude 和 Codex，本轮调研没有找到等价的官方 webhook / sidecar 机制。第一阶段最稳妥的建模是：`supportsStructuredEvents() === false`，状态依赖 PTY 生命周期；`externalSessionId` 只用于恢复，不依赖运行期事件回填。

- `Claude Code` 恢复必须避免同一 session 被多个 PTY 同时 attach。
  Anthropic 官方文档明确说明，如果在多个终端恢复同一个会话，所有终端会共享同一会话并交错消息。这对当前项目意味着：一个 persisted session 只能对应一个活跃 runtime；如果要做“从旧会话分叉”，应该建新 session，并映射到 `--fork-session`，而不是把同一个 `externalSessionId` 同时挂给多个 PTY。

### Recovery Recommendation

- `Claude Code`
  启动：为每个新建的 stoa session 生成一个 UUID，作为 `externalSessionId`，启动命令使用 `claude --session-id <uuid>`.
  恢复：若有 `externalSessionId`，使用 `claude --resume <uuid>`.
  兜底：仅在没有保存外部 ID 时，才考虑 `claude --continue`.
  结论：这是当前最强、最干净、最少脆弱性的 provider。

- `Codex`
  启动：直接启动 `codex` 交互会话。
  ID 捕获：启动后监听 `~/.codex/sessions` 新文件，读取 `session_meta.payload.id` 与 `payload.cwd`，命中当前项目后写回 `externalSessionId`.
  恢复：若有 `externalSessionId`，使用 `codex resume <uuid>`.
  兜底：仅在 watcher 未拿到 ID 时，才考虑 `codex resume --last`，并要求 cwd 一致。
  结论：能做强恢复，但需要一个 provider 级“外部 session id 发现器”，不能只靠现有 runtime start path。

### Design Implications For This Repo

- 需要新增 provider 元数据，不要再把逻辑挂在 `SessionType === 'opencode'` 上。
  最少需要：
  `providerId`
  `sessionType`
  `executableName`
  `supportsResume`
  `supportsStructuredEvents`
  `canSeedExternalSessionId`
  `needsShellWrap(providerPath, platform)`
  `discoverExternalSessionId?(target, startedAt)`

- `externalSessionId` 的写入时机要允许“异步补写”。
  Claude 在 create 时就能写入。
  Codex 在 runtime 启动后才可能发现并补写。
  这要求 runtime/controller 支持“会话已 running 后更新 externalSessionId”，而不是只在 webhook 或启动瞬间设置。

- `resolveRuntimePaths()` 需要从按 `sessionType` 特判改成按 provider 查表。
  当前逻辑只为 `opencode` 解析 provider path；Codex 与 Claude 都需要各自的 CLI 路径配置与检测。

- `detectProvider()` 要从“providerId = binary name”改为接受真正的 executable 名称。
  否则 `claude-code` 类型永远找不到 `claude` 可执行文件。

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| 当前 session type 只区分 `shell` / `opencode`，恢复模式是 `fresh-shell` / `resume-external` | `src/shared/project-session.ts` | `src/shared/project-session.ts:1` |
| 运行时目前只在 `opencode` 类型上允许 resume 与 shell wrap | `src/core/session-runtime.ts` | `src/core/session-runtime.ts:67` |
| 主进程现在把非 `shell` 一律硬编码映射到 `opencode` provider | `src/main/index.ts` | `src/main/index.ts:119`, `src/main/index.ts:230` |
| provider path 解析当前仅处理 `opencode` | `src/main/index.ts` | `src/main/index.ts:64` |
| 当前 event bridge 依赖 provider webhook 事件来更新 `externalSessionId` | `src/main/session-event-bridge.ts` | `src/main/session-event-bridge.ts:35` |
| OpenCode 的恢复与外部 ID 回填来自 sidecar webhook 插件 | `src/extensions/providers/opencode-provider.ts` | `src/extensions/providers/opencode-provider.ts:31` |
| `detectProvider()` 直接把 `providerId` 当 binary 名称查找 | `src/core/settings-detector.ts` | `src/core/settings-detector.ts:35` |
| Codex CLI 官方文档支持 `resume` 恢复先前交互式 session | OpenAI Codex CLI reference | https://developers.openai.com/codex/cli/reference |
| OpenAI 官方还公开提到 Codex thread 支持 create / resume / fork / archive | OpenAI “Unlocking the Codex harness” | https://openai.com/index/unlocking-the-codex-harness/ |
| 本机 `codex --help` 显示 `resume` / `fork` 子命令存在 | local CLI help | `codex --help` output on 2026-04-23 |
| 本机 `codex resume --help` 显示可按 `SESSION_ID` 或 thread name 恢复，并支持 `--last` / `--all` / `--include-non-interactive` | local CLI help | `codex resume --help` output on 2026-04-23 |
| 本机 Codex session 文件首行 `session_meta` 含 `payload.id` 与 `payload.cwd` | `C:\Users\30280\.codex\sessions\2026\02\19\rollout-2026-02-19T20-18-28-019c75d6-5db6-7c21-8d2f-f0602da4f64d.jsonl` | line 1 |
| 本机 Codex `session_index.jsonl` 记录 `id` 与 `thread_name` | `C:\Users\30280\.codex\session_index.jsonl` | line 1 |
| Anthropic 官方文档说明 Claude Code 会在 `~/.claude` 下保存本地数据，并支持恢复先前会话；同一会话可在多个终端恢复但会交错 | Claude Code docs | https://code.claude.com/docs/en/how-claude-code-works |
| 本机 `claude --help` 显示支持 `--session-id <uuid>`、`--resume`、`--continue`、`--fork-session` | local CLI help | `claude --help` output on 2026-04-23 |
| 本机 Claude project transcript 记录 `cwd` 与 `sessionId` | `C:\Users\30280\.claude\projects\C--Users-30280\127d8a14-8f68-4c79-9d4b-4151ce23da11.jsonl` | line 2 |
| 本机 `Get-Command codex` 解析到 `codex.ps1`，`Get-Command claude` 解析到 `claude.exe` | local shell inspection | `Get-Command codex`, `Get-Command claude` on 2026-04-23 |

### Risks / Unknowns

- [!] Codex 的本地会话文件格式属于本地实现细节。当前样本能支撑 watcher 方案，但 OpenAI 官方文档没有承诺该存储格式长期稳定。
- [!] 如果用户在同一项目目录里同时开多个 Codex 新会话，单纯靠 `cwd + 启动时间窗口` 做匹配仍有误判空间；需要为 watcher 设计严格时间窗和失败兜底。
- [!] 当前仓库的 `SessionSummary.externalSessionId` 可以持久化，但没有专门的“异步发现后补写 provider 外部 ID”抽象；实现时要避免把 Codex watcher 写成一次性 hack。
- [!] Claude 的 `--continue` / `--resume` 同 session 多终端 attach 会共享上下文并相互干扰，产品层需要禁止一个 persisted session 同时被多个 PTY runtime 恢复。
- [?] 本轮没有找到 Claude / Codex 的官方 webhook 事件接口，因此第一阶段默认它们都按“无结构化事件”设计；如果后续发现更强的 hooks 机制，provider 能力边界可以再上移。
- [?] Codex 是否有未来公开的“启动时注入 session id / thread id”能力目前未知；若后续 CLI 增加该参数，Codex 的恢复方案可以从 watcher 升级为 Claude 式显式绑定。

## Context Handoff: Codex + Claude Code Session Recovery

Start here: `research/2026-04-23-codex-claude-session-recovery.md`

Context only. Use the saved report as the source of truth.
