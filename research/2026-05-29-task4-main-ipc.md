---
date: 2026-05-29
topic: Task 4 Integration Gaps — main/index.ts, ipc-channels.ts, stoa-ctl-port-file
status: completed
mode: context-gathering
sources: 14
---

## Context Report: Task 4 — Main/IPC Integration Gaps

### Why This Was Gathered

Task 4 (Unified Control Server and CLI) has four new modules implemented:
`SessionSupervisor`, `SessionControlServer`, `SessionCommandEnv`, `SessionBootstrapPromptService`.
This report audits what still needs to be wired in `src/main/index.ts`, what must be removed
from `src/core/ipc-channels.ts`, what must change in `src/core/stoa-ctl-port-file.ts`, and
what CLI routes are missing from `tools/stoa-ctl/index.ts`. Only gaps beyond red tests are documented.

---

### Summary

The new control-plane modules exist and their unit tests pass. Three integration seams are
still unwired: (1) `main/index.ts` still mounts the old `createMetaSessionControlServer` and
still uses meta-session IPC handlers; (2) the port file schema still carries
`activeMetaSessionId`; (3) the CLI has no `session *` commands and does not send
`x-stoa-session-token`. The `ipc-channels.ts` removals are already planned but not executed.

---

### Gap 1: `src/main/index.ts` Still Wires Meta-Session Stack

**Evidence:**

| Item | Location | Status |
|------|----------|--------|
| 10 meta-session imports | `index.ts:13-24` | Still present |
| `metaSessionBootstrapPending` set | `index.ts:69` | Still present |
| `metaSessionManager` instance | `index.ts:469-471` | Still present |
| `configureServerApp` mounts `createMetaSessionControlServer` | `index.ts:661-718` | Old server |
| `launchMetaSessionRuntimeWithGuard` | `index.ts:847-1014` | Still present |
| `metaSession:*` IPC handlers | `index.ts:1546-1645` | 8 handlers still wired |
| `pushMetaSessionEvent` helper | `index.ts:359-366` | Still present |
| Old `compositeRuntimeController` branch | `index.ts:611-635` | Still uses `MetaSessionManager` |

**What must change:**

1. Replace `import { createMetaSessionControlServer } ...` with `import { createSessionControlServer }`
2. Replace `metaSessionManager = await MetaSessionManager.create(...)` with `SessionSupervisor` construction
3. Wire `sessionTokenRegistry` (from `SessionRuntimeController`) into `SessionControlServerDeps.sessionTokenRegistry`
4. Replace the `configureServerApp` callback to call `createSessionControlServer(deps)` instead of `createMetaSessionControlServer(opts)`
5. Replace `launchMetaSessionRuntimeWithGuard` with unified session launch using `buildSessionCommandEnv` + `SessionBootstrapPromptService`
6. Remove all `metaSession:*` IPC handlers (8 handlers at lines 1546–1645)
7. Remove `pushMetaSessionEvent`, `metaSessionBootstrapPending`, `metaSessionManager`

---

### Gap 2: `src/core/ipc-channels.ts` Meta-Session Channels Not Yet Removed

**Evidence:**

```typescript
// src/core/ipc-channels.ts:17-28 — still present
metaSessionBootstrap: 'meta-session:bootstrap',
metaSessionCreate: 'meta-session:create',
metaSessionSetActive: 'meta-session:set-active',
metaSessionArchive: 'meta-session:archive',
metaSessionRestore: 'meta-session:restore',
metaSessionEvent: 'meta-session:event',
metaSessionProposalList: 'meta-session:proposal-list',
metaSessionProposalGet: 'meta-session:proposal-get',
metaSessionProposalApprove: 'meta-session:proposal-approve',
metaSessionProposalReject: 'meta-session:proposal-reject',
metaSessionProposalDispatch: 'meta-session:proposal-dispatch',
metaSessionInspectorSetTarget: 'meta-session:inspector-set-target',
```

**What must change:**

Remove all 12 `metaSession*` keys from `IPC_CHANNELS`. This is a precondition for deleting
the meta-session stack in Phase D of the implementation plan.

---

### Gap 3: `src/core/stoa-ctl-port-file.ts` Schema Still Carries `activeMetaSessionId`

**Evidence:**

```typescript
// stoa-ctl-port-file.ts:9
export interface PortFileData {
  port: number
  pid: number
  activeMetaSessionId: string | null   // ← must be replaced/removed
  secret: string
  startedAt: string
}
```

Also at `stoa-ctl-port-file.ts:56`:
```typescript
activeMetaSessionId: typeof data.activeMetaSessionId === 'string' ? data.activeMetaSessionId : null,
```

**What must change:**

Replace `activeMetaSessionId` with `activeSessionId: string | null`. The refresh call in
`main/index.ts:746-756` (`refreshCtlPortFile`) must be updated to use `activeSessionId`
from the unified tree (from `metaSessionManager?.snapshot()?.activeMetaSessionId` → project
session manager's active session).

---

### Gap 4: `tools/stoa-ctl/index.ts` Missing `session *` Commands

**Evidence — existing CLI routes that match new server:**

| Server Route | CLI Command | Status |
|-------------|-------------|--------|
| `GET /ctl/health` | `stoa-ctl health` | ✓ exists |
| `GET /ctl/whoami` | `stoa-ctl whoami` | ✓ exists |
| `GET /ctl/capabilities` | `stoa-ctl capabilities` | ✓ exists |
| `GET /ctl/session/list` | `stoa-ctl session list` | ✗ missing |
| `GET /ctl/session/:id/inspect` | `stoa-ctl session inspect <id>` | ✗ missing |
| `POST /ctl/session/:id/prompt` | `stoa-ctl session prompt <id> --text "..."` | ✗ missing |
| `POST /ctl/session/:id/destroy` | `stoa-ctl session destroy <id>` | ✗ missing |
| `POST /ctl/session/create` | `stoa-ctl session create --parent <id> ...` | ✗ missing |
| `GET /ctl/bootstrap-prompt` | `stoa-ctl bootstrap-prompt` | ✓ exists (line 278) |

**CLI header resolution issue (`resolveHeaders`, `index.ts:93-113`):**

```typescript
// Current: uses x-stoa-session-id only
function resolveHeaders(env, sessionOverride, portFileData): Record<string, string> {
  const sessionId = env.STOA_META_SESSION_ID ?? env.STOA_SESSION_ID ?? sessionOverride ?? portFileData?.activeMetaSessionId ?? undefined
  const headers = { 'x-stoa-session-id': sessionId }
  if (portFileData?.secret) headers['x-stoa-secret'] = portFileData.secret
  return headers
}
```

- `STOA_META_SESSION_ID` must be removed from resolution chain
- `activeMetaSessionId` fallback must be removed
- `x-stoa-session-token` must be added when `STOA_SESSION_ID` is set (from `STOA_CTL_SESSION_TOKEN` env var)

**What must change:**

1. Add `session *` command group with list, inspect, prompt, destroy, create subcommands
2. Add `x-stoa-session-token` header to `resolveHeaders`
3. Remove `STOA_META_SESSION_ID` from resolution chain
4. Remove `activeMetaSessionId` fallback
5. Update `USAGE_TEXT` (line 41-77) to reflect new command structure

---

### Gap 5: `sessionTokenRegistry` Not Wired to `SessionControlServer`

**Evidence:**

`session-control-server.ts:18` declares deps:
```typescript
sessionTokenRegistry: Map<string, string>
```

`session-runtime-controller.ts:31` has the registry:
```typescript
private readonly sessionTokens = new Map<string, string>()
```

But `main/index.ts` does not pass the runtime controller's token registry to the control server deps.
The `configureServerApp` callback (`index.ts:661-718`) constructs `createMetaSessionControlServer`
with no reference to the new `SessionControlServerDeps.sessionTokenRegistry`.

**What must change:**

Extract `runtimeController.sessionTokens` (or expose via a getter) and pass it to
`createSessionControlServer` as `sessionTokenRegistry`.

---

### Gap 6: `SessionBootstrapPromptService.getPrompt` Called Incorrectly in Test

**Evidence:**

```typescript
// session-bootstrap-prompt-service.ts:40
getPrompt(_sessionType: SessionType): string { ... }

// session-bootstrap-prompt-service.test.ts:8
const prompt = service.getPrompt('claude-code')
```

TypeScript accepts `'claude-code'` as `SessionType` (string literal). This is a valid test but
the implementation ignores `_sessionType` entirely — it returns the same prompt for all session
types. This is by design per the skeleton phase (initial implementation returns same prompt).
No fix needed; this is acknowledged in Task 4 plan.

---

### Minimal Change Set (File-Grouped)

**`src/core/ipc-channels.ts`**
- Delete 12 `metaSession*` channel entries (lines 17-28)

**`src/core/stoa-ctl-port-file.ts`**
- Rename `activeMetaSessionId` → `activeSessionId` in `PortFileData` interface and `readPortFile` return

**`src/main/index.ts`**
- Remove meta-session imports (lines 13-24)
- Remove `metaSessionManager`, `metaSessionBootstrapPending` declarations
- Replace `configureServerApp` callback to use `createSessionControlServer` with new deps
- Wire `runtimeController.sessionTokens` → `sessionTokenRegistry`
- Replace `launchMetaSessionRuntimeWithGuard` with unified session launch
- Remove all `metaSession:*` IPC handlers (lines 1546-1645)
- Remove `pushMetaSessionEvent`, `compositeRuntimeController.meta-session` branch

**`tools/stoa-ctl/index.ts`**
- Add `session list`, `session inspect`, `session prompt`, `session destroy`, `session create` routes
- Update `resolveHeaders` to remove `STOA_META_SESSION_ID`, `activeMetaSessionId`, add `x-stoa-session-token`
- Update `USAGE_TEXT`

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| New modules exist and tests pass | Files read | `src/core/session-supervisor.ts`, `session-control-server.ts`, `session-command-env.ts`, `session-bootstrap-prompt-service.ts`, and their `.test.ts` files |
| `meta-session` imports still in main | Import block | `src/main/index.ts:13-24` |
| Old control server still mounted | `configureServerApp` | `src/main/index.ts:661-718` |
| Meta-session lifecycle functions still present | Function defs | `src/main/index.ts:847-1058` |
| `metaSession:*` IPC handlers still wired | `ipcMain.handle` calls | `src/main/index.ts:1546-1645` |
| 12 meta-session channels in `IPC_CHANNELS` | Channel map | `src/core/ipc-channels.ts:17-28` |
| `PortFileData.activeMetaSessionId` | Interface | `src/core/stoa-ctl-port-file.ts:9` |
| CLI has no `session *` commands | `run()` switch | `tools/stoa-ctl/index.ts:253-738` |
| CLI uses `activeMetaSessionId` fallback | `resolveHeaders` | `tools/stoa-ctl/index.ts:93-113` |
| CLI never sends `x-stoa-session-token` | `resolveHeaders` | `tools/stoa-ctl/index.ts:93-113` |
| Runtime controller has token registry | `sessionTokens` map | `src/main/session-runtime-controller.ts:31` |
| Token registry not wired to server | `configureServerApp` | `src/main/index.ts:661-718` |

---

### Risks / Unknowns

- [!] **Renderer breaks after main/index.ts removes meta-session IPC handlers** — This is expected (Task 5 fixes the renderer). The app won't be runnable between Task 4 and Task 5 without the E2E test harness.

- [?] **Proposal system survival** — The plan doesn't clarify whether proposals survive. If they do, `metaSessionProposalStore` + `metaSessionProposalList/Get/Approve/Reject/Dispatch` IPC handlers need to be preserved but keyed by `sessionId` instead of `metaSessionId`. No evidence of this decision yet.

- [?] **`runtimeController.sessionTokens` is private** — The token registry is `private readonly` in `session-runtime-controller.ts:31`. A public getter method needs to be added to expose it to `main/index.ts` for wiring to `SessionControlServerDeps`.

---

## Context Handoff: Task 4 Main/IPC Integration Gaps

Start here: `research/2026-05-29-task4-main-ipc.md`

Context only. Use the saved report as the source of truth.