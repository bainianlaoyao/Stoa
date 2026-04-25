---
date: 2026-04-25
topic: checkpoint-evolution-v2-review
status: completed
mode: context-gathering
sources: 10
---

## Context Report: Revised Checkpoint/Evolution Design V2

### Why This Was Gathered
Validate whether revised design V2 still has blocking architecture or data-model gaps against the current repository.

### Summary
V2 fixes the largest flaws from the first draft, especially by introducing a single durable write boundary and moving the ledger out of project-local `.stoa`. Two blocking issues remain: `RuntimeEpoch` is not yet specified as an end-to-end validation key on all runtime/event paths, and Phase 1 still promises durable diff/blast-radius/attribution without defining an immutable workspace artifact to compute them from later.

### Key Findings
- `RuntimeEpoch` must be carried and validated through webhook ingress, terminal spool, controller calls, and state reduction. Persisting it on the session alone is not enough.
- Phase 1 needs a durable content artifact for checkpoint diff/blast-radius/attribution. A ledger of ingress evidence plus checkpoint metadata is insufficient once the live workspace changes.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Webhook ingress is keyed by session secret and session id, not runtime instance | `src/core/webhook-server.ts` | `src/core/webhook-server.ts:29-33`, `src/core/webhook-server.ts:134-147`, `src/core/webhook-server.ts:150-181`, `src/core/webhook-server.ts:184-215` |
| Controller mutates by `sessionId` only | `src/main/session-runtime-controller.ts` | `src/main/session-runtime-controller.ts:35-63` |
| Manager patch application mutates by `sessionId` only | `src/core/project-session-manager.ts` | `src/core/project-session-manager.ts:497-516` |
| Runtime launch and terminal append are keyed to the session, not a runtime instance | `src/core/session-runtime.ts` | `src/core/session-runtime.ts:104-149` |
| The current data model has only project/session identity, no snapshot artifact | `src/shared/project-session.ts` | `src/shared/project-session.ts:64-92` |
| Runtime launch always targets the live project path | `src/main/launch-tracked-session-runtime.ts` | `src/main/launch-tracked-session-runtime.ts:30-57` |
| Runtime target path comes directly from the live project path | `src/core/session-runtime.ts` | `src/core/session-runtime.ts:45-53` |
| Normal E2E isolation currently injects only `VIBECODING_STATE_DIR` | `tests/e2e-playwright/fixtures/electron-app.ts` | `tests/e2e-playwright/fixtures/electron-app.ts:99-108` |
| Main maps `VIBECODING_STATE_DIR` only to `global.json` in normal runs | `src/main/index.ts` | `src/main/index.ts:95-97` |
| Electron `userData` is only overridden in packaged smoke mode today | `src/main/index.ts` | `src/main/index.ts:113-118` |

### Risks / Unknowns
- [!] If `RuntimeEpoch` is not part of every ingress/update path, stale provider or PTY output can still mutate the current session after restart or duplicate launches.
- [!] If Phase 1 does not define an immutable checkpoint artifact, review diff/blast-radius output will depend on the mutable live workspace and become non-reproducible.
- [?] V2 does not yet say whether `userData`-backed journal/ledger paths are injectable for non-packaged E2E runs.

## Context Handoff: Revised Checkpoint/Evolution Design V2

Start here: `research/2026-04-25-checkpoint-v2-review.md`

Context only. Use the saved report as the source of truth.
