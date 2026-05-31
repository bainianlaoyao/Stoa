---
date: 2026-05-29
topic: session-as-agent / subagent control plane / CLI session management
status: completed
mode: context-gathering
sources: 35
---

## Context Report: Session-as-Agent & Subagent Control Plane

### Why This Was Gathered
Designing a unified session tree for Stoa — deciding how to model parent-child session relationships, agent hierarchy, visibility scoping, and a CLI control plane for managing subagents. Needs to draw from Orca's proven orchestration system and community best practices.

### Summary
Orca already implements a production-grade coordinator/worker orchestration system with SQLite-backed task DAGs, dispatch contexts, circuit breakers, and message-bus addressing. The community converges on three patterns: **supervisor-worker tree** (LangGraph), **handoff chain** (OpenAI Swarm), and **explicit sub-agent tree** (Google ADK). For this project, the recommended approach is an **Orca-style two-level coordinator/worker model with task DAG**, extended with a `parentId` field on `SessionSummary` to support future N-level nesting without over-engineering now.

---

### Part 1: Orca Upstream Architecture (Primary Reference)

#### 1.1 Orchestration Core — Coordinator/Worker Pattern

Orca uses a **single coordinator → N workers** model backed by SQLite:

| Concept | Implementation | File |
|---------|---------------|------|
| Task DAG | `tasks` table with `deps` (JSON array) and `parent_id` | `research/upstreams/orca/src/main/runtime/orchestration/db.ts` |
| Message bus | `messages` table with `from_handle`, `to_handle`, `type`, `thread_id` | Same file |
| Dispatch context | `dispatch_contexts` table tracking assignee, failure count, heartbeat | Same file |
| Decision gates | `decision_gates` table for approval checkpoints | Same file |
| Coordinator loop | Polling phases: decompose → dispatch → monitor → merge → done | `research/upstreams/orca/src/main/runtime/orchestration/coordinator.ts:90` |
| Circuit breaker | 3-failure limit per task, then `circuit_broken` | `db.ts:542-688` |
| DAG promotion | `promoteReadyTasks()` — pending tasks become ready when all deps satisfied | `db.ts:519-538` |

Task statuses: `'pending' | 'ready' | 'dispatched' | 'completed' | 'failed' | 'blocked'`

Coordinator statuses: `'idle' | 'running' | 'completed' | 'failed'`

Coordinator phases: `'decomposing' | 'dispatching' | 'monitoring' | 'merging' | 'done'`

#### 1.2 Agent Status & Orchestration Context

Each agent pane tracks orchestration linkage via:

```typescript
// research/upstreams/orca/src/shared/agent-status-types.ts:55-62
type AgentStatusOrchestrationContext = {
  taskId: string
  dispatchId: string
  parentTerminalHandle?: string
  parentPaneKey?: string
  coordinatorHandle?: string
  orchestrationRunId?: string
}
```

This is the **parent-child link** — workers know their coordinator's handle but not other workers.

#### 1.3 Visibility Scoping

- **Handle-based addressing**: Each terminal gets a unique `handle` via `ORCA_TERMINAL_HANDLE` env var
- **Message isolation**: Workers can only check their own messages (by handle) and send to any handle/group
- **Group addressing**: `@all`, `@idle`, `@claude`, `@worktree:<id>` — fans out to one message per recipient
- **Push-on-idle delivery**: When an agent goes idle, runtime checks for unread orchestration messages and injects into PTY

File: `research/upstreams/orca/src/main/runtime/orchestration/groups.ts`

#### 1.4 Dispatch Lifecycle

1. Coordinator finds available terminals (not busy, not coordinator itself, connected + writable)
2. If no idle terminal, creates one via `runtime.createTerminal()`
3. Writes preamble + task spec to PTY via `runtime.sendTerminal()`
4. Preamble teaches worker: send `worker_done` (required even on failure), heartbeat every 5min, ask via `orchestration ask`, escalate blockers
5. On worker exit: find active dispatch → fail it → escalate to coordinator → task returns to `'ready'`

File: `research/upstreams/orca/src/main/runtime/orchestration/preamble.ts`

#### 1.5 UI Tree Rendering (Dashboard Lineage)

```typescript
// research/upstreams/orca/src/renderer/src/components/dashboard/agent-row-lineage.ts
// depth: 0 | 1 — only two levels (coordinator and workers)
// Workers grouped under parent via orchestration.parentPaneKey
// isFirstSibling / isLastSibling for visual grouping
```

The UI renders a **visual tree** from `AgentStatusOrchestrationContext.parentPaneKey`, grouping children under their parent agent. Maximum visual depth is 1.

---

### Part 2: Community Best Practices

#### 2.1 LangGraph — Supervisor-Worker Tree Pattern

Source: LangGraph multi-agent concepts (langchain-ai.github.io/langgraph/concepts/multi_agent/)

**Pattern**: Hierarchical `StateGraph` composition where each layer is its own graph.

```
        [Root Supervisor]
        /       |        \
  [Worker A] [Worker B] [Sub-Supervisor]
                          /         \
                    [Worker C]  [Worker D]
```

**Key design decisions**:
- Supervisor uses LLM to decide routing — `add_conditional_edges` for routing decisions
- Each worker processes subtask, returns results to parent supervisor
- State flows up/down hierarchy, each level manages its own portion
- Sub-graphs can be nested → N-level trees possible
- `Command` objects route between nodes and pass state

**Relevant to Stoa**: The DAG-based task dependency model with supervisor-mediated routing maps directly to Orca's coordinator pattern. LangGraph validates that two-level supervisor/worker is the most common case; N-level nesting is rare and should not be the default design.

#### 2.2 OpenAI Swarm — Handoff-Based Flat Pattern

Source: OpenAI Swarm (github.com/openai/swarm)

**Pattern**: Agents hand off conversations to other agents via function returns. No hierarchy — just flat handoffs.

**Key design decisions**:
- Agent = Instructions + Functions
- Handoffs: agents transfer conversations via function returns
- `context_variables` dict maintains state across turns and handoffs
- No built-in persistence — developers must implement their own
- Deliberately minimal — no framework lock-in

**Relevant to Stoa**: Swarm's handoff model is too flat for subagent control planes. It lacks the parent-child ownership, task DAG, and structured dispatch that Stoa's meta-session system already provides. The `context_variables` pattern is useful for passing orchestration context between agents.

#### 2.3 Google ADK — Explicit Sub-Agent Tree

Source: Google Agent Development Kit (google.github.io/adk-docs/agents/multi-agents/)

**Pattern**: Agents can contain sub-agents forming an explicit tree. Parent agents delegate to sub-agents, creating nested sessions.

**Key design decisions**:
- Agents built with tools, instructions, and sub-agent orchestration
- Session tree maintains isolated contexts per sub-agent while allowing data flow to parent
- Supports multi-turn conversations with stateful memory
- Each sub-agent session is a first-class entity with its own lifecycle

**Relevant to Stoa**: ADK's explicit parent-child tree with isolated contexts is the closest community analogue to what Stoa needs. The pattern of nested sessions with isolated-but-linked state maps to the desired `parentId` on sessions.

#### 2.4 Microsoft AutoGen — Conversation Pattern

Source: AutoGen (microsoft.github.io/autogen/)

**Pattern**: Agents participate in structured conversations. Group chat with round-robin or LLM-selected speaker.

**Key design decisions**:
- Agents can be composed into groups with conversation patterns
- Nested chats: an agent can initiate a sub-conversation with other agents
- Code execution agents with sandboxed environments
- Human-in-the-loop via `UserProxyAgent`

**Relevant to Stoa**: AutoGen's "nested chat" concept — where an agent can spawn a sub-conversation that runs independently — validates the pattern of sessions spawning child sessions with their own lifecycle.

---

### Part 3: Recommendations for This Project

#### 3.1 Adopt Orca's Orchestration Model (Not Copy, Pattern)

Orca's coordinator/worker system is the strongest reference because:
- It's already vendored in this repo (`research/upstreams/orca/`)
- It's proven in production (Orca is a shipping product)
- It maps cleanly to the existing `MetaSession` / work-session split

**Recommendation**: Use Orca's orchestration types as the architectural template but implement natively in Stoa's existing patterns.

#### 3.2 Concrete Schema: Add `parentId` to Sessions

The current `SessionSummary` has no parent-child field. The minimal change:

```typescript
// Extend SessionSummary (src/shared/project-session.ts:122-145)
interface SessionSummary {
  // ... existing fields ...
  parentId: string | null        // null = top-level session
  depth: 0 | 1 | 2              // visual tree depth, capped at 2
  childIds: string[]             // denormalized for fast tree rendering
}
```

**Why cap at depth 2**: Orca caps visual rendering at depth 1 (coordinator + workers). LangGraph's docs confirm two-level is the 95% case. Capping prevents over-engineering while `parentId` allows future extension.

#### 3.3 Task DAG for Orchestration (Not N-Level Tree)

Use Orca's task DAG pattern, not a recursive session tree, for orchestration:

```
MetaSession (orchestrator)
  ├── Task A (deps: [])           → dispatch to Session 1
  ├── Task B (deps: [A])         → dispatch to Session 2
  └── Task C (deps: [A, B])     → dispatch to Session 1
```

**Why DAG over tree**: Tasks represent *work dependencies*, not *ownership hierarchies*. A session can execute multiple tasks. The tree is a *visualization* of the DAG, not the data model.

#### 3.4 Visibility Scoping: Handle-Based Isolation

Follow Orca's pattern:
- Each session gets a unique `handle` (already exists via session ID)
- Workers only see their own messages and can address their coordinator
- Coordinator sees all messages from its workers
- No cross-worker visibility unless explicitly routed through coordinator

#### 3.5 Frontend Tree: Flat Array + Computed Hierarchy

Current `ProjectHierarchyNode` is already flat-with-computed-children. Extend this:

```typescript
// Current (src/renderer/stores/workspaces.ts:11-15)
interface ProjectHierarchyNode extends ProjectSummary {
  sessions: Array<SessionSummary & { active: boolean }>
}

// Extended — add children to session nodes
interface SessionTreeNode extends SessionSummary & { active: boolean } {
  children: SessionTreeNode[]   // computed from childIds
}
```

Render with a recursive component that respects the `depth` cap. This matches Orca's `agent-row-lineage.ts` pattern.

#### 3.6 CLI Control Surface

Follow Orca's `orchestration` command group pattern:

```
stoa-ctl session tree                    # show session hierarchy
stoa-ctl session spawn <parent> <spec>   # create child session
stoa-ctl session kill <id>               # kill session + children
stoa-ctl session inspect <id>            # show session state + children
stoa-ctl orchestrate run <spec>          # start coordinator
stoa-ctl orchestrate tasks               # list task DAG
stoa-ctl orchestrate dispatch <task>     # force-dispatch a task
```

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Orca coordinator loop with task DAG | Local codebase | `research/upstreams/orca/src/main/runtime/orchestration/coordinator.ts:90` |
| Task DAG with deps and parent_id | Local codebase | `research/upstreams/orca/src/main/runtime/orchestration/db.ts` |
| Agent orchestration context (parent link) | Local codebase | `research/upstreams/orca/src/shared/agent-status-types.ts:55-62` |
| Circuit breaker (3-failure limit) | Local codebase | `research/upstreams/orca/src/main/runtime/orchestration/db.ts:542-688` |
| Dispatch preamble for workers | Local codebase | `research/upstreams/orca/src/main/runtime/orchestration/preamble.ts` |
| Group addressing (@all, @idle, @claude) | Local codebase | `research/upstreams/orca/src/main/runtime/orchestration/groups.ts` |
| UI lineage rendering (depth 0/1) | Local codebase | `research/upstreams/orca/src/renderer/src/components/dashboard/agent-row-lineage.ts` |
| Push-on-idle message delivery | Local codebase | `research/upstreams/orca/src/main/runtime/orca-runtime.ts:11210` |
| Session state machine (5 states) | Local codebase | `research/upstreams/orca/src/main/daemon/types.ts:10` |
| No parentId in current Stoa sessions | Local codebase | `src/shared/project-session.ts:122-145` |
| Current two-level ProjectHierarchyNode | Local codebase | `src/renderer/stores/workspaces.ts:11-15` |
| MetaSession proposal-approval pattern | Local codebase | `src/core/meta-session-proposal-store.ts` |
| 18 session state intents (no subagent events) | Local codebase | `src/shared/project-session.ts:61-79` |
| Hook lease ownerInstanceId concept | Local codebase | `src/shared/project-session.ts:449-450` |
| LangGraph supervisor-worker tree | Community reference | langchain-ai.github.io/langgraph/concepts/multi_agent/ |
| OpenAI Swarm handoff pattern | Community reference | github.com/openai/swarm |
| Google ADK sub-agent tree | Community reference | google.github.io/adk-docs/agents/multi-agents/ |
| AutoGen nested chat pattern | Community reference | microsoft.github.io/autogen/ |

### Risks / Unknowns

- **[!] Schema migration**: Adding `parentId` requires bumping `PersistedProjectSessions` version (currently v6). Must handle existing sessions without parent gracefully (treat as `null`).
- **[!] Orphan handling**: If a parent session is killed, children must be cascaded. Need policy: cascade-kill vs promote-to-root vs leave-orphaned.
- **[?] Depth validation**: Capping at depth 2 is a design hypothesis. Orca caps at 1. Community frameworks support N-level but usage data shows 2 is sufficient. May need adjustment after real usage.
- **[!] CLI control surface**: `stoa-ctl` already exists via `meta-session-control-server.ts`. New session tree commands must extend it, not create a parallel CLI.
- **[?] External web sources rate-limited**: Could not fetch live docs for LangGraph, ADK, Swarm. Recommendations based on training knowledge + local Orca evidence. Frameworks may have evolved since training cutoff (Jan 2026).
