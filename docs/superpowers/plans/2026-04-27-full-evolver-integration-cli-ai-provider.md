# Full Evolver Integration With CLI AI Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Entire-based direct-memory runtime with a Stoa-owned Evolver runtime that captures provider-native session evidence, materializes verified Evolver inputs, runs review/distill through the user-selected CLI AI provider, and delivers published memory to Claude Code before the next session.

**Architecture:** Keep `maintainer` and `injector` as fixed internal stages, not plugins. Stoa owns durable evidence snapshots, an `evidence -> Evolver input` materializer, and a runtime state store; Evolver owns run/solidify/distill/publish semantics behind machine-readable commands; Claude Code remains the first complete consumer target, while `memoryAiProvider` selects the CLI used for summary, review, and distillation work.

**Tech Stack:** Electron main/renderer, Vue 3, Pinia, TypeScript, Vitest, Playwright, Node child-process APIs, Claude Code CLI, Codex CLI, pinned Evolver fork under `research/upstreams/evolver`.

---

## Corrections From The Previous Draft

This revision fixes the three architectural gaps in the previous plan:

1. **Entire removal now has a replacement input path.**
   - Stoa-owned evidence snapshots replace Entire exports.
   - A new materializer replaces `src/core/direct-memory/evolver-input-importer.ts`.

2. **Bridge-store responsibilities are preserved instead of dropped.**
   - A new runtime state store replaces the dedupe, run-ref, and publish-hash tracking currently handled by `src/core/direct-memory/bridge-store.ts`.

3. **`transcript_path` is no longer treated as durable storage.**
   - Provider transcript paths become read-time hints only.
   - Stoa copies the needed transcript slice and evidence metadata into `.stoa/memory/evidence/` at ingestion time.

## Scope

### In Scope

- Add `memoryAiProvider: 'codex' | 'claude-code'` to persisted app settings.
- Reuse the existing provider executable-path settings for memory AI subprocesses.
- Persist provider-native evidence for Claude Code and Codex.
- Materialize Evolver `memory/` inputs from Stoa evidence snapshots.
- Add Stoa-owned machine interfaces around Evolver publish/review/distill flows.
- Deliver published memory to Claude Code before start/resume.
- Remove Entire from the normal runtime path.

### Out Of Scope

- Generic memory plugin registry.
- Entire on the critical runtime path.
- Codex as a first-pass published-context consumer target.
- Hub Memory API, Hub search, validator, or proxy integration.
- Compatibility shims for the old direct-memory entry points.

## Verified Constraints This Plan Assumes

- Evolver `run` scans `memory/`; it does not natively import Claude/Codex session transcripts.
- Evolver `session-start` can consume a `MEMORY_GRAPH_PATH` JSONL and inject recent memory.
- Evolver `session-end` and `signal-detect` can gather lightweight signals by themselves, but they do not replace transcript-backed Stoa evidence capture.
- Claude Code already has a verified local consumption path in this repository through the wrapper that sets `MEMORY_GRAPH_PATH` from `.stoa/generated/evolver-context/claude-code.jsonl`.
- Codex currently does not have an equivalent published-context consumption path in this repository.

References:

- `research/upstreams/evolver/README.md`
- `research/upstreams/evolver/src/gep/paths.js`
- `research/upstreams/evolver/src/adapters/scripts/evolver-session-start.js`
- `research/upstreams/evolver/src/adapters/scripts/evolver-session-end.js`
- `research/upstreams/evolver/src/adapters/scripts/evolver-signal-detect.js`
- `src/extensions/providers/claude-code-provider.ts`
- `src/extensions/providers/codex-provider.ts`

## File Structure

### Shared Contracts

- **Create:** `src/shared/memory-runtime.ts`
  - New runtime-owned contracts: `MemoryAiProvider`, `SessionEvidenceRecord`, `SessionEvidenceSnapshot`, `MemoryRunRecord`, `PublishedMemoryRecord`, `ReviewDecision`, `DistillationDecision`.
- **Modify:** `src/shared/project-session.ts`
  - Add `memoryAiProvider` to `AppSettings`.
  - Extend canonical provider payload fields only for evidence Stoa will actually persist.
- **Modify:** `src/shared/project-session.test.ts`

### Main Process Integration

- **Create:** `src/core/provider-path-resolver.ts`
  - Extract provider path resolution from `src/main/index.ts`.
- **Create:** `src/core/memory/runtime.ts`
  - Fixed dispatcher for evidence capture notifications, maintainer work, and injector preparation.
- **Modify:** `src/main/index.ts`
- **Modify:** `src/main/launch-tracked-session-runtime.ts`
- **Modify:** `src/main/session-event-bridge.ts`

### Evidence Capture And Storage

- **Create:** `src/core/memory/session-evidence-store.ts`
  - Durable `.stoa/memory/evidence/` storage.
- **Create:** `src/core/memory/transcript-snapshot.ts`
  - Reads provider transcript files and writes Stoa-owned snapshots.
- **Modify:** `src/core/hook-event-adapter.ts`
- **Modify:** `src/core/webhook-server.ts`
- **Modify:** `src/core/webhook-server-validation.test.ts`
- **Modify:** `src/main/session-event-bridge.test.ts`
- **Modify:** `src/extensions/providers/claude-code-provider.ts`
  - Keep Stoa webhook hooks; keep only the Claude session-start Evolver wrapper needed for `MEMORY_GRAPH_PATH` consumption.
- **Modify:** `src/extensions/providers/codex-provider.ts`

### Evolver Input Materialization And Run State

- **Create:** `src/core/memory/evolver-input-materializer.ts`
  - Replaces Entire checkpoint import as the runtime input builder.
- **Create:** `src/core/memory/runtime-state-store.ts`
  - Replaces direct-memory bridge-store responsibilities.
- **Create:** `src/core/memory/evolver-client.ts`
  - Move and simplify the retained Evolver command client.
- **Create:** `src/core/memory/worktree.ts`
  - Move the retained detached-worktree helper.
- **Create:** `src/core/memory/command-runner.ts`
  - Move the retained JSON command helper.

### CLI AI Bridge

- **Create:** `src/core/memory/cli-ai-schemas.ts`
- **Create:** `src/core/memory/cli-ai-provider.ts`
  - Non-interactive structured calls to the selected CLI AI provider.

### Maintainer And Injector

- **Create:** `src/core/memory/evolver-maintainer.ts`
- **Create:** `src/core/memory/claude-code-injector.ts`

### Evolver Fork

- **Modify:** `research/upstreams/evolver/index.js`
- **Create:** `research/upstreams/evolver/src/stoa/publishContext.js`
- **Create:** `research/upstreams/evolver/src/stoa/reviewBridge.js`
- **Create:** `research/upstreams/evolver/src/stoa/distillBridge.js`
- **Create:** `research/upstreams/evolver/src/stoa/artifactRefs.js`

### Legacy Removal

- **Delete:** `src/shared/direct-memory.ts`
- **Delete:** `src/shared/direct-memory.test.ts`
- **Delete:** `src/core/direct-memory/completion-service.ts`
- **Delete:** `src/core/direct-memory/orchestrator.ts`
- **Delete:** `src/core/direct-memory/entire-client.ts`
- **Delete:** `src/core/direct-memory/evolver-input-importer.ts`
- **Delete:** `src/core/direct-memory/published-context-builder.ts`
- **Delete:** `src/core/direct-memory/bridge-store.ts`
- **Delete or move:** retained helper files from `src/core/direct-memory/` into `src/core/memory/`
- **Modify:** `package.json`
- **Retain only as explicit tooling:** `scripts/build-entire-bridge.mjs`

## Task Plan

### Task 1: Lock The Provider Contract Before Architecture Work

**Files:**
- Create: `src/core/provider-path-resolver.ts`
- Create: `src/core/provider-path-resolver.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/shared/project-session.ts`
- Modify: `src/core/project-session-manager.ts`
- Modify: `src/core/project-session-manager.test.ts`
- Modify: `src/renderer/stores/settings.ts`
- Modify: `src/renderer/components/settings/ProvidersSettings.vue`
- Modify: `src/renderer/components/settings/ProvidersSettings.test.ts`

- [ ] Add `memoryAiProvider: 'codex' | 'claude-code'` to `AppSettings` and persistence.
- [ ] Extract the existing provider executable-path resolution from `src/main/index.ts:457-485` into `src/core/provider-path-resolver.ts`.
- [ ] Reuse that resolver for both session launch and memory AI subprocesses.
- [ ] Add the settings UI control using existing settings-surface patterns and shared tokens only.
- [ ] Prove the contract in tests: persisted setting round-trip, executable resolution with configured path, and executable fallback to detector.
- [ ] Run: `npm run typecheck`
- [ ] Run: `npx vitest run src/core/provider-path-resolver.test.ts src/core/project-session-manager.test.ts src/renderer/components/settings/ProvidersSettings.test.ts`

### Task 2: Extend Canonical Events So Stoa Can Persist Real Evidence

**Files:**
- Create: `src/shared/memory-runtime.ts`
- Modify: `src/shared/project-session.ts`
- Modify: `src/core/hook-event-adapter.ts`
- Modify: `src/core/hook-event-adapter.test.ts`
- Modify: `src/core/webhook-server.ts`
- Modify: `src/core/webhook-server-validation.test.ts`
- Modify: `src/main/session-event-bridge.ts`
- Modify: `src/main/session-event-bridge.test.ts`
- Modify: `src/extensions/providers/claude-code-provider.ts`
- Modify: `src/extensions/providers/codex-provider.ts`
- Modify: `tests/e2e/provider-integration.test.ts`

- [ ] Define the normalized evidence fields Stoa will ingest: `hookEventName`, `providerSessionId`, `turnId`, `transcriptPath`, `lastAssistantMessage`, `promptText`, `inputMessages`, `toolName`, `toolUseId`, `cwd`, `model`, and raw-source provenance.
- [ ] Make the hook adapters read those already-available provider fields instead of collapsing everything into `summary`.
- [ ] Keep `CanonicalSessionEvent` as the transport object, but only add fields that the evidence store will persist.
- [ ] Extend webhook validation so malformed evidence fields fail fast.
- [ ] Preserve current session-state updates while exposing richer evidence to the next layer.
- [ ] Run: `npx vitest run src/core/hook-event-adapter.test.ts src/core/webhook-server-validation.test.ts src/main/session-event-bridge.test.ts tests/e2e/provider-integration.test.ts`

### Task 3: Persist Stoa-Owned Evidence Snapshots Instead Of Provider-Owned Paths

**Files:**
- Create: `src/core/memory/session-evidence-store.ts`
- Create: `src/core/memory/transcript-snapshot.ts`
- Create: `src/core/memory/session-evidence-store.test.ts`
- Create: `src/core/memory/transcript-snapshot.test.ts`
- Modify: `src/main/session-event-bridge.ts`
- Modify: `src/main/session-event-bridge.test.ts`

- [ ] Write evidence under `.stoa/memory/evidence/<session-id>/<event-id>/`.
- [ ] Treat provider `transcript_path` as a read-time pointer only; copy the required transcript content into Stoa storage at ingestion time.
- [ ] Persist both:
  - a normalized JSON metadata record
  - a Stoa-owned transcript snapshot or extracted turn slice
- [ ] Capture enough data to reconstruct the final user correction / assistant outcome even if the provider transcript later disappears.
- [ ] Record a stable evidence key for dedupe: provider type + provider session id + turn id or event id.
- [ ] Run: `npx vitest run src/core/memory/session-evidence-store.test.ts src/core/memory/transcript-snapshot.test.ts src/main/session-event-bridge.test.ts`

### Task 4: Replace Entire Import With An Evidence-To-Evolver Materializer

**Files:**
- Create: `src/core/memory/evolver-input-materializer.ts`
- Create: `src/core/memory/evolver-input-materializer.test.ts`
- Create: `src/core/memory/worktree.ts`
- Create: `src/core/memory/worktree.test.ts`
- Delete: `src/core/direct-memory/evolver-input-importer.ts`
- Delete: `src/core/direct-memory/evolver-input-importer.test.ts`

- [ ] Build a materializer that consumes `SessionEvidenceSnapshot[]` and writes the Evolver input shape that `run` already understands:
  - `MEMORY.md`
  - `USER.md`
  - dated memory markdown
  - provider-shaped session JSONL files
- [ ] Keep the materializer isolated from provider hooks; it only consumes Stoa snapshots.
- [ ] Preserve the existing detached-worktree isolation model because Evolver still mutates a repo checkout.
- [ ] Verify the materialized session logs are valid for Claude/Codex transcript shapes already used by the current importer.
- [ ] Run: `npx vitest run src/core/memory/evolver-input-materializer.test.ts src/core/memory/worktree.test.ts`

### Task 5: Replace Bridge-Store With A Runtime State Store

**Files:**
- Create: `src/core/memory/runtime-state-store.ts`
- Create: `src/core/memory/runtime-state-store.test.ts`
- Delete: `src/core/direct-memory/bridge-store.ts`
- Delete: `src/core/direct-memory/bridge-store.test.ts`

- [ ] Store three categories of state:
  - last processed evidence key per session
  - Evolver run refs per project/session
  - last published target/hash per consumer
- [ ] Preserve the useful parts of the old bridge-store semantics: idempotency, atomic writes, and explicit delivery state.
- [ ] Stop encoding Entire checkpoint ids into the primary key.
- [ ] Write the store under `.stoa/memory/runtime-state.json`.
- [ ] Run: `npx vitest run src/core/memory/runtime-state-store.test.ts`

### Task 6: Add A Verified CLI AI Bridge

**Files:**
- Create: `src/core/memory/cli-ai-schemas.ts`
- Create: `src/core/memory/cli-ai-provider.ts`
- Create: `src/core/memory/cli-ai-provider.test.ts`

- [ ] Define structured request/response contracts for:
  - semantic session summary
  - review decision
  - distillation response
- [ ] Resolve the selected executable using `memoryAiProvider` and the shared provider path resolver.
- [ ] Keep the bridge non-interactive and schema-validated; invalid JSON is a hard failure.
- [ ] Add one proof test per provider command builder so the exact CLI invocation shape is locked before deeper integration.
- [ ] Run: `npx vitest run src/core/memory/cli-ai-provider.test.ts`

### Task 7: Patch Evolver With Machine Interfaces Instead Of Human-Only Commands

**Files:**
- Modify: `research/upstreams/evolver/index.js`
- Create: `research/upstreams/evolver/src/stoa/publishContext.js`
- Create: `research/upstreams/evolver/src/stoa/reviewBridge.js`
- Create: `research/upstreams/evolver/src/stoa/distillBridge.js`
- Create: `research/upstreams/evolver/src/stoa/artifactRefs.js`
- Create: `src/core/memory/evolver-client.ts`
- Create: `src/core/memory/command-runner.ts`
- Create: `src/core/memory/evolver-client.test.ts`

- [ ] Add a machine-readable `publish-context` command that selects provider-facing memory content and emits deterministic JSON/JSONL.
- [ ] Add a machine-readable review export path so Stoa can ask the selected CLI AI provider for a decision before calling approve/reject.
- [ ] Add a machine-readable distillation prepare/complete path around Evolver’s existing skill-distiller functions.
- [ ] Do not rely on `EVOLVER_LLM_REVIEW=true` or the default `llmReview.js` stub for the Stoa runtime path.
- [ ] Keep all Stoa-specific patch code under `research/upstreams/evolver/src/stoa/`.
- [ ] Run: `npx vitest run src/core/memory/evolver-client.test.ts`

### Task 8: Implement The Fixed Maintainer Runtime

**Files:**
- Create: `src/core/memory/runtime.ts`
- Create: `src/core/memory/evolver-maintainer.ts`
- Create: `src/core/memory/runtime.test.ts`
- Create: `src/core/memory/evolver-maintainer.test.ts`
- Modify: `src/main/session-event-bridge.ts`
- Modify: `src/main/session-event-bridge.test.ts`

- [ ] Trigger maintainer work on `agent.turn_completed`.
- [ ] Queue by Stoa session id and keep per-session ordering, mirroring the useful part of `DirectMemoryCompletionService`.
- [ ] For each eligible completion:
  - load the newest unseen evidence snapshot
  - build a semantic session summary through the selected CLI provider
  - materialize Evolver inputs in an isolated worktree
  - run Evolver
  - export review payload when pending, ask the selected CLI provider, then approve/reject
  - export distillation payload when available, ask the selected CLI provider, then complete distillation
  - persist run refs and publishable artifacts into the runtime state store
- [ ] Fail loudly in logs and state, but do not block session progression forever on memory failures.
- [ ] Run: `npx vitest run src/core/memory/runtime.test.ts src/core/memory/evolver-maintainer.test.ts`

### Task 9: Implement The Claude Code Injector And Launch-Time Bridge

**Files:**
- Create: `src/core/memory/claude-code-injector.ts`
- Create: `src/core/memory/claude-code-injector.test.ts`
- Modify: `src/main/launch-tracked-session-runtime.ts`
- Modify: `src/main/launch-tracked-session-runtime.test.ts`
- Modify: `src/extensions/providers/claude-code-provider.ts`
- Modify: `src/extensions/providers/claude-code-provider.test.ts`

- [ ] Before start/resume, ask the injector for the latest successful published context for the project/session.
- [ ] Have the injector call native Evolver `publish-context --target=claude-code`.
- [ ] Write `.stoa/generated/evolver-context/claude-code.jsonl`.
- [ ] Preserve the existing Claude wrapper behavior that sets `MEMORY_GRAPH_PATH` from the generated JSONL.
- [ ] Remove automatic wiring of `evolver-session-end.js` and `evolver-signal-detect.js` from the Claude runtime provider path; keep Stoa webhook hooks plus the session-start `MEMORY_GRAPH_PATH` wrapper only.
- [ ] Run: `npx vitest run src/core/memory/claude-code-injector.test.ts src/main/launch-tracked-session-runtime.test.ts src/extensions/providers/claude-code-provider.test.ts`

### Task 10: Delete The Entire-Based Runtime And Update Documentation

**Files:**
- Delete: `src/shared/direct-memory.ts`
- Delete: `src/shared/direct-memory.test.ts`
- Delete: `src/core/direct-memory/completion-service.ts`
- Delete: `src/core/direct-memory/completion-service.test.ts`
- Delete: `src/core/direct-memory/orchestrator.ts`
- Delete: `src/core/direct-memory/orchestrator.test.ts`
- Delete: `src/core/direct-memory/entire-client.ts`
- Delete: `src/core/direct-memory/entire-client.test.ts`
- Delete: `src/core/direct-memory/published-context-builder.ts`
- Delete: `src/core/direct-memory/published-context-builder.test.ts`
- Delete or move: retained helper files from `src/core/direct-memory/`
- Modify: `package.json`
- Modify: `docs/engineering/evolver-data-flow.md`
- Modify: `docs/superpowers/specs/2026-04-27-memory-plugin-architecture-design.md`

- [ ] Remove `build:entire-bridge` from the normal runtime build path.
- [ ] Delete the Entire-based runtime entry points instead of leaving dead compatibility surfaces behind.
- [ ] Update the engineering docs so they describe the Stoa-owned evidence/materializer/runtime-state architecture.
- [ ] Keep `scripts/build-entire-bridge.mjs` only as an explicit offline tool if it still serves audit/replay work after the rewrite.
- [ ] Run: `npm run test:generate`
- [ ] Run: `npm run typecheck`
- [ ] Run: `npx vitest run`
- [ ] Run: `npm run test:e2e`
- [ ] Run: `npm run test:behavior-coverage`

## Acceptance Criteria

- `memoryAiProvider` is persisted and reuses the same executable-path resolution model as session launch.
- Stoa owns durable provider evidence snapshots; runtime processing does not depend on provider-owned transcript paths surviving.
- Entire is no longer on the runtime critical path.
- Evolver runtime input is built from Stoa evidence snapshots, not Entire checkpoint exports.
- Run dedupe, run refs, and publish hashes are preserved in a Stoa-owned runtime state store.
- Review and distillation decisions run through the selected CLI AI provider, not the Evolver `llmReview.js` stub.
- Claude Code receives published Evolver memory through `.stoa/generated/evolver-context/claude-code.jsonl` before the next start/resume.
- The full repository quality gate passes on the branch that implements this plan.

## Review Notes

This plan intentionally keeps one medium-risk validation item at the front of the queue: the exact non-interactive JSON contract for the selected CLI AI provider must be locked before deeper implementation. That is why Task 1 and Task 6 explicitly require command-shape tests.

The prior high-severity gaps are now closed in the plan itself:

- **Replacement for Entire input path:** covered by Task 3 and Task 4.
- **Replacement for bridge-store semantics:** covered by Task 5.
- **Durable transcript ownership:** covered by Task 3.

The main remaining non-goal is **Codex as a published-context consumer target**. This plan still allows Codex to be the selected AI provider for summary/review/distill work, but it does not claim a native Codex memory-consumption path until this repository has a verified equivalent to the existing Claude `MEMORY_GRAPH_PATH` bridge.
