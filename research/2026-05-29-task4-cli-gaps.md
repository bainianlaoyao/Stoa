---
date: 2026-05-29
topic: Task 4 CLI and control plane implementation gaps
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Task 4 Unified Session Tree CLI & Control Plane Gaps

### Why This Was Gathered

Task 4 of the unified session tree implementation plan calls for a unified control server and CLI rewrite. The new backend core files exist (`session-supervisor.ts`, `session-control-server.ts`, `session-command-env.ts`, `session-bootstrap-prompt-service.ts`) but the CLI, port file, IPC channels, and `main/index.ts` have not been updated. This report catalogs the exact remaining gaps, ordered by severity.

### Summary

The new unified control server and supervisor are implemented and tested against each other. However, the CLI (`tools/stoa-ctl/index.ts`) still speaks the old meta-session/work-session protocol with ~20 routes that do not exist on the new server. The CLI does not send `x-stoa-session-token`, does not have `session *` commands, and the port file / IPC channels still reference the old meta-session feature stack. The disconnect is total — no end-to-end CLI flow works through the new control plane.

### Key Findings

#### CRITICAL — CLI speaks entirely wrong protocol

1. **CLI has zero unified `session *` commands.** The CLI still exposes `work-sessions *`, `meta-sessions *`, `proposals *`, `dispatch *`, and `state *` command groups. The plan requires `session list`, `session inspect <id>`, `session prompt <id>`, `session create --parent <id> --type <type>`, `session destroy <id>`.
   - Source: `tools/stoa-ctl/index.ts:253-740` — all command routing
   - Target: Plan Task 4 Step 3 "CLI rewrite to `session` commands"

2. **CLI calls ~20 routes that do not exist on new control server.** The CLI targets routes like `/ctl/work-sessions`, `/ctl/meta-sessions/*`, `/ctl/proposals/*`, `/ctl/dispatch/*`, `/ctl/state/*`. The new `session-control-server.ts` only exposes: `/ctl/health`, `/ctl/whoami`, `/ctl/capabilities`, `/ctl/session/list`, `/ctl/session/:id/inspect`, `/ctl/session/:id/prompt`, `/ctl/session/:id/destroy`, `/ctl/session/create`.
   - Source: `tools/stoa-ctl/index.ts:259-738` vs `src/core/session-control-server.ts:81-243`

3. **CLI never sends `x-stoa-session-token` header.** The new control server requires `x-stoa-session-id` + `x-stoa-session-token` for session-scoped auth (lines 34-39). The CLI's `resolveHeaders` only sends `x-stoa-session-id` and `x-stoa-secret`, never the token. Every session-scoped request will 401.
   - Source: `tools/stoa-ctl/index.ts:93-113` (`resolveHeaders`) vs `src/core/session-control-server.ts:34-39` (`resolveCaller`)

#### HIGH — Stale integration surface

4. **Port file still has `activeMetaSessionId`.** `PortFileData` at `src/core/stoa-ctl-port-file.ts:9` keeps `activeMetaSessionId: string | null`. The plan expects this to be replaced with a tree-aware active session concept or removed. The CLI still falls back to `portFileData?.activeMetaSessionId` at line 97.
   - Source: `src/core/stoa-ctl-port-file.ts:9`, `tools/stoa-ctl/index.ts:97`

5. **IPC channels still have full meta-session stack.** `ipc-channels.ts:17-28` still defines `metaSessionBootstrap`, `metaSessionCreate`, `metaSessionSetActive`, `metaSessionArchive`, `metaSessionRestore`, `metaSessionEvent`, `metaSessionProposalList`, etc. These need removal or replacement per plan.
   - Source: `src/core/ipc-channels.ts:17-28`

6. **`main/index.ts` wiring not done.** The plan requires wiring `main/index.ts` to the new `SessionControlServer` and removing the old meta-session control stack. This file is listed as a modify target in Task 4 but has not been touched.
   - Source: Plan Task 4 file list includes `src/main/index.ts`

#### MEDIUM — Test and spec alignment

7. **CLI tests still validate old command surface.** All 25+ tests in `tools/stoa-ctl/index.test.ts` test `meta-sessions *`, `work-sessions *`, `proposals *`, `dispatch *` commands. Zero tests exist for the new `session *` unified commands. The plan's Step 1 requires tests for "CLI command parsing for `session *`" and "no `activeMetaSessionId` fallback".
   - Source: `tools/stoa-ctl/index.test.ts:29-884`

8. **Usage text is entirely old commands.** `USAGE_TEXT` at `tools/stoa-ctl/index.ts:41-77` still shows the old meta-session/work-session/proposals/dispatch surface. No `session *` commands documented.
   - Source: `tools/stoa-ctl/index.ts:41-77`

9. **Bootstrap prompt not served by new control server.** The CLI has a `bootstrap-prompt` command hitting `/ctl/bootstrap-prompt` (line 279). The new control server has no such route. The `SessionBootstrapPromptService` was created as a standalone service but has no HTTP route exposure.
   - Source: `tools/stoa-ctl/index.ts:278-286` vs `src/core/session-control-server.ts` (no bootstrap-prompt route)

10. **`SessionBootstrapPromptService.getPrompt()` signature mismatch.** The implementation takes no arguments (`getPrompt(): string`), but the test calls it with provider type strings like `getPrompt('claude-code')`. JS ignores extra args silently, but this indicates the service was expected to be provider-aware and is not.
    - Source: `src/core/session-bootstrap-prompt-service.ts:37` vs `src/core/session-bootstrap-prompt-service.test.ts:9,13,19,25,31`

#### LOW — Minor type/env mismatches

11. **CLI reads `STOA_META_SESSION_ID` which new env does not set.** `resolveHeaders` at line 94 falls back to `env.STOA_META_SESSION_ID`. The new `buildSessionCommandEnv` at `session-command-env.ts:18` only sets `STOA_SESSION_ID`. Sessions started under the new system will never have `STOA_META_SESSION_ID`.
    - Source: `tools/stoa-ctl/index.ts:94` vs `src/core/session-command-env.ts:18`

12. **CLI reads `STOA_CTL_BASE_URL` but new env also sets it.** This is actually compatible — both old and new paths set `STOA_CTL_BASE_URL`. No gap here, just noting consistency.

### Evidence Chain

| # | Finding | Source | Location |
|---|---------|--------|----------|
| 1 | CLI has no `session *` commands | `tools/stoa-ctl/index.ts` | L253-740 |
| 2 | CLI calls 20+ non-existent routes | `tools/stoa-ctl/index.ts` | L259-738 |
| 3 | CLI never sends session token | `tools/stoa-ctl/index.ts` | L93-113 |
| 4 | Port file has `activeMetaSessionId` | `src/core/stoa-ctl-port-file.ts` | L9 |
| 5 | IPC channels still have meta-session stack | `src/core/ipc-channels.ts` | L17-28 |
| 6 | `main/index.ts` wiring not done | Plan Task 4 | File list |
| 7 | CLI tests all test old commands | `tools/stoa-ctl/index.test.ts` | L29-884 |
| 8 | Usage text is old commands | `tools/stoa-ctl/index.ts` | L41-77 |
| 9 | No bootstrap-prompt route on new server | `src/core/session-control-server.ts` | (absent) |
| 10 | `getPrompt()` ignores provider arg | `session-bootstrap-prompt-service.ts` | L37 |
| 11 | CLI reads `STOA_META_SESSION_ID` | `tools/stoa-ctl/index.ts` | L94 |

### Risks / Unknowns

- [!] **Total CLI-to-server disconnect**: No CLI command can reach the new control server. Every CLI invocation will either 404 (old routes) or 401 (missing token header). Task 4 CLI rewrite is the blocking work.
- [!] **`main/index.ts` wiring is a hard dependency**: Without wiring the new `SessionControlServer` into `main/index.ts`, the control plane never starts. Both CLI rewrite and main wiring must land together.
- [?] **Whether `send-keys` should survive the rewrite**: The old CLI has `work-sessions send-keys` with its own parser. The plan's Task 4 doesn't mention `send-keys` in the new unified surface. It may need to become `session send-keys <id>` or be dropped.
- [?] **Whether `proposals` / `dispatch` should survive**: Same question — these exist in the old CLI but are not mentioned in the plan's Task 4 unified command set. May be deferred to a later task or removed.

### Change Suggestions (file-grouped)

**`tools/stoa-ctl/index.ts`** — Full CLI rewrite:
- Replace `work-sessions *`, `meta-sessions *` with `session list`, `session inspect <id>`, `session prompt <id>`, `session create --parent <id> --project <id> --type <type>`, `session destroy <id>`
- Add `x-stoa-session-token` from `STOA_CTL_SESSION_TOKEN` env to `resolveHeaders`
- Remove `STOA_META_SESSION_ID` fallback from `resolveHeaders`
- Remove `activeMetaSessionId` fallback from `resolveHeaders`
- Update `USAGE_TEXT` entirely
- Decide fate of `send-keys`, `proposals`, `dispatch` commands

**`tools/stoa-ctl/index.test.ts`** — Full test rewrite:
- Replace all meta-session/work-session test cases with `session *` command tests
- Add test for `x-stoa-session-token` header flow
- Add test that `STOA_META_SESSION_ID` is not read

**`src/core/stoa-ctl-port-file.ts`** — Rename field:
- Replace `activeMetaSessionId` with tree-aware session ID or remove

**`src/core/session-control-server.ts`** — Add bootstrap-prompt route:
- Add `GET /ctl/bootstrap-prompt` serving `SessionBootstrapPromptService.getPrompt()`

**`src/core/session-bootstrap-prompt-service.ts`** — Fix signature:
- `getPrompt()` should accept optional provider type parameter

**`src/core/ipc-channels.ts`** — Remove meta-session channels:
- Remove lines 17-28 (`metaSession*` channels)
- Add new session-tree IPC channels as needed

**`src/main/index.ts`** — Wire new control server:
- Start `SessionControlServer` on boot
- Write port file with new fields
- Remove old meta-session control stack wiring
