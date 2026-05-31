---
date: 2026-05-29
topic: Task 4 control plane spec-vs-code gaps
status: completed
mode: context-gathering
sources: 18
---

## Context Report: Task 4 Unified Control Plane — Spec-vs-Code Gaps

### Why This Was Gathered

Task 4 of the unified session tree plan calls for a unified control server, CLI rewrite to `session *` commands, wiring in main/index.ts, and retirement of the meta-session control stack. This audit compares the plan spec against the current code to identify remaining gaps.

### Summary

The core building blocks exist (supervisor, control server, command-env, bootstrap-prompt), but the integration layer is incomplete: main/index.ts still wires the old meta-session control server, the CLI has zero `session *` commands, the control server lacks several routes the CLI expects, and the auth flow is still meta-session centric. Approximately 70% of the integration surface is unwired.

### Key Findings

Gaps ordered by severity. Typecheck mismatches noted where the code compiles but semantics are wrong.

---

#### CRITICAL — Structural Wiring Gaps

**G1. main/index.ts not wired to unified control server**

`main/index.ts` imports and uses the old stack:
- `createMetaSessionControlServer` (line 15)
- `buildMetaSessionCommandEnv` (line 20)
- `META_SESSION_BOOTSTRAP_PROMPT` (line 22)

The new `createSessionControlServer` from `session-control-server.ts` is never imported or referenced anywhere in `src/main/`.

| Claim | Source | Location |
|-------|--------|----------|
| Still uses old meta-session imports | `src/main/index.ts` | lines 13-22 |
| `createSessionControlServer` unused in main | `src/main/index.ts` | grep: 0 hits |

**G2. CLI has zero `session *` commands**

`tools/stoa-ctl/index.ts` still operates on `work-sessions` and `meta-sessions` command groups. The plan's Task 4 spec says: "CLI rewrite to `session` commands". There are no `session list`, `session inspect`, `session prompt`, `session create`, `session destroy` handlers.

| Claim | Source | Location |
|-------|--------|----------|
| No `session *` command handlers | `tools/stoa-ctl/index.ts` | grep: 0 hits for `session list\|session inspect\|session prompt\|session create\|session destroy` |
| Still uses `work-sessions` and `meta-sessions` groups | `tools/stoa-ctl/index.ts` | lines 332-611 |

**G3. Control server missing routes the CLI calls**

`session-control-server.ts` exposes only:
- `GET /ctl/health`
- `GET /ctl/whoami`
- `GET /ctl/capabilities`
- `GET /ctl/session/list`
- `GET /ctl/session/:id/inspect`
- `POST /ctl/session/:id/prompt`
- `POST /ctl/session/:id/destroy`
- `POST /ctl/session/create`

Missing routes the CLI depends on:
- `GET /ctl/bootstrap-prompt` — CLI line 279
- `POST /ctl/session/:id/send-keys` — CLI line 498 (old `work-sessions/:id/send-keys`)
- `GET /ctl/session/:id/context` — CLI line 426 (old `work-sessions/:id/context`)
- `GET /ctl/session/:id/events` — CLI line 400 (old `work-sessions/:id/events`)
- `GET /ctl/state/brief` — CLI line 303
- `GET /ctl/state/attention-queue` — CLI line 312
- `GET /ctl/state/conflicts` — CLI line 321

| Claim | Source | Location |
|-------|--------|----------|
| No `bootstrap-prompt` route | `src/core/session-control-server.ts` | grep: 0 hits |
| No `send-keys`/`context`/`events`/`state/*` routes | `src/core/session-control-server.ts` | grep: 0 hits for `send-keys\|context\|events\|state` |

---

#### HIGH — Auth and Identity Gaps

**G4. CLI auth resolution is meta-session centric, not session-token aware**

`resolveHeaders()` in `tools/stoa-ctl/index.ts` (line 93-113):
1. Resolves session ID from `STOA_META_SESSION_ID` first, then `STOA_SESSION_ID` (line 94-97)
2. Never sends `x-stoa-session-token` header
3. Falls back to `portFileData?.activeMetaSessionId` (line 97)

The new unified auth model requires `x-stoa-session-id` + `x-stoa-session-token` pair. The CLI sends `x-stoa-secret` from port file (line 108-109) but never sends `x-stoa-session-token`.

| Claim | Source | Location |
|-------|--------|----------|
| `STOA_META_SESSION_ID` checked first | `tools/stoa-ctl/index.ts` | line 94 |
| No `x-stoa-session-token` header | `tools/stoa-ctl/index.ts` | lines 104-111 |
| Port file fallback uses `activeMetaSessionId` | `tools/stoa-ctl/index.ts` | line 97 |

**G5. stoa-ctl-port-file.ts still has `activeMetaSessionId`**

`PortFileData` interface (line 6-12) includes `activeMetaSessionId: string | null`. The plan says Task 4 should modify this file, presumably to remove the meta-session field.

| Claim | Source | Location |
|-------|--------|----------|
| `activeMetaSessionId` still in PortFileData | `src/core/stoa-ctl-port-file.ts` | line 9 |

**G6. ipc-channels.ts not updated with session tree channels**

All channel names are still `metaSession*`. No unified `sessionGraph*`, `sessionNode*`, or `sessionTree*` channels exist.

| Claim | Source | Location |
|-------|--------|----------|
| 14 `metaSession*` channels still present | `src/core/ipc-channels.ts` | lines 17-28 |
| No unified tree channels | `src/core/ipc-channels.ts` | grep: 0 hits for `sessionGraph\|sessionNode\|sessionTree\|sessionControl` |

---

#### HIGH — Typecheck/Spec Mismatches (compiles but semantically wrong)

**G7. `SessionBootstrapPromptService.getPrompt()` — provider parameter ignored**

- Implementation: `getPrompt(): string` — no parameters (`session-bootstrap-prompt-service.ts:38`)
- Test calls: `service.getPrompt('claude-code')`, `service.getPrompt('codex')`, etc. (`session-bootstrap-prompt-service.test.ts:8,12,19,26`)
- TypeScript silently allows extra arguments; tests pass at runtime but the provider type is always ignored
- The service returns the same static prompt regardless of provider

| Claim | Source | Location |
|-------|--------|----------|
| `getPrompt()` takes no args | `src/core/session-bootstrap-prompt-service.ts` | line 38 |
| Tests pass provider arg | `src/core/session-bootstrap-prompt-service.test.ts` | lines 8, 12, 19, 26 |

**G8. Missing input validation in create route**

`session-control-server.ts` `POST /ctl/session/create` only validates `parentId` presence (line 190-196). Tests expect 400 for missing `projectId` (test line 337) and missing `type` (test line 347). Neither check exists. Additionally, `type` is not `.trim()`-ed (line 187), so the whitespace-only type test (test line 357) would also fail because `'   '` is truthy.

| Claim | Source | Location |
|-------|--------|----------|
| Only `parentId` validated | `src/core/session-control-server.ts` | lines 190-196 |
| `type` not trimmed | `src/core/session-control-server.ts` | line 187 |

---

#### MEDIUM — Incomplete Transition Surface

**G9. CLI USAGE_TEXT and tests still reference meta-session commands**

`USAGE_TEXT` lists `meta-sessions list`, `meta-sessions create`, `meta-sessions archive`, etc. The test at `index.test.ts:29-51` asserts these meta-session strings are present. No `session *` commands appear in USAGE_TEXT.

| Claim | Source | Location |
|-------|--------|----------|
| Meta-session commands in usage | `tools/stoa-ctl/index.ts` | lines 65-76 |
| Test asserts meta-session strings | `tools/stoa-ctl/index.test.ts` | lines 41-44 |

**G10. CLI tests use `STOA_META_SESSION_ID` env var**

All test environments use `STOA_META_SESSION_ID: 'meta_session_1'` (`index.test.ts:20-21`). No test uses `STOA_SESSION_ID` + `STOA_CTL_SESSION_TOKEN`.

| Claim | Source | Location |
|-------|--------|----------|
| Tests use `STOA_META_SESSION_ID` | `tools/stoa-ctl/index.test.ts` | lines 20-21 |

**G11. `buildSessionCommandEnv` never called from main process**

The new env builder in `session-command-env.ts` is never imported or used in `main/index.ts`. The main process still uses `buildMetaSessionCommandEnv` (line 20).

| Claim | Source | Location |
|-------|--------|----------|
| New env builder unused in main | `src/main/index.ts` | grep: 0 hits for `buildSessionCommandEnv` |
| Old env builder still imported | `src/main/index.ts` | line 20 |

---

### Minimal Change Suggestions (file-grouped)

#### `tools/stoa-ctl/index.ts` + `tools/stoa-ctl/index.test.ts`
1. Add `session list`, `session inspect`, `session prompt`, `session create`, `session destroy` command handlers
2. Replace `STOA_META_SESSION_ID` fallback with `STOA_SESSION_ID` + `STOA_CTL_SESSION_TOKEN` pair
3. Send `x-stoa-session-token` header when token is available from env
4. Remove or deprecate `meta-sessions *` command handlers
5. Update `USAGE_TEXT` to include `session *` commands
6. Rewrite tests to use new env vars and `session *` routes

#### `src/core/session-control-server.ts`
1. Add missing routes: `bootstrap-prompt`, `send-keys`, `context`, `events`, `state/*`
2. Add `projectId` and `type` presence validation in `POST /ctl/session/create`
3. Trim `type` before validation

#### `src/core/session-bootstrap-prompt-service.ts`
1. Add optional `provider` parameter to `getPrompt(provider?: string)` and use it to customize the prompt per provider, OR remove the parameter from tests

#### `src/main/index.ts`
1. Replace `createMetaSessionControlServer` with `createSessionControlServer`
2. Replace `buildMetaSessionCommandEnv` with `buildSessionCommandEnv`
3. Replace `META_SESSION_BOOTSTRAP_PROMPT` with `SessionBootstrapPromptService`
4. Wire session token registry into the new control server deps

#### `src/core/stoa-ctl-port-file.ts`
1. Remove `activeMetaSessionId` from `PortFileData` (breaking change, per project rules)

#### `src/core/ipc-channels.ts`
1. Add unified session tree channels (e.g. `sessionGraphEvent`, `sessionNodeSnapshot`)
2. Remove `metaSession*` channels (breaking change, per project rules)

---

### Risks / Unknowns

- [!] The control server tests currently pass because they test the new routes in isolation. When main/index.ts is rewired, the old meta-session routes will break unless both servers run simultaneously during transition — but the project rules prohibit compatibility code.
- [!] The CLI has no backward compatibility story for existing agent sessions using `work-sessions *` commands. After the CLI rewrite, sessions still running with old bootstrap prompts will send commands to routes that no longer exist.
- [?] It is unclear whether `send-keys` should be a unified session route (`POST /ctl/session/:id/send-keys`) or remain under a separate path. The old design spec (`2026-05-11-stoa-ctl-send-keys-design.md`) puts it under `work-sessions`, but the new plan implies unification.
- [?] The `session-control-server.ts` has a `sessionTokenRegistry: Map<string, string>` dependency. Who populates and invalidates this map is not specified — this is a Task 3 concern but the control server test mocks it.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| main/index.ts still imports old meta-session stack | `src/main/index.ts` | lines 13-22 |
| `createSessionControlServer` unused in main | `src/main/index.ts` | grep: 0 hits |
| CLI has no `session *` commands | `tools/stoa-ctl/index.ts` | grep: 0 hits |
| CLI resolves `STOA_META_SESSION_ID` first | `tools/stoa-ctl/index.ts` | line 94 |
| CLI never sends `x-stoa-session-token` | `tools/stoa-ctl/index.ts` | lines 104-111 |
| Control server has 8 routes, CLI expects 15+ | `src/core/session-control-server.ts` | full file |
| `getPrompt()` takes no args, tests pass arg | `session-bootstrap-prompt-service.ts:38` vs `test.ts:8,12,19,26` | |
| Create route only validates `parentId` | `session-control-server.ts` | lines 190-196 |
| `type` not trimmed in create route | `session-control-server.ts` | line 187 |
| `PortFileData` still has `activeMetaSessionId` | `stoa-ctl-port-file.ts` | line 9 |
| 14 `metaSession*` IPC channels unchanged | `ipc-channels.ts` | lines 17-28 |
| `buildSessionCommandEnv` unused in main | `src/main/index.ts` | grep: 0 hits |
