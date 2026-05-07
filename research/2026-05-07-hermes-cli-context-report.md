---
date: 2026-05-07
topic: hermes cli context for stoa
status: completed
mode: context-gathering
sources: 13
---

## Context Report: Hermes CLI Context For Stoa

### Why This Was Gathered
This report gathers bounded repository context needed to decide how a global `Hermes` agent should access Stoa state and capabilities through a local CLI tool plus skill/docs, instead of MCP.

### Summary
Stoa's current architecture already matches a `Hermes`-style control plane in one important way: structured session state is owned by the Electron main process, not inferred from terminal text, and the renderer only consumes mirrored state. However, the live observability/event layer is currently exposed only through renderer bridge APIs and in-memory stores, while durable on-disk state remains intentionally minimal. That means a Hermes CLI has two materially different implementation paths: attach to a live Stoa runtime for authoritative event/snapshot access, or grow new durable export/log surfaces for offline access.

### Key Findings
- Stoa already centralizes authoritative session/runtime coordination in the main process and explicitly separates human terminal output from machine state events.
- The preload bridge already exposes session, presence, project observability, app observability, and per-session observation-event listing APIs, but only to the renderer-facing bridge contract.
- `SessionSummary`, `SessionPresenceSnapshot`, `ProjectObservabilitySnapshot`, and `AppObservabilitySnapshot` already provide most of the state shape Hermes would need for a first read-only MVP.
- Observation events are currently kept in an in-memory store with session/project listing methods; there is no durable append-only global observation log yet.
- Durable state on disk is intentionally minimal: `~/.stoa/state.json` is a recovery index, not an event log.
- Per-project memory artifacts already exist under `.stoa/memory/`, including sealed turn evidence and runtime job state, but those are evidence/job stores rather than a general global scheduler API.
- There is no existing standalone `stoa` CLI entrypoint in `package.json`, so a Hermes CLI would be a net-new surface.
- Current product UX explicitly avoids making a command palette the primary interaction model inside the app, which supports delivering Hermes primarily as an external CLI plus skill/doc workflow rather than as a first-class in-app command surface.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Main process owns real coordination; terminal text and status events are split into separate channels | `docs/architecture/system-architecture.md` | `docs/architecture/system-architecture.md:3-17` |
| Renderer is a mirror only and does not own session control | `docs/architecture/system-architecture.md` | `docs/architecture/system-architecture.md:19-34` |
| Stoa requires status to come from structured channels rather than terminal guessing | `README.md` | `README.md:48-57` |
| Current UI status summaries must come from the state channel and preserve event ordering | `docs/product/workspace-console-ux.md` | `docs/product/workspace-console-ux.md:22-26` |
| Persistent state file is intentionally a minimal recovery index, not a debug/event log | `docs/operations/state-storage-and-recovery.md` | `docs/operations/state-storage-and-recovery.md:3-11` |
| `SessionSummary` already stores runtime state, turn state, blocking/failure reasons, unseen completion, recovery mode, and external session ID | `src/shared/project-session.ts` | `src/shared/project-session.ts:95-117` |
| Renderer bridge already exposes bootstrap state, session presence, project/app observability, and session observation-event listing APIs | `src/shared/project-session.ts` | `src/shared/project-session.ts:268-316` |
| Canonical provider events already carry session, project, intent, summary, and optional evidence | `src/shared/project-session.ts` | `src/shared/project-session.ts:318-338` |
| `SessionPresenceSnapshot` / `ProjectObservabilitySnapshot` / `AppObservabilitySnapshot` already model blocked, failed, unread, confidence, health, and attention state | `src/shared/observability.ts` | `src/shared/observability.ts:42-114` |
| Observation events are stored in memory with per-session and per-project listing, not persisted globally | `src/core/observation-store.ts` | `src/core/observation-store.ts:15-59` |
| The session event bridge ingests provider events into observability and state reduction in the main process | `src/main/session-event-bridge.ts` | `src/main/session-event-bridge.ts:120-143` |
| Session evidence is durably persisted under `<project>/.stoa/memory/evidence/...` | `src/core/memory/session-evidence-store.ts` | `src/core/memory/session-evidence-store.ts:70-136` |
| Runtime jobs and sealed turns are durably persisted under `<project>/.stoa/memory/runtime-state.json` | `src/core/memory/runtime-state-store.ts` | `src/core/memory/runtime-state-store.ts:23-25` |
| There is no standalone CLI `bin` surface declared in package scripts/package metadata | `package.json` | `package.json:1-36` |
| Product UX explicitly says not to introduce a complex command palette as the main in-app interaction | `docs/product/workspace-console-ux.md` | `docs/product/workspace-console-ux.md:28-32` |

### Risks / Unknowns
- [!] If Hermes must work when Stoa is not running, the current durable state is insufficient for authoritative global observability. A new export/log surface would be required.
- [!] If Hermes needs cross-session conflict arbitration based on file edits, the current cited surfaces do not yet show a canonical diff/conflict index; that likely requires new evidence capture or VCS-aware aggregation.
- [!] A CLI+skill path avoids MCP complexity, but it still needs a stable local contract. The main unresolved design choice is whether that contract is live RPC against a running app, offline reads from disk, or both.
- [?] The repository already has rich per-turn memory/evidence machinery, but it is not yet clear whether Hermes should consume raw evidence directly or only higher-level projected summaries.

## Context Handoff: Hermes CLI Context For Stoa

Start here: `research/2026-05-07-hermes-cli-context-report.md`

Context only. Use the saved report as the source of truth.
