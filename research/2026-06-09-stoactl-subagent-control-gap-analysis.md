---
date: 2026-06-09
topic: stoa-ctl subagent control gap analysis
status: completed
mode: context-gathering
sources: 34
---

# Context Report: stoa-ctl Subagent Control Gap Analysis

## Why This Was Gathered

The task is to evaluate and tune the current `stoa-ctl` support for subagent-driven development implemented through subsessions. The requested capabilities are dispatching subagents, waiting for one or more subagents, appending prompts, stopping subagents, wrapping options/proposals raised by subagents, and defining how a subagent notifies a top-level agent.

## Summary

Current `stoa-ctl` has a usable session-tree control plane for basic subsession work: create a child session, prompt it, wait for one session, read output/report, and destroy it. It is not yet a complete subagent orchestration protocol because multi-session waiting, structured child-to-parent messages, option/proposal escalation, interrupt/stop semantics, and durable typed task results are missing or only indirectly defined.

Recommended direction: keep `session` as the low-level control surface, and add a first-class `subagent` contract on top. The contract should model subagent work as a task/dispatch/message resource with explicit lifecycle states, structured completion, and parent-visible messages, while preserving the existing session-tree permission model.

## Key Findings

- Implemented: child session creation maps to subagent dispatch at the current low level. Session callers can create direct children through `stoa-ctl session create --type ...`, and the control server enforces session identity through `STOA_SESSION_ID` plus `STOA_CTL_SESSION_TOKEN`.
- Implemented: prompt append/submit exists as `stoa-ctl session prompt <id> --text ...`; the supervisor writes the text plus carriage return to the target session.
- Implemented: single-session wait exists as `stoa-ctl session wait <id> --timeout <seconds>` and returns `session`, `status`, `output`, and `report`.
- Implemented: basic child return is pull-based. The bootstrap prompt explicitly tells parents to recover child work through `wait`, `report`, or `output`, and children return ordinary text to terminal output.
- Partly implemented: `destroy` exists, but the runtime meaning is kill/archive/release resources rather than physical deletion. There is no separate public `stop`, `cancel`, or `interrupt` command in the unified `stoa-ctl session` surface.
- Missing: wait-many/wait-all/wait-any for multiple children. Existing tests only cover single target waits and multiple waiters on the same session.
- Missing: structured child-to-parent notification. There is no durable inbox/message API for `worker_done`, `escalation`, `blocked`, or `decision_gate`.
- Missing: durable typed child result payload. Completion reports are derived from session state and terminal replay; child agents cannot submit a typed result object.
- Missing: option/proposal escalation in the unified session-tree model. Legacy meta-session proposal flows exist, but unified session tree docs explicitly avoid preserving old meta-only proposal/dispatch flows.
- Missing: behavior/generated journey coverage for `stoa-ctl` control operations beyond lifecycle/feature-gate checks.

## Evidence Chain

| Finding | Source | Location |
|---|---|---|
| CLI exposes session create/prompt/wait/report/destroy commands | `tools/stoa-ctl/index.ts` | lines 47-65 |
| Session caller identity uses `STOA_SESSION_ID` and `STOA_CTL_SESSION_TOKEN` | `tools/stoa-ctl/index.ts` | lines 86-105 |
| CLI sends caller identity as `x-stoa-session-id` and `x-stoa-session-token` | `tools/stoa-ctl/index.ts` | lines 146-158 |
| `session create` forbids session callers from passing `--project` or `--parent` | `tools/stoa-ctl/index.ts` | lines 279-283 |
| `session wait` is a single-session command and maps timeout seconds to `timeoutMs` | `tools/stoa-ctl/index.ts` | lines 371-382 |
| `session prompt` sends JSON `{ text }` to `/ctl/session/:id/prompt` | `tools/stoa-ctl/index.ts` | lines 405-423 |
| Control server resolves local-user and session caller credentials | `src/core/session-control-server.ts` | lines 44-65 |
| Capabilities currently advertise session-level features only | `src/core/session-control-server.ts` | lines 119-133 |
| `/ctl/session/:id/wait` handles only one session id | `src/core/session-control-server.ts` | lines 255-293 |
| `/ctl/session/:id/prompt` accepts text and dispatches through supervisor | `src/core/session-control-server.ts` | lines 300-329 |
| `/ctl/session/:id/destroy` exists, no separate stop/cancel/interrupt route | `src/core/session-control-server.ts` | lines 331-360 |
| Supervisor appends carriage return when prompting a session | `src/core/session-supervisor.ts` | lines 82-89 |
| Session callers create only direct child sessions | `src/core/session-supervisor.ts` | lines 91-101 |
| Wait returns session/status/output/report after terminal state or timeout | `src/core/session-supervisor.ts` | lines 121-149 |
| Completion report is derived from session state/outcome | `src/core/session-supervisor.ts` | lines 230-262 |
| Bootstrap prompt defines pull-based child result recovery | `src/core/session-bootstrap-prompt-service.ts` | lines 34-43 |
| Existing design defines session-tree visibility and authority | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 365, 404, 424, 447 |
| Existing design maps dispatch to child session create + prompt | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 572-598 |
| Existing design lacks a unified child-to-parent structured message contract | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 858-882 |
| Legacy meta proposal exists but is not integrated into unified session tree | `docs/superpowers/specs/2026-05-07-meta-session-global-agent-design.md` | line 467 |
| Tests cover create child session through HTTP and supervisor | `src/core/session-control-server.test.ts`, `src/core/session-supervisor.test.ts` | lines 483, 508, 531; lines 196 |
| Tests cover single-session wait | `src/core/session-control-server.test.ts`, `src/core/session-supervisor.test.ts`, `tools/stoa-ctl/index.test.ts` | lines 363, 344, 402 |
| Tests do not cover wait-many | `src/main/session-runtime-controller.test.ts` | lines 422 only covers multiple waiters on same session |
| Tests cover prompt, destroy, report individually | `src/core/session-control-server.test.ts`, `tools/stoa-ctl/index.test.ts` | lines 416, 457, 313; lines 511, 535, 489 |
| Generated `stoa-ctl` Playwright coverage is feature-gate/lifecycle only | `testing/behavior/stoactl-lifecycle.ts`, `tests/generated/playwright/stoactl-lifecycle.generated.spec.ts` | lines 3, 13 |
| Orca models inter-agent coordination as structured messages, worker_done/escalation, wait, tasks, and decision gates | `research/upstreams/orca/skills/orchestration/SKILL.md` | lines 42-54, 77-110, 168-174 |
| Orca dispatch preamble requires `taskId` and `dispatchId` to avoid stale worker updates | `research/upstreams/orca/src/main/runtime/orchestration/preamble.ts` | lines 44, 53, 68 |
| Entire CLI normalizes lifecycle events including subagent start/end | `research/upstreams/entire-cli/cmd/entire/cli/agent/event.go` | lines 13, 71 |
| Entire CLI uses tool-use identity for subagent start/end correlation | `research/upstreams/entire-cli/cmd/entire/cli/agent/claudecode/lifecycle.go` | lines 52, 155 |
| Kubernetes `kubectl wait` supports waiting for one or many resources with explicit conditions | Kubernetes docs | https://kubernetes.io/docs/reference/kubectl/generated/kubectl_wait |
| Docker Compose `wait` blocks until one or more service containers stop | Docker docs | https://docs.docker.com/reference/cli/docker/compose/wait/ |
| Docker Compose dependencies model explicit health/completion conditions | Docker docs | https://docs.docker.com/reference/compose-file/services/ |
| A2A models agent work as `Task` with id, status, artifacts, history, and lifecycle states | A2A Protocol docs | https://a2a-protocol.org/dev/specification/ |

## Recommendation

### Contract Shape

Add a first-class `subagent` command group while keeping `session` as the underlying resource:

- `stoa-ctl subagent dispatch --type <provider> --title <title> --prompt <text|file|stdin> [--task-id <id>]`
- `stoa-ctl subagent wait <id...> --mode all|any --timeout <seconds>`
- `stoa-ctl subagent input <id> --text ...`
- `stoa-ctl subagent stop <id...> --mode interrupt|terminate|destroy`
- `stoa-ctl subagent report <id>`
- `stoa-ctl subagent notify --type worker_done|escalation|blocked|status --task-id <id> --payload <json|file|stdin>`
- `stoa-ctl subagent ask --question ... --options <json>`
- `stoa-ctl subagent inbox [--wait] [--types ...]`

This is intentionally a breaking, prototype-friendly contract. It avoids preserving the old meta-session proposal dual track and gives subagent-driven development one coherent vocabulary.

### Data Model

Introduce a Stoa-side subagent task resource:

- `taskId`: stable work unit identity.
- `dispatchId`: stable attempt identity; changes on retry.
- `sessionId`: backing child session id.
- `parentSessionId`: parent/top session that owns the task.
- `state`: `submitted | running | waiting | blocked | completed | failed | cancelled | interrupted`.
- `result`: structured completion payload, including summary, changed files, artifacts, verification, blockers, and terminal output reference.
- `messages`: structured child-to-parent events: `worker_done`, `escalation`, `blocked`, `status`, `decision_gate`.

### Semantics

- Dispatch creates the child session and submits the initial prompt in one command. A successful dispatch returns `taskId`, `dispatchId`, `sessionId`, and initial `state`.
- Wait-many supports `all` and `any`, returns completed and pending arrays, and includes per-target errors rather than collapsing the entire batch into one opaque failure.
- Input appends/submits text to a running child and returns only delivery acknowledgement, not completion.
- Stop distinguishes `interrupt`, `terminate`, and `destroy`. `destroy` remains archive/subtree cleanup; `interrupt` should be exposed separately because it is operationally different.
- Notify is the supported child-to-parent channel. Terminal final output remains useful, but the protocol should not depend on parsing it.
- Ask/options are modeled as `decision_gate` messages owned by the parent/top session. This replaces meta-only proposal behavior for unified session-tree workflows.

## Risks / Unknowns

- [!] Implementing the full contract touches shared types, control server, CLI, bootstrap prompt, behavior assets, and tests. This should be implemented behind a single breaking-contract update, not as scattered command additions.
- [!] A public `interrupt` route needs careful integration with existing runtime interruption handling so it does not conflict with archive/destroy semantics.
- [!] The current report/output model is terminal-tail based. A typed `notify/result` store must be durable enough for parent recovery after restart.
- [?] The final UI treatment for inbox/decision gates is not defined here. CLI contract can land first, with UI added later if needed.

## Context Handoff

Start here: `research/2026-06-09-stoactl-subagent-control-gap-analysis.md`

Context only. Use this saved report as the source of truth for the next design or implementation step.
