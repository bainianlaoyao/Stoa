---
date: 2026-06-10
topic: stoa-ctl and session management architecture for subagent command design
status: completed
mode: context-gathering
sources: 18
---

## Context Report: stoa-ctl + Session Architecture

### Why This Was Gathered
Designing a new `subagent` command group for `stoa-ctl` requires understanding the full CLI-to-server pipeline, session tree model, authority/visibility system, bootstrap prompts, and test infrastructure.

### Summary
The codebase has a clean three-layer architecture: CLI (`tools/stoa-ctl/`) -> HTTP server (`src/core/session-control-server.ts`) -> supervisor (`src/core/session-supervisor.ts`). Sessions form a parent-child tree with visibility/authority checks. Tests follow a strict pattern with dependency injection. The CLI is a flat if-chain router with no command registry pattern.

### Key Findings

#### 1. tools/stoa-ctl/ -- CLI Layer
- **4 files**: `index.ts`, `index.test.ts`, `send-keys.ts`, `send-keys.test.ts`
- Single entry point: `run(argv, deps)` returns exit code number
- **No command registry** -- flat if-chain on `[group, action, ...rest]`
- Two caller modes: `session` (via env vars) and `local-user` (via port file secret)
- Commands: `health`, `whoami`, `capabilities`, `session list/create/inspect/status/output/wait/report/prompt/destroy`
- `send-keys.ts` is a standalone key-sequence parser (not wired into the main command set)
- Tests inject `fetch`, `env`, `stdout`, `stderr`, `sleep`, `readPortFile` via deps

#### 2. src/core/session-control-server.ts -- HTTP Transport
- Express app with two middleware gates: disabled-check then auth
- Creates a `SessionSupervisor` internally
- All routes under `/ctl/` prefix
- JSON envelope: `{ ok, data, error }` everywhere
- Auth: `x-stoa-secret` for local-user, `x-stoa-session-id` + `x-stoa-session-token` for session
- `SessionControlServerDeps` extends `SessionSupervisorDeps` with `ctlSecret`, `sessionTokenRegistry`, `isCtlEnabled`
- Server binds to `127.0.0.1` on random port; `start()` returns port number

#### 3. src/core/session-supervisor.ts -- Business Logic
- `SessionSupervisor` class with `CallerIdentity` discriminated union
- Methods: `listSessions`, `inspectSession`, `promptSession`, `createChildSession`, `destroySession`, `getSessionStatus`, `getSessionOutput`, `getCompletionReport`, `waitForSession`
- Authority model: session callers can only act within their visibility scope; local-user has full access
- `SessionSupervisorDeps` interface injects: `getSnapshot()`, `visibilityService`, `sessionInput`, `createChildSession()`, `destroySession()`, `getTerminalReplay()`, `waitForSessionStateChange()`
- `SessionControlError` with codes: `unknown_session`, `forbidden_authority_scope`, `wait_timeout`, `no_completion_yet`

#### 4. src/core/session-visibility-service.ts -- Tree Authority
- `SessionVisibilityService` implements `SessionVisibilityReader`
- Visibility: same-depth peers + all descendants within the same root tree
- Authority actions: `inspect | status | report | prompt | create | destroy | wait | read-output`
- `create` only allowed on self; `destroy` allowed on self + descendants
- Uses `SessionNodeSnapshot[]` (live array or function) as node source

#### 5. Shared Types (src/shared/project-session.ts)
- `SessionType = 'shell' | 'opencode' | 'codex' | 'claude-code'`
- `SessionSummary` -- 30+ fields including parentSessionId, createdBySessionId, runtimeState, turnState, etc.
- `SessionNodeSnapshot = { session: SessionSummary, tree: SessionTreeMeta }`
- `SessionTreeMeta = { rootSessionId, depth, childCount, descendantCount }`
- `SessionStatusSnapshot`, `SessionOutputResult`, `SessionCompletionReport`, `SessionWaitResult`
- `CreateSessionRequest` includes `parentSessionId`, `createdBySessionId`, `externalSessionId`, `initialCols/Rows`

#### 6. src/core/session-bootstrap-prompt-service.ts
- Returns a unified static bootstrap prompt for all session types
- Covers: discovery sequence, session commands, subsession dispatch protocol, subsession return protocol, session context protocol
- Already documents the `session create` + `session prompt` + `session wait` workflow for child sessions

#### 7. session-command-env.ts -- Environment Variables
- Injects `STOA_SESSION_ID`, `STOA_CTL_BASE_URL`, `STOA_CTL_SESSION_TOKEN`, `STOA_CTL_COMMAND` when stoa-ctl enabled
- `STOA_CTL_BASE_URL` always present; others conditional on `stoaCtlEnabled`

#### 8. stoa-ctl-port-file.ts
- `PortFileData = { port, pid, secret, startedAt }`
- Stored at `~/.stoa/ctl.json`

#### 9. Test Patterns
- **CLI tests**: inject `fetch`, `env`, `stdout`, `stderr`, `readPortFile` via `RunDependencies`
- **Server tests**: `createSessionControlServer(deps)` -> `startServer()` -> `get()/post()` helpers with real HTTP
- **Supervisor tests**: direct class instantiation with mock `SessionSupervisorDeps`
- Common pattern: `makeSession()` and `makeNode()` factory helpers with overrides
- All use vitest (`describe, expect, test`)

#### 10. Testing Infrastructure (testing/)
- `testing/contracts/testing-contracts.ts`: `defineBehavior()`, `defineTopology()`, `defineJourney()`, `defineGeneratedTestMeta()`
- `testing/behavior/stoactl-lifecycle.ts`: 5 behaviors covering enable/disable/env stripping
- `testing/topology/stoactl-topology.ts`: data-testid declarations
- `testing/journeys/stoactl-lifecycle.journey.ts`: 2 journeys (disable cleanup, env stripped)
- Pattern: behavior -> topology -> journey -> generated Playwright spec

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| CLI flat if-chain, run() entry, CallerMode union | tools/stoa-ctl/index.ts | lines 29-43, 200-454 |
| CLI deps injection pattern | tools/stoa-ctl/index.ts | lines 20-27 |
| SessionControlServer Express routes | src/core/session-control-server.ts | lines 64-525 |
| SessionSupervisor business logic | src/core/session-supervisor.ts | lines 54-293 |
| Visibility + authority model | src/core/session-visibility-service.ts | lines 16-129 |
| SessionType, SessionSummary, all shared types | src/shared/project-session.ts | lines 39-544 |
| Bootstrap prompt for child sessions | src/core/session-bootstrap-prompt-service.ts | lines 1-61 |
| Port file data shape | src/core/stoa-ctl-port-file.ts | lines 6-11 |
| Session env injection | src/core/session-command-env.ts | lines 1-31 |
| Testing contract DSL | testing/contracts/testing-contracts.ts | lines 1-164 |
| CLI test pattern with mock fetch | tools/stoa-ctl/index.test.ts | lines 1-699 |
| Server test with real HTTP | src/core/session-control-server.test.ts | lines 1-690 |
| Supervisor test with mock deps | src/core/session-supervisor.test.ts | lines 1-528 |

### Risks / Unknowns
- [!] The CLI has no command registry -- adding `subagent` as a new group means extending the if-chain, which may get unwieldy. Consider whether to refactor into a command registry pattern first.
- [?] The `send-keys.ts` module exists but is not wired into the main CLI command set. It may be intended for a `session send-keys` command that hasn't been added yet.
- [!] The session types are hardcoded in two places (`SESSION_TYPES` in both CLI and server). A new `subagent` type would need to be added to the `SessionType` union.
- [?] No existing `subagent` concept in the codebase -- this would be entirely new.
