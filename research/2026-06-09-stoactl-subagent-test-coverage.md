---
date: 2026-06-09
topic: stoa-ctl session control and subagent test coverage
status: completed
mode: context-gathering
sources: 34
---

## Context Report: stoa-ctl Subagent Test Coverage

### Why This Was Gathered

This report maps existing tests, behavior assets, generated journeys, and static guards for `stoa-ctl`, session control, and subagent/subsession behavior. The goal is to identify which expected capabilities are already covered and which remain missing or weakly specified.

### Summary

The direct session-control stack has meaningful unit and HTTP coverage for child creation, single-session wait/report/output, prompt delivery, destroy, and terminal completion reports. Coverage is weaker at the product-contract layer: behavior assets and generated Playwright mainly cover `stoa-ctl` lifecycle toggling/env stripping and session presence, not the full subagent protocol. There is no explicit `stoa-ctl` command surface for wait-many, stop/interrupt, child-to-parent push notification, or meta-session proposal/dispatch routes.

### Capability Matrix

| Capability | Current coverage | Assessment |
|---|---|---|
| Create/dispatch child session | `SessionSupervisor.createChildSession` tests cover local root creation, session-caller rewrite to direct child, delegation, forbidden authority, and unknown caller. `/ctl/session/create` HTTP tests cover local root, direct child, and newly added session caller authorization. | Covered for direct child creation. Dispatch as "create then prompt" is documented in bootstrap text but not represented as a single high-level behavior/journey. |
| Wait one or many | `waitForSession` tests cover already-terminal, later completion, bounded polling, timeout, and completion report. Runtime controller wakes multiple waiters for the same session. `/ctl/session/:id/wait` HTTP tests cover success, timeout, invalid timeout, and unknown target. | Covered for waiting one target and for multiple waiters on one target. Missing a first-class wait-many capability for multiple child sessions. |
| Append prompt/input | `/ctl/session/:id/prompt` tests cover dispatch and authority failures. `SessionSupervisor.promptSession` appends carriage return. IPC bridge/static guards cover renderer `sessionInput` and `sessionBinaryInput`; meta-session dispatcher tests cover low-level send-keys. | Covered across direct session prompt/input. `stoa-ctl` only exposes text prompt, not raw/binary input or send-keys. |
| Stop/interrupt/destroy | Destroy is covered in supervisor and HTTP tests. Interruption is covered through `Ctrl+C` input routing and session telemetry/hook handling. Claude Stop hooks are covered as provider lifecycle events. | Destroy is covered. Stop/interrupt are covered as input/hook semantics, but not as explicit `stoa-ctl session stop` or `session interrupt` commands. |
| Child completion reports | Supervisor and HTTP tests cover completed, failed, and `no_completion_yet` completion reports. Shared types model report and wait results. | Covered for pull-based terminal reports. |
| Proposal/option escalation | Meta-session dispatcher/control-server tests cover approval-required proposals, stale rejection, proposal creation, send-keys, preset dispatch, and proposal dispatch. Behavior assets cover pending approval visibility. | Covered in meta-session HTTP/dispatcher layer. Weakly specified for generated journeys and absent from `stoa-ctl` CLI command surface. Not specifically tested as child-session escalation. |
| Child-to-parent notification | Bootstrap protocol explicitly says parents must pull `wait`, `report`, or `output` and must not assume pushed callbacks. Existing push coverage is session graph/title/memory notification, not child-to-parent completion notification. | Intentionally absent as a push callback, but weakly specified as a negative test. No explicit child-to-parent notification test. |

### Key Findings

- The `stoa-ctl` CLI command surface is limited to health/whoami/capabilities and `session {list,create,inspect,status,output,wait,report,prompt,destroy}`. Its usage text does not expose meta-session, proposal, dispatch, send-keys, stop, interrupt, or wait-many commands. This is also asserted by the CLI usage test, which checks that `meta-sessions`, `proposals`, and `dispatch preset` are absent.
- Direct child creation is implemented as direct-child semantics for session callers: the supervisor rewrites session-caller creation requests to use the caller session as `parentId`, while local-user callers may create roots or specify a parent.
- Wait is a single target pull interface: `/ctl/session/:id/wait` returns a wait result for one target, and `stoa-ctl session wait <sessionId>` only accepts one session id plus optional seconds timeout.
- "Many" wait coverage currently means multiple waiters for the same session state change, not one command waiting for many child sessions.
- Prompt dispatch is covered by HTTP tests and supervisor tests; the supervisor sends `${text}\r`. Raw interrupt input is modeled separately through `SessionInputRouter`, where `Ctrl+C` is forwarded and reports interruption for agent sessions.
- Destroy is a direct control-plane operation, but the main-process implementation archives/tears down work-session runtime rather than exposing a distinct stop primitive.
- Completion reports are pull-based. Shared types define `SessionCompletionReport` and `SessionWaitResult`, while bootstrap instructions tell parent sessions to recover child output via `wait`, `report`, or `output`, not a pushed callback.
- Proposal/option escalation exists in the meta-session control plane, not the current `stoa-ctl` CLI. Freeform work-session prompt injection returns `approval_required`; proposals can be created/approved/rejected/dispatched, and presets can be dispatched.
- Behavior assets and generated Playwright provide strong coverage for `stoa-ctl` enable/disable lifecycle and env stripping, but they do not cover direct child create/wait/report/prompt/destroy flows.
- Session telemetry generated journeys cover ready/running/blocked/complete/failure and interruption-like presence transitions, but not child-session orchestration semantics.
- The generator explicitly removes the meta-session generated Playwright spec, so proposal escalation lacks generated Playwright journey coverage in the current output set.
- Static guards cover Electron sandbox config, `sessionRestart`, send-only `sessionInput`/`sessionBinaryInput`, session graph event, and memory notification channel wiring. They do not guard `stoa-ctl` HTTP routes or wait/report/destroy/prompt routes.

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| `stoa-ctl` usage exposes only session list/create/inspect/status/output/wait/report/prompt/destroy. | `tools/stoa-ctl/index.ts` | `tools/stoa-ctl/index.ts:46` |
| CLI usage test asserts unified session commands and absence of meta-session/proposal/dispatch command names. | `tools/stoa-ctl/index.test.ts` | `tools/stoa-ctl/index.test.ts:30` |
| CLI `session wait` accepts one session id and maps `--timeout <seconds>` to `timeoutMs`. | `tools/stoa-ctl/index.ts` | `tools/stoa-ctl/index.ts:371` |
| CLI `session report`, `prompt`, and `destroy` map to completion-report, prompt, and destroy endpoints. | `tools/stoa-ctl/index.ts` | `tools/stoa-ctl/index.ts:391`, `tools/stoa-ctl/index.ts:405`, `tools/stoa-ctl/index.ts:423` |
| `/ctl/session/:id/wait` is a single-session HTTP endpoint that calls `supervisor.waitForSession`. | `src/core/session-control-server.ts` | `src/core/session-control-server.ts:255` |
| `/ctl/session/:id/destroy` is a direct HTTP endpoint. | `src/core/session-control-server.ts` | `src/core/session-control-server.ts:335` |
| `/ctl/session/create` is the HTTP child/root creation endpoint. | `src/core/session-control-server.ts` | `src/core/session-control-server.ts:365` |
| Supervisor prompt sends text with a trailing carriage return. | `src/core/session-supervisor.ts` | `src/core/session-supervisor.ts:82` |
| Supervisor child creation rewrites session callers to create direct children of themselves. | `src/core/session-supervisor.ts` | `src/core/session-supervisor.ts:91` |
| Supervisor destroy enforces authority for session callers. | `src/core/session-supervisor.ts` | `src/core/session-supervisor.ts:106` |
| Child creation tests cover local-user root create, direct child rewrite, local-user delegation, forbidden authority, and unknown caller. | `src/core/session-supervisor.test.ts` | `src/core/session-supervisor.test.ts:196` |
| Destroy tests cover local-user delegation, unknown target, forbidden peer destroy, and allowed descendant destroy. | `src/core/session-supervisor.test.ts` | `src/core/session-supervisor.test.ts:267` |
| Wait tests cover already-terminal result, later completion, bounded polling, and timeout. | `src/core/session-supervisor.test.ts` | `src/core/session-supervisor.test.ts:344` |
| Completion report tests cover no completion, completed already seen, and failed sessions. | `src/core/session-supervisor.test.ts` | `src/core/session-supervisor.test.ts:468` |
| HTTP completion-report tests cover completed report, `no_completion_yet`, and forbidden authority. | `src/core/session-control-server.test.ts` | `src/core/session-control-server.test.ts:313` |
| HTTP wait tests cover success, timeout, invalid timeout, and missing target. | `src/core/session-control-server.test.ts` | `src/core/session-control-server.test.ts:363` |
| HTTP prompt tests cover dispatch and authority errors. | `src/core/session-control-server.test.ts` | `src/core/session-control-server.test.ts:416` |
| HTTP destroy tests cover destroy and forbidden authority. | `src/core/session-control-server.test.ts` | `src/core/session-control-server.test.ts:457` |
| HTTP create tests cover root create, direct child create, and newly added session caller authorization. | `src/core/session-control-server.test.ts` | `src/core/session-control-server.test.ts:483` |
| Runtime wait state-change tests cover updated, timeout, and waking all waiters for the same session. | `src/main/session-runtime-controller.test.ts` | `src/main/session-runtime-controller.test.ts:395`, `src/main/session-runtime-controller.test.ts:422` |
| `Ctrl+C` is recognized as interrupt input for agent sessions. | `src/main/session-input-router.ts` | `src/main/session-input-router.ts:29`, `src/main/session-input-router.ts:93` |
| Input-router test verifies `Ctrl+C` writes through and reports interruption. | `src/main/session-input-router.test.ts` | `src/main/session-input-router.test.ts:117` |
| Session-event bridge tests cover memory notifications. | `src/main/session-event-bridge.test.ts` | `src/main/session-event-bridge.test.ts:1163` |
| Session-event bridge tests cover canonical interruption events as ready presence evidence. | `src/main/session-event-bridge.test.ts` | `src/main/session-event-bridge.test.ts:1284` |
| Session-event bridge tests cover Claude Stop reducing blocked state to completion. | `src/main/session-event-bridge.test.ts` | `src/main/session-event-bridge.test.ts:1585` |
| Runtime E2E covers a Claude Stop hook without an open turn and verifies it does not fabricate completion. | `tests/e2e/webhook-runtime-integration.test.ts` | `tests/e2e/webhook-runtime-integration.test.ts:516` |
| Meta-session dispatcher tests cover approval-required proposal creation for freeform prompt injection. | `src/core/meta-session-command-dispatcher.test.ts` | `src/core/meta-session-command-dispatcher.test.ts:43` |
| Meta-session dispatcher tests cover low-level send-keys dispatch without approval. | `src/core/meta-session-command-dispatcher.test.ts` | `src/core/meta-session-command-dispatcher.test.ts:220` |
| Meta-session control server exposes work-session prompt/send-keys routes. | `src/core/meta-session-control-server.ts` | `src/core/meta-session-control-server.ts:423`, `src/core/meta-session-control-server.ts:446` |
| Meta-session control server exposes proposal creation/approval routes. | `src/core/meta-session-control-server.ts` | `src/core/meta-session-control-server.ts:548`, `src/core/meta-session-control-server.ts:582` |
| Meta-session control-server test covers attention queue, proposal creation, send-keys, and preset dispatch routes. | `src/core/meta-session-control-server.test.ts` | `src/core/meta-session-control-server.test.ts:785` |
| Shared types define completion report and wait result shapes. | `src/shared/project-session.ts` | `src/shared/project-session.ts:338`, `src/shared/project-session.ts:354` |
| Bootstrap prompt documents the subsession protocol: create does not start work, prompt dispatch is not completion, wait/report/output are pull recovery, and no pushed callback should be assumed. | `src/core/session-bootstrap-prompt-service.ts` | `src/core/session-bootstrap-prompt-service.ts:24` |
| Main destroy implementation archives the work session with runtime teardown. | `src/main/index.ts` | `src/main/index.ts:807` |
| Main session creation pushes session graph events. | `src/main/index.ts` | `src/main/index.ts:999` |
| `stoa-ctl` behavior assets cover disable cleanup, 503 disabled response, and env stripping on spawn. | `testing/behavior/stoactl-lifecycle.ts` | `testing/behavior/stoactl-lifecycle.ts:47`, `testing/behavior/stoactl-lifecycle.ts:86` |
| `stoa-ctl` journeys cover disable cleanup and env stripping. | `testing/journeys/stoactl-lifecycle.journey.ts` | `testing/journeys/stoactl-lifecycle.journey.ts:3`, `testing/journeys/stoactl-lifecycle.journey.ts:23` |
| Generated `stoa-ctl` Playwright spec covers lifecycle disable behavior and 503 response, not session orchestration. | `tests/generated/playwright/stoactl-lifecycle.generated.spec.ts` | `tests/generated/playwright/stoactl-lifecycle.generated.spec.ts:12` |
| Generator removes the meta-session generated Playwright file. | `testing/generators/write-generated-playwright.ts` | `testing/generators/write-generated-playwright.ts:35` |
| Session behavior assets cover restore and memory notification, not child-to-parent orchestration. | `testing/behavior/session.behavior.ts` | `testing/behavior/session.behavior.ts:25`, `testing/behavior/session.behavior.ts:92` |
| Session telemetry journeys cover provider lifecycle and interrupt presence. | `testing/journeys/session-telemetry.journey.ts` | `testing/journeys/session-telemetry.journey.ts:3`, `testing/journeys/session-telemetry.journey.ts:43`, `testing/journeys/session-telemetry.journey.ts:73` |
| Generated session telemetry Playwright covers presence states and Stop completion. | `tests/generated/playwright/session-telemetry-claude-lifecycle.generated.spec.ts` | `tests/generated/playwright/session-telemetry-claude-lifecycle.generated.spec.ts:16`, `tests/generated/playwright/session-telemetry-claude-lifecycle.generated.spec.ts:146` |
| Meta-session behavior asset covers context reading and approval-gated prompt visibility. | `testing/behavior/meta-session.behavior.ts` | `testing/behavior/meta-session.behavior.ts:3` |
| Static guards cover sandbox, `sessionInput`, `sessionBinaryInput`, `sessionRestart`, session graph event, and memory notification wiring. | `tests/e2e/main-config-guard.test.ts` | `tests/e2e/main-config-guard.test.ts:138`, `tests/e2e/main-config-guard.test.ts:271`, `tests/e2e/main-config-guard.test.ts:324`, `tests/e2e/main-config-guard.test.ts:594`, `tests/e2e/main-config-guard.test.ts:599` |

### Missing Or Weakly Specified Areas

- **No first-class wait-many**: tests prove one session wait and multiple waiters for one session, but not a single API/CLI operation waiting for many children.
- **No explicit stop/interrupt CLI/API**: destroy exists, and `Ctrl+C`/provider Stop are tested, but there is no `stoa-ctl session stop` or `session interrupt` command to guard.
- **No child-to-parent push notification contract**: current design appears pull-based by instruction. A negative contract could make this explicit by testing that parent recovery uses `wait/report/output` and not pushed child callbacks.
- **Generated journey gap for subagent protocol**: generated Playwright covers lifecycle and presence, not create child -> prompt -> wait -> report/output -> destroy.
- **Meta-session gap in generated output and CLI**: proposal escalation is covered by core/control-server tests and a behavior asset, but the generated meta-session Playwright file is removed and `stoa-ctl` does not expose proposal/dispatch commands.
- **Static guard gap**: guards do not currently protect `/ctl/session/create`, wait, prompt, report, destroy, or meta-session proposal route registration.

### Risks / Unknowns

- [!] The strongest child-session coverage is unit/HTTP level. A renderer/Electron journey could still regress the full user-visible orchestration path without detection.
- [!] If future product direction expects child-to-parent push notifications, existing bootstrap text and tests point the opposite direction: pull recovery is the current contract.
- [?] "Wait many" may mean either many child targets or many waiters. Current tests only prove many waiters for one session.
- [?] "Proposal/option escalation" may be intended for `stoa-ctl` eventually, but current CLI tests explicitly assert proposal/meta-session command names are absent.

## Context Handoff

Start here: `D:\Data\DEV\ultra_simple_panel\research\2026-06-09-stoactl-subagent-test-coverage.md`

Context only. Use the saved report as the source of truth.
