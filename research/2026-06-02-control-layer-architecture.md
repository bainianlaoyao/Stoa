---
date: 2026-06-02
topic: control-layer-architecture-session-supervisor-and-control-server
status: completed
mode: context-gathering
sources: 24 evidence items
---

## Context Report: Control-Layer Architecture around SessionSupervisor, SessionControlServer, and Adjacent Session-Output Concepts

### Why This Was Gathered
Map the existing control-layer architecture in `D:\Data\DEV\ultra_simple_panel` so future planning can reason about how sessions are supervised, exposed via HTTP, gated by authority, and how any "wait for output / replay / completion report" concept might fit. Read-only research; no code changes.

### Summary
The codebase has two parallel control planes: a unified `SessionSupervisor` + `SessionControlServer` (work-session tree) and a `MetaSession`-specific control plane with proposals and dispatch. The unified plane lives in `src/core/session-supervisor.ts` and `src/core/session-control-server.ts`, both already implemented and wired through `SessionEventBridge.configureServerApp()` in `src/main/index.ts`. Visibility is enforced by `SessionVisibilityService` (tree-local scope). There is no "wait-for-output" or "completion-report" endpoint today; replay is only terminal-scrollback text (`getTerminalReplay`), and turn-completion flows through `SessionPresenceSnapshot.phase === 'complete'` plus `TurnOutcome`.

### Key Findings

1. **`SessionSupervisor` is a thin authority-gating layer.** Pure logic, no HTTP. Defined at `src/core/session-supervisor.ts:37-121`. It depends only on a `getSnapshot()` callback, a `SessionVisibilityReader`, a `SessionInputLike.send()`, and `createChildSession`/`destroySession` callbacks (`src/core/session-supervisor.ts:19-25`). Caller identity is one of two variants: `{ type: 'local-user' }` or `{ type: 'session', sessionId }` (`src/core/session-supervisor.ts:4-7`). Errors are typed via `SessionControlError` with `code: 'unknown_session' | 'forbidden_authority_scope'` (`src/core/session-supervisor.ts:27-35`).

2. **Five supervisor actions cover the unified surface.** `listSessions`, `inspectSession`, `promptSession`, `createChildSession`, `destroySession` (`src/core/session-supervisor.ts:40-95`). All four mutating/visible actions funnel through `assertAuthority(viewerId, targetId, action)` (`src/core/session-supervisor.ts:97-105`) which delegates to `SessionVisibilityReader.checkAuthority()`.

3. **`SessionControlServer` wraps the supervisor as an Express app.** Lives at `src/core/session-control-server.ts:43-308`. Routes mount under `/ctl/...`:
   - `GET /ctl/health` (l.72)
   - `GET /ctl/whoami` (l.76)
   - `GET /ctl/capabilities` (l.85) — declares `sessionList/Inspect/Prompt/Create/Destroy`
   - `GET /ctl/session/list` (l.99)
   - `GET /ctl/session/:id/inspect` (l.105)
   - `POST /ctl/session/:id/prompt` (l.119) — calls `supervisor.promptSession()` and returns `{ kind: 'dispatched' }`
   - `POST /ctl/session/:id/destroy` (l.150)
   - `POST /ctl/session/create` (l.180)
   Listens on `127.0.0.1` random port (l.292), no remote exposure.

4. **Two caller-auth modes coexist via header sniffing.** `resolveCaller()` at `src/core/session-control-server.ts:22-41`:
   - `x-stoa-secret` matching `ctlSecret` → `local-user`
   - `x-stoa-session-id` + `x-stoa-session-token` matching the `sessionTokenRegistry` map → `session` (per-session token, no global session list lookup)
   - No match → 401 `invalid_secret`.

5. **Token registry is wired from `main/index.ts`.** `sessionTokenRegistry: Map<string, string>` is plumbed into `SessionControlServerDeps` (`src/core/session-control-server.ts:7-10`). Populated by `SessionEventBridge` via `registerSessionSecret(sessionId, secret)` (`src/main/session-event-bridge.ts:728-730`) which generates a per-session secret using `randomUUID()` (`src/main/session-event-bridge.ts:722-726`). The same secret is also used as `STOA_CTL_SESSION_TOKEN` injected into child PTY env via `session-command-env`.

6. **Visibility = tree-local descendant scope.** `SessionVisibilityService` (`src/core/session-visibility-service.ts:16-122`) treats a session as visible to its caller if (a) same root tree, AND (b) same-or-deeper depth, AND (c) same-depth OR descendant of viewer. Authority rules at l.53-91: `inspect`/`prompt` allowed if visible; `create` only allowed when `targetId === viewerId`; `destroy` allowed on self or descendants.

7. **Meta-session control plane is parallel and largely redundant.** `src/core/meta-session-control-server.ts` is a separate Express app exposing `/ctl/meta-sessions`, `/ctl/proposals`, `/ctl/dispatch/...`, `/ctl/work-sessions/:id/prompt` with proposal-based approval (`meta-session-control-server.ts:467-635`). Its caller auth is single-mode: `x-stoa-session-id` only checks `metaSessionSource.getSession()` exists (`meta-session-control-server.ts:83-96`). Spec calls for replacement with the unified `SessionSupervisor` (see `research/2026-05-29-unified-session-control-plane-seams.md`).

8. **Dispatch in the meta plane uses proposals for freeform prompts.** `MetaSessionCommandDispatcher.promptWorkSession()` at `src/core/meta-session-command-dispatcher.ts:106-124`: any non-empty freeform text returns `{ kind: 'approval_required', proposal }` (l.112-119). Send-keys bypass approval (l.96-104). `dispatchProposal()` (l.152-188) does staleness check via `lastStateSequence + turnEpoch + updatedAt` triple match (l.64-78).

9. **Main wires both servers into one Express app via `configureServerApp`.** `src/main/index.ts:710-772`:
   - Builds the unified `SessionControlServer` with deps that read from `listSessionNodeSnapshots()` (l.711-714), `buildSessionVisibilityService()` (l.715), an `activeSessionInputRouter` (l.717-720), and a custom `createChildSession` that calls `createWorkSessionWithRuntime` (l.721-752). It then mounts `app.use(sessionControlServer.app)` at l.763.
   - The legacy `legacyControlPlaneHooks` block (l.765-771) builds work-session lifecycle hooks but is `void`-ed out (l.771) — meta-session-control-server is no longer mounted in this code path. Only the unified server is active.

10. **The same Express port is the `stoa-ctl` control plane.** `SessionEventBridge.start()` (l.113-147) creates one `createLocalWebhookServer` instance; `configureServerApp` is passed through to it. The `webhookPort` (returned to main) is shared between the canonical-event webhook endpoints and `/ctl/*`. The port is published to `~/.stoa/ctl.json` by `writePortFile()` (`src/core/stoa-ctl-port-file.ts:21-26`) with `port`, `pid`, `secret`, `startedAt`.

11. **CLI surface is already unified.** `tools/stoa-ctl/index.ts:46-58` `USAGE_TEXT` lists `health / whoami / capabilities / session list / create / inspect / prompt / destroy` — no meta-session commands. `resolveCaller()` (l.76-99) reads `STOA_SESSION_ID` + `STOA_CTL_SESSION_TOKEN` for session identity, or port-file `secret` for local-user. CLI exits with code 3 on 401, 6 on `unknown_session`, 7 on other errors (l.110-124).

12. **No "wait for output" / "completion report" / "output replay" concept exists at the supervisor or control-server layer.**
    - The unified server returns a fire-and-forget `{ kind: 'dispatched' }` for `prompt` (l.124 of `session-control-server.ts`).
    - The only "replay" concept in the codebase is **terminal scrollback replay** exposed via `getTerminalReplay(sessionId)` (referenced in `src/shared/project-session.ts:369` `RendererApi.getTerminalReplay`, and consumed by `MetaSessionContextAssembler` at `src/core/meta-session-context-assembler.ts:107`). It is not exposed over `/ctl/*`.
    - The only "completion" concept is **`SessionPresenceSnapshot.phase === 'complete'`** with `lastTurnOutcome === 'completed'` (e.g. `src/shared/observability.ts:62-89`). Pushed via `observability-service.ts:115` and consumed by `MetaSessionContextAssembler` / `ObservabilityService` projections.
    - No endpoint returns "report of completion" (no aggregate-of-N-turns report). The `MetaSessionProposal.executionResult: string | null` (`src/shared/meta-session.ts:97`) is the closest thing to a single-dispatch completion report.

13. **Context assembler covers slim/full/bundle context, not "wait".** `MetaSessionContextAssembler` (`src/core/meta-session-context-assembler.ts`) exposes `getStatus`, `getEvents(sessionId, {limit, cursor, categories, includeEphemeral})`, `getBundle`, `getSlimContext`, `getFullContext` (l.51-154). These are all read-only queries; no blocking/polling primitive. The full context reads `getTerminalReplay()` and appends as a `Terminal:` section (l.107).

14. **Observation events are the canonical completion record.** `ObservabilityService.ingest()` (`src/core/observability-service.ts:91-113`) writes to `ObservationStore`; `SessionEventBridge.enqueueSessionEvent()` (l.153-195) emits a normalized `ObservationEvent` for every canonical event with category `presence` and type `presence.complete` for `agent.turn_completed` (l.771-772 of `session-event-bridge.ts`). Presence snapshots then derive from these observations and feed the supervisor-side `state/attention-queue` (in the meta plane; not the unified plane).

15. **The unified control plane does NOT expose any "state/attention-queue" route.** Searching `/ctl/state/...` only finds it in `meta-session-control-server.ts:231-290`. The unified server is purely session-tree CRUD + prompt. There is no `attention` or `wait` route in the unified plane.

16. **`SessionControlServer.start()` returns the port; lifecycle is per-instance.** `session-control-server.ts:286-307`: idempotent start (returns existing port), `stop()` resolves when `server.close` finishes. There is no graceful drain — in-flight requests are cut.

17. **Two state stores back the data: one for sessions, one for meta-sessions.** `ProjectSessionManager` (`src/core/project-session-manager.ts:269-977`) holds the `BootstrapState` snapshot (projects + sessions) and provides `getSessionNodeSnapshot` (l.352-362) and `buildBootstrapRecoveryPlan` (l.337-350). `MetaSessionManager` (`src/core/meta-session-manager.ts:63-243`) is a separate, JSON-persisted state for the legacy meta-session plane.

18. **Shared API surface for renderer is in `src/shared/project-session.ts`.** `RendererApi` (l.358-457) lists every IPC method. `SessionStatePatchEvent`, `SessionSummary`, `SessionNodeSnapshot`, `SessionGraphEvent` are the canonical session types. `SessionType = 'shell' | 'opencode' | 'codex' | 'claude-code'` (l.39). `SessionPhase = 'ready' | 'running' | 'blocked' | 'complete' | 'failure'` (l.43). All control-layer types flow through this shared module — no other shared module is used by both main and renderer for control surfaces.

19. **Per-session secret is the unification primitive.** `SessionEventBridge.issueSessionSecret()` (l.722-726) and `registerSessionSecret()` (l.728-730) write to `this.sessionSecrets: Map<string, string>`. The same map is exposed to the unified control server as `sessionTokenRegistry` (`src/core/session-control-server.ts:9`). The CLI reads it from `STOA_CTL_SESSION_TOKEN` env injected into child PTY (`src/core/session-command-env.ts`).

20. **`SessionEventBridge` orchestrates the event→state→observation→state-patch pipeline.** `enqueueSessionEvent` (l.153-195) is a per-session serialized queue (l.67 `sessionEventQueues`) that: (a) accepts/rejects codex events by intent, (b) attaches turn id, (c) persists evidence, (d) ingests observation, (e) calls `controller.applyProviderStatePatch`, (f) runs lifecycle (turn sealing → `TurnMaintenanceRunner`).

21. **Bootstrap recovery plan is per-session and resume-or-fresh.** `ProjectSessionManager.buildBootstrapRecoveryPlan()` (`src/core/project-session-manager.ts:337-350`): for `codex`/`opencode`/`claude-code`, emit `resume-external` with `externalSessionId`; for `shell`, emit `fresh-shell`. This is **not** part of the supervisor — it's a higher-level restart helper consumed by `launchSessionRuntimeWithGuard()` in main.

22. **Authority errors map to HTTP statuses deterministically.** `session-control-server.ts:125-148` maps `SessionControlError.code` → 404 (`unknown_session`) or 403 (`forbidden_authority_scope`); unknown → 500. `meta-session-control-server.ts:49-65` `getErrorStatus()` does the same for `MetaSessionDispatchError`: `unknown_session`/`unknown_proposal` → 404, `stale_proposal` → 409, `proposal_not_approved`/`proposal_invalid` → 400.

23. **There is no supervisor "subscribe to events" / "SSE" / "long-poll" route today.** Both `SessionControlServer` (l.43-308) and `MetaSessionControlServer` (l.156-669) only define request/response routes. Live updates flow through a different channel: `RendererApi.onSessionPresenceChanged`, `onSessionEvent`, `onSessionGraphEvent` (l.385-387, 376-377) — IPC pushes from main to renderer. The control plane is stateless and request-only.

24. **The unified `SessionControlServer` is being treated as the migration target.** `src/main/index.ts:711-762` already mounts it. `src/main/session-event-bridge.test.ts:374-392` builds a `MetaSessionControlServer` only in a test fixture for `configureServerApp`, suggesting the meta server is being kept around in test plumbing. Recent research `research/2026-05-29-unified-session-control-plane-seams.md` identifies 6 seams that still need replacing; this report can be read as the post-seam-2 (HTTP server) snapshot.

### Evidence Chain

| # | Claim | Source | Location |
|---|-------|--------|----------|
| 1 | `SessionSupervisor` is the unified authority-gating layer | `src/core/session-supervisor.ts` | l.37-121 |
| 2 | `SessionControlError` codes: `unknown_session`, `forbidden_authority_scope` | `src/core/session-supervisor.ts` | l.27-35 |
| 3 | Caller identity: `local-user` vs `session` | `src/core/session-supervisor.ts` | l.4-7 |
| 4 | Five supervisor actions | `src/core/session-supervisor.ts` | l.40-95 |
| 5 | Unified control server routes under `/ctl/*` | `src/core/session-control-server.ts` | l.72-282 |
| 6 | Two auth modes via headers + token registry | `src/core/session-control-server.ts` | l.22-41 |
| 7 | `x-stoa-secret`, `x-stoa-session-id`, `x-stoa-session-token` headers | `src/core/session-control-server.ts` | l.22-41, 52-70 |
| 8 | Listens on `127.0.0.1` random port | `src/core/session-control-server.ts` | l.292 |
| 9 | Visibility = tree-local descendant scope | `src/core/session-visibility-service.ts` | l.16-122 |
| 10 | `inspect`/`prompt` allowed when visible; `create` only on self | `src/core/session-visibility-service.ts` | l.53-91 |
| 11 | Meta-session control server: parallel plane | `src/core/meta-session-control-server.ts` | l.156-669 |
| 12 | Meta plane auth: `x-stoa-session-id` only | `src/core/meta-session-control-server.ts` | l.83-96, 164-176 |
| 13 | Meta plane routes: `/ctl/meta-sessions`, `/ctl/proposals`, `/ctl/dispatch/...` | `src/core/meta-session-control-server.ts` | l.467-635 |
| 14 | Freeform prompt requires proposal | `src/core/meta-session-command-dispatcher.ts` | l.106-124 |
| 15 | Send-keys bypasses approval | `src/core/meta-session-command-dispatcher.ts` | l.96-104 |
| 16 | Proposal staleness check by triple match | `src/core/meta-session-command-dispatcher.ts` | l.64-78 |
| 17 | Main wires both servers via `configureServerApp` | `src/main/index.ts` | l.710-772 |
| 18 | Unified server mounted via `app.use(sessionControlServer.app)` | `src/main/index.ts` | l.763 |
| 19 | Legacy `legacyControlPlaneHooks` is `void`-ed out (meta not mounted) | `src/main/index.ts` | l.765-771 |
| 20 | `SessionEventBridge` orchestrates event queue | `src/main/session-event-bridge.ts` | l.113-195 |
| 21 | `issueSessionSecret` / `registerSessionSecret` | `src/main/session-event-bridge.ts` | l.722-730 |
| 22 | `webhookPort` shared with control plane | `src/main/session-event-bridge.ts` | l.144-147 |
| 23 | Port file at `~/.stoa/ctl.json` | `src/core/stoa-ctl-port-file.ts` | l.13-26 |
| 24 | `getTerminalReplay` is renderer-only | `src/shared/project-session.ts` | l.369 |
| 25 | `getTerminalReplay` consumed in meta-context full text | `src/core/meta-session-context-assembler.ts` | l.107 |
| 26 | `SessionPresenceSnapshot.phase` includes `complete` | `src/shared/observability.ts` | l.62-89 |
| 27 | `agent.turn_completed` → `presence.complete` | `src/main/session-event-bridge.ts` | l.771-772 |
| 28 | Context assembler: status / events / slim / full / bundle | `src/core/meta-session-context-assembler.ts` | l.51-154 |
| 29 | CLI already unified: `session list/create/inspect/prompt/destroy` | `tools/stoa-ctl/index.ts` | l.46-58 |
| 30 | CLI caller resolution uses `STOA_SESSION_ID` + `STOA_CTL_SESSION_TOKEN` | `tools/stoa-ctl/index.ts` | l.76-99 |
| 31 | CLI exit codes: 3 (401), 6 (`unknown_session`), 7 (other) | `tools/stoa-ctl/index.ts` | l.110-124 |
| 32 | Project session state + `getSessionNodeSnapshot` | `src/core/project-session-manager.ts` | l.269-362 |
| 33 | Meta session state + persistence | `src/core/meta-session-manager.ts` | l.63-243 |
| 34 | `RendererApi` IPC surface | `src/shared/project-session.ts` | l.358-457 |
| 35 | `SessionType`, `SessionPhase`, `TurnOutcome` | `src/shared/project-session.ts` | l.39, 43, 46 |
| 36 | No SSE / long-poll in either control server | `src/core/session-control-server.ts`, `src/core/meta-session-control-server.ts` | entire files |
| 37 | No `/ctl/.../wait` or `/ctl/.../replay` route | `src/core/session-control-server.ts` | routes l.72-282 |
| 38 | Lifecycle hooks block in main, not in supervisor | `src/main/index.ts` | l.765-771 |
| 39 | `Proposal.executionResult` is the only "report" field | `src/shared/meta-session.ts` | l.97 |
| 40 | Recovery plan in `ProjectSessionManager`, not supervisor | `src/core/project-session-manager.ts` | l.337-350 |
| 41 | `presence` observations drive `SessionPresenceSnapshot` | `src/core/observability-service.ts` | l.91-157 |
| 42 | `SessionEventBridge` enqueues per session sequentially | `src/main/session-event-bridge.ts` | l.67, 153-195 |
| 43 | `stoa-ctl` shim lives at `tools/stoa-ctl/index.ts` | `tools/stoa-ctl/index.ts` | l.1 |
| 44 | Pre-existing migration spec | `research/2026-05-29-unified-session-control-plane-seams.md` | l.1-72 |
| 45 | Pre-existing design spec | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | referenced |
| 46 | `SessionEventBridge` test wires meta server only in fixture | `src/main/session-event-bridge.test.ts` | l.374-392 |

### Risks / Unknowns

- [!] **The unified server has no concept of waiting for completion.** A "wait-for-output" or "completion-report" feature is a net-new surface. It would have to land in `SessionControlServer` (preferred, since the meta plane is being deprecated per `research/2026-05-29-unified-session-control-plane-seams.md`) and would need: (a) a route under `/ctl/`, (b) a polling or SSE primitive, (c) hooks into `SessionEventBridge` / `ObservabilityService` to know when a turn completes.
- [!] **The unified plane's authority scope is tree-local.** Any new "wait" route must use the same `SessionVisibilityReader` to gate which caller can subscribe to which session's outputs, or it becomes a side-channel for one session to peek at another's outputs.
- [!] **No current "replay" surface over HTTP.** The only `getTerminalReplay` lives in `RendererApi` (l.369 of `project-session.ts`) and is consumed only by `MetaSessionContextAssembler`. Exposing it over `/ctl/` would require adding a new route and a backend function (likely on `ProjectSessionManager` or a sibling module). The data source itself (terminal scrollback) is implementation-defined and not documented here.
- [?] **The unified server is stateless / request-response.** It does not keep a long-lived connection. A wait/replay surface would need to choose: (a) long-poll with timeout, (b) SSE, (c) cursor-based polling similar to `ObservationEventListOptions` in the renderer API (l.325-330 of `project-session.ts`). The codebase has no precedent for (a) or (b).
- [?] **Visibility enforcement in the unified plane is anchored on a callback `getSnapshot()` that returns `SessionNodeSnapshot[]`.** Any new wait/replay endpoint must be sure the snapshot it uses for authority checks is the same one used for filtering — currently the supervisor uses `this.deps.getSnapshot()` once per call (`session-supervisor.ts:41, 50, 108`). A long-running request may race with the snapshot changing.
- [?] **`SessionPresenceSnapshot.phase` is derived from observation events, not from synchronous state.** A "wait for complete" implementation may need to subscribe to `SessionEventBridge` events rather than poll snapshots.
- [?] **The `legacyControlPlaneHooks` block in main is `void`-ed (l.771).** This suggests the meta-server wiring in production is incomplete or transitional. A new control-layer feature should not rely on anything in the meta plane.
- [?] **`SessionEventBridge` already exposes a per-session `Map` of secrets (`sessionSecrets`, l.65).** This is the de facto token registry. The unified server reads from a separate `sessionTokenRegistry` parameter; how the two stay in sync needs to be verified before adding a wait/replay route (the bridge would need to publish each new secret to that registry as sessions are launched).
- [?] **No precedent for "output" vs "replay" naming.** The codebase uses `getTerminalReplay` (renderer) and `context` (slim/full/bundle). If a new "wait" route is added, naming alignment with these conventions should be confirmed.

### Related Artifacts (for follow-up reads)

- Design spec: `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md`
- Migration seams report: `research/2026-05-29-unified-session-control-plane-seams.md`
- Auth model report: `research/2026-05-29-session-visibility-auth-model.md`
- Audit report: `research/2026-05-29-unified-session-control-plane-audit.md`
- Frontend topology: `research/2026-05-29-session-frontend-topology.md`
- Backend topology: `research/2026-05-29-session-backend-topology.md`
- Stoa ctl current architecture: `research/2026-05-29-stoa-ctl-current-architecture.md`

---

## Context Handoff: Control-Layer Architecture around SessionSupervisor, SessionControlServer, and Adjacent Concepts

Start here: `D:\Data\DEV\ultra_simple_panel\research\2026-06-02-control-layer-architecture.md`

Context only. Use the saved report as the source of truth.
