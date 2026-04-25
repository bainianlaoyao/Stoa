# CLI Adapter Layer Verification Plan

## Objective

Verify every link in the signal chain from CLI → webhook → adapter → bridge → state → IPC → renderer, for all 4 providers, using real CLI execution with payload capture.

## Available CLIs

| CLI | Version | Hook Mechanism | Status |
|---|---|---|---|
| codex | 0.125.0 | stdin hooks (`hooks.json`) + notify (`config.toml`) | Installed, hooks live-captured ✅ |
| claude | 2.1.89 | HTTP hooks (`settings.local.json`, type=`http`) | Installed, not yet live-captured |
| opencode | Available | Plugin (`stoa-status.ts`, `afterCommand` callback) | Installed, not yet live-captured |
| local-shell | N/A | PTY stdout, no hooks | N/A |

### Key Architecture Differences (per provider)

| Aspect | Codex | Claude Code | OpenCode |
|---|---|---|---|
| Hook transport | stdin → sidecar → HTTP POST | **HTTP POST directly** (no sidecar) | Plugin constructs CanonicalSessionEvent directly |
| Config file | `.codex/hooks.json` + `.codex/config.toml` | `.claude/settings.local.json` | `.opencode/plugins/stoa-status.ts` |
| Auth headers | Sidecar adds from env vars | **Claude CLI interpolates `${ENV}`** in headers | Plugin reads `process.env` |
| Events registered | SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop | UserPromptSubmit, PreToolUse, Stop, StopFailure, PermissionRequest | session.idle, permission.asked, permission.replied, session.error |
| `PostToolUse` support | ✅ | ❌ (not in Claude Code hooks API) | ❌ (plugin only fires on status change) |
| `externalSessionId` source | body.`session_id` (Codex thread ID) — **not forwarded by adapter** | body.`session_id` — **forwarded as `externalSessionId`** | event.properties.`sessionID` — forwarded |
| Sidecar script | `hook-stoa.mjs` (reads stdin) | **None** (HTTP hooks go direct to webhook) | `stoa-status.ts` (plugin) |

---

## Phase 1: Codex Deep Verification

Hooks already live-captured. Remaining gaps:

### 1A. Notify Mechanism in Interactive Session

**Why**: Notify fires per-turn in interactive sessions, but our live capture used `codex exec` (single turn, no notify).

**Steps**:
1. Start capture server on fixed port 18923
2. Install sidecar files (hook-stoa.mjs + notify-stoa.mjs + hooks.json + config.toml)
3. Run `codex --no-alt-screen` interactively (not exec mode) with env vars set:
   - `STOA_SESSION_ID`, `STOA_PROJECT_ID`, `STOA_SESSION_SECRET`, `STOA_WEBHOOK_PORT`
4. Send 2 prompts in sequence via stdin
5. Capture both hook payloads AND notify payloads
6. Verify: `agent-turn-complete` fires between turns, Stop fires at session end

**Expected result**: `notify-stoa.mjs` receives `agent-turn-complete` with `last-assistant-message` field per turn.

**Watch out**: Interactive mode requires stdin interaction. Use tmux or expect-like mechanism.

### 1B. Unread Fields Forwarding

**Why**: Real payloads contain `tool_input`, `tool_response`, `last_assistant_message` that `adaptCodexHook` doesn't forward. Verify these exist and consider adding them to `CanonicalSessionEvent.payload`.

**Steps**:
1. Review captured payloads from previous live run (already in context)
2. Verify each unread field is present and non-empty in real payloads
3. Cross-reference with `CanonicalSessionEvent.payload` type definition
4. Decide per field:
   - `tool_input` → forward as `toolInput`? (shows what command will run)
   - `tool_response` → forward as `toolResponse`? (shows command output)
   - `last_assistant_message` → forward as `snippet`? (already in Stop payload)
   - `permission_mode` → forward? (capability detection)
   - `transcript_path` → forward? (session file location)
5. Document decision: add to adapter output or record as intentional omission

### 1C. Sidecar Config Correctness After Fix

**Why**: We fixed the config.toml template (notify before [features]). Verify the fixed config works end-to-end.

**Steps**:
1. Delete `.codex/` directory in a temp workspace
2. Run `installSidecar` via codex provider
3. Verify config.toml parses without errors (`codex features list`)
4. Verify hooks.json is valid JSON with all 5 events
5. Verify config.toml has `notify` as top-level key (not under `[features]`)
6. Run a short `codex exec` to confirm hooks fire

**Already partially done**: `codex features list` was verified to parse correctly after the fix. Remaining: fresh install in temp dir + hooks fire.

### 1D. Hook Timeout Behavior

**Why**: `hooks.json` sets `timeout_sec: 5`. If webhook server is down, Codex waits 5s per hook event.

**Actual hook count**: For a simple `echo hello` prompt via `codex exec`, 7 hooks fire (SessionStart + UserPromptSubmit + 2×PreToolUse + 2×PostToolUse + Stop). Worst case: 7 × 5s = 35s overhead.

**Steps**:
1. Install sidecar but don't start capture server
2. Run `codex exec` with a simple prompt, measure wall-clock time
3. Verify: codex still completes successfully after all timeouts
4. Verify: no error in codex output (timeout should be silent from codex's perspective)
5. Optionally: reduce `timeout_sec` to 2s for faster fallback

---

## Phase 2: Claude Code Live Verification

**Architecture note**: Claude Code uses HTTP hooks (not command hooks). The provider (`claude-code-provider.ts`) writes `.claude/settings.local.json` with `type: 'http'` hook definitions. Claude CLI interpolates `${STOA_SESSION_ID}` etc. from environment variables and POSTs directly to the webhook server. **No sidecar script needed.**

### 2A. Capture Real Claude Code HTTP Hook Payloads

**Why**: `adaptClaudeCodeHook` was written based on docs but never verified with real payloads.

**Steps**:
1. Start capture server on fixed port (reuse tmp-capture-server.mjs pattern)
2. Call `installSidecar` via claude-code provider to write `.claude/settings.local.json`
3. Verify `.claude/settings.local.json` contains HTTP hooks with correct port
4. Set env vars: `STOA_SESSION_ID`, `STOA_PROJECT_ID`, `STOA_SESSION_SECRET`, `STOA_WEBHOOK_PORT`
5. Run: `claude -p "list files in current directory" --dangerously-skip-permissions`
6. Capture all HTTP hook payloads at webhook server
7. Verify field naming: `hook_event_name`, `tool_name`, `tool_use_id`, `session_id`, etc.

**Registered events**: UserPromptSubmit, PreToolUse, Stop, StopFailure, PermissionRequest (no PostToolUse — Claude Code doesn't have it).

**Watch out**:
- `settings.local.json` merges with `~/.claude/settings.json` which already has `"hooks": {}`. Verify merge behavior.
- `${STOA_SESSION_ID}` template syntax — verify Claude CLI actually expands env vars in header values.
- The `allowedEnvVars` array must include the env var names for the template expansion to work.

### 2B. Verify HTTP Hook Env Var Interpolation

**Why**: Claude Code HTTP hooks use `${STOA_SESSION_ID}` in header values. This is a security-sensitive mechanism — env vars must be correctly expanded.

**Steps**:
1. Set specific test values: `STOA_SESSION_ID=test-session-42`, `STOA_PROJECT_ID=test-project-42`, `STOA_SESSION_SECRET=test-secret-42`
2. Run Claude Code with a prompt
3. Inspect received headers at capture server
4. Verify: `x-stoa-session-id` header = `test-session-42` (not literal `${STOA_SESSION_ID}`)
5. Verify: all 3 headers correctly interpolated
6. Verify: no env var leakage in request body

### 2C. Verify adaptClaudeCodeHook Field Mapping

**Steps**:
1. Take real captured payloads from 2A
2. Feed each through `adaptClaudeCodeHook` manually (or via test)
3. Verify output matches expected `CanonicalSessionEvent` shape
4. Key fields to verify against real payloads:
   - `hook_event_name` → correctly read (is it `hook_event_name` or something else for Claude?)
   - `tool_name` → present for PreToolUse
   - `session_id` → present, maps to `externalSessionId` in payload
   - `last_assistant_message` → present in Stop event, maps to `snippet`
   - `stop_hook_active` → present in StopFailure, maps to `error`
5. Compare adapter expectations with real field names — fix any mismatches

### 2D. PermissionRequest Event

**Why**: Claude Code has `PermissionRequest` event type mapped to `needs_confirmation` status. No live capture exists.

**Steps**:
1. Run Claude Code with `--permission-mode default` (not bypass)
2. Submit a prompt that triggers tool use requiring approval
3. Capture the `PermissionRequest` hook payload
4. Verify `adaptClaudeCodeHook` maps it to `status: 'needs_confirmation'` with `blockingReason: 'permission'`
5. Verify: subsequent user approval triggers `running` status update

**Alternative**: If triggering PermissionRequest is difficult in `-p` mode, verify with synthetic test payload shaped from Claude Code docs, then mark as ⬜ for live capture.

### 2E. settings.local.json Merge Behavior

**Why**: Provider writes `.claude/settings.local.json` but global `~/.claude/settings.json` already has `"hooks": {}`. Need to verify merge semantics.

**Steps**:
1. Inspect global `~/.claude/settings.json` — currently has `"hooks": {}`
2. Write `.claude/settings.local.json` with hook config
3. Run `claude --debug hooks` or inspect debug output to verify hooks are loaded
4. Verify: local settings override/merge with global correctly
5. Verify: removing `.claude/settings.local.json` reverts to no hooks (global empty)

---

## Phase 3: OpenCode Live Verification

**Architecture note**: OpenCode uses a plugin mechanism (not hooks). The `stoa-status.ts` plugin is an `afterCommand` callback that fires on specific event types (`session.idle`, `permission.asked`, etc.) and constructs `CanonicalSessionEvent` directly, then POSTs to `/events`.

### 3A. Capture Real OpenCode Plugin Output

**Why**: OpenCode plugin constructs `CanonicalSessionEvent` directly — no adapter involved. Need to verify the constructed event matches what the webhook server expects.

**Steps**:
1. Install the stoa-status.ts plugin via provider's `installSidecar`
2. Start capture server on a known port
3. Set env vars: `STOA_SESSION_ID`, `STOA_PROJECT_ID`, `STOA_SESSION_SECRET`, `STOA_WEBHOOK_PORT`
4. Run opencode with a test prompt in a way that triggers afterCommand
5. Verify: `POST /events` received with correct `CanonicalSessionEvent` shape
6. Verify: only explicit state-changing statuses emitted (not every event type)

**Event type mapping** (from plugin source):
- `session.idle` → `turn_complete`
- `permission.asked` → `needs_confirmation`
- `permission.replied` → `running`
- `session.error` → `error`

### 3B. Verify Plugin Reads Env Vars at Runtime

**Why**: Plugin should read `STOA_SESSION_ID` etc. from env, not have values baked in.

**Steps**:
1. Install sidecar via provider
2. Read plugin file content from disk
3. Verify: no hardcoded session IDs, port numbers, or secrets
4. Verify: reads `process.env.STOA_SESSION_ID`, `process.env.STOA_WEBHOOK_PORT` etc. at runtime
5. Verify: webhook port in fetch URL comes from env, not template literal baked at install time

**Already verified by test**: `provider-integration.test.ts` has "shared sidecar plugin reads session identity from runtime env instead of baking ids" test that checks this.

---

## Phase 4: Cross-Provider Integration Tests

### 4A. Webhook Server Handles All Provider Events

**Steps**:
1. Start webhook server with real `SessionEventBridge` + mock `manager`
2. For each provider, send representative captured payloads to the correct endpoint:
   - Codex hooks → `POST /hooks/codex` (raw payload from stdin)
   - Codex notify → `POST /events` (pre-constructed CanonicalSessionEvent)
   - Claude Code → `POST /hooks/claude-code` (raw payload from HTTP hook)
   - OpenCode → `POST /events` (pre-constructed CanonicalSessionEvent)
3. Verify: all reach `applySessionEvent` with correct (sessionId, status, summary)
4. Verify: unknown events return `{ accepted: true, ignored: true }`

### 4B. External Session ID Reconciliation (per-provider)

**Why**: Each provider handles `externalSessionId` differently. The `session_id` field in raw payloads has different meanings.

**Steps**:
1. Start full pipeline (webhook → bridge → manager → state-store)
2. **Codex**: Send PreToolUse hook with `session_id: "codex-thread-1"` in body → adapter ignores it (uses context sessionId) → verify `externalSessionId` is NOT set from body
3. **Claude Code**: Send PreToolUse hook with `session_id: "claude-session-1"` in body → adapter reads it as `externalSessionId` → verify `externalSessionId = "claude-session-1"` in reconciled state
4. **OpenCode**: Send event with `payload.externalSessionId: "oc-sess-1"` → verify `externalSessionId = "oc-sess-1"` in reconciled state
5. For each: send another event with different external session ID → verify reconciliation detects the change

### 4C. Config Template Validation (All Providers)

**Steps**:
1. **Codex**: `installSidecar` in temp dir → `codex features list` must not error → verify hooks.json is valid
2. **Claude Code**: `installSidecar` in temp dir → verify `settings.local.json` is valid JSON → verify hook type is `http` with correct URL template → verify `allowedEnvVars` lists are correct
3. **OpenCode**: `installSidecar` in temp dir → verify `stoa-status.ts` is valid TypeScript (or at least syntactically correct JS) → verify no hardcoded values
4. All: verify generated configs don't conflict with existing global configs

---

## Phase 5: Downstream Verification

Already well-tested by existing E2E tests. These are confirmation checks, not discovery.

### 5A. Bridge → State Store Round-Trip

**Existing test**: `tests/e2e/webhook-runtime-integration.test.ts` (7 tests)

**Confirmation**: Run existing test suite, verify all pass. No new work needed.

### 5B. Bridge → Observability Ingest

**Existing test**: `src/main/session-event-bridge.test.ts` (6 tests)

**Confirmation**: Verify observability mapping covers all statuses that can come from adapters:
- `running` (all providers)
- `turn_complete` (Codex Stop, Claude Stop, OpenCode session.idle)
- `needs_confirmation` (Claude PermissionRequest, OpenCode permission.asked)
- `error` (Claude StopFailure, OpenCode session.error)

### 5C. IPC → Renderer Store Propagation

**Existing test**: `tests/e2e/frontend-store-projection.test.ts` (14 tests)

**Confirmation**: Run existing test suite, verify all pass. No new work needed.

---

## Execution Priority

| ID | Verification Item | Risk | Effort | Priority |
|---|---|---|---|---|
| **2A** | Claude Code live HTTP hook capture | **HIGH** — never verified, uses novel `${ENV}` interpolation mechanism | Low | **P0** |
| **2B** | Claude Code env var interpolation | **HIGH** — security-sensitive, misconfiguration = auth bypass or failure | Low | **P0** |
| **2C** | Claude adapter field mapping | **HIGH** — field names assumed from docs, never validated against real payloads | Low | **P0** |
| **1A** | Codex notify in interactive session | Medium — untested mechanism | Medium | **P0** |
| **2E** | settings.local.json merge behavior | Medium — may silently fail to load hooks | Low | **P1** |
| **4A** | Cross-provider webhook integration | Medium — each endpoint should work with real payloads | Low | **P1** |
| **4B** | External session ID reconciliation per-provider | Medium — different behavior per provider | Low | **P1** |
| **1C** | Sidecar config after fix | Low — fix already verified partially | Low | **P1** |
| **3A** | OpenCode live capture | Medium — plugin never tested live | Medium | **P1** |
| **2D** | PermissionRequest event | Medium — rare event, hard to trigger | Medium | **P2** |
| **1D** | Hook timeout behavior | Low — cosmetic, not a correctness issue | Low | **P2** |
| **1B** | Unread fields decision | Low — documentation/enhancement | Low | **P2** |
| **3B** | OpenCode plugin env vars | Low — already verified by E2E test | Low | **P3** |
| **5A-5C** | Downstream verification | Low — already well-tested | None | **P3** |

---

## Success Criteria

1. **All 3 CLIs** have at least one live-captured payload set verified against adapter code
2. **All adapter functions** (`adaptCodexHook`, `adaptClaudeCodeHook`) field names match real payload shapes — no camelCase/snake_case mismatches
3. **Claude Code HTTP hooks**: `${ENV}` interpolation verified working correctly in header values
4. **All sidecar/config files**: hook-stoa.mjs, notify-stoa.mjs, settings.local.json, config.toml verified parseable by their respective CLIs
5. **External session ID**: verified per-provider (Codex ignores body.session_id, Claude forwards it, OpenCode uses event property)
6. **Notify mechanism**: confirmed working in interactive Codex sessions
7. **All findings** documented in `docs/architecture/hook-signal-chain.md` with updated verification statuses

## Deliverables

- Captured payload fixture files under `tests/fixtures/captured-payloads/` (JSONL format, one payload per line)
- Updated `docs/architecture/hook-signal-chain.md` — all ⬜ changed to ✅ or 🔬 with evidence
- Any new bugs found are fixed inline with test coverage
- Any field naming mismatches are fixed in adapter code + tests
