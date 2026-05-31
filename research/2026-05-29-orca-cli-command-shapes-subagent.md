---
date: 2026-05-29
topic: Orca upstream CLI command shapes — stoa-ctl/session control design reference
status: completed
mode: context-gathering
sources: 28
---

## Context Report: Orca CLI Command Shapes

### Why This Was Gathered

Bounded context for stoa-ctl session-control design. What patterns can be extracted from the Orca CLI without proposing upstream changes?

### Summary

Orca's CLI is a typed command-line client over a JSON-RPC transport. Commands are declared as static `CommandSpec[]` arrays (path + allowedFlags + positionalArgs) and dispatched via a flat `Map<string, CommandHandler>` keyed by the joined command path. Output formatting is centralized per result type with a `printResult(result, json, formatter)` pattern. The transport is a named-pipe socket (local) or WebSocket (remote), with a JSON envelope schema that includes keepalive frames and runtimeId tracking.

### Key Findings

**Command Spec Architecture**

1. **Static spec arrays grouped by domain.** Each domain (core, browser-basic, browser-advanced, automations, orchestration, computer, environment) exports a `COMMAND_SPECS: CommandSpec[]` from a dedicated `specs/*.ts` file. These are merged into a single flat `COMMAND_SPECS[]` in `specs/index.ts`. No subcommand nesting in the data structure — the `path: string[]` field represents the command path. Evidence: `src/cli/specs/index.ts:10-18`, `src/cli/specs/core.ts:4-256`, `src/cli/specs/orchestration.ts:4-143`

2. **CommandSpec shape is minimal.** `CommandSpec = { path: string[], summary: string, usage: string, allowedFlags: string[], positionalArgs?: string[], examples?: string[], notes?: string[] }`. Path is an array so `['tab', 'profile', 'set']` represents a 3-level command. Evidence: `src/cli/args.ts:9-17`

3. **Global flags are inherited** via `[...GLOBAL_FLAGS, ...localFlags]`. GLOBAL_FLAGS = `['help', 'json', 'pairing-code', 'environment']`. Evidence: `src/cli/args.ts:19`

4. **Positional args are normalized at parse time.** `normalizeCommandPositionals()` detects when trailing command-path tokens match a spec's `positionalArgs` and promotes them to flags — so `--id` and positional `2f9e...` are equivalent. Evidence: `src/cli/args.ts:109-134`

5. **Help routing is resolved before dispatch.** `resolveHelpPath()` returns the command path to print help for, or `null` to proceed. Evidence: `src/cli/args.ts:46-54`

**Command Dispatch**

6. **Flat handler map keyed by joined path.** `buildHandlers()` merges handler groups into a single `Map<string, CommandHandler>`. Handler keys are the space-joined command path, e.g. `'orchestration task-create'`. Evidence: `src/cli/dispatch.ts:29-68` at line 63

7. **Handler receives typed context.** `HandlerContext = { flags: Map<string, string | boolean>, client: RuntimeClient, cwd: string, json: boolean }`. All handlers are `async (ctx: HandlerContext) => Promise<void>`. Evidence: `src/cli/dispatch.ts:20-27`

8. **Handler grouping is by domain, not verb.** Each domain (`core`, `terminal`, `orchestration`, etc.) gets its own `handlers/*.ts` file. Within a file, handlers are grouped by related entity (e.g., all terminal handlers in one file). Evidence: `src/cli/dispatch.ts:30-47`

9. **No reflection — every command is explicitly registered.** There is no automatic wiring from spec to handler. The spec defines the interface; the handler implements it. Duplicate key detection at build time. Evidence: `src/cli/dispatch.ts:49-56`

**Output Formatting**

10. **Centralized per-type formatters.** Each result type has a dedicated `formatXxx(result: TXxxResult): string` function. Human output is key-value or list format, never structured. Evidence: `src/cli/format.ts:42-641` (641 lines for all formatters)

11. **`printResult` is the canonical output path.** `printResult(response, json, formatter)` dispatches: `--json` emits the full RPC envelope with pretty-print; otherwise calls `formatter(response.result)`. Evidence: `src/cli/format.ts:42-52`

12. **JSON output includes runtime metadata.** The `RuntimeRpcSuccess` envelope is `{ id: string, ok: true, result: TResult, _meta: { runtimeId: string } }`. Screenshots are converted to file paths to keep JSON size bounded. Evidence: `src/cli/format.ts:482-511`

13. **Error formatting is centralized.** `formatCliError()` rewrites `runtime_unavailable` as a human hint ("Orca is not running. Run 'orca open' first."). `reportCliError()` switches between structured JSON error and human text. Evidence: `src/cli/format.ts:54-101`

14. **Special-case JSON for `orchestration ask`.** Deliberate bypass of `printResult` — emits bare `result.result` as a single-line JSON object so `jq -r .answer` piping works. Both the formatter path and the special path exist, with test coverage. Evidence: `src/cli/handlers/orchestration.ts:328-345`

**Transport and RPC**

15. **Transport is selected at connection time, not per-call.** `findTransport(metadata, 'unix', 'named-pipe')` picks the transport from runtime metadata. Local uses named-pipe, remote uses WebSocket. Evidence: `src/cli/runtime/transport.ts:14`

16. **Named-pipe transport uses newline-delimited JSON frames.** Each request is one JSON object followed by `\n`. Responses read in a line-by-line loop. Keepalive frames `{"_keepalive":true}\n` are filtered without schema parsing. Evidence: `src/cli/runtime/transport.ts:76-107`

17. **Request ID is a `randomUUID`.** The client generates a UUID per request, reads responses in a loop until a matching `id` is found, ignores other IDs and keepalives. Evidence: `src/cli/runtime/transport.ts:27`

18. **Timeout is client-side only.** The server does not send a response within a time bound — the client sets a `setTimeout` that destroys the socket. Evidence: `src/cli/runtime/transport.ts:29-41`

19. **Keepalive refreshes the client timeout.** `timeout.refresh()` resets the timer on each keepalive frame. This allows long-polling methods (orchestration check with wait, terminal wait) to outlive the default 60s ceiling by extending per-call. Evidence: `src/cli/runtime/transport.ts:103-107`, `src/cli/runtime/client.ts:91-102`

20. **RuntimeClient dispatches between local and remote.** If `remotePairing` is set, uses WebSocket transport and performs compat checking on first non-status call. Otherwise uses named-pipe. Evidence: `src/cli/runtime/client.ts:50-84`

**Selector and Resolution Pattern**

21. **`getTerminalHandle` resolves implicit target.** When `--terminal` is omitted, resolves the active terminal in the current worktree so commands like `terminal send --text "hello" --enter` just work. Falls back to env var `ORCA_TERMINAL_HANDLE`. Evidence: `src/cli/selectors.ts:142-154`

22. **Worktree selector resolution.** `resolveCurrentWorktreeSelector()` finds the deepest Orca-managed worktree enclosing the cwd. The `active`/`current` alias is resolved locally before passing a `path:` selector to the runtime. Evidence: `src/cli/selectors.ts:50-76`

23. **Remote vs local behavior differs for worktree defaulting.** Browser commands auto-resolve from cwd when local; omit worktree when remote so the runtime uses server-side focus. Evidence: `src/cli/selectors.ts:111-137`

24. **Explicit selectors use prefix notation.** Selectors include `id:`, `path:`, `branch:`, `issue:` prefixes. `id:` is used for worktrees. Evidence: `src/cli/selectors.ts:38` (remote selector restriction), `src/cli/handlers/worktree.ts:91` (worktree.show call)

**RPC Envelope Schema**

25. **Envelopes are versioned with runtimeId.** Success includes `runtimeId` in `_meta`. The client validates that the runtime hasn't changed mid-request. Evidence: `src/cli/runtime/transport.ts:146-155`

26. **Failure envelopes include error code, message, and optional data.** The `data` field carries structured next-steps in some failure cases. Evidence: `src/cli/format.ts:65-76`

27. **Zod schema validates the envelope at the transport boundary.** `RuntimeRpcEnvelopeSchema.safeParse(raw)` is called on every frame before type narrowing. Evidence: `src/cli/runtime/transport.ts:114-124`

**Error Taxonomy**

28. **Client-side errors** (pre-RPC): `RuntimeClientError('invalid_argument', ...)`, `RuntimeClientError('runtime_unavailable', ...)`, `RuntimeClientError('runtime_timeout', ...)`, `RuntimeClientError('incompatible_runtime', ...)`. Evidence: `src/cli/runtime-client.ts:9-15`

29. **Server-side errors** propagate as `RuntimeRpcFailureError` wrapping the full failure envelope. Evidence: `src/cli/runtime-client.ts:17-25`

### Reusable Patterns for stoa-ctl

| Pattern | Orca Implementation | Relevance |
|---|---|---|
| Static spec array + joined-key dispatch | `CommandSpec[]` + `Map<string, CommandHandler>` | stoa-ctl commands can follow the same flat-map approach |
| Positional-args-as-flags normalization | `normalizeCommandPositionals()` | stoa-ctl `--id` flags can accept positional arguments |
| Per-type formatters with centralized switch | `formatXxx()` + `printResult(result, json, formatter)` | stoa-ctl human output should be key-value lines |
| Global flags inherited per-spec | `[...GLOBAL_FLAGS, ...localFlags]` | stoa-ctl can add global `--json` without per-command boilerplate |
| RuntimeClient wrapping transport selection | Local named-pipe vs remote WebSocket | stoa-ctl can follow the same local/remote dispatch pattern |
| Keepalive refresh on long waits | `timeout.refresh()` + 10s grace window | stoa-ctl long-polling session reads can use the same approach |
| Selector resolution with aliases | `resolveCurrentWorktreeSelector()` + `active`/`current` alias | stoa-ctl session selectors should support the same resolution |
| Handler context as single param | `{ flags, client, cwd, json }` | stoa-ctl handlers receive all context in one typed object |
| Error rewriting with human hints | `formatCliError()` → "Orca is not running..." | stoa-ctl should provide actionable errors for common failures |

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| Spec array structure | `src/cli/specs/index.ts:10-18` | `COMMAND_SPECS` merged from domain exports |
| CommandSpec shape | `src/cli/args.ts:9-17` | type definition |
| GLOBAL_FLAGS constant | `src/cli/args.ts:19` | `['help', 'json', 'pairing-code', 'environment']` |
| Positional normalization | `src/cli/args.ts:109-134` | `normalizeCommandPositionals()` |
| Flat handler map | `src/cli/dispatch.ts:60-68` | `HANDLERS.get(commandPath.join(' '))` |
| Handler context type | `src/cli/dispatch.ts:20-27` | `HandlerContext` interface |
| Handler groups | `src/cli/dispatch.ts:30-47` | groups array |
| printResult function | `src/cli/format.ts:42-52` | `printResult()` |
| formatXxx formatters | `src/cli/format.ts:145-641` | `formatTerminalList`, `formatWorktreeShow`, etc. |
| Error rewriting | `src/cli/format.ts:54-78` | `formatCliError()` |
| Special JSON for orchestration ask | `src/cli/handlers/orchestration.ts:328-345` | bare `console.log(JSON.stringify(result.result))` |
| Named-pipe transport | `src/cli/runtime/transport.ts:14` | `findTransport(metadata, 'unix', 'named-pipe')` |
| Request ID as UUID | `src/cli/runtime/transport.ts:27` | `randomUUID()` |
| Keepalive timeout refresh | `src/cli/runtime/transport.ts:103-107` | `isKeepaliveFrame()` + `timeout.refresh()` |
| Local/remote dispatch | `src/cli/runtime/client.ts:50-84` | `RuntimeClient.call()` |
| Terminal implicit resolution | `src/cli/selectors.ts:142-154` | `getTerminalHandle()` |
| Worktree selector resolution | `src/cli/selectors.ts:50-76` | `resolveCurrentWorktreeSelector()` |
| RPC envelope schema | `src/shared/runtime-rpc-envelope.ts:6-38` | `RuntimeRpcEnvelopeSchema` union |
| Error class hierarchy | `src/cli/runtime-client.ts:9-25` | `RuntimeClientError` + `RuntimeRpcFailureError` |
| Long-poll timeout extension | `src/cli/runtime/client.ts:91-102` | `resolveMethodTimeoutMs()` |
| Status check exit code | `src/cli/handlers/core.ts:36-41` | non-reachable runtime → `process.exitCode = 1` |

### Risks / Unknowns

- [!] **Not all RPC methods have corresponding CLI commands.** `session.*` methods exist in the runtime but may not be exposed via CLI. Confirm which session methods are CLI-accessible. Current search shows `terminal.*` methods and `worktree.*` methods as CLI commands; session control is not in the spec files.
- [?] **What is the naming convention for session handles?** Orca uses `term_abc123` for terminal handles. Stoa session handles may follow a different convention.
- [?] **Stoa IPC channel naming** — Orca uses IPC channels internally for renderer↔main communication, but the CLI uses named-pipe sockets. Stoa's IPC architecture may need a different transport pattern.
- [!] **No `session.*` RPC methods found in search scope.** The grep for `session.*` in the runtime rpc/methods/ directory returned no results. Session management may be implemented differently — possibly via terminal handles or worktree identity rather than dedicated session RPC methods.

---

## Context Handoff: Orca CLI Command Shapes

Start here: `research/2026-05-29-orca-cli-command-shapes-subagent.md`

Context only. Use the saved report as the source of truth.