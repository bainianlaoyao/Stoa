---
date: 2026-04-25
topic: EvoMap Evolver - Native Pipeline Architecture Deep Dive
status: completed
mode: deep-research
sources: autogame-17/evolver source code (src/gep/*, src/evolve.js), zread.ai docs
---

## Context Report: EvoMap Evolver Native Pipeline

### Why This Was Gathered
Understanding Evolver's exact native data recording pipeline to identify what fills the "context recording" role that Entire Checkpoints would play, and to find precise gaps.

### Overview

EvoMap Evolver (`@evomap/evolver` v1.14.0, GPL-3.0) is a self-evolution engine for AI agents built around the GEP (Genome Evolution Protocol). It enables agents to learn from runtime experience, solidify validated fixes into reusable Genes and Capsules, and share these across a network.

Repository: `autogame-17/evolver` on GitHub

---

### Complete Data Flow

```
Input Sources (4 streams)
  ├── Session Logs (JSONL)     ─┐
  ├── Today Log (Markdown)     ─┤
  ├── Memory.md                ─┼──► Signal Extraction ──► Gene/Capsule Selection ──► Mutation Build ──► Validation ──► Solidify
  └── User.md                  ─┘    (signals.js)        (selector.js)            (mutation.js)        (validation)    (solidify.js)
```

---

### Asset Storage Structure

```
assets/gep/
├── genes.json           # Primary Gene definitions (read/write)
├── genes.jsonl          # Overflow channel for genes (append-only)
├── capsules.json        # Verified solutions (read/write)
├── capsules.jsonl       # Overflow channel (append-only)
├── events.jsonl         # EvolutionEvent + ValidationReport (append-only)
├── candidates.jsonl     # Auto-detected capability candidates
└── memory_graph.jsonl   # Causal reasoning graph (append-only)
```

---

### EvolutionEvent Schema (Complete)

Source: `solidify.js#L946-996`

```typescript
{
  type: "EvolutionEvent",
  schema_version: "1.5.0",
  id: "ev_${timestamp}",
  asset_id: "sha256:...",           // Content-addressable ID

  // LINEAGE
  parent: string | null,            // Links to previous event (causal chain)

  // TRIGGER CONTEXT
  signals: string[],                // Extracted signals that triggered this cycle
  intent: "repair" | "optimize" | "innovate",

  // SELECTION CONTEXT
  genes_used: string[],             // Gene IDs selected for this cycle
  capsule_used: string | null,      // Capsule ID if reused
  selector_decision: {
    selected: string | null,        // Gene ID selected
    reason: string[],               // Human-readable reasons for selection
    alternatives: string[],         // Alternative gene IDs considered
  },

  // MUTATION CONTEXT
  mutation: {
    type: "Mutation",
    id: string,
    category: "repair" | "optimize" | "innovate",
    trigger_signals: string[],
    target: string,
    expected_effect: string,        // Generic category description
    risk_level: "low" | "medium" | "high",
  },

  // EXECUTION CONTEXT
  personality_state: {              // Mandatory since GEP v1.4
    rigor: number,
    risk_tolerance: number,
    // ... full personality snapshot
  },

  // RESULT CONTEXT
  blast_radius: {
    files: number,
    lines: number,
    changed_files: string[],
    ignored_files: string[],
  },
  outcome: {
    status: "success" | "failed",
    score: number,                  // 0.85 for success, 0.2 for failure
    notes: string,
  },

  // VALIDATION CONTEXT
  validation: {
    commands: string[],
    results: Array<{ command, ok, stdout, stderr }>,
  },

  // METADATA
  meta: {
    constraint_violations: string[],
    canary_check: "passed" | "failed",
    personality_classification: string,
    empty_cycle: boolean,
  },

  created_at: ISO8601,
}
```

---

### MemoryGraphEvent Types

Source: `memoryGraph.js#L314-725`

The memory graph records a **separate causal chain** via `memory_graph.jsonl`:

| Kind | Purpose | When Recorded | Key Fields |
|------|---------|---------------|------------|
| `signal` | Snapshot of observed signals | Start of every cycle | `signal.key`, `signal.signals`, `signal.error_signature` |
| `hypothesis` | Predicted outcome before action | After gene selection | `hypothesis.id`, `hypothesis.text`, `gene`, `mutation` |
| `attempt` | Chosen causal path | After mutation build | `action.id`, `action.drift`, `hypothesis.id`, `personality` |
| `outcome` | Inferred result of previous attempt | Start of next cycle | `outcome.status`, `outcome.score`, `baseline` |
| `confidence_edge` | Signal→gene edge statistics | After outcome recording | `stats.p`, `stats.decay_weight`, `stats.value` |
| `confidence_gene_outcome` | Gene→outcome global statistics | After outcome recording | `stats.success`, `stats.fail`, `stats.attempts` |

#### Outcome Inference (Heuristic 2x2 Matrix)

Source: `memoryGraph.js#L493-498`

```javascript
// prevHadError + currentHasError → outcome
✗ + ✗ → success (0.6)  "stable_no_error"
✓ + ✗ → success (0.85) "error_cleared"
✓ + ✓ → failed (0.2)   "error_persisted"
✗ + ✓ → failed (0.15)  "new_error_appeared"
```

**CRITICAL**: System infers **correlation**, not **causation**. Cannot definitively say "I fixed X by doing Y".

---

### How Evolver Records "Why Decisions Were Made"

#### Gene Selection (`selector.js#L163-180`)

```javascript
function buildSelectorDecision({ gene, capsule, signals, alternatives, memoryAdvice, driftEnabled, driftIntensity }) {
  const reason = [];
  if (gene) reason.push('signals match gene.signals_match');
  if (capsule) reason.push('capsule trigger matches signals');
  if (!gene) reason.push('no matching gene found; new gene may be required');
  if (signals && signals.length) reason.push(`signals: ${signals.join(', ')}`);
  if (memoryAdvice && Array.isArray(memoryAdvice.explanation)) {
    reason.push(`memory_graph: ${memoryAdvice.explanation.join(' | ')}`);
  }
  if (driftEnabled) reason.push('random_drift_override: true');
  return { selected: gene ? gene.id : null, reason, alternatives: [...] };
}
```

**LIMITATION**: `reason` is semantic labels, not the actual reasoning chain. Does NOT record scoring calculations, rejection rationale, or Jaccard similarity values.

#### Mutation Build (`mutation.js#L79-108`)

```javascript
function buildMutation({ signals, selectedGene, driftEnabled, personalityState }) {
  const category = mutationCategoryFromContext({ signals, driftEnabled });
  return {
    type: 'Mutation',
    id: `mut_${ts}`,
    category,
    trigger_signals: uniqStrings(signals),
    target: String(target || targetFromGene(selectedGene)),
    expected_effect: String(expected_effect || expectedEffectFromCategory(category)),
    risk_level: 'low',
  };
}
```

**LIMITATION**: `expected_effect` is generic:
- repair: "reduce runtime errors, increase stability, and lower failure rate"
- optimize: "improve success rate and reduce repeated operational cost"
- innovate: "explore new strategy combinations to escape local optimum"

#### Signal Extraction (`signals.js`)

Signals extracted from 4 sources but extraction reasoning NOT recorded:

```javascript
// What IS recorded:
signals: ['log_error', 'errsig:TypeError: Cannot read...', 'recurring_error']

// What is NOT recorded:
// - Which source each signal came from
// - Why certain patterns were matched/missed
// - Confidence in signal extraction
// - Raw text snippets that triggered detection
```

---

### Git Usage in Evolver

Git is used **only for**:
1. **Blast radius** — `git diff --name-only`, `git diff --numstat`
2. **Rollback on failure** — `git restore --staged --worktree .`, `git reset --hard`
3. **State snapshots** — `git rev-parse HEAD` for baseline

**CRITICAL GAP**: Evolver does NOT:
- Record git commit history leading to a change
- Link EvolutionEvents to git commit SHAs
- Record the git diff representing the actual mutation
- Track branch/merge context

```javascript
// solidify.js#L594-597 — rollback discards everything
function rollbackTracked() {
  // git restore --staged --worktree . + git reset --hard
  // RESTORES files but does NOT record git history
}
```

---

### Failed Mutation Handling

**FAILED MUTATIONS ARE COMPLETELY LOST.**

```javascript
// solidify.js validation failure path
if (!validationResult.overall_ok) {
  rollbackTracked();  // git reset --hard — reverts files
  // ❌ Does NOT write any EvolutionEvent
  // ❌ Does NOT record "what was tried and why it failed"
  return { status: 'failed' };
}
```

**CONSEQUENCE**: Gene library only contains successful patterns. No knowledge of "what not to do".

---

### Gene Epigenetic Marks

Track context-specific performance, not reasoning:

```typescript
{
  context: string,    // e.g., "platform:win32 node:18"
  boost: number,      // positive or negative adjustment
  reason: string,    // e.g., "success:3 fail:1 avg_score:0.82"
  created_at: ISO8601,
}
```

Source: Gene schema from `assets/gep/genes.json`

---

### ValidationReport Schema

Source: `src/gep/validationReport.js`

```typescript
{
  type: "ValidationReport",
  schema_version: "1.5.0",
  id: "vr_${timestamp}",
  gene_id: string,
  env_fingerprint: {
    nodeVersion: string,
    platform: string,
    arch: string,
    osRelease: string,
    evolverVersion: string,
    timestamp: string,
  },
  env_fingerprint_key: string,
  commands: Array<{
    command: string,
    ok: boolean,
    stdout: string,   // truncated to 4000 chars
    stderr: string,   // truncated to 4000 chars
  }>,
  overall_ok: boolean,
  duration_ms: number,
  created_at: ISO8601,
  asset_id: "sha256:...",
}
```

---

### Evolution Strategies

| Strategy | Innovation | Optimization | Repair | Use Case |
|----------|-----------|--------------|--------|----------|
| `balanced` (default) | 50% | 30% | 20% | Daily steady growth |
| `innovate` | 80% | 15% | 5% | Fast feature development |
| `harden` | 20% | 40% | 40% | Post-major-change stability |
| `repair-only` | 0% | 20% | 80% | Emergency fix mode |

Signal de-duplication: When >= 50% of last 8 cycles are repairs, forces innovation mode.

Personality evolution: Small `PersonalityMutation` steps (+/-0.2), max 2 params per step, natural selection based on success rate.

---

### Key Code References

| Component | File | Key Lines |
|-----------|------|-----------|
| Main evolution loop | `src/evolve.js` | Full file |
| EvolutionEvent construction | `src/gep/solidify.js` | 946-996 |
| Mutation building | `src/gep/mutation.js` | 79-108 |
| Selector decision | `src/gep/selector.js` | 163-180 |
| Signal extraction | `src/gep/signals.js` | Full file |
| Memory graph events | `src/gep/memoryGraph.js` | 314-725 |
| Outcome inference (2x2) | `src/gep/memoryGraph.js` | 493-575 |
| ValidationReport | `src/gep/validationReport.js` | Full file |
| Git rollback | `src/gep/solidify.js` | 594-597 |
| GEP prompt assembly | `src/gep/prompt.js` | Full file |
| Personality evolution | `src/gep/personality.js` | Full file |

---

### Evidence Chain

| Finding | Source |
|---------|--------|
| EvolutionEvent schema fields | `solidify.js#L946-996` via zread |
| Selector decision reasoning | `selector.js#L163-180` via zread |
| Memory graph event types | [zread.ai/autogame-17/evolver/9-memory-graph-and-causal-reasoning](https://zread.ai/autogame-17/evolver/9-memory-graph-and-causal-reasoning) |
| GEP asset store structure | [zread.ai/autogame-17/evolver/20-gep-asset-store-structure](https://zread.ai/autogame-17/evolver/20-gep-asset-store-structure) |
| Blast radius control | [zread.ai/autogame-17/evolver/13-blast-radius-control](https://zread.ai/autogame-17/evolver/13-blast-radius-control) |
| Self-repair and git emergency | [zread.ai/autogame-17/evolver/19-self-repair-and-git-emergency](https://zread.ai/autogame-17/evolver/19-self-repair-and-git-emergency) |
| Signal extraction analysis | [zread.ai/autogame-17/evolver/5-signal-extraction-and-analysis](https://zread.ai/autogame-17/evolver/5-signal-extraction-and-analysis) |
| NPM package v1.14.0 | npmjs.com @evomap/evolver |

### Risks / Unknowns
- License changed from MIT to GPL-3.0 on 2026-04-09 due to Hermes Agent plagiarism controversy
- EvoMap Hub platform for asset sharing network not deeply researched
- Some source files were read via zread (summarized) rather than raw — exact line numbers may differ
