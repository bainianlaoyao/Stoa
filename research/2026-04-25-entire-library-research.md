---
date: 2026-04-25
topic: Entire (company) - Checkpoints Product Deep Dive
status: completed
mode: deep-research
sources: entireio/cli source code, docs.entire.io, TechCrunch, SiliconANGLE, Tech Stackups
---

## Context Report: Entire Company & Checkpoints Product

### Why This Was Gathered
Understanding Entire's Checkpoints product in detail for comparison with EvoMap Evolver's native pipeline. Need exact data model, storage format, and capabilities.

### Company Overview

| Attribute | Value |
|-----------|-------|
| **Name** | Entire (entire.io) |
| **Founder** | Thomas Dohmke (former GitHub CEO, 2021-2025) |
| **Funding** | $60M seed round (largest dev tools seed on record) |
| **Valuation** | $300M |
| **Lead Investor** | Felicis (with Madrona, Microsoft M12, Basis Set) |
| **Team** | 15 employees, remote-first, growing to 30+ |
| **Mission** | Build the world's next developer platform for humans + AI agents |

### Platform Vision (Three Components)

| Component | Status | Description |
|-----------|--------|-------------|
| **Git-compatible Database** | ✅ Shipped with Checkpoints | Unifies code, intent, constraints, reasoning in version-controlled system |
| **Semantic Reasoning Layer** | 🔜 Roadmap | Context graph for multi-agent coordination |
| **AI-native SDLC Interface** | 🔜 Roadmap | UI for reviewing/approving/deploying hundreds of changes per day |

### Product: Entire CLI (Checkpoints)

**Open source, MIT licensed**. GitHub: `entireio/cli` (~4K stars, Go)

#### Install
```bash
curl -fsSL https://entire.io/install.sh | sh
cd your-repo && entire enable
```

#### How It Works
1. `entire enable` injects Git hooks + Agent hooks (non-invasive — listens to events agents already emit)
2. Normal agent coding session proceeds
3. On `git commit` → Checkpoint auto-created
4. On `git push` → `entire/checkpoints/v1` branch synced

#### Supported Agents
Claude Code, Gemini CLI, OpenCode, Cursor, GitHub Copilot CLI, Factory Droid, Codex (preview)
External Agent Plugin API available for custom integrations.

---

### Checkpoint Data Model (from source code)

#### Checkpoint Types

| Type | Storage | Contents | Use Case |
|------|---------|----------|----------|
| **Temporary** | Shadow branch (`entire/<commit-hash>`) | Full state (code + metadata) | Intra-session rewind, pre-commit |
| **Committed** | `entire/checkpoints/v1` branch | Metadata + commit reference | Permanent record, post-commit |

#### CommittedMetadata Schema

```json
{
  "checkpoint_id": "a3b2c4d5e6f7",
  "session_id": "uuid",
  "strategy": "manual-commit",
  "created_at": "2026-01-20T10:30:00Z",
  "branch": "main",
  "checkpoints_count": 3,
  "files_touched": ["file1.txt", "file2.txt"],
  "agent": "Claude Code",
  "turn_id": "optional-correlation-id",
  "is_task": false,
  "tool_use_id": "",
  "transcript_identifier_at_start": "last-uuid-when-checkpoint-started",
  "checkpoint_transcript_start": 42,
  "token_usage": {
    "input_tokens": 1500,
    "cache_creation_tokens": 200,
    "cache_read_tokens": 800,
    "output_tokens": 500,
    "api_call_count": 3,
    "subagent_tokens": { }
  },
  "initial_attribution": {
    "calculated_at": "2026-01-20T10:30:00Z",
    "agent_lines": 42,
    "human_added": 5,
    "human_modified": 3,
    "human_removed": 1,
    "total_committed": 47,
    "agent_percentage": 89.4
  },
  "summary": {
    "intent": "what user wanted",
    "outcome": "what was achieved",
    "learnings": {
      "repo": ["repo-specific-patterns"],
      "code": [{ "path": "file.go", "line": 42, "finding": "..." }],
      "workflow": ["dev-practice"]
    },
    "friction": ["problems encountered"],
    "open_items": ["tech debt, unfinished work"]
  }
}
```

Source: `cmd/entire/cli/checkpoint/checkpoint.go` (Go structs)

#### Transcript Format (full.jsonl)

Complete conversation events as JSONL. Each line is a normalized Event:

```typescript
interface Event {
  type: 'SessionStart' | 'TurnStart' | 'TurnEnd' |
        'Compaction' | 'SessionEnd' |
        'SubagentStart' | 'SubagentEnd'
  session_id: string
  prompt?: string              // User prompt (on TurnStart)
  tool_use_id?: string         // Tool invocation ID
  subagent_id?: string         // Subagent instance ID
  tool_input?: json.RawMessage // Raw tool input JSON
  response_message?: string
  metadata?: map[string]string
  timestamp: time.Time
}
```

Source: `cmd/entire/cli/agent/event.go`

#### Storage Layout

```
entire/checkpoints/v1/
  <id[:2]>/<id[2:]>/           # Sharded by checkpoint ID
    metadata.json               # CheckpointSummary (aggregated stats)
    <session-index>/
      metadata.json             # CommittedMetadata (per-session)
      full.jsonl                # Full transcript (JSONL)
      full.jsonl.001            # Chunked if > MaxChunkSize
      prompt.txt                # User prompts
      context.md                # Generated context
      content_hash.txt          # Content verification
```

#### Temporary Checkpoint (Shadow Branch)

```
entire/<commit[:7]>-<worktreeHash[:6]>/
  <worktree files...>           # Full file snapshot
  .entire/metadata/<session-id>/
    full.jsonl                  # Complete transcript
    prompt.txt                  # User prompts
    context.md                  # Generated context
    tasks/<tool-use-id>/        # Task checkpoints (subagent)
```

#### Line Attribution (InitialAttribution)

Compares **checkpoint tree** (agent's work on shadow branch) against **committed tree** (after human edits):

| Field | Calculation |
|-------|-------------|
| `AgentLines` | Lines agent added (shadow diff vs base commit) |
| `HumanAdded` | Lines human added after checkpoint |
| `HumanModified` | Estimated via `min(added, removed)` heuristic |
| `HumanRemoved` | Lines human removed |
| `TotalCommitted` | Net additions in final commit |
| `AgentPercentage` | `agent_lines / total_committed * 100` |

Source: `cmd/entire/cli/checkpoint/checkpoint.go#L477-L499`

#### Key Capabilities

1. **Full Transcript**: Captures ALL user prompts, agent responses, tool calls with arguments
2. **Line Attribution**: Distinguishes human vs agent code at line granularity
3. **Rewind**: Can restore to any checkpoint's exact file state (shadow branches)
4. **Subagent Tracking**: `SubagentStart`/`SubagentEnd` with file diffs per task
5. **Token Usage**: Per-checkpoint API cost tracking
6. **AI Summaries**: Auto-generated intent/outcome/learnings/friction/open_items
7. **Bidirectional Git Link**: Commit → Checkpoint, Checkpoint → Commit via trailer
8. **Concurrent Sessions**: Multiple sessions per checkpoint with interleaving support

#### Is Entire a Learning System?

**NO.** Entire is a **recording layer**, not a learning system.

- `Summary.Learnings` is AI-generated per-checkpoint summary — not aggregated knowledge
- No model weights, no RAG pipeline, no cross-session pattern inference
- The "learning" is passive: `entire explain <id>` shows summary for **humans** to learn
- No automatic improvement of future agent behavior based on history

### Web Platform (entire.io)

| Module | Description |
|--------|-------------|
| Dashboard | AI coding activity overview |
| Checkpoints | Browse by branch, search, navigate snapshots |
| Sessions | Full conversation, tool calls, token usage, line attribution |
| Repositories | Connect/manage GitHub repos |

### Competitive Positioning

Not a GitHub competitor — an **abstraction layer on top of GitHub**. In the full vision, developers would no longer interact with GitHub directly. Instead, agents handle PRs/reviews and developers get a higher-level view with full context of all agents and humans that contributed to code.

Source: Tech Stackups analysis — "Dohmke is not seeking to build a GitHub competitor, but rather a full abstraction layer that sits on top of GitHub."

### Evidence Chain

| Finding | Source |
|---------|--------|
| Company founding & funding | [TechCrunch](https://techcrunch.com/2026/02/10/former-github-ceo-raises-record-60m-dev-tool-seed-round-at-300m-valuation) |
| Platform three-component vision | [entire.io/blog/hello-entire-world](https://entire.io/blog/hello-entire-world) |
| Checkpoint data model | [entireio/cli](https://github.com/entireio/cli) — `cmd/entire/cli/checkpoint/checkpoint.go` |
| Event types | [entireio/cli](https://github.com/entireio/cli) — `cmd/entire/cli/agent/event.go` |
| Architecture docs | [docs.entire.io/architecture/sessions-and-checkpoints.md](https://docs.entire.io/cli/checkpoints) |
| Hands-on analysis | [Tech Stackups](https://techstackups.com/guides/entire-io-hands-on-what-it-actually-captures/) |
| Docs index | [docs.entire.io/llms.txt](https://docs.entire.io/llms.txt) |
| Company page | [entire.io/company](https://entire.io/company) |
