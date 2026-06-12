---
date: 2026-06-10
topic: stoa-ctl subagent control implementation reference summary
status: completed
mode: context-gathering
sources: 4
---

# Context Report: stoa-ctl Subagent Control Implementation Reference

## Why This Was Gathered

The task is to extract key interfaces, types, existing CLI command patterns, HTTP endpoint patterns, session supervisor API surface, test patterns, and constraints from the authoritative reference documents for the `stoa-ctl` subagent control implementation. This includes the unified session tree design, the gap analysis, the subagent control design spec, and the design language constraints.

## Summary

The `stoa-ctl` subagent control implementation builds on the unified session tree (2026-05-29) and extends it with a first-class `subagent` CLI command group. Subagents are a facade over child sessions (not a new runtime). Key additions: short-name aliases, wait-many, explicit result submission, interrupt/destroy stop modes, and breaking rename of `session prompt` to `session input`. The implementation is prototype-stage, so all changes are breaking with no compatibility layers.

## Key Findings

### 1. Architecture Foundation (2026-05-29 spec)

- **One control object**: `SessionSummary` is the only first-class control object. No separate `MetaSessionSummary`.
- **Explicit tree**: `parentSessionId` is the only authoritative tree relationship. `rootSessionId`, `depth`, `childCount`, `descendantCount` are derived, never persisted.
- **Main process is sole supervisor**: `SessionSupervisor` is the unified business entry point for CLI and IPC. No parallel paths.
- **User vs session caller contexts**: Users see the full graph; sessions see only tree-local scope `V(S)`.
- **Tree-local visibility rule**: `V(S) = { X in T | depth(X) = depth(S) } ∪ descendants(S)`. No ancestor or peer-descendant visibility.

### 2. Host-Side Modules (from 2026-05-29)

- `SessionSupervisor` — session graph, lifecycle, prompt, destroy
- `SessionControlServer` — replaces `meta-session-control-server`, loopback only
- `SessionVisibilityService` — single authority for visibility/authority
- `SessionCommandEnv` — injects `STOA_SESSION_ID`, `STOA_CTL_SESSION_TOKEN`, `STOA_CTL_BASE_URL`
- `SessionBootstrapPromptService` — replaces "you are in a meta session" prompt
- `SessionCallerAuthRegistry` — mints per-session tokens, enforces live-session check

### 3. Session Tree Constraints

- Child session inherits parent's `projectId` (no cross-project children).
- `stoa-ctl session create` from a session caller always creates a direct child of the caller.
- `destroy` is recursive subtree destroy (leaf-first stop + archive). No reparent, no orphans.
- `restore` is symmetric (subtree restore).

### 4. Authority Matrix (2026-05-29)

| Action | self | same-depth peers | descendants | ancestors | peer descendants | other trees |
|--------|------|------------------|-------------|-----------|------------------|-------------|
| inspect | yes | yes | yes | no | no | no |
| prompt | yes | yes | yes | no | no | no |
| create | yes (direct child only) | no | no | no | no | no |
| destroy | yes | no | yes | no | no | no |

### 5. Gap Analysis Findings (2026-06-09)

- **Implemented**: child create, prompt, single wait, report/output, destroy.
- **Missing**: wait-many, structured child-to-parent messages, typed result payload, option/proposal escalation, interrupt/stop distinction.
- **Recommended direction**: keep `session` as low-level; add first-class `subagent` contract on top.
- **External references**: A2A protocol models agent work as `Task`; Orca uses `taskId`/`dispatchId`; Kubernetes/Docker wait-many patterns.

### 6. Subagent Control Design (2026-06-10) — Key Contracts

**Subagent = child session facade**:
- Every `parentSessionId != null` session is a subagent (no exceptions).
- Formal ID is the `sessionId`; short name is an alias within the root session tree.
- Root sessions are not subagents and cannot be targeted by `subagent` commands.
- No `taskId` / `dispatchId` in v1.

**Short name rules**:
- Unique key: `(rootSessionId, name)`.
- Default pool: `ryu, andy, mai, saski, naruto` (extensible, non-enumerative allocation).
- Resolution scope = caller `V(S)`; local-user resolves globally.
- `ambiguous_subagent_name` when multiple visible matches exist.
- Archived/destroyed aliases are tombstoned in the same root tree (not reusable).
- Hidden blockers leak only one bit: "requested name unavailable".

**InputSource unification**:
- All text input uses `--text | --file | --stdin` (mutually exclusive, exactly one required).
- Replaces `--prompt`, `--prompt-file`, `--json`.

**Breaking rename**:
- `session prompt` → `session input` (CLI, HTTP `/ctl/session/:id/input`, IPC `session:input`).
- No alias or compatibility forwarding for old command/route/channel.

**`dispatch`**:
- Atomic: create child + allocate alias + persist facade state + deliver initial input + init `subagentInputEpoch = 1`.
- On any step failure: cleanup child, release alias, no orphan state.
- Returns: `name`, `id`, `status`.
- session caller: cannot pass `--parent` or `--project` (direct child only).
- local-user: must pass `--parent`; cannot create root subagent.

**`wait`**:
- Supports multiple targets, `--mode all|any`, `--timeout <seconds>` (converted to `timeoutMs` in HTTP).
- Returns `SubagentWaitAggregate` with per-target completed/pending/error entries.
- Result source priority: `destroyed` (host lifecycle) > current-epoch explicit result > current-epoch terminal fallback.
- Stale result guard: explicit result's `inputEpoch` must match backing session's current `subagentInputEpoch`.
- Timeout returns `ok: true` with `overallStatus = 'timeout'`, not a top-level error.
- `interrupted` is a terminal fallback status only (not an explicit result status).

**`input`**:
- Appends input to running subagent.
- Increments `subagentInputEpoch`; invalidates previous explicit result (stale or cleared).
- Returns delivery acknowledgement only, not completion.

**`stop`**:
- `--mode interrupt`: interrupt current turn, keep session.
- `--mode destroy`: reuse archive/subtree cleanup.
- Returns `SubagentStopAggregate` with per-target status/error.
- No `terminate` mode.

**`result`**:
- Child-only self-report (no `<subagent>` argument).
- Status: `completed | failed | blocked | cancelled` (no `interrupted`).
- local-user, root, and parent calling on behalf of child are all forbidden.
- `subagentInputEpoch` recorded with result; only same-epoch results are valid.
- Full body read authority: local-user, self, ancestor/parent can read full body; descendant, same-depth peer, sibling descendant cannot.

### 7. CLI Usage (2026-06-10 spec)

```text
health
whoami
capabilities

session list [--include-archived]
session create --type <shell|opencode|codex|claude-code> [--title] [--project] [--parent] [--external-session-id] [--cols] [--rows]
session inspect <sessionId>
session status <sessionId>
session output <sessionId>
session wait <sessionId> [--timeout <seconds>]
session report <sessionId>
session input <sessionId> --text|--file|--stdin
session destroy <sessionId>

subagent list
subagent dispatch --type <shell|opencode|codex|claude-code> --text|--file|--stdin [--title] [--name] [--parent] [--cols] [--rows]
subagent wait <subagent...> [--mode all|any] [--timeout <seconds>]
subagent input <subagent> --text|--file|--stdin
subagent stop <subagent...> [--mode interrupt|destroy]
subagent result --status <completed|failed|blocked|cancelled> --text|--file|--stdin [--title]
```

### 8. HTTP/Control API Routes

| Command | Method | Path | Request |
|---------|--------|------|---------|
| `session input` | POST | `/ctl/session/:id/input` | `{ text: string }` |
| `subagent list` | GET | `/ctl/subagent/list` | none |
| `subagent dispatch` | POST | `/ctl/subagent/dispatch` | `SubagentDispatchRequest` |
| `subagent wait` | POST | `/ctl/subagent/wait` | `SubagentWaitRequest` |
| `subagent input` | POST | `/ctl/subagent/input` | `SubagentInputRequest` |
| `subagent stop` | POST | `/ctl/subagent/stop` | `SubagentStopRequest` |
| `subagent result` | POST | `/ctl/subagent/result` | `SubagentResultRequest` |

CLI uses kebab-case params; HTTP API uses camelCase (e.g., `--parent` → `parentId`, `--cols` → `initialCols`).

### 9. Key TypeScript Interfaces

**Read model** (from 2026-05-29):
```ts
interface SessionTreeMeta {
  rootSessionId: string
  depth: number
  childCount: number
  descendantCount: number
}

interface SessionNodeSnapshot {
  session: SessionSummary
  tree: SessionTreeMeta
}

interface SessionGraphEvent {
  kind: 'created' | 'updated' | 'archived' | 'restored' | 'destroyed'
  graphVersion: number
  origin: 'renderer' | 'local-cli' | 'session' | 'system'
  initiatorSessionId: string | null
  node: SessionNodeSnapshot
}
```

**Subagent types** (from 2026-06-10):
```ts
interface SubagentListItem {
  name: string
  id: string
  parentSessionId: string
  type: SessionType
  title: string
  phase: string
  resultStatus: SubagentResultSummary['status'] | null
  updatedAt: string
}

interface SubagentResult {
  sessionId: string
  parentSessionId: string
  inputEpoch: number
  status: 'completed' | 'failed' | 'blocked' | 'cancelled'
  title: string | null
  body: string
  createdAt: string
  updatedAt: string
}

interface SubagentResultSummary {
  status: 'completed' | 'failed' | 'blocked' | 'cancelled'
  title: string | null
  createdAt: string
  updatedAt: string
  hasBody: boolean
}

interface SubagentWaitAggregate {
  mode: 'all' | 'any'
  conditionMet: boolean
  overallStatus: 'complete' | 'partial' | 'timeout' | 'failed'
  timeoutMs: number | null
  elapsedMs: number
  targets: Array<SubagentWaitCompletedTarget | SubagentWaitPendingTarget | SubagentWaitErrorTarget>
}
```

**SessionSummary extension** (from 2026-06-10):
```ts
interface SessionSummary {
  // ... existing fields
  subagentName?: string | null
  subagentResultSummary?: SubagentResultSummary | null
}

interface InternalSubagentFacadeState {
  subagentInputEpoch?: number
  subagentLatestInputAt?: string
  subagentResult?: SubagentResult | null
}
```

### 10. Error Envelope Extension

```ts
type SubagentCommandErrorCode =
  | 'unknown_subagent'
  | 'ambiguous_subagent_name'
  | 'duplicate_subagent_name'
  | 'subagent_result_forbidden'
  | 'invalid_input_source'
  | 'invalid_result_status'
  | 'interrupt_unsupported'

interface SessionCommandErrorEnvelope {
  code:
    | 'unknown_session' | 'unknown_project'
    | 'forbidden_visibility_scope' | 'forbidden_authority_scope'
    | 'invalid_parent_session' | 'cross_project_parent_forbidden'
    | 'internal_error'
    | SubagentCommandErrorCode
  message: string
  nextSteps: string[] | null
}
```

Invisible targets return `unknown_subagent` (never `forbidden_visibility_scope`). Full body read failures return `forbidden_authority_scope`.

### 11. Capabilities Schema

```ts
interface StoaCtlCapabilitiesSupports {
  sessionList: boolean
  sessionInspect: boolean
  sessionStatus: boolean
  sessionInput: boolean
  sessionCreate: boolean
  sessionDestroy: boolean
  sessionWait: boolean
  sessionOutput: boolean
  sessionCompletionReport: boolean
  subagentList: boolean
  subagentDispatch: boolean
  subagentWait: boolean
  subagentInput: boolean
  subagentStop: boolean
  subagentResult?: boolean  // only true for child/subagent callers
}
```

### 12. Test File Targets

**CLI unit tests**: `tools/stoa-ctl/index.test.ts`
- InputSource parsing (`--text|--file|--stdin` mutual exclusion)
- `session prompt` removal, `session input` route
- `subagent dispatch` output (name + id)
- `subagent list` excludes root sessions
- `subagent wait` all/any modes
- Aggregate exit code rules
- Root session ID as `<subagent>` target → `unknown_subagent`
- `subagent result` status validation
- `subagent stop` mode validation

**Control/Supervisor tests**:
- `src/core/session-control-server.test.ts` (extended)
- `src/core/session-supervisor.test.ts` (extended)
- `src/core/subagent-supervisor.test.ts` (new, if facade service added)

**Bootstrap prompt tests**: `src/core/session-bootstrap-prompt-service.test.ts`
- Root prompt: no `subagent result`
- Child prompt: `subagent result` present
- No `session prompt` in prompts
- Uniform `--text|--file|--stdin` in prompts
- No `--artifact` in prompts

**E2E / Behavior Assets**:
- `testing/behavior/stoactl-subagent-control.ts` (new/updated)
- `testing/journeys/stoactl-subagent-control.journey.ts` (new/updated)
- Generated via `npm run test:generate`; never hand-edited

### 13. Implementation Order (2026-06-10)

1. Add shared types: subagent alias projection, result, wait aggregate.
2. Add or extend supervisor facade, reusing `SessionSupervisor`.
3. Add control endpoints.
4. Update `stoa-ctl` CLI parser and output.
5. Delete `session prompt`, add `session input`.
6. Update bootstrap prompt (distinguish root vs child).
7. Add CLI / control / supervisor / bootstrap tests.
8. Add behavior and journey assets.
9. Regenerate generated tests and run quality gate.

### 14. Quality Gate

```bash
npm run test:generate
npm run typecheck
npx vitest run
npm run test:e2e
npm run test:behavior-coverage
```

Or one-shot: `npm run test:all`.

### 15. Design Language Constraints (`docs/engineering/design-language.md`)

- **Token-only**: No hardcoded colors, shadows, radii, stroke widths, or motion timings.
- **Material system**: `var(--mica)` for durable surfaces, `var(--mica-alt)` for alternate, `var(--surface-solid)` for dense/terminal-adjacent, `var(--acrylic)` for transient overlays/menus/dialogs, `var(--smoke)` for modal blocking.
- **Text**: `var(--text-strong)` headings, `var(--text)` body, `var(--muted)`/`var(--subtle)` secondary.
- **Control**: `var(--control-fill)` resting, `var(--control-fill-hover)` hover, `var(--control-fill-active)` pressed, `var(--stroke-control)` boundaries, `var(--stroke-divider)` separators, `var(--accent)`/`var(--active-fill)` selected/focus/primary.
- **Typography**: `--font-ui` for UI text, `--font-mono` for terminal logs, file paths, session IDs, timestamps, code, command identifiers.
- **Motion**: `var(--duration-rest)` ordinary, `var(--duration-emphasized)` overlays, `var(--curve-standard)` ordinary, `var(--curve-decelerate)` entering.
- **Elevation**: `var(--shadow-card)` low, `var(--shadow-flyout)` transient.
- **Preserve**: renderer topology and `data-testid` attributes during visual-only work.
- **Scope**: production renderer UI, preview HTML, new frontend modules, refactors, interaction styling.

## Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Unified session tree contract | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 1-1219 |
| `SessionSupervisor` and host modules | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 691-813 |
| Authority matrix | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 424-432 |
| Visibility rule `V(S)` | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 319-365 |
| `SessionGraphEvent` envelope | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 884-891 |
| Error envelope | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 1097-1115 |
| Gap analysis findings | `research/2026-06-09-stoactl-subagent-control-gap-analysis.md` | lines 22-32, 73-117 |
| Subagent control design spec | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 1-1306 |
| Short name rules | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 157-194 |
| InputSource unification | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 244-261 |
| Breaking rename `session prompt` → `session input` | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 263-288 |
| `dispatch` atomicity | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 290-341 |
| `wait` aggregate contract | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 343-461 |
| `result` self-report | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 463-543 |
| Stale epoch guard | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 545-567 |
| `stop` modes | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 599-615 |
| CLI usage block | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 662-688 |
| HTTP routes | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 762-781 |
| Subagent TypeScript types | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 367-406, 504-523, 783-850 |
| Error code extension | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 1064-1098 |
| Capabilities schema | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 874-901 |
| Authority matrix extension | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 1006-1025 |
| Test targets | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 1119-1236 |
| Implementation order | `docs/superpowers/specs/2026-06-10-stoa-ctl-subagent-control-design.md` | lines 1258-1268 |
| Design language tokens | `docs/engineering/design-language.md` | lines 1-154 |

## Risks / Unknowns

- [!] The subagent control design spec is a breaking change: `session prompt` must be fully removed across CLI, HTTP routes, IPC channels, capabilities, and bootstrap prompts. No alias or compatibility forwarding.
- [!] `subagentInputEpoch` is internal-only and must not be exposed as a `<subagent>` target, task ID, or dispatch ID. Any IPC/host-side input path that delivers text to a backing subagent session must go through the same `recordSubagentInput` hook.
- [!] Full result body must never enter `SessionSummary`, `SessionNodeSnapshot`, `session list`, `session inspect`, or `SessionGraphEvent` push. Only `SubagentResultSummary` is projected generically.
- [!] Hidden alias blockers must not leak existence, archived state, branch, or formal ID. Only visible blockers can expose formal ID and phase.
- [!] Aggregate commands (`subagent wait`, `subagent stop`) always return `ok: true` for valid requests, including timeout and per-target errors. Per-target `unknown_subagent` does not map to exit code `6`.
- [?] Final UI treatment for subagent list, inbox, and decision gates is not defined in the spec. CLI contract can land first; UI may follow separately.
- [?] The `interrupt_unsupported` error must be returned per-target when the provider/runtime does not support interruption. Integration with existing runtime interruption handling needs careful design to avoid conflict with archive/destroy semantics.

## Context Handoff

Start here: `research/2026-06-10-stoactl-subagent-control-reference-summary.md`

Context only. Use this report plus the cited source documents as the source of truth for the next design or implementation step.
