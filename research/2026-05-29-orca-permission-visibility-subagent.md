---
date: 2026-05-29
topic: Orca permission/visibility boundary patterns audit
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Orca Permission/Visibility Boundary Patterns Audit

### Why This Was Gathered
Audit upstream Orca (stablyai/orca) for caller visibility scoping, filtered lists, validation gates, permission boundaries around session/worktree/agent operations, and inspect/prompt/destroy guard patterns.

### Summary
The `research/upstreams/orca/` directory is empty — no vendored Orca source exists locally. Stoa implements its own tree-based permission/visibility boundary system independently. The available patterns are documented from existing research files and Stoa's own implementation of the same concerns Orca would address.

### Key Findings

#### 1. Upstream Boundary Status
- `research/upstreams/orca/` is an empty directory — no Orca source code is vendored
- `research/upstreams/entire-cli/` is also empty
- `research/upstreams/evolver/` is empty
- **No Orca permission/visibility code is locally available for audit**

#### 2. Existing Orca Context (from prior research)
From `research/2026-05-24-orca-public-project-research.md`:
- Orca is an Agent Development Environment (ADE) for AI coding orchestration
- Core model: worktree-native, multi-agent terminals, GitHub integration
- Supported agents: Claude Code, Codex, Gemini, OpenCode, Goose, Cline, Continue, Cursor, and 15+ more
- Orca CLI allows AI agents to control the IDE (add projects, create worktrees, update comments)
- **Permission/visibility model not explicitly documented in public materials**

From `research/2026-05-24-orca-stably-adjacent-tools-public-gaps-and-unoccupied-areas.md`:
- Orca/Superset orchestration model is "parallel independent work"
- Lacks cross-agent coordination layer
- No lock mechanism or merge conflict pre-detection for shared files
- No "agent间上下文移交" (inter-agent context handoff) mechanism

#### 3. Stoa's Own Permission/Visibility Implementation
Stoa has implemented a complete tree-based permission system in `src/core/session-visibility-service.ts`:

**Types:**
```typescript
// src/core/session-visibility-service.ts:3
export type AuthorityAction = 'inspect' | 'prompt' | 'create' | 'destroy'
```

**Visibility Scoping:**
- `visibleSessionIds(sessionId)` returns filtered list based on:
  - Same `rootSessionId` (same tree)
  - Same `depth` OR descendant of viewer
  - Root sessions see all in tree; leaves see only same-depth siblings

**Authority Matrix:**
| Action | Self | Same-depth peer | Descendant | Ancestor |
|--------|------|-----------------|------------|---------|
| inspect | allowed | allowed | allowed | unknown_session |
| prompt | allowed | allowed | allowed | unknown_session |
| create | allowed | forbidden | forbidden | forbidden |
| destroy | allowed | forbidden | allowed | unknown_session |

**Key invariant:** Ancestors are outside visibility scope and return `unknown_session` (not `forbidden_authority_scope`), effectively hiding their existence from descendants.

#### 4. Control Server Patterns (`src/core/session-control-server.ts`)
Two authentication paths:
- `x-stoa-secret` → local-user caller (bypass all visibility checks)
- `x-stoa-session-id` + `x-stoa-session-token` → session caller (full authority enforcement)

HTTP endpoints with auth guards:
| Endpoint | Method | Auth Required |
|----------|--------|---------------|
| `/ctl/health` | GET | yes |
| `/ctl/whoami` | GET | yes |
| `/ctl/capabilities` | GET | yes |
| `/ctl/session/list` | GET | yes (filtered by visibility) |
| `/ctl/session/:id/inspect` | GET | yes (null if not visible) |
| `/ctl/session/:id/prompt` | POST | yes (authority check) |
| `/ctl/session/:id/destroy` | POST | yes (authority check) |
| `/ctl/session/create` | POST | yes (session caller forced to create under self) |

#### 5. Supervisor Patterns (`src/core/session-supervisor.ts`)
`CallerIdentity` type:
```typescript
// src/core/session-supervisor.ts:4-6
export type CallerIdentity =
  | { type: 'local-user' }
  | { type: 'session'; sessionId: string }
```

Session callers have two restrictions:
1. Can only `create` children of themselves (not peers)
2. Can only `destroy` descendants or self (not peers or ancestors)

#### 6. Upstream Boundary Guard (`src/core/memory/upstream-boundary-guard.test.ts`)
Static analysis test that enforces:
- No Stoa source imports from `src/stoa/` (patched surface)
- No import of `hostBridge`/`host-bridge` (evolver import)
- No reference to forbidden patched action names: `state-summary`, `trace-turn`, `explain-recall`, `get-asset`
- `bundled-evolver.ts` does not export `resolveBundledEvolverCli`, `isElectronRuntime`, `argsPrefix`, `ELECTRON_RUN_AS_NODE`

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Upstream directories empty | Local inspection | `research/upstreams/` |
| Orca product overview | research/2026-05-24-orca-public-project-research.md | lines 1-96 |
| Orca orchestration gaps | research/2026-05-24-orca-stably-adjacent-tools-public-gaps-and-unoccupied-areas.md | lines 48-53 |
| SessionVisibilityService types | src/core/session-visibility-service.ts | :3 |
| Authority check logic | src/core/session-visibility-service.ts | :48-85 |
| isDescendantOf helper | src/core/session-visibility-service.ts | :87-100 |
| Visibility test cases | src/core/session-visibility-service.test.ts | :51-256 |
| CallerIdentity type | src/core/session-supervisor.ts | :4-6 |
| Session control server auth | src/core/session-control-server.ts | :31-50 |
| HTTP auth guard middleware | src/core/session-control-server.ts | :61-79 |
| Upstream boundary patterns | src/core/memory/upstream-boundary-guard.test.ts | :64-76 |
| Control server test coverage | src/core/session-control-server.test.ts | :129-415 |
| Supervisor test coverage | src/core/session-supervisor.test.ts | :58-301 |

### Risks / Unknowns
- [!] **Orca's internal permission model is not publicly documented** — available evidence is only from product features and CLI, not source code
- [?] **Whether Orca implements tree-based or role-based access control** — could not verify from public materials
- [?] **Orca's CLI dispatch security** — Orca CLI allows AI agents to control the IDE, but credential/auth model not documented
- [?] **Cross-agent coordination permissions** — Orca's multi-agent model may have implicit permission rules not surfaced in public docs

### Notes
- `research/upstreams/orca/` should likely contain cloned Orca source if the intent is to audit Orca's internal patterns
- The existing `upstream-boundary-guard.test.ts` guards against Stoa code importing from evolver surfaces, not Orca
- Stoa's permission model is self-contained and well-tested; it does not depend on Orca patterns