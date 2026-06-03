---
date: 2026-06-02
topic: completion-report, transcript, replay, event-log, parent-child linkage for sub-session completion report retrieval
status: completed
mode: context-gathering
sources: 27
---

## Context Report: Sub-Session Completion Report — Existing Concept Survey

### Why This Was Gathered

The team is planning to add "completion report retrieval" after a child/sub-session finishes. Before designing that feature we need to know:

- What completion / report / transcript / replay / event-log / parent-child concepts already exist in the codebase, in specs, and in research.
- Where the data flow would attach a new completion-report field.
- Which IPC channels, reducers, stores, and tests would need to change.
- What risks and unknown gaps the new feature must work around.

This is a **read-only** trace. No code or design decisions are committed.

### Summary

The Stoa codebase already has a **mature parent→child session hierarchy** with `parentSessionId` and `createdBySessionId` on `SessionSummary` ([src/shared/project-session.ts:125](/D:/Data/DEV/ultra_simple_panel/src/shared/project-session.ts:125)), an authoritative `SessionVisibilityService` ([src/core/session-visibility-service.ts](/D:/Data/DEV/ultra_simple_panel/src/core/session-visibility-service.ts)), and a turn-sealing/evidence pipeline that records per-event artifacts. It also has an `executionResult: string | null` field on `MetaSessionProposal` ([src/shared/meta-session.ts:97](/D:/Data/DEV/ultra_simple_panel/src/shared/meta-session.ts:97)) — but **no equivalent completion-report concept for ordinary (non-meta) sessions**.

The closest existing signal is the boolean `hasUnseenCompletion` flag flipped on `agent.turn_completed` ([src/shared/session-state-reducer.ts:158](/D:/Data/DEV/ultra_simple_panel/src/shared/session-state-reducer.ts:158)) and cleared on `agent.completion_seen` ([src/shared/session-state-reducer.ts:197](/D:/Data/DEV/ultra_simple_panel/src/shared/session-state-reducer.ts:197)). This is a UI badge, not a retrieval payload — there is **no structured per-child completion report** and no IPC channel for retrieving one. The state-event contract treats parent and child identically; cross-session correlation is enforced only by `externalSessionId` ([src/main/session-event-bridge.ts:268](/D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:268)).

The principal data-flow gap is at the **child-to-parent completion boundary**: the moment a child transitions to `complete`, the system only flips a boolean. A completion report retrieval feature would have to introduce: a payload field on the `SessionSummary` (or a sidecar store), an IPC channel for the parent to query it, and visibility/authority rules in `SessionVisibilityService.checkAuthority` to permit `inspect` of descendants.

### Key Findings

#### 1. Parent–child session linkage is real and authoritative

- `SessionSummary.parentSessionId` / `createdBySessionId` ([src/shared/project-session.ts:125-126](/D:/Data/DEV/ultra_simple_panel/src/shared/project-session.ts:125))
- Persisted to `parent_session_id` / `created_by_session_id` on `PersistedSession` ([src/shared/project-session.ts:168-169](/D:/Data/DEV/ultra_simple_panel/src/shared/project-session.ts:168))
- `CreateSessionRequest` accepts `parentSessionId`, `createdBySessionId` ([src/shared/project-session.ts:289-290](/D:/Data/DEV/ultra_simple_panel/src/shared/project-session.ts:289))
- Validation rules in `createSession` reject orphan/dangling/cross-project parents ([src/core/project-session-manager.ts:519-545](/D:/Data/DEV/ultra_simple_panel/src/core/project-session-manager.ts:519))
- `SessionNodeSnapshot` + `SessionTreeMeta` carry `rootSessionId`, `depth`, `childCount`, `descendantCount` ([src/shared/project-session.ts:305-315](/D:/Data/DEV/ultra_simple_panel/src/shared/project-session.ts:305))
- Renderer projection at `src/renderer/stores/workspaces.ts:19-92` groups children by parent and projects tree metadata.
- The unified-session-tree spec ([docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md](/D:/Data/DEV/ultra_simple_panel/docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:116-172)) explicitly states: `sub session` and `child session` are synonyms; `parentSessionId` is the single source of truth; main process is the unique authority supervisor.

#### 2. `SessionVisibilityService` already gates descendant access

- Actions enumerated: `inspect | prompt | create | destroy` ([src/core/session-visibility-service.ts:3](/D:/Data/DEV/ultra_simple_panel/src/core/session-visibility-service.ts:3))
- `checkAuthority` for `create` / `destroy` permits only self or descendants of viewer ([src/core/session-visibility-service.ts:74-90](/D:/Data/DEV/ultra_simple_panel/src/core/session-visibility-service.ts:74))
- `inspect` and `prompt` are allowed for any visible session, with `visible` = same-root peers at depth ≥ viewer depth, or descendants ([src/core/session-visibility-service.ts:23-46](/D:/Data/DEV/ultra_simple_panel/src/core/session-visibility-service.ts:23))
- `visibleSessionIds(viewerId)` is the canonical "what can this session see" answer — already exposed via `SessionVisibilityReader` interface ([src/core/session-visibility-service.ts:10-14](/D:/Data/DEV/ultra_simple_panel/src/core/session-visibility-service.ts:10)).

**Implication for the feature**: retrieving a child completion report from a parent maps directly to `checkAuthority(parentId, childId, 'inspect')`. The authority layer is ready; what is missing is the payload.

#### 3. No completion-report data structure exists for non-meta sessions

- Searched for `completionReport`, `CompletionReport`, `completion_report`, `completionSummary`, `subagentReport`, `childCompletion` — **no hits anywhere in `src/`**.
- The only structured "result" field in the session tree is `MetaSessionProposal.executionResult: string | null` ([src/shared/meta-session.ts:97](/D:/Data/DEV/ultra_simple_panel/src/shared/meta-session.ts:97)), and that is meta-session orchestration, not per-turn completion.
- The runtime controller's exit signal is `markRuntimeExited(sessionId, exitCode, summary)` — summary is a free-form string passed in ([src/core/session-runtime-controller.ts:51-53](/D:/Data/DEV/ultra_simple_panel/src/core/session-runtime-controller.ts:51), [src/core/project-session-manager.ts:419-426](/D:/Data/DEV/ultra_simple_panel/src/core/project-session-manager.ts:419)). It is *not* a structured completion report; it is the human-readable exit message that lands in `SessionSummary.summary` and the `runtime.exited_clean` / `runtime.exited_failed` patches.
- `hasUnseenCompletion` is a pure boolean, flipped once at `agent.turn_completed` ([src/shared/session-state-reducer.ts:158](/D:/Data/DEV/ultra_simple_panel/src/shared/session-state-reducer.ts:158)), cleared on `agent.completion_seen` ([src/shared/session-state-reducer.ts:197](/D:/Data/DEV/ultra_simple_panel/src/shared/session-state-reducer.ts:197)). It carries no payload.

#### 4. Transcript and replay primitives exist but are not parent-child aware

- `TranscriptSnapshotArtifact` ([src/core/memory/transcript-snapshot.ts:5-10](/D:/Data/DEV/ultra_simple_panel/src/core/memory/transcript-snapshot.ts:5)): snapshots either the provider's native transcript (Claude JSONL, Codex JSONL, OpenCode SQLite via context exporter) or a structured `turn-slice.json` fallback ([src/core/memory/transcript-snapshot.ts:25-47](/D:/Data/DEV/ultra_simple_panel/src/core/memory/transcript-snapshot.ts:25)).
- `SessionEvidenceStore` writes per-event evidence at `<projectPath>/.stoa/memory/evidence/<sessionId>/<eventId>/` with metadata + content snapshot ([src/core/memory/session-evidence-store.ts:1-373](/D:/Data/DEV/ultra_simple_panel/src/core/memory/session-evidence-store.ts)).
- Sealed turn records live in `RuntimeStateStore` at `<projectRoot>/.stoa/memory/runtime-state.json` and contain `evidenceIds[]` per turn ([src/core/memory/runtime-state-store.ts](/D:/Data/DEV/ultra_simple_panel/src/core/memory/runtime-state-store.ts)). Sealing is triggered by Stop hook events via `sealTurn()` in `session-event-bridge.ts:525-631`.
- Terminal replay buffer is in-memory only, in `session-runtime-controller.ts:129-131` (`terminalBacklogs`), exposed via `IPC_CHANNELS.sessionTerminalReplay` ([src/core/ipc-channels.ts:8](/D:/Data/DEV/ultra_simple_panel/src/core/ipc-channels.ts:8)).
- `ObservationStore` ([src/core/observation-store.ts](/D:/Data/DEV/ultra_simple_panel/src/core/observation-store.ts)) is an in-memory append-only event log with `lifecycle | presence | evidence | activity | system` categories; events have a `scope: 'session' | 'project' | 'app'` but no parent/child field.
- `SessionContextExporter` ([src/core/context/session-context-exporter.ts](/D:/Data/DEV/ultra_simple_panel/src/core/context/session-context-exporter.ts)) builds full-text or slim-text exports from provider sources; the IPC channels `context:export-full-text` / `context:export-slim-text` ([src/core/ipc-channels.ts:52-53](/D:/Data/DEV/ultra_simple_panel/src/core/ipc-channels.ts:52)) are the closest existing precedent for "retrieve a session's content as a single payload" — and they operate per-session, with no tree awareness.

**Gap**: none of these systems know about `parentSessionId`. A completion report is currently scattered across (a) sealed turn evidence, (b) the final `turn-slice.json` or provider transcript, (c) the `runtime.exited_*` patch's free-form summary, and (d) the `lastTurnOutcome` enum. There is no aggregation step.

#### 5. IPC surface — what is and is not exposed

Present in `IPC_CHANNELS` ([src/core/ipc-channels.ts:1-86](/D:/Data/DEV/ultra_simple_panel/src/core/ipc-channels.ts:1)):

- `session:create` ([src/core/ipc-channels.ts:6](/D:/Data/DEV/ultra_simple_panel/src/core/ipc-channels.ts:6)) — accepts `parentSessionId` already.
- `session:graph-event` ([src/core/ipc-channels.ts:19](/D:/Data/DEV/ultra_simple_panel/src/core/ipc-channels.ts:19)) — main pushes `SessionGraphEvent` with `kind: 'created' | 'updated' | 'archived' | 'restored' | 'destroyed'` ([src/shared/project-session.ts:317-323](/D:/Data/DEV/ultra_simple_panel/src/shared/project-session.ts:317)). No `kind: 'completed'` variant; the `updated` path silently flips `hasUnseenCompletion` via the reducer.
- `session:terminal-replay` ([src/core/ipc-channels.ts:8](/D:/Data/DEV/ultra_simple_panel/src/core/ipc-channels.ts:8)) — the existing "give me the contents of a session" channel pattern.
- `observability:list-session-events` ([src/core/ipc-channels.ts:24](/D:/Data/DEV/ultra_simple_panel/src/core/ipc-channels.ts:24)) — paginated observation events per session.
- `evidence:list-session-snapshots` ([src/core/ipc-channels.ts:51](/D:/Data/DEV/ultra_simple_panel/src/core/ipc-channels.ts:51)) — evidence store list per session.
- `context:export-full-text` / `context:export-slim-text` ([src/core/ipc-channels.ts:52-53](/D:/Data/DEV/ultra_simple_panel/src/core/ipc-channels.ts:52)) — already export per-session content, but produce formatted text, not a structured report.

**Missing**: there is no `session:get-completion-report` or `session:list-child-completions` channel.

#### 6. The reducer is the authoritative completion boundary

- `reduceSessionState` handles `agent.turn_completed` ([src/shared/session-state-reducer.ts:146-159](/D:/Data/DEV/ultra_simple_panel/src/shared/session-state-reducer.ts:146)) by setting `lastTurnOutcome='completed'` and `hasUnseenCompletion=true`. It is the only place in the code that produces the "completed" signal.
- The same reducer also resets `hasUnseenCompletion=false` on `agent.turn_started` ([src/shared/session-state-reducer.ts:215](/D:/Data/DEV/ultra_simple_panel/src/shared/session-state-reducer.ts:215)), `turn_interrupted` ([src/shared/session-state-reducer.ts:169](/D:/Data/DEV/ultra_simple_panel/src/shared/session-state-reducer.ts:169)), `turn_cancelled` ([src/shared/session-state-reducer.ts:180](/D:/Data/DEV/ultra_simple_panel/src/shared/session-state-reducer.ts:180)), `turn_failed` ([src/shared/session-state-reducer.ts:194](/D:/Data/DEV/ultra_simple_panel/src/shared/session-state-reducer.ts:194)), and `completion_seen` ([src/shared/session-state-reducer.ts:197](/D:/Data/DEV/ultra_simple_panel/src/shared/session-state-reducer.ts:197)).
- The presence-phase reducer reads `hasUnseenCompletion && lastTurnOutcome === 'completed'` to derive `complete` phase ([src/shared/session-state-reducer.ts:43,54](/D:/Data/DEV/ultra_simple_panel/src/shared/session-state-reducer.ts:43)).

**Implication**: any completion report is sealed at the `agent.turn_completed` event, not at runtime exit. A child session can be `complete` while still `alive` (waiting for next prompt) or `exited` (provider gone). The feature must decide which boundary defines "completion" for report purposes — almost certainly `agent.turn_completed`, because that is what the codebase already calls completion.

#### 7. Cross-session correlation risk already documented

The 2026-05-16 codex subagent payload research ([research/2026-05-16-codex-hook-subagent-payload-and-session-state.md](/D:/Data/DEV/ultra_simple_panel/research/2026-05-16-codex-hook-subagent-payload-and-session-state.md)) identified that:

- Codex hook payloads expose `session_id` and `turn_id` but no explicit root/subagent field.
- Provider `session_id` is the only stable discriminator between root and subagent.
- Stoa's bridge does not currently enforce provider-session identity before reducing events into a Stoa session.
- The same `session_id` value (or absent `externalSessionId`) is the root cause of "subagent `Stop` reduced as main session completion" symptom.

**Implication for the feature**: any parent reading a child completion report is relying on the child having the correct `externalSessionId` bound and the right `agent.turn_completed` event reduced into the right Stoa session. The completion-report feature will inherit the same correlation risk that already produces bug-filed work.

#### 8. Visibility rules and the CLI control plane

- The spec at [docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:128-136](/D:/Data/DEV/ultra_simple_panel/docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:128) states: "User visibility != session visibility". A parent UI session can see its descendants, but a sub-session running in stoa-ctl can only see same-depth peers and its own descendants.
- A completion-report retrieval IPC must respect this distinction. From a parent UI session's perspective, the children are visible; from a sibling sub-session's perspective, they are not.

#### 9. Renderer projection has the tree but no completion aggregator

- `SessionTreeProjection` in `src/renderer/stores/workspaces.ts:19-29` carries `treeChildCount` and `treeDescendantCount` — pure counts, not completion states.
- No existing computed property in the Pinia store aggregates "which of my children are complete" or "give me the completion report of this child". The store would need a new selector and a new IPC consumer.

#### 10. Test pipeline must gate the new feature

Per the project's quality gate ([CLAUDE.md](/D:/Data/DEV/ultra_simple_panel/CLAUDE.md) and `docs/engineering/`):

- New IPC channel → requires round-trip test in `tests/e2e/ipc-bridge.test.ts` AND registration guard in `tests/e2e/main-config-guard.test.ts`.
- New `SessionSummary` field → requires fixture updates in `src/shared/test-fixtures.ts` and unit tests in `src/shared/project-session.test.ts`, `src/shared/session-state-reducer.test.ts`, `src/shared/observability-projection.test.ts`.
- New behavior asset (parent reading child completion) → requires assets in `testing/behavior/`, `testing/topology/`, `testing/journeys/`, then `npm run test:generate` must run.
- All four tiers of `npx vitest run` plus `npm run test:e2e` plus `npm run test:behavior-coverage` must pass.

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| `SessionSummary` carries parent/creator linkage | `src/shared/project-session.ts` | [125-126](/D:/Data/DEV/ultra_simple_panel/src/shared/project-session.ts:125) |
| `hasUnseenCompletion` boolean on `SessionSummary` | `src/shared/project-session.ts` | [134](/D:/Data/DEV/ultra_simple_panel/src/shared/project-session.ts:134) |
| `SessionGraphEvent` kind set has no `completed` | `src/shared/project-session.ts` | [317-323](/D:/Data/DEV/ultra_simple_panel/src/shared/project-session.ts:317) |
| `CreateSessionRequest` accepts `parentSessionId`, `createdBySessionId` | `src/shared/project-session.ts` | [285-294](/D:/Data/DEV/ultra_simple_panel/src/shared/project-session.ts:285) |
| `SessionVisibilityService` authority model | `src/core/session-visibility-service.ts` | [3, 23-46, 53-91](/D:/Data/DEV/ultra_simple_panel/src/core/session-visibility-service.ts:3) |
| Parent/child validation rules | `src/core/project-session-manager.ts` | [519-545](/D:/Data/DEV/ultra_simple_panel/src/core/project-session-manager.ts:519) |
| `markRuntimeExited` carries only exitCode + free-form summary | `src/core/project-session-manager.ts` | [419-426](/D:/Data/DEV/ultra_simple_panel/src/core/project-session-manager.ts:419) |
| `markCompletionSeen` reducer path | `src/core/project-session-manager.ts` | [434-436](/D:/Data/DEV/ultra_simple_panel/src/core/project-session-manager.ts:434) |
| Reducer flips `hasUnseenCompletion=true` on `agent.turn_completed` | `src/shared/session-state-reducer.ts` | [146-159](/D:/Data/DEV/ultra_simple_panel/src/shared/session-state-reducer.ts:146) |
| Reducer resets on `agent.completion_seen` | `src/shared/session-state-reducer.ts` | [196-198](/D:/Data/DEV/ultra_simple_panel/src/shared/session-state-reducer.ts:196) |
| Presence phase `complete` depends on the boolean | `src/shared/session-state-reducer.ts` | [43, 54](/D:/Data/DEV/ultra_simple_panel/src/shared/session-state-reducer.ts:43) |
| Transcript snapshot kinds (provider-transcript / turn-slice) | `src/core/memory/transcript-snapshot.ts` | [5-47](/D:/Data/DEV/ultra_simple_panel/src/core/memory/transcript-snapshot.ts:5) |
| Evidence storage layout | `src/core/memory/session-evidence-store.ts` | (full file) |
| Sealed turn records and runtime state | `src/core/memory/runtime-state-store.ts` | (full file) |
| Turn sealing in event bridge | `src/main/session-event-bridge.ts` | [525-631](/D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:525) |
| In-memory terminal backlog | `src/main/session-runtime-controller.ts` | [129-131](/D:/Data/DEV/ultra_simple_panel/src/main/session-runtime-controller.ts:129) |
| Observation event store | `src/core/observation-store.ts` | (full file) |
| Session context exporter | `src/core/context/session-context-exporter.ts` | (full file) |
| IPC channels inventory | `src/core/ipc-channels.ts` | [1-86](/D:/Data/DEV/ultra_simple_panel/src/core/ipc-channels.ts:1) |
| `session:terminal-replay` channel exists | `src/core/ipc-channels.ts` | [8](/D:/Data/DEV/ultra_simple_panel/src/core/ipc-channels.ts:8) |
| `evidence:list-session-snapshots` channel exists | `src/core/ipc-channels.ts` | [51](/D:/Data/DEV/ultra_simple_panel/src/core/ipc-channels.ts:51) |
| `context:export-*` channels exist (precedent for per-session retrieval) | `src/core/ipc-channels.ts` | [52-53](/D:/Data/DEV/ultra_simple_panel/src/core/ipc-channels.ts:52) |
| `MetaSessionProposal.executionResult` (only existing "result" field, meta-only) | `src/shared/meta-session.ts` | [97](/D:/Data/DEV/ultra_simple_panel/src/shared/meta-session.ts:97) |
| Renderer tree projection | `src/renderer/stores/workspaces.ts` | [19-92](/D:/Data/DEV/ultra_simple_panel/src/renderer/stores/workspaces.ts:19) |
| Unified session tree spec (parent↔child authority, visibility) | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | [116-172](/D:/Data/DEV/ultra_simple_panel/docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:116) |
| Codex subagent correlation risk (provider `session_id` is the only discriminator) | `research/2026-05-16-codex-hook-subagent-payload-and-session-state.md` | [1-83](/D:/Data/DEV/ultra_simple_panel/research/2026-05-16-codex-hook-subagent-payload-and-session-state.md) |
| Stoa-ctl sub-session precedence history (sub-session ≠ child session semantics in earlier docs) | `research/2026-05-12-ashare-research-subsession-review.md` | [1-55](/D:/Data/DEV/ultra_simple_panel/research/2026-05-12-ashare-research-subsession-review.md) |

### Missing Data Flow (where the feature must connect)

1. **Sealing trigger**: `agent.turn_completed` reducer path → no payload is captured today. The reducer would need to (a) snapshot the latest `turn-slice` evidence, (b) snapshot the latest `lastTurnOutcome` patch payload, (c) snapshot the latest terminal backlog tail, and (d) write a completion report atomically with the existing `hasUnseenCompletion=true` flip.

2. **Storage target**: not present. Options: (a) a new column/file alongside `RuntimeState` at `<project>/.stoa/memory/runtime-state.json` keyed by `stoaSessionId`+`turnId`, (b) a new file under the evidence tree `<project>/.stoa/memory/evidence/<sessionId>/completions/<turnId>.json`, or (c) a column on `PersistedSession`. Option (b) is most consistent with existing evidence-store conventions; option (a) is cheapest.

3. **Read path**: parent → IPC channel `session:get-completion-report` (new) → main process handler that (a) loads `SessionNodeSnapshot` for `parentId`, (b) calls `SessionVisibilityService.checkAuthority(parentId, childId, 'inspect')`, (c) reads the sealed report. Must be added to `IPC_CHANNELS` in `src/core/ipc-channels.ts` and to `tests/e2e/main-config-guard.test.ts` registration guard.

4. **Projection**: renderer's Pinia store at `src/renderer/stores/workspaces.ts` needs a new computed `childCompletionReports(parentId)` that consumes the new IPC. The store currently projects tree counts but no per-child status payload.

5. **State machine interaction**: `markCompletionSeen` ([src/core/project-session-manager.ts:434](/D:/Data/DEV/ultra_simple_panel/src/core/project-session-manager.ts:434)) must not destroy the report. Today it only clears the boolean — the report (if stored) survives, but the contract must explicitly state retention: keep until the session is archived or its next `turn_completed` overwrites.

6. **Cross-session correlation**: the 2026-05-16 research flags the existing codex event-binding gap. The completion report must store the `externalSessionId` it was sealed against, so a parent can later verify "this report was sealed by the same Codex provider session that this Stoa session is bound to" and reject the report on identity mismatch.

### Major Risks

- [!] **No payload exists at the completion boundary.** The reducer currently only flips `hasUnseenCompletion`. There is no schema for what a completion report contains. This is a brand-new data structure and the design team must decide fields (e.g. `turnId`, `outcome`, `summary`, `lastAssistantMessage`, `transcriptPath`, `evidenceIds[]`, `sealedAt`, `parentSessionId`).
- [!] **Cross-session correlation is unsolved.** The 2026-05-16 research already documents that subagent events can be reduced into the wrong Stoa session. If a child is silently mis-bound, its completion report will be silently wrong. The feature must inherit or precede the fix for `externalSessionId` enforcement.
- [!] **No IPC channel or contract exists for parent→child content retrieval.** Even a minimal "get the last sealed turn" requires a new channel, a new handler, and a new round-trip test plus a new static-analysis guard.
- [!] **Visibility/authority must be re-checked at retrieval time.** A report stored on a child is a child-owned artifact. The retrieval IPC must call `SessionVisibilityService.checkAuthority(parentId, childId, 'inspect')` and not assume that "I'm the parent" is sufficient — the spec explicitly says "user visibility != session visibility".
- [!] **Reducer ordering.** `hasUnseenCompletion` is reset on every `turn_started` and on every terminal failure. If the report is sealed in the reducer itself, it must be sealed *before* the reset path; if sealed in `markRuntimeExited` or `sealTurn`, the timing is already correct. Either way, the seal must be idempotent and must not race with `agent.completion_seen`.
- [!] **Persistence semantics.** The codebase forbids compatibility shims ("不允许写任何兼容性代码, 做任何兼容性迁移行为. 我们处于原型开发阶段.所有改进做breaking change."). The feature should ship as a clean addition — but adding a new field to `SessionSummary` and a new IPC channel is itself a breaking change for any external consumer of those types.
- [?] **Scope of "completion".** Today there are two completion-shaped events: `agent.turn_completed` (turn boundary) and `runtime.exited_*` (provider process boundary). For subagent work, the meaningful event is the provider's `Stop` hook, which reduces to `turn_completed`. The design team must confirm this is the right boundary; otherwise the report may be sealed at the wrong moment.
- [?] **What goes in the report for failed/interrupted/cancelled turns.** The current `hasUnseenCompletion` is `false` for those outcomes. A report retrieval feature that wants to surface "child failed because X" may need to seal reports for those branches too — or, equivalently, return a structured `null` plus a reason.

### Unknowns

- [?] Is the parent the *only* retrieval target, or should siblings in the same tree (per the unified-tree spec, peers at same depth) also be allowed to read completion reports? The spec implies same-depth peers are visible but not authoritative.
- [?] Does the completion report need to be human-readable formatted text (like the context exporter) or a structured JSON object (like a sealed turn record)? Existing precedent is split.
- [?] Should the report be a per-turn artifact (one per `turn_completed`) or a per-session artifact (one per session, overwritten on each completion)?
- [?] For children that did not produce a provider transcript (e.g. early exit, no Stop hook), is there any recoverable report at all? The `turn-slice.json` fallback exists but may be missing.
- [?] How long should reports be retained? The `hasUnseenCompletion` boolean is cleared on `agent.completion_seen` and on next `turn_started`. If the report is the *content* behind that boolean, the retention policy must be explicit.

## Context Handoff: Sub-Session Completion Report

Start here: `D:/Data/DEV/ultra_simple_panel/research/2026-06-02-subsession-completion-report-context.md`

Context only. Use the saved report as the source of truth. Implementation agents should:

1. Read this report before designing the completion-report data structure.
2. Re-use `SessionVisibilityService.checkAuthority(parentId, childId, 'inspect')` for retrieval authorization.
3. Re-use the `sealTurn()` / evidence-store conventions for storage.
4. Coordinate with the open Codex `externalSessionId` correlation work tracked in `research/2026-05-16-codex-hook-subagent-payload-and-session-state.md` before claiming the feature is safe end-to-end.
5. Add new IPC channels to `tests/e2e/main-config-guard.test.ts` and round-trip tests in `tests/e2e/ipc-bridge.test.ts` as required by the project's quality gate.
