---
date: 2026-06-11
topic: stoa-ctl subagent control state machine and visibility audit
status: completed
mode: context-gathering
sources: 22
---

# Context Report: stoa-ctl Subagent Control State Machine and Visibility Audit

## Why This Was Gathered

Review the live `SubagentSupervisor`, `SessionControlServer`, `SessionSupervisor`, `SessionVisibilityService`, and the shared subagent facade types, with their corresponding unit tests. Focus on stale-snapshot races, destroyed/closed semantics, session-liveness races, visibility-authority inconsistencies, and test coverage gaps that hide real server/API bugs. The goal is to surface Critical/Important issues with file:line citations so the next design or implementation pass can prioritize them.

## Summary

The subagent facade state machine has the right high-level shape (epoch guard on result, terminal fallback, host destroyed short-circuit, source priority destroyed > current-epoch explicit > current-epoch terminal), and the shared types match the 2026-06-10 design spec. The HTTP envelope, error code mapping, and CLI client surface are largely aligned with the spec as well.

There are several real issues hiding under the surface, however. The most important are: (1) the visibility/authority model is silently bypassed for `local-user` callers in the `SubagentSupervisor` target resolution and body-read paths while `SessionSupervisor` only skips visibility for local-user on the "list" route — the asymmetry hides cross-tree reads; (2) `subagent stop --mode destroy` does not consult `visibilityService.checkAuthority` for `local-user`, and the `SessionSupervisor` `destroy` route does, so the same intent has two implementations; (3) the visibility `checkAuthority` "input" branch returns `allowed: true` for any visible target, so a same-depth peer can call `subagent input` on another peer via the `subagent input` route — the spec/2026-05-29 matrix says `prompt/input` is allowed on same-depth peers but `subagentInput` is a subagent-only action; (4) the `wait` polling loop only waits on the first pending target's state change and ignores the rest, so a long-lived sibling child is starved; (5) `dispatch` has a write-after-read window: `allocateShortName` and `createChildSession` are not atomic, so two concurrent dispatches can both pass the name-uniqueness check and collide on the persisted facade state; (6) the dispatch cleanup on epoch-update failure does not happen — only `updateSessionFacade` and `sessionInput.send` failures trigger `destroySession`, so a successful `send` followed by a hidden persistence race leaves an orphan child with an incremented epoch but possibly no facade; (7) the `input` route does not use the same authority check that `SessionSupervisor.inputSession` uses — `subagent input` accepts any visible target, and the resolved target's caller is not re-validated against the `subagentInput` action when caller is `local-user`; (8) the `result` flow re-reads the snapshot with a window where the parent can change between request dispatch and snapshot read; (9) the `stop` aggregate uses `overallStatus === 'complete'` even if no targets were successfully destroyed but no errors, and tests do not exercise the zero-target-success case; (10) tests do not cover visibility-isolation for cross-tree subagent lookup, archived-subagent wait behavior at pending-facade boundary, or subagentInput authority for same-depth peers.

## Key Findings

### Critical

#### C1. `local-user` bypasses `subagentInput` authority entirely

`SubagentSupervisor.input` (subagent-supervisor.ts:635-685) only calls `checkAuthority` when `caller.type === 'session'`. For `local-user` the function only verifies that the target is a child session (via `resolveTarget`). But `subagent input` is a subagent-only action, and the unified session tree matrix (2026-05-29 spec) defines `subagentInput` as a restricted action — root and peer should not be able to push input into a subagent. `local-user` should still go through the authority check, or at minimum the spec must explicitly endorse a `local-user` bypass for input. Today the code allows `local-user` to push input to ANY visible subagent in the tree, including a deep grandchild of an unrelated sibling subtree, as long as it is in the global node list.

Source: `src/core/subagent-supervisor.ts:651-661` — only the `caller.type === 'session'` branch performs `checkAuthority(..., 'subagentInput')`.

#### C2. `subagent stop --mode destroy` does not check authority for `local-user` callers

`SubagentSupervisor.stop` (subagent-supervisor.ts:759-873) gates `subagentInterrupt`/`subagentDestroy` authority only when `caller.type === 'session'`. For `local-user` the only check is `resolveTarget`. This is inconsistent with `SessionSupervisor.destroySession` (session-supervisor.ts:118-124), which calls `assertAuthority(caller.sessionId, targetId, 'destroy')` only for `session` callers too — but for `destroy` the asymmetry is more defensible because local-user is the operator. For subagent `destroy` the spec defines `subagentDestroy` as a distinct restricted action that is supposed to be more constrained than `destroy` (limited to self/ancestor, no peer). Today a `local-user` caller can `subagent stop --mode destroy` on any subagent anywhere in the global snapshot, even one outside the operator's project. The route at `session-control-server.ts:565-599` accepts this without any project/visibility scoping for local-user.

Source: `src/core/subagent-supervisor.ts:772-792`.

#### C3. Same-depth peer `subagentInput` is allowed by `visibilityService.checkAuthority` for any visible target

`SessionVisibilityService.checkAuthority` (session-visibility-service.ts:72-84) lumps `subagentInput` together with `inspect`/`status`/`prompt`/`input` and returns `allowed: true` for any visible target. Same-depth peers are in each other's visibility scope (session-visibility-service.ts:36-47), so a peer A1 can call `subagent input ryu` even though ryu is a child of A2 — A1 is at the same depth as ryu and `r u` is visible to A1, and the `subagentInput` branch returns true. The unified session tree matrix in the 2026-05-29 design allows `prompt/input` on same-depth peers, but `subagentInput` is conceptually a stronger action: it bypasses the parent's child-orchestration channel and pushes raw text directly into a subagent that another peer may be coordinating.

Source: `src/core/session-visibility-service.ts:72-84`; tests `src/core/session-visibility-service.test.ts:146-153` only cover `prompt` on descendant/peer, not `subagentInput`.

#### C4. `wait` polling loop only wakes on the first pending target

`SubagentSupervisor.wait` (subagent-supervisor.ts:484-586) uses `pendingTargets[0].node.session.id` to call `waitForSessionStateChange`. If the caller passes multiple pending targets (e.g. `wait ryu mai andy` and ryu finishes first but mai/andy are still running), the loop only wakes when ryu changes state. mai/andy have to be re-checked on the next iteration of the inner loop, but the wakeup cadence is bounded by ryu's state changes. If ryu is the slowest, mai/andy will be polled only when ryu changes, so a quick result on mai can be delayed by ryu's idle period (up to 250ms per slice). In the worst case where ryu is genuinely stuck but mai completes, the loop returns `pending` for both until timeout. This is a real starvation race in multi-target `subagent wait`.

Source: `src/core/subagent-supervisor.ts:576-585`.

### Important

#### I1. `dispatch` name allocation is not atomic against concurrent dispatches

`allocateShortName` (subagent-supervisor.ts:90-133) reads `getSnapshot()` and checks the set of used names. Then `createChildSession` and `updateSessionFacade` happen in separate awaits. If two dispatches run concurrently (e.g. local-user script + a peer parent), both can pass the uniqueness check, both create child sessions, and both attempt to `updateSessionFacade` with the same name. The facade mutation has no uniqueness constraint at the persistence layer (visible in `subagent-supervisor.ts:286-301`, where `updateSessionFacade` is just `Object.assign`). The post-create cleanup path is also not symmetric: if `createChildSession` succeeds but `updateSessionFacade` fails, the child is destroyed (subagent-supervisor.ts:298-301); but the second concurrent dispatch cannot detect that the first one is about to win the name race.

Source: `src/core/subagent-supervisor.ts:266-301`.

#### I2. `dispatch` epoch update after successful `sessionInput.send` is not cleaned up on persistence failure

`SubagentSupervisor.dispatch` (subagent-supervisor.ts:303-327): if `sessionInput.send` succeeds but the subsequent `updateSessionFacade({ subagentInputEpoch: 1, subagentLatestInputAt: now })` throws, the code logs nothing and just keeps the original `childSession`. The child session has already been activated via `send`, but its facade state is at epoch 0 with no `subagentLatestInputAt`. Future `subagent wait` will see `inputEpoch === 0` and fall into the "terminal after input" branch (subagent-supervisor.ts:441-444), which can incorrectly classify the session as terminal-after-input even when it is actively running. The cleanup is missing in this branch.

Source: `src/core/subagent-supervisor.ts:312-327`.

#### I3. `result` and `dispatch` re-read snapshot with stale-authority window

`SubagentSupervisor.result` (subagent-supervisor.ts:716-755) reads `getSnapshot()` once and trusts `callerNode.session.parentSessionId` from that snapshot. Between the snapshot read and the `updateSessionFacade` call, the parent can be reparented (unlikely, but the design does not forbid reparent), the session can be archived, or the token registry can be invalidated. The HTTP route has no re-check. This is consistent with other paths, so it is a systemic race rather than a per-bug, but tests do not exercise it.

Source: `src/core/subagent-supervisor.ts:716-755`; tests `src/core/session-control-server.test.ts:913-933` only cover the happy path with a single static snapshot.

#### I4. `subagent stop` `overallStatus = 'complete'` for zero-target success is ambiguous

`SubagentSupervisor.stop` (subagent-supervisor.ts:860-869) sets `overallStatus = 'complete'` when `errorCount === 0`, including the case where all targets fail to resolve. With an empty target list the route rejects with 400 (session-control-server.ts:570-577), so this is not reachable from HTTP. But the supervisor itself can be called directly with `targets: []` and will return `{ overallStatus: 'complete', targets: [] }`. Tests `session-control-server.test.ts:866-887` only cover the single-target happy path.

Source: `src/core/subagent-supervisor.ts:860-869`.

#### I5. Visibility `checkAuthority` is not re-validated inside `subagent input` for local-user

`SubagentSupervisor.input` (subagent-supervisor.ts:635-685) uses `resolveTarget` which already calls `visibleSessionIds` for session callers. For `local-user` it does not. The function then directly mutates facade state and dispatches input. The spec section on full-body read authority says local-user can read full bodies but does not explicitly bless local-user for subagent input. Today local-user can send input to a subagent in any project if it is in the global snapshot. The same path is not used by the design (the 2026-06-10 design spec line 663-665 implies `subagent input` is used by parents, not operators), so the surface is broader than the design intended.

Source: `src/core/subagent-supervisor.ts:651-661`.

#### I6. `subagentDispatch` body `text` is not trimmed; empty-after-trim is not rejected

`session-control-server.ts:427` reads `text = req.body?.text` and passes it through to `subagentSupervisor.dispatch`. The supervisor at `subagent-supervisor.ts:228-233` rejects blank text, so a string of spaces does fail. But a string of `\r\n` is also not blank (it has non-whitespace chars depending on locale). More importantly, the CLI `parseInputSource` at `tools/stoa-ctl/index.ts:176-178` trims content and rejects whitespace-only before sending, so the server-side guard is the only line of defense. Tests cover `' '` rejection but not multi-character whitespace unicode.

Source: `src/core/subagent-supervisor.ts:228-233`; tests `session-control-server.test.ts:783-792`.

#### I7. `subagent wait` condition for `mode === 'any'` uses `completedCount > completedNow` instead of "any newly completed"

`SubagentSupervisor.wait` (subagent-supervisor.ts:573-574) uses:
```
const completedNow = results.filter(r => r.state === 'completed').length
if (mode === 'any' && completedNow > completedCount) break
```
This counts all completed entries, including error entries? No — `state: 'error'` is filtered out, only `state === 'completed'` counts. So `completedNow` is the number of completed results so far. The check `completedNow > completedCount` is correct for "any new completion". But `pendingTargets` is iterated in target order, and the inner `continue` re-enters the loop without re-snapshotting when a target is destroyed. Once all targets are destroyed/terminal, the inner `allResolved` check is bypassed because each branch does `continue` after pushing to `results` and updating `pending.node`. The condition `allResolved = true` is never set in those branches, so the loop continues until the deadline even when all targets are already terminal. This wastes CPU and can cause premature timeout in tests with short timeouts.

Source: `src/core/subagent-supervisor.ts:485-571`.

#### I8. `SessionSupervisor.toStatusSnapshot.phase` uses `derivePresencePhase` but tests do not cover `hasUnseenCompletion` transitions

`SessionSupervisor.toStatusSnapshot` (session-supervisor.ts:217-242) reports `hasCompletionReport` based on the synchronous terminal-outcome check, but the `phase` is derived from `derivePresencePhase` which is a separate reducer. If the reducer and `toCompletionReport` disagree (e.g. the reducer considers the session "running" but the report check returns a report), the API will return `phase: 'running'` and `hasCompletionReport: true` simultaneously. This is by design in some cases (running + unseen completion), but the route at `session-control-server.ts:196-209` does not surface the discrepancy, and tests do not assert the combined shape. The behavioral contract of "phase == complete iff hasCompletionReport" is implicit but not enforced.

Source: `src/core/session-supervisor.ts:217-242`; tests `session-supervisor.test.ts:300-342`.

#### I9. `errorCodeToHttpStatus` maps `no_completion_yet` to 409 but `subagent result` returns 403 with no specific code mapping in route

`session-control-server.ts:601-646` handles `subagent result` and the route's catch block delegates to `errorCodeToHttpStatus`. The function maps `subagent_result_forbidden` to 403. The supervisor's `result` method (subagent-supervisor.ts:711-727) throws `subagent_result_forbidden` for local-user and root sessions. The route accepts that. But there is no test covering a session caller that is not a child (e.g. a peer calling as session). The peer case is not in the test matrix. The supervisor logic at subagent-supervisor.ts:722-727 checks `callerNode.session.parentSessionId` — a peer with `parentSessionId === null` would be rejected as root, but two peers (both with `parentSessionId === 'root'`) would not be rejected; the test does not cover this.

Source: `src/core/subagent-supervisor.ts:716-727`; tests `session-control-server.test.ts:890-945`.

#### I10. HTTP body parsing for `parentId`/externalSessionId whitespace trim is inconsistent

`session-control-server.ts:305-313`:
```
const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId.trim() : ''
```
`session-control-server.ts:309-313`:
```
const externalSessionId = typeof req.body?.externalSessionId === 'string' ? req.body.externalSessionId.trim() : req.body?.externalSessionId === null ? null : undefined
```
But `session-control-server.ts:531-535` for subagent input reads `target = req.body?.target.trim()` and never trims `text`. The `text` field is sent verbatim to `sessionInput.send`. The same applies to `subagent dispatch` and `subagent result`. This is fine for the server contract, but the CLI strips text via `parseInputSource`, while a malicious or buggy client could pass text with control characters. The server should at minimum reject control characters in text before passing to `send`. Today there is no validation.

Source: `src/core/session-control-server.ts:531-535`, `:425-477`, `:601-646`.

#### I11. `subagent list` filters out archived subagents but does not expose archived state in the projection

`SubagentSupervisor.list` (subagent-supervisor.ts:877-892) filters `!n.session.archived`, so an archived subagent disappears from the list. The CLI's `subagent list` test (tools/stoa-ctl/index.test.ts:776-817) covers the empty list case. But the spec (2026-06-10 design) says archived subagents are tombstoned, not deleted. Users may want to see archived subagents with a phase indicator. The omission is intentional given the spec, but the user-visible behavior is that an archived subagent cannot be referenced by short name (because it's not in the list) nor by formal ID (because the supervisor's `resolveTarget` does not check `archived`). The behavior is: `subagent input ryu` where ryu is archived returns `unknown_subagent` because `list` filtered it, but the `getSnapshot` still has it. Today this is consistent, but it is a footgun for clients that cache short names.

Source: `src/core/subagent-supervisor.ts:877-892`; tests `session-supervisor.test.ts` do not cover the archived visibility case.

#### I12. `subagent result` does not validate caller is the target's own session

`SubagentSupervisor.result` (subagent-supervisor.ts:716-755) checks `callerNode.session.parentSessionId` exists (i.e. caller is a child) but does not verify the `updateSessionFacade` is writing to the caller's own session. The facade update writes to `callerNode.session.id` (subagent-supervisor.ts:748-751), which is the caller. The check is correct, but the `resolveTarget`-like path is bypassed. The spec says the result is always for self, and the code matches. Tests `session-control-server.test.ts:913-933` cover happy path. But the case where `callerNode` is found and is a child but the snapshot returns a different session for the same id (concurrent dispatch race) is not tested. The race window is sub-millisecond and unlikely but unhandled.

Source: `src/core/subagent-supervisor.ts:716-755`.

#### I13. `interrupt` and `destroy` modes can be called on an already-terminal subagent

`SubagentSupervisor.stop` (subagent-supervisor.ts:759-873) does not check `isTerminalSession` or `archived` before calling `interruptSession`/`destroySession`. The supervisor assumes the runtime's `interruptSession` returns false for an already-exited session. Tests cover only the happy path. If `interruptSession` on an already-exited session returns true (some runtimes do), the facade state could be mutated incorrectly. There is no facade mutation on interrupt (subagent-supervisor.ts:823-831) so this is safe, but `destroy` always calls `destroySession` which may be a no-op or may throw. The HTTP route at session-control-server.ts:565-599 maps throws to 500/internal_error. Today the code does not check `terminal/archived` pre-conditions.

Source: `src/core/subagent-supervisor.ts:794-843`.

#### I14. `subagent result` does not record `subagentLatestInputAt` and silently allows self-result even if input was never delivered

`SubagentSupervisor.result` (subagent-supervisor.ts:689-755) does not check whether `subagentInputEpoch > 0` or whether `subagentLatestInputAt` exists. A child that is created via `session create` (not `subagent dispatch`) and never received input can still submit a result. The spec (2026-06-10) defines `subagentInputEpoch` as "internal-only, must not be exposed as a `<subagent>` target, task ID, or dispatch ID", but does not restrict `result` to dispatched subagents. The code is consistent with the spec, but the behavior is that a manually-created child session can be a "subagent" for result purposes, including the case where it was created by a different process. This is a design choice and not a bug, but tests do not assert the restriction.

Source: `src/core/subagent-supervisor.ts:689-755`; tests `session-control-server.test.ts:913-933`.

### Test coverage gaps

#### T1. No unit tests for `SubagentSupervisor` directly

`src/core/subagent-supervisor.ts` is a new module with significant state-machine logic (epoch guard, terminal fallback, dispatch atomicity, wait polling), but no `src/core/subagent-supervisor.test.ts` exists. All tests for subagent behavior go through `session-control-server.test.ts`, which uses a permissive `visibilityService` mock and a static `getSnapshot`. As a result, the following are untested at the unit level:
- `allocateShortName` uniqueness and pool exhaustion (subagent-supervisor.ts:90-133)
- `canReadFullBody` semantics (subagent-supervisor.ts:197-220)
- `dispatch` failure cleanup (subagent-supervisor.ts:286-310)
- `wait` polling loop behavior with concurrent state changes (subagent-supervisor.ts:484-586)
- `result` epoch matching (subagent-supervisor.ts:716-755)
- `stop` mode dispatch and aggregate status (subagent-supervisor.ts:759-873)
- `list` archived filtering (subagent-supervisor.ts:877-892)

The "dispatch failure cleanup" test in `session-control-server.test.ts` is missing the case where `updateSessionFacade` throws after `createChildSession` succeeds. The "wait polling" behavior is not tested at all.

#### T2. No tests for visibility/authority cross-tree isolation in subagent routes

`session-control-server.test.ts:746-887` covers subagent list/dispatch/wait/input/stop/result. The `visibilityService` mock is permissive (`checkAuthority: () => ({ allowed: true })`) for most of these. There is no test that exercises `subagent input` from a same-depth peer against another peer's child, and there is no test that exercises `subagent stop` from a peer against an unrelated peer's child. The asymmetry between local-user and session-caller authority is not asserted.

#### T3. No tests for archived subagent lifecycle in wait

`subagentSupervisor.wait` handles `session.archived` at subagent-supervisor.ts:390-403 and :499-513. There is no test that:
- dispatches a subagent
- archives it before wait
- expects a `destroyed` result with `source: 'host'`

This path is reachable in real usage (a parent can archive its own children), and the state machine should be exercised.

#### T4. No tests for epoch guard across `subagent input`

`SubagentSupervisor.input` increments the epoch and clears `subagentResult` (subagent-supervisor.ts:670-678). The `wait` phase checks `inputEpoch` and the result's `inputEpoch` (subagent-supervisor.ts:423, :518). There is no end-to-end test that:
- dispatches a subagent
- subagent submits a result
- parent sends `subagent input` to it
- parent calls `subagent wait` and expects the previous result to be stale, then sees a new result after the child responds again

This is the central promise of the epoch guard, and it is untested.

#### T5. No tests for `interrupt_unsupported` flow

`session-control-server.ts` maps `interrupt_unsupported` to 501 (session-control-server.ts:84-85). `SubagentSupervisor.stop` throws this code when `interruptSession` returns false or is not provided (subagent-supervisor.ts:794-822). There is no test that:
- provides a `interruptSession` mock that returns false
- calls `subagent stop --mode interrupt`
- expects 501 and an `interrupt_unsupported` error per target

#### T6. No tests for `subagent result` status validation in route

`session-control-server.test.ts:935-944` covers `interrupted` as an invalid status, but does not test `unknown`, `pending`, or empty string. The CLI rejects more statuses (tools/stoa-ctl/index.ts:761-764), but the server-side validation list is a duplicate source of truth that is undertested.

#### T7. No tests for `subagent wait` mode `any` exit code

`tools/stoa-ctl/index.test.ts:1082-1102` covers `stop` exit code logic, but `wait` exit code is only tested for the `conditionMet` path (tools/stoa-ctl/index.test.ts:961-998). The CLI returns `aggregate.conditionMet ? 0 : 7`. The `conditionMet` for `mode: 'any'` is `completedTargets.length > 0`. If one of three targets completes and the others are still pending, the CLI returns 0 even though the user may have expected all three. The contract is per the spec, but the test does not assert it for the `any` mode.

#### T8. No tests for `subagent result` epoch mismatch rejection

`SubagentSupervisor.result` does not reject a result whose epoch is not the current `subagentInputEpoch`. The 2026-06-10 design spec (line 545-567) defines the stale-epoch guard as part of `wait`, not `result`. The result method writes whatever the child sends. The child must self-coordinate to send at the correct epoch. There is no test that asserts the result is silently accepted with any epoch.

Source: `src/core/subagent-supervisor.ts:716-755`.

## Evidence Chain

| Finding | Source | Location |
|---|---|---|
| Subagent supervisor module | `src/core/subagent-supervisor.ts` | lines 1-915 |
| `allocateShortName` non-atomic read-then-write | `src/core/subagent-supervisor.ts` | lines 90-133 |
| `dispatch` flow with name/child/facade/input sequence | `src/core/subagent-supervisor.ts` | lines 224-332 |
| `dispatch` epoch-update not cleaned up on failure | `src/core/subagent-supervisor.ts` | lines 312-327 |
| `wait` polling loop wakes on first pending only | `src/core/subagent-supervisor.ts` | lines 484-586 |
| `wait` `mode === 'any'` break check | `src/core/subagent-supervisor.ts` | lines 573-574 |
| `input` skips `checkAuthority` for `local-user` | `src/core/subagent-supervisor.ts` | lines 651-661 |
| `result` epoch write, no rejection | `src/core/subagent-supervisor.ts` | lines 716-755 |
| `stop` skips `checkAuthority` for `local-user` | `src/core/subagent-supervisor.ts` | lines 772-792 |
| `stop` does not pre-check `archived` or terminal | `src/core/subagent-supervisor.ts` | lines 794-843 |
| `list` filters `!archived` | `src/core/subagent-supervisor.ts` | lines 877-892 |
| `SessionVisibilityService.checkAuthority` `subagentInput` lumped with read-only | `src/core/session-visibility-service.ts` | lines 72-84 |
| `SessionVisibilityService.checkAuthority` `submitOwnResult` always false | `src/core/session-visibility-service.ts` | lines 86-88 |
| `SessionVisibilityService` visible scope includes same-depth peers | `src/core/session-visibility-service.ts` | lines 36-47 |
| `SessionSupervisor` toStatusSnapshot vs derivePresencePhase | `src/core/session-supervisor.ts` | lines 217-242 |
| `SessionSupervisor` waitForSession uses bounded waiter | `src/core/session-supervisor.ts` | lines 276-306 |
| `errorCodeToHttpStatus` mapping | `src/core/session-control-server.ts` | lines 65-89 |
| HTTP `subagent result` route | `src/core/session-control-server.ts` | lines 601-646 |
| HTTP `subagent stop` route | `src/core/session-control-server.ts` | lines 565-599 |
| HTTP `subagent input` route (text not trimmed/validated) | `src/core/session-control-server.ts` | lines 531-563 |
| HTTP `subagent dispatch` route | `src/core/session-control-server.ts` | lines 425-477 |
| HTTP `subagent list` route | `src/core/session-control-server.ts` | lines 411-423 |
| HTTP `session/destroy` route | `src/core/session-control-server.ts` | lines 288-301 |
| Subagent types in shared module | `src/shared/project-session.ts` | lines 378-533 |
| `SubagentResult` epoch field | `src/shared/project-session.ts` | lines 380-389 |
| `SubagentWaitAggregate` shape | `src/shared/project-session.ts` | lines 435-442 |
| `SubagentCommandErrorCode` | `src/shared/project-session.ts` | lines 511-518 |
| `SessionCommandErrorEnvelope` | `src/shared/project-session.ts` | lines 520-532 |
| Visibility tests (no subagentInput coverage) | `src/core/session-visibility-service.test.ts` | lines 134-245 |
| Subagent HTTP integration tests | `src/core/session-control-server.test.ts` | lines 746-945 |
| Subagent CLI tests | `tools/stoa-ctl/index.test.ts` | lines 774-1140 |
| Bootstrap prompt: root vs child subagent text | `src/core/session-bootstrap-prompt-service.ts` | lines 31-114 |
| Bootstrap prompt: child teaches `subagent result` | `src/core/session-bootstrap-prompt-service.ts` | lines 64-140 |
| Bootstrap prompt: visibility rule teaching | `src/core/session-bootstrap-prompt-service.ts` | lines 12-15, 73-76 |
| CLI `subagent list` empty message | `tools/stoa-ctl/index.ts` | lines 613-627 |
| CLI `subagent stop` exit code 0 iff `overallStatus === 'complete'` | `tools/stoa-ctl/index.ts` | line 757 |
| CLI `subagent wait` exit code 0 iff `conditionMet` | `tools/stoa-ctl/index.ts` | line 712 |
| Gap analysis reference | `research/2026-06-09-stoactl-subagent-control-gap-analysis.md` | lines 1-120 |
| Subagent reference summary | `research/2026-06-10-stoactl-subagent-control-reference-summary.md` | lines 1-398 |
| 2026-05-29 unified session tree design spec | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 1-1219 (cited indirectly) |
| 2026-06-10 subagent control design spec | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 1-1306 (cited indirectly) |

## Risks / Unknowns

- [!] **C1+C2+C3 authority asymmetry** — the same intent (input, destroy) has two implementations across `SessionSupervisor` and `SubagentSupervisor`. The inconsistency will be discovered by clients that use one path for some sessions and the other for subagents. The fix is to make `SubagentSupervisor.input` and `SubagentSupervisor.stop` route through a shared authority check for `local-user` callers (e.g. always go through `checkAuthority` with the corresponding action, but special-case local-user to allow only on subagents in the operator's project or on the root tree).
- [!] **C4 wait polling starvation** — multi-target `subagent wait` with mode `all` may delay detection of one target's completion by the slowest target's state-change cadence. The fix is to call `waitForSessionStateChange` for each pending target, or use a fan-in notification channel.
- [!] **I1 dispatch name race** — concurrent dispatches can collide. The fix is to use a synchronous uniqueness guard at the facade persistence layer, or to make `allocateShortName` consult a lock manager. This is hard to fix in pure JS without a transactional store.
- [!] **I2 dispatch epoch cleanup gap** — partial failure leaves an inconsistent child. The fix is to wrap the whole `send + epoch-update` in a single try and destroy on any error.
- [?] **I3 snapshot staleness** — systemic race that affects many paths. The design does not promise atomicity, but the epoch guard partially mitigates it.
- [?] **I4 stop zero-targets edge case** — only reachable from direct supervisor calls, not HTTP. The CLI rejects empty targets. Low risk in practice.
- [?] **I5 local-user authority** — depends on whether the design intends local-user to be a super-caller. The 2026-06-10 spec is silent. Clarification needed.
- [?] **I11 archived list filter** — design choice; tests should pin the behavior. Low risk if pinned.
- [?] **I14 non-dispatched child can submit result** — design choice; tests should pin the behavior.

## Context Handoff

Start here: `research/2026-06-11-stoa-ctl-subagent-control-state-machine-audit.md`

Context only. Use the saved report as the source of truth. The next design/implementation pass should prioritize C1, C2, C3, C4, I1, and I2; the rest are lower priority but should be pinned by tests before any breaking change.
