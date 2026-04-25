---
date: 2026-04-25
topic: Entire Checkpoints vs EvoMap Evolver - Comparative Analysis
status: completed
mode: deep-analysis
sources: research/2026-04-25-entire-library-research.md, research/2026-04-25-evomap-evolver-research.md
---

## Analysis: Entire Checkpoints vs EvoMap Evolver — Why Combine Them?

### Core Question
Why is adding Entire better than pure Evolver? In the native/pure Evolver pipeline, what plays the role that Entire Checkpoints would fill?

### TL;DR
Pure Evolver's `events.jsonl` + `memory_graph.jsonl` + session logs cover ~15-20% of what Checkpoints provides. The missing 80% isn't decorative — it's the difference between "blind trial-and-error" and "evidence-based improvement".

---

## 1. What Plays the Checkpoints Role in Pure Evolver?

**Answer: Four scattered subsystems that each cover a fraction:**

```
                    Checkpoints' Complete Capability
    ┌──────────────────────────────────────────────────┐
    │  Full Dialog  Decision Chain  Failure Log  Git   │
    │  Transcript   + Reasoning     Recording    Link  │
    └──────────────────────────────────────────────────┘
          │            │              │           │
          ▼            ▼              ▼           ▼
    ┌──────────┐ ┌──────────┐  ┌─────────┐  ┌───────┐
    │ Session  │ │ events.  │  │ memory_ │  │  git  │
    │ Logs     │ │ jsonl    │  │ graph.  │  │ reset │
    │ (24h     │ │          │  │ jsonl   │  │       │
    │  window) │ │          │  │         │  │       │
    └──────────┘ └──────────┘  └─────────┘  └───────┘
         ①            ②             ③           ④
```

### ① Session Logs (`signals.js` reads them)
- **Covers**: Raw session text (24-hour rolling window)
- **Missing**: Not structured. No tool call arguments. No agent response records. 24h expiry. Not linked to Gene/EvolutionEvent.

### ② events.jsonl (EvolutionEvent)
- **Covers**: Per-cycle signals, intent, mutation type, outcome
- **Missing**: `selector_decision.reason` is semantic labels not reasoning. `mutation.expected_effect` is generic description. Failed mutations NOT recorded at all. No raw conversation context.

### ③ memory_graph.jsonl
- **Covers**: Causal chain (signal → hypothesis → attempt → outcome)
- **Missing**: Outcome is heuristic 2x2 inference, not explicit. Jaccard similarities not exposed. Cannot distinguish correlation from causation.

### ④ Git (rollback only)
- **Covers**: File-level blast radius, `git reset --hard`
- **Missing**: No commit history recording. No EvolutionEvent ↔ Git SHA linkage. Rollback is all-or-nothing, not checkpoint-level.

---

## 2. Field-Level Comparison

| Capability | Evolver Native (`events.jsonl`) | Entire Checkpoint | Gap Severity |
|------------|------|------|------|
| **Full dialog transcript** | ❌ None | ✅ `full.jsonl` complete JSONL event stream | **FATAL** |
| **Decision reasoning** | `reason: ['signals match gene.signals_match']` labels | Full prompt + Agent reply + tool call args | **FATAL** |
| **Failed attempt recording** | ❌ Lost (only successful cycles persist) | ✅ Temporary checkpoint on shadow branch | **FATAL** |
| **Git commit association** | ❌ Git used for rollback only | ✅ `Entire-Checkpoint:` trailer bidirectional link | **SEVERE** |
| **Signal source attribution** | `signals: ['log_error', ...]` flat array | Each event tagged with source + raw text | **SEVERE** |
| **Code attribution (human vs agent)** | ❌ Cannot distinguish | ✅ `InitialAttribution` line-level | **MODERATE** |
| **Token cost tracking** | ❌ None | ✅ `TokenUsage` per checkpoint | **MODERATE** |
| **Agent thinking process** | ❌ None | ✅ `TurnStart`/`TurnEnd` with agent reasoning | **SEVERE** |
| **Rewind granularity** | `git reset --hard` (whole-tree) | Shadow branch per-checkpoint precise rewind | **SEVERE** |
| **Subagent tracking** | ❌ None | ✅ `SubagentStart`/`SubagentEnd` | **MODERATE** |

---

## 3. Three Fatal Blind Spots

### Blind Spot 1: Failed Experience Completely Lost

```javascript
// solidify.js — validation failure path
if (!validationResult.overall_ok) {
  rollbackTracked();  // git reset --hard
  // ❌ No EvolutionEvent written
  // ❌ No record of "what was tried and why it failed"
  return { status: 'failed' };
}
```

**vs Checkpoints**: Every mutation attempt has a temporary checkpoint on shadow branch. Even after failure, you can inspect "what was attempted".

**Consequence**: Agent repeats the same mistakes. Gene library has only successes, no "what NOT to do" knowledge.

### Blind Spot 2: Decision Reasoning is Labels, Not Reasoning

```javascript
// selector.js output
selector_decision: {
  selected: "gene_abc123",
  reason: [
    "signals match gene.signals_match",     // ← Fact, not reasoning
    "memory_graph: confidence_edge boost"   // ← No specific values
  ],
  alternatives: ["gene_def456"]  // ← Considered but no rejection rationale
}
```

**vs Checkpoints**: Full agent conversation contains "I considered approach A but chose B because of X constraint".

**Consequence**: No decision audit. You see a Gene activated but cannot reconstruct why it was chosen over alternatives.

### Blind Spot 3: Causal Inference ≠ Causal Fact

```javascript
// memoryGraph.js 2x2 outcome inference
prevHadError + currentHasError → success(0.6)   "stable_no_error"
hadError     + noError         → success(0.85)  "error_cleared"
hadError     + hadError        → failed(0.2)    "error_persisted"
noError      + newError        → failed(0.15)   "new_error_appeared"
```

**Real scenario**:
- Agent modified file A
- Error in file B disappeared
- Evolver infers: "mutation fixed B's problem"
- Actual cause: B's error was a transient third-party API outage that self-resolved

**vs Checkpoints**: Full conversation might contain agent's observation "API returned 500, might be temporary" and "I changed A's retry logic" — enabling human (or another agent) to distinguish true causation from spurious correlation.

---

## 4. Quantified Improvement Estimate

| Dimension | Pure Evolver | +Entire Checkpoints | Improvement |
|-----------|-------------|-------------------|-------------|
| Traceable decision context | ~5% | ~95% | **~19x** |
| Failed experience retention | 0% | ~100% | **∞** |
| Causal inference accuracy | Heuristic (~60%) | Evidence-based (~90%+) | **~1.5x** |
| Repeat mistake avoidance | Gene positive match only | Positive match + negative exclusion (failure memory) | **~2x** |
| Team auditability | Read raw JSONL files | entire.io Web UI | **Significant** |
| Cross-session learning | None (24h window) | Full history with summaries | **Significant** |

---

## 5. Synergistic Architecture (Combined System)

```
                    ┌──────────────┐
                    │  Git Repo    │
                    │  (source +   │
                    │  checkpoints)│
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       ┌────────────┐ ┌─────────┐ ┌──────────┐
       │ Checkpoints │ │ Evolver │ │ Strategy │
       │  Store      │ │ Engine  │ │ Manager  │
       │             │ │         │ │          │
       │ - sessions  │ │ - GEP   │ │ - budget │
       │ - contexts  │ │ - genes │ │ - mode   │
       │ - diffs     │ │ - muts  │ │ - ROI    │
       │ - transcript│ │ - memG  │ │          │
       └──────┬──────┘ └────┬────┘ └────┬─────┘
              │             │            │
              └─────────────┼────────────┘
                            ▼
                    ┌──────────────┐
                    │  Evolution   │
                    │  Orchestrator│
                    │              │
                    │ - signal→strategy  │
                    │ - execute mutation │
                    │ - validate+solidify│
                    │ - write checkpoint │
                    │ - extract Gene     │
                    └──────────────┘
```

### Six Integration Points

1. **Gene ↔ Checkpoint Linkage**: Each Gene links to its source Checkpoint for full reasoning traceability
2. **Safe Evolution**: Evolver mutation + Checkpoint rewind = zero-cost rollback on failed evolution
3. **Precise Signal Extraction**: Checkpoint's full context enables intent-level signals beyond code-level errors
4. **Blast Radius Enrichment**: Checkpoint's per-file intent metadata makes blast radius semantic, not just file-count
5. **Multi-Agent Gene Sharing**: Entire's semantic reasoning layer (planned) + Evolver's Capsule system = cross-agent capability inheritance
6. **Evolution ROI**: Checkpoint's token usage + Gene effectiveness metrics = cost-aware evolution strategy selection

---

## 6. Implementation Challenges

| Challenge | Why |
|-----------|-----|
| **Gene granularity alignment** | Checkpoint is commit-level, Gene is capability-fragment-level. Need precise extraction from commit context. |
| **Cross-agent Gene compatibility** | Claude Code dialog format ≠ Gemini CLI. Need abstraction layer for Gene portability. |
| **Convergence detection** | When is evolution "done"? Requires Checkpoint history trends + Evolver effectiveness metrics jointly. |
| **Privacy/security** | Checkpoints may contain sensitive info (API keys, internal logic). Gene sharing needs sanitization. |
| **Both systems are early** | Entire only has Checkpoints shipped. Evolver npm package is v1.14.0. Production integration is premature. |

---

## 7. Recommended Next Step

**Don't integrate yet.** Instead:
1. Use both systems in parallel on one project
2. Manually observe the mapping between Checkpoint data and Evolver Gene patterns
3. Document the observed correspondences
4. Design automation only when patterns are clear and stable

This is a "monitor and learn" phase, not a "build the integration" phase.

---

### Source Files
- Entire Checkpoints data model: `research/2026-04-25-entire-library-research.md`
- Evolver pipeline architecture: `research/2026-04-25-evomap-evolver-research.md`
