# CLI Adapter Layer Verification Plan

## Objective

Verify every link in the signal chain from CLI → sidecar → webhook → adapter → bridge → state → IPC → renderer, for all 4 providers, using real CLI execution with payload capture.

## Available CLIs

| CLI | Version | Status |
|---|---|---|
| codex | 0.125.0 | Installed, live-captured ✅ |
| claude | 2.1.89 | Installed, not yet live-captured |
| opencode | Available | Installed (we're running in it), not yet live-captured |
| local-shell | N/A | No hooks, PTY-based only |

---

## Phase 1: Codex Deep Verification

Already partially verified with live capture. Remaining gaps:

### 1A. Notify Mechanism in Interactive Session

**Why**: Notify fires per-turn in interactive sessions, but our live capture used `codex exec` (single turn, no notify).

**Steps**:
1. Start capture server on fixed port
2. Install sidecar files with capture server port
3. Run `codex --no-alt-screen` interactively (not exec mode)
4. Send 2 prompts in sequence
5. Capture both hook payloads AND notify payloads
6. Verify: `agent-turn-complete` fires between turns, Stop fires at session end

**Expected result**: `notify-stoa.mjs` receives `agent-turn-complete` with `last-assistant-message` field per turn.

### 1B. Unread Fields Forwarding

**Why**: Real payloads contain `tool_input`, `tool_response`, `last_assistant_message` that `adaptCodexHook` doesn't forward. Verify these exist and consider adding them to `CanonicalSessionEvent.payload`.

**Steps**:
1. Review captured payloads from previous live run
2. Verify each unread field is present and non-empty
3. Decide: add to adapter output or document as intentional omission

### 1C. Sidecar Config Correctness After Fix

**Why**: We fixed the config.toml template (notify before [features]). Verify the fixed config works with a fresh install.

**Steps**:
1. Delete `.codex/` directory in a temp workspace
2. Run `installSidecar` via provider
3. Verify config.toml parses without errors (`codex features list`)
4. Verify hooks.json is valid JSON with all 5 events
5. Run a short codex exec to confirm hooks fire

### 1D. Hook Timeout Behavior

**Why**: hooks.json sets `timeout_sec: 5`. If webhook server is down, Codex waits 5s per hook. Verify this doesn't cause issues.

**Steps**:
1. Install sidecar but don't start capture server
2. Run `codex exec` with a simple prompt
3. Measure total execution time
4. Verify: each hook adds ~5s timeout (5 hooks × 5s = ~25s overhead)
5. Verify: codex still completes successfully after timeouts

---

## Phase 2: Claude Code Live Verification

### 2A. Capture Real Claude Code Hook Payloads

**Why**: `adaptClaudeCodeHook` was written based on docs but never verified with real payloads.

**Steps**:
1. Create capture server script
2. Configure Claude Code hooks in `.claude/settings.json`:
   ```json
   {
     "hooks": {
       "PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": "node .claude/hook-capture.mjs"}]}],
       "PostToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": "node .claude/hook-capture.mjs"}]}],
       "Stop": [{"hooks": [{"type": "command", "command": "node .claude/hook-capture.mjs"}]}]
     }
   }
   ```
3. Write `hook-capture.mjs` that reads stdin → writes to capture file + POSTs to capture server
4. Run `claude -p "list files in current directory" --dangerously-skip-permissions`
5. Capture all hook payloads
6. Verify field naming: `hook_event_name`, `tool_name`, `tool_use_id`, `session_id`, etc.

### 2B. Verify adaptClaudeCodeHook Field Mapping

**Steps**:
1. Take real captured payloads
2. Feed each through `adaptClaudeCodeHook` manually
3. Verify output matches expected `CanonicalSessionEvent` shape
4. Key fields to verify:
   - `hook_event_name` → correctly read
   - `tool_name` → present for PreToolUse/PostToolUse
   - `session_id` → present (maps to `externalSessionId`)
   - `last_assistant_message` → present in Stop event
   - `stop_hook_active` → present in StopFailure (if it occurs)

### 2C. PermissionRequest Event

**Why**: Claude Code has `PermissionRequest` event type mapped to `needs_confirmation` status. No live capture exists.

**Steps**:
1. Run Claude Code without `--dangerously-skip-permissions`
2. Trigger a command that requires approval
3. Capture the `PermissionRequest` hook payload
4. Verify `adaptClaudeCodeHook` maps it to `status: 'needs_confirmation'` with `blockingReason: 'permission'`

---

## Phase 3: OpenCode Live Verification

### 3A. Capture Real OpenCode Plugin Output

**Why**: OpenCode uses a plugin mechanism, not hooks. The `stoa-status.ts` plugin constructs `CanonicalSessionEvent` directly.

**Steps**:
1. Install the stoa-status.ts plugin via provider's `installSidecar`
2. Start capture server
3. Run opencode with a test prompt
4. Verify: `POST /events` received with correct `CanonicalSessionEvent` shape
5. Verify: only explicit state-changing statuses emitted (running, turn_complete, awaiting_input, exited)

### 3B. Verify Plugin Reads Env Vars at Runtime

**Why**: Plugin should read `STOA_SESSION_ID` etc. from env, not have values baked in.

**Steps**:
1. Install sidecar
2. Read plugin file content
3. Verify: no hardcoded session IDs
4. Verify: reads `process.env.STOA_*` at runtime

---

## Phase 4: Cross-Provider Integration Tests

### 4A. Webhook Server Handles All Provider Events

**Steps**:
1. Start capture server with real `SessionEventBridge` + mock `manager`
2. For each provider, send representative captured payloads
3. Verify: all reach `applySessionEvent` with correct (sessionId, status, summary)
4. Verify: unknown events return `{ accepted: true, ignored: true }`

### 4B. External Session ID Reconciliation

**Steps**:
1. Start full pipeline (webhook → bridge → manager → state-store)
2. Send Codex hook with `session_id: "codex-uuid-1"` in body
3. Verify: `externalSessionId` is reconciled to internal session ID
4. Send another hook with different `session_id` (simulating mid-conversation switch)
5. Verify: reconciliation detects and logs the change

### 4C. Config Template Validation (All Providers)

**Steps**:
1. For Codex: write `.codex/config.toml` via template → `codex features list` must not error
2. For Claude Code: write `.claude/settings.json` via template → `claude config list` must not error (if available)
3. For OpenCode: write `.opencode/plugins/stoa-status.ts` → TypeScript compiles without errors
4. Verify: all generated configs are parseable by their respective CLIs

---

## Phase 5: Downstream Verification

### 5A. Bridge → State Store Round-Trip

**Steps**:
1. Use `tests/e2e/webhook-runtime-integration.test.ts` pattern
2. Start real `SessionEventBridge` with real `ProjectSessionManager`
3. Send Codex hook payloads through webhook
4. Read `state-store.json` from disk
5. Verify: session status matches the last event's status

### 5B. Bridge → Observability Ingest

**Steps**:
1. Mock `ObservabilityIngester`
2. Send each provider's canonical events
3. Verify: `toObservationEvent` maps status → correct (category, type, severity, retention)
4. Status mapping table:
   - `running` → presence.running / info / operational
   - `turn_complete` → presence.turn_complete / info / operational
   - `needs_confirmation` → presence.needs_confirmation / attention / critical
   - `exited` → lifecycle.session_exited / info / operational

### 5C. IPC → Renderer Store Propagation

**Steps**:
1. Use `tests/e2e/frontend-store-projection.test.ts` pattern
2. Send events through full pipeline
3. Hydrate Pinia store from backend state
4. Verify: computed properties (active session, hierarchy) reflect events correctly

---

## Execution Priority

| Phase | Risk | Effort | Priority |
|---|---|---|---|
| 2A Claude Code live capture | **HIGH** — never verified with real payloads | Medium | **P0** |
| 1A Codex notify verification | Medium — untested mechanism | Medium | **P0** |
| 4A Cross-provider webhook test | Medium — integration gap | Low | **P0** |
| 2B Claude adapter field mapping | Medium — depends on 2A | Low | **P1** |
| 1C Sidecar config after fix | Low — fix already verified | Low | **P1** |
| 3A OpenCode live capture | Medium — plugin never tested live | Medium | **P1** |
| 1D Hook timeout behavior | Low — cosmetic | Low | **P2** |
| 2C PermissionRequest event | Medium — rare event | Medium | **P2** |
| 1B Unread fields decision | Low — documentation | Low | **P2** |
| 5A-5C Downstream | Low — already well-tested | Low | **P3** |

---

## Success Criteria

1. **All 3 CLIs** have at least one live-captured payload set stored in the repo (under `tests/fixtures/` or documented in test files)
2. **All adapter functions** (`adaptCodexHook`, `adaptClaudeCodeHook`) are verified against real payload shapes — not just synthetic test data
3. **All sidecar scripts** (hook-stoa.mjs, notify-stoa.mjs, stoa-status.ts) are verified to fire correctly when their respective CLI runs
4. **All config templates** (config.toml, hooks.json, settings.json) are verified to parse without errors in their respective CLIs
5. **Field naming** is confirmed via real capture for every adapter-read field (no camelCase/snake_case mismatches)
6. **Notify mechanism** confirmed working in interactive Codex sessions (not just exec mode)

## Deliverables

- Captured payload fixture files under `tests/fixtures/captured-payloads/`
- Updated `docs/architecture/hook-signal-chain.md` with all verification statuses changed from ⬜ to ✅ or 🔬
- Any new bugs found during verification are filed as issues or fixed inline
