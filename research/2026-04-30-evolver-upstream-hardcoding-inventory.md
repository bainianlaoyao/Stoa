# Evolver Upstream Hardcoding Inventory

**Date:** 2026-04-30
**Purpose:** Establish the boundary between clean upstream Evolver modules and Stoa-specific patched surfaces. This is Task 1 of the 11-task cleanup plan.

## 1. Current Submodule State

- **Pinned commit:** `d4c2271` (contains patched `src/stoa/` directory)
- **Clean upstream target:** `bc17fda` (Release v1.70.0-beta.3, no `src/stoa/`)
- **Boundary rule:** `research/upstreams/evolver/**` is read-only. No Stoa modifications.

## 2. Raw Upstream `src/` Module Survey

Excluding the patched `src/stoa/` directory. Status indicates whether the module is usable as a clean `require()` target by Stoa.

### 2.1 Top-level modules

| Module | Readable? | Exports | Stoa can use? |
|--------|-----------|---------|---------------|
| `src/config.js` | Yes (plain JS) | `envInt`, `envFloat`, `envStr`, all config constants (`HEARTBEAT_INTERVAL_MS`, `VALIDATION_TIMEOUT_MS`, etc.), `resolveHubUrl` | **Yes** — configuration constants and env helpers are clean |
| `src/canary.js` | Yes (plain JS) | Side-effect only (exits 0/1) | **No** — child process safety check, not a library |
| `src/evolve.js` | **Obfuscated** | Unknown (main evolution loop) | **No** — cannot `require()` meaningfully |

### 2.2 `src/gep/` (55 files) — GEP Protocol Core

| Module | Readable? | Key Exports | Stoa can use? |
|--------|-----------|-------------|---------------|
| `src/gep/paths.js` | Yes | `getRepoRoot`, `getWorkspaceRoot`, `getLogsDir`, `getEvolverLogPath`, `getMemoryDir`, `getEvolutionDir`, `getGepAssetsDir`, `getSkillsDir`, `getSessionScope`, `getAgentSessionsDir`, `readSessionCwdFromHead`, `getNarrativePath`, `getEvolutionPrinciplesPath`, `getReflectionLogPath` | **Yes** — path resolution for all Evolver data directories |
| `src/gep/assetStore.js` | Yes | `ensureAssetFiles`, `loadGenes`, `loadCapsules`, `readRecentFailedCapsules`, `upsertCapsule`, `upsertGene`, `genesPath`, `capsulesPath`, `eventsPath`, `candidatesPath`, `externalCandidatesPath`, `failedCapsulesPath` | **Yes** — CRUD operations on Gene/Capsule/Event stores |
| `src/gep/signals.js` | Yes | `OPPORTUNITY_SIGNALS`, `hasOpportunitySignal`, signal extraction functions | **Yes** — signal classification and extraction |
| `src/gep/llmReview.js` | Yes | `buildReviewPrompt`, `isLlmReviewEnabled` | **Yes** — review prompt builder |
| `src/gep/solidify.js` | **Obfuscated** | `solidify()` (via module.exports) | **Partial** — export exists but internals are opaque |
| `src/gep/selector.js` | **Obfuscated** | `tokenize`, `scoreGeneSemantic` (used by hostBridge) | **Partial** — export names known from hostBridge usage but code is opaque |
| `src/gep/skillDistiller.js` | **Obfuscated** | `prepareDistillation`, `completeDistillation` | **Partial** — export names known from distillBridge usage but code is opaque |
| `src/gep/memoryGraph.js` | **Obfuscated** | `memoryGraphPath`, `tryReadMemoryGraphEvents`, `getMemoryAdvice`, `recordSignalSnapshot`, `recordAttempt`, `recordOutcomeFromState` | **Partial** — export names known from hostBridge usage but code is opaque |
| `src/gep/contentHash.js` | Yes | `computeAssetId`, `SCHEMA_VERSION` | **Yes** |
| `src/gep/mutation.js` | **Obfuscated** | Unknown | **No** — opaque |
| `src/gep/personality.js` | **Obfuscated** | Unknown | **No** — opaque |
| `src/gep/strategy.js` | **Obfuscated** | Unknown | **No** — opaque |
| Other `src/gep/*.js` | **Obfuscated** | Various | **No** — opaque |

### 2.3 `src/adapters/` (6 entries) — Platform Hook Integration

| Module | Readable? | Key Exports | Stoa can use? |
|--------|-----------|-------------|---------------|
| `src/adapters/hookAdapter.js` | Yes | `detectPlatform`, `resolveConfigRoot`, `loadAdapter`, `setupHooks`, `mergeJsonFile`, `copyHookScripts`, `PLATFORMS` | **Yes** — generic hook setup for Cursor/Claude Code/Codex/Kiro |
| `src/adapters/claudeCode.js` | Unknown | Claude Code specific adapter | **Maybe** — may be useful for Stoa's Claude Code integration |
| `src/adapters/codex.js` | Unknown | Codex specific adapter | **Maybe** |
| `src/adapters/cursor.js` | Unknown | Cursor specific adapter | **No** — Stoa doesn't target Cursor |
| `src/adapters/kiro.js` | Unknown | Kiro specific adapter | **No** — Stoa doesn't target Kiro |
| `src/adapters/scripts/` | Directory | Hook scripts | **No** — Evolver-specific hook scripts |

### 2.4 `src/ops/` (9 entries) — Operations & Lifecycle

| Module | Readable? | Key Exports | Stoa can use? |
|--------|-----------|-------------|---------------|
| `src/ops/index.js` | Yes | Aggregates: `lifecycle`, `skillsMonitor`, `cleanup`, `trigger`, `commentary`, `selfRepair` | **Partial** — lifecycle management is Evolver-daemon-specific |
| `src/ops/cleanup.js` | Unknown | Cleanup operations | **Maybe** |
| `src/ops/lifecycle.js` | Unknown | Start/stop/status | **No** — daemon lifecycle, not library |
| Other `src/ops/*.js` | Unknown | Various | **No** — daemon ops, not library |

### 2.5 `src/proxy/` (7 entries) — Proxy & Mailbox Server

| Module | Readable? | Key Exports | Stoa can use? |
|--------|-----------|-------------|---------------|
| `src/proxy/index.js` | Unknown | Proxy entry | **No** — network service, not library |
| Other `src/proxy/**` | Unknown | Mailbox/sync/task | **No** — network service |

### 2.6 `src/atp/` (9 entries) — Auto-Buyer & Consumer Agent

| Module | Readable? | Key Exports | Stoa can use? |
|--------|-----------|-------------|---------------|
| All | Unknown | Marketplace/agent | **No** — EvoMap marketplace feature |

## 3. Planned Stoa Adapter Actions vs. Upstream Availability

For each adapter action that Stoa planned to use through the patched `hostBridge`, this table records whether a clean upstream entry point exists.

| Adapter Action | Patched Source (src/stoa/hostBridge.js) | Clean Upstream Entry? | Decision |
|----------------|----------------------------------------|----------------------|----------|
| `warmStart` | `handleWarmStart()` → `tryReadMemoryGraphEvents()`, `readRecentFailedCapsules()`, `ensureAssetFiles()` | **No clean entry** — depends on obfuscated `memoryGraph.js` and readable `assetStore.js`. No upstream function called `warmStart` exists. | **DELETE** — Stoa must reimplement using `src/gep/assetStore.js` (readable) and `src/gep/paths.js` directly |
| `recall` | `handleRecall()` → `loadGenes()`, `loadCapsules()`, `tokenizeSignals()`, `getMemoryAdvice()`, `rankGenes()` | **No clean entry** — depends on obfuscated `selector.js` (tokenize) and `memoryGraph.js` (getMemoryAdvice). | **DELETE** — Cannot call obfuscated code; Stoa must build its own recall using `assetStore.js` |
| `observeWrite` | `handleObserveWrite()` → `recordSignalSnapshot()` | **No clean entry** — depends on obfuscated `memoryGraph.js` | **DELETE** — Stoa cannot call obfuscated recordSignalSnapshot |
| `processTurn` | `handleProcessTurn()` → `recordSignalSnapshot()`, `recordAttempt()`, `recordOutcomeFromState()`, `upsertCapsule()` | **No clean entry** — depends on obfuscated `memoryGraph.js` | **DELETE** — Stoa must build its own turn processing |
| `prepareReview` | `handlePrepareReview()` → `exportReview()` from `reviewBridge.js`, `buildReviewPrompt()` from `llmReview.js` | **Partial** — `buildReviewPrompt` from `llmReview.js` is clean, but `exportReview` depends on `reviewBridge.js` which is patched | **DELETE** — reviewBridge is patched; can use `buildReviewPrompt` from clean `llmReview.js` later |
| `completeReview` | `handleCompleteReview()` → `rejectReview()` from `reviewBridge.js`, `approveReview()` from `reviewBridge.js` | **No clean entry** — `reviewBridge.js` is patched (uses `solidify()`) | **DELETE** |
| `prepareSolidify` | `handlePrepareSolidify()` → reads bridge turn record | **No clean entry** — depends on patched bridge turn infrastructure | **DELETE** |
| `completeSolidify` | `handleCompleteSolidify()` → reads bridge turn record | **No clean entry** — depends on patched bridge turn infrastructure | **DELETE** |
| `prepareDistill` | `handlePrepareDistill()` → `prepareDistillation()` from `skillDistiller.js` | **No clean entry** — `skillDistiller.js` is obfuscated | **DELETE** |
| `completeDistill` | `handleCompleteDistill()` → `completeDistillation()` from `skillDistiller.js` | **No clean entry** — `skillDistiller.js` is obfuscated | **DELETE** |

## 4. Clean Upstream Modules Stoa CAN Use

These modules are readable, have clear exports, and can be `require()`'d directly from the vendored submodule:

| Module | Path | What Stoa gets |
|--------|------|----------------|
| Config | `src/config.js` | All runtime config constants, `envInt`/`envFloat`/`envStr` helpers, `resolveHubUrl()` |
| Paths | `src/gep/paths.js` | All directory/file path resolvers (`getRepoRoot`, `getMemoryDir`, `getEvolutionDir`, `getGepAssetsDir`, etc.) |
| Asset Store | `src/gep/assetStore.js` | Gene/Capsule/Event CRUD: `loadGenes`, `loadCapsules`, `upsertGene`, `upsertCapsule`, `ensureAssetFiles`, path getters |
| Signals | `src/gep/signals.js` | Signal name constants, `hasOpportunitySignal()`, signal extraction |
| LLM Review | `src/gep/llmReview.js` | `buildReviewPrompt()`, `isLlmReviewEnabled()` |
| Content Hash | `src/gep/contentHash.js` | `computeAssetId()`, `SCHEMA_VERSION` |
| Hook Adapter | `src/adapters/hookAdapter.js` | Platform detection, hook setup/teardown for Claude Code/Codex |
| Canary | `src/canary.js` | Not useful as library (child process exit check) |

## 5. Patched Surfaces That Must NOT Be Used

These are the Stoa-specific patched files in `src/stoa/` and the action names that depend on them. No Stoa code may import, require, or reference these:

### 5.1 Patched Files (in `src/stoa/`)

| File | Purpose | Why it must not be used |
|------|---------|------------------------|
| `src/stoa/hostBridge.js` | Main bridge: dispatches all Stoa adapter actions | Purely Stoa-specific; will be deleted in Task 8 |
| `src/stoa/publishContext.js` | Context publishing for Claude Code/Codex | Stoa-specific; will be deleted in Task 8 |
| `src/stoa/reviewBridge.js` | Review state management, approve/reject | Stoa-specific; will be deleted in Task 8 |
| `src/stoa/distillBridge.js` | Distillation payload preparation/completion | Stoa-specific; will be deleted in Task 8 |
| `src/stoa/artifactRefs.js` | Artifact reference building, run result building | Stoa-specific; will be deleted in Task 8 |

### 5.2 Forbidden Action/CLI Surfaces

These action names are dispatched through the patched `hostBridge` CLI interface. Stoa must not reference them:

| Action Name | Why forbidden |
|-------------|---------------|
| `host-bridge` / `hostBridge` | CLI entry into patched `src/stoa/hostBridge.js` |
| `publish-context` / `publishContext` | CLI entry into patched `src/stoa/publishContext.js` |
| `state-summary` | Returns Evolver state summary via patched hostBridge |
| `trace-turn` | Traces turn execution via patched hostBridge |
| `explain-recall` | Explains recall reasoning via patched hostBridge |
| `get-asset` | Asset retrieval via patched hostBridge |

## 6. Obfuscated Modules That Cannot Be Reliably Used

These modules export functions that work at runtime (since the patch uses them), but Stoa cannot depend on their internals because the code is obfuscated:

- `src/evolve.js`
- `src/gep/solidify.js`
- `src/gep/selector.js`
- `src/gep/skillDistiller.js`
- `src/gep/memoryGraph.js`
- `src/gep/mutation.js`
- `src/gep/personality.js`
- `src/gep/strategy.js`

If Stoa needs capabilities provided by these modules, the correct approach is to reimplement the needed logic in Stoa's own adapter layer, not to call obfuscated code.

## 7. Summary

**Result: ALL 10 planned adapter actions are marked DELETE.**

None of the planned actions (`warmStart`, `recall`, `observeWrite`, `processTurn`, `prepareReview`, `completeReview`, `prepareSolidify`, `completeSolidify`, `prepareDistill`, `completeDistill`) have clean upstream entry points. They all depend on:
1. The patched `src/stoa/` bridge layer (to be removed in Task 8), or
2. Obfuscated upstream modules (`memoryGraph.js`, `selector.js`, `skillDistiller.js`, `solidify.js`)

Stoa's path forward is to:
1. Use clean upstream modules directly (`assetStore.js`, `paths.js`, `config.js`, `signals.js`, `llmReview.js`)
2. Reimplement needed capabilities (signal recording, recall ranking, turn processing, distillation) in Stoa's own adapter layer
3. Never depend on `src/stoa/` or obfuscated modules

This task (Task 1) only establishes the boundary. The submodule gitlink remains at `d4c2271`; repinning to `bc17fda` happens in Task 8.
