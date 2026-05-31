---
date: 2026-05-29
topic: Orca upstream inspect/prompt primitives
status: completed
mode: context-gathering
sources: 15
---

## Context Report: Orca Upstream Inspect/Prompt Primitives

### Why This Was Gathered
Bounded research on Orca's `research/upstreams/orca` vendored tree for reusable patterns around prompt composition, terminal inspection, and machine-readable output primitives.

### Summary
Orca exposes inspect/prompt primitives through two distinct channels: (1) the `orca` CLI to a running Orca runtime via JSON-RPC over named pipes, and (2) the `orca orchestration` subcommand for inter-agent coordination. Terminal interaction uses cursor-tracked bounded reads and text injection; browser automation uses ref-based snapshot-and-interact cycles; computer use uses app-state snapshots. All primitives support `--json` for structured output.

### Key Findings

#### 1. Terminal Send/Read Flow
- **Send**: `terminal send` RPC call at `src/cli/handlers/terminal.ts:83-90` writes to PTY. Params: `text`, `enter` (bool), `interrupt` (bool). Returns `{ handle, accepted, bytesWritten }`.
- **Read**: `terminal read` RPC call at `src/cli/handlers/terminal.ts:67-81` reads bounded terminal output. Cursor-based pagination avoids unbounded reads. Returns `RuntimeTerminalRead`:
  ```typescript
  // src/shared/runtime-types.ts:308-318
  {
    handle: string
    status: RuntimeTerminalState  // 'running' | 'exited' | 'unknown'
    tail: string[]               // output lines
    truncated: boolean           // older output dropped
    limited?: boolean
    oldestCursor?: string
    nextCursor: string | null    // use in --cursor for next page
    latestCursor?: string
    returnedLineCount?: number
  }
  ```
- **Wait**: `terminal wait --for tui-idle|exit` at `src/cli/handlers/terminal.ts:92-110` blocks until condition. `tui-idle` detects working→idle OSC title transition for recognized agent CLIs.

#### 2. Terminal Metadata/Status
- `terminal show` returns `RuntimeTerminalShow` (extends `RuntimeTerminalSummary`):
  - `handle`, `title`, `worktreePath`, `branch`, `leafId`, `ptyId`, `connected`, `writable`, `preview`
- `terminal list` returns `RuntimeTerminalListResult` with `terminals[]` array and `truncated` flag.
- `worktree ps` returns compact orchestration summary across worktrees.

#### 3. Browser Inspect Primitives
- **Snapshot**: `snapshot` command returns accessibility tree with element refs (`@e1`, `@e2`, etc.). Formatted at `src/cli/format.ts:385-388`:
  ```typescript
  // page: <browserPageId>
  // <title> — <url>
  // <accessibility tree>
  ```
- **Screenshot**: `screenshot [--format png|jpeg]` returns base64 image. CLI saves to temp file and returns path in JSON mode (`format.ts:390-391`, `prepareCliJsonResult` at `format.ts:482-511`).
- **Full-screenshot**: Captures full page beyond viewport.
- **Element refs**: Short identifiers scoped to one tab, invalidated by navigation or tab switch. `browser_stale_ref` error means re-snapshot required.

#### 4. Computer Use Inspect Primitives
- `computer get-app-state` returns `ComputerSnapshotResult` with:
  - App: `name`, `pid`, `bundleId`
  - Window: `id`, `title`, `width`, `height`, `x`, `y`
  - Focused element
  - `treeText` - full accessibility tree
  - `truncation` metadata if tree was truncated (`maxNodes`, `maxDepth`)
  - `screenshotStatus` with `captured|skipped|failed`
- Formatted at `src/cli/format.ts:452-480`:
  ```typescript
  `${app.name} (pid ${pid}, ${bundleId})`
  `Window: id:${id} "${title}" (${width}x${height} @ ${x},${y})`
  `Elements: ${count}  Focused: ${focused}  Coordinates: ${coordinateSpace}`
  `Truncated: yes (max nodes N, max depth M)`
  `Screenshot captured (${format}, ${bytes}, ${engine})`
  `${treeText}`
  ```

#### 5. Orchestration Inter-Agent Primitives
- **Messaging**: `orchestration send/reply/check/inbox` for inter-agent communication via SQLite mail store.
- **Message types**: `status`, `dispatch`, `worker_done`, `merge_ready`, `escalation`, `handoff`, `decision_gate`.
- **Priority levels**: `normal`, `high`, `urgent`.
- **Group addressing**: `@all`, `@idle`, `@claude`, `@codex`, `@opencode`, `@gemini`, `@worktree:<id>`.
- **Task DAG**: `task-create --spec --deps` creates tasks; task becomes `ready` when all deps complete. Statuses: `pending | ready | dispatched | completed | failed | blocked`.
- **Dispatch with injection**: `dispatch --task --to --inject` optionally injects preamble teaching agents to send `worker_done`.

#### 6. Prompt Composition
- **Preamble injection**: Coordinator can inject task spec + preamble via `dispatch --inject`. Preamble teaches agents to report via `orca orchestration send --type worker_done` (`skills/orchestration/SKILL.md:96`).
- **Dispatch preamble**: Returned via `dispatch --return-preamble` or `dispatch-show --preamble`. Contains task spec + communication guidance.
- **No dedicated prompt-building primitives**: Prompt composition is implicit through orchestration messaging, not a separate API. Agents compose prompts from their own context plus received messages.

#### 7. RPC Transport & Envelope
- Named pipe transport at `src/cli/runtime/transport.ts:7-171`:
  - Sends `{ id, authToken, method, params }` as newline-delimited JSON
  - Reads responses frame-by-frame
  - Keepalive frames `{"_keepalive":true}` refresh client-side timeout
  - Envelope validated with `RuntimeRpcEnvelopeSchema` (Zod):
    ```typescript
    // src/shared/runtime-rpc-envelope.ts:16-38
    Success: { id, ok: true, result: unknown, _meta: { runtimeId } }
    Failure: { id, ok: false, error: { code, message, data? }, _meta? }
    Keepalive: { _keepalive: true }
    ```
- CLI default timeout: 60s. Terminal wait has separate 5-minute cap (`DEFAULT_TERMINAL_WAIT_RPC_TIMEOUT_MS` at `src/cli/handlers/terminal.ts:44`).

#### 8. `--json` Output Patterns
- All commands accept `--json` flag for machine-readable output.
- JSON output bypasses human formatter and returns raw RPC response envelope.
- Special case: `orchestration ask --json` emits bare `result` object without envelope wrapper (`src/cli/handlers/orchestration.ts:334-335`).
- Screenshot in JSON mode: data omitted, `path` field points to temp file with 24h TTL (`format.ts:492-508`).

#### 9. Stable Page Targeting (Browser)
- `tab list --json` returns `tabs[].browserPageId` - stable page identifier.
- Commands accept `--page <browserPageId>` to pin targeting across concurrent operations.
- Tab indices are relative to worktree-filtered tab list.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| `terminal send` handler | CLI handler | `src/cli/handlers/terminal.ts:83-90` |
| `terminal read` handler with cursor | CLI handler | `src/cli/handlers/terminal.ts:67-81` |
| `terminal wait` with `tui-idle` | CLI handler | `src/cli/handlers/terminal.ts:92-110` |
| `RuntimeTerminalRead` type | Shared types | `src/shared/runtime-types.ts:308-318` |
| `RuntimeTerminalSend` type | Shared types | `src/shared/runtime-types.ts:326-330` |
| `formatTerminalRead` with cursor tracking | Formatter | `src/cli/format.ts:175-214` |
| Snapshot formatting | Formatter | `src/cli/format.ts:385-388` |
| `formatGetAppState` for computer | Formatter | `src/cli/format.ts:452-480` |
| `prepareCliJsonResult` for screenshots | Formatter | `src/cli/format.ts:482-511` |
| Named pipe transport | RPC transport | `src/cli/runtime/transport.ts:7-171` |
| `RuntimeRpcEnvelopeSchema` | Envelope schema | `src/shared/runtime-rpc-envelope.ts:16-38` |
| Orchestration messaging spec | CLI specs | `src/cli/specs/orchestration.ts` |
| Orchestration handlers | CLI handlers | `src/cli/handlers/orchestration.ts` |
| Orchestration skill | Skill doc | `skills/orchestration/SKILL.md` |
| Orca CLI skill | Skill doc | `skills/orca-cli/SKILL.md` |

### Risks / Unknowns
- [!] **No explicit prompt-building API**: Orca does not expose a dedicated "prompt composition" API. Agents receive task specs and orchestration messages as text; prompt assembly is internal to each agent's runtime. Reuse assumes Stoa agents implement their own prompt composition from orchestration message payloads.
- [!] **Terminal output buffer bounded**: Default terminal read is a bounded preview (120-line tail by design, per `skills/orca-cli/SKILL.md:164`). Long transcripts require cursor pagination with `--cursor nextCursor`. Truncation can drop older output.
- [!] **Keepalive timeout behavior**: Long `terminal wait` operations rely on keepalive frames to prevent client timeout. If keepalives are lost or filtered, the operation may fail silently.
- [?] **Preamble injection compatibility**: Preamble injection via `--inject` requires recognized agent CLI (Claude Code, Codex, etc.). Bare shell terminals will not understand the injected preamble. Boundary with non-agent terminals is untested.
- [?] **Named pipe transport availability**: Transport uses Unix domain sockets (`findTransport(metadata, 'unix', 'named-pipe')`). On Windows, Orca may use a different transport; the Orca runtime must be running for any CLI commands to succeed.

### Report Path
`D:\Data\DEV\ultra_simple_panel\research\2026-05-29-orca-inspect-prompt-patterns-subagent.md`