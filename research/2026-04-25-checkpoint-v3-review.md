---
date: 2026-04-25
topic: checkpoint-evolution-v3-review
status: completed
mode: context-gathering
sources: 6
---

## Context Report: Revised Checkpoint/Evolution Design V3

### Why This Was Gathered
Final blocking review of V3 against the current repository, limited to architecture/data-model issues only.

### Summary
V3 resolves most previously blocking issues. Two blocking points remain: startup ordering must explicitly invalidate old runtime epochs before ingress starts, and `baseHeadSha` cannot be an unconditional required artifact because the current repo supports arbitrary non-git project roots.

### Key Findings
- Restart safety still needs an explicit ordering rule: old runtime epochs must be invalid before the webhook bridge can accept ingress after process start.
- `baseHeadSha` must be nullable or replaced with a non-git base fingerprint because project roots are not guaranteed to be git repositories.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Main starts the session event bridge before bootstrap recovery launches sessions | `src/main/index.ts` | `src/main/index.ts:412-438`, `src/main/index.ts:804-806` |
| Current webhook validation accepts events based on session secret/session id, with no runtime-instance identity today | `src/core/webhook-server.ts` | `src/core/webhook-server.ts:140-147`, `src/core/webhook-server.ts:159-180`, `src/core/webhook-server.ts:193-214` |
| Projects are arbitrary paths with no git requirement at creation time | `src/core/project-session-manager.ts` | `src/core/project-session-manager.ts:266-303` |
| Runtime launch always targets the live project path and does not require git metadata | `src/main/launch-tracked-session-runtime.ts` | `src/main/launch-tracked-session-runtime.ts:36-65` |
| Runtime target path is just the project path from session/project state | `src/core/session-runtime.ts` | `src/core/session-runtime.ts:45-53` |
| Tests commonly create temporary project directories directly, not initialized repos | `tests/e2e/error-edge-cases.test.ts` | `tests/e2e/error-edge-cases.test.ts:39-47`, `tests/e2e/error-edge-cases.test.ts:191-205` |

### Risks / Unknowns
- [!] If the old epoch remains persisted and valid until relaunch, stale provider ingress can still be accepted during startup because the bridge comes up before recovery in the current main flow.
- [!] If `baseHeadSha` is mandatory rather than nullable/alternative-backed, checkpoint capture will fail for valid current-repo project roots that are not git repositories.

## Context Handoff: Revised Checkpoint/Evolution Design V3

Start here: `research/2026-04-25-checkpoint-v3-review.md`

Context only. Use the saved report as the source of truth.
