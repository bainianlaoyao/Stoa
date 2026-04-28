# Stoa As Evolver Host Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Stoa-owned memory maintainer/injector runtime with a thin host-orchestrator that captures evidence, invokes Evolver on lifecycle events, and delivers Evolver-owned memory context back to consumers.

**Architecture:** Stoa keeps only Hook Gateway, Evidence Ledger, Evolver Bridge, and Delivery Adapter responsibilities. Evolver remains the sole memory authority. The rewrite is a breaking change: old run-centric runtime state, summary/review/distill orchestration, and latest-run-based injection are removed.

**Tech Stack:** Electron main process, TypeScript, Vitest, Playwright, Node child-process APIs, pinned Evolver fork under `research/upstreams/evolver`.

---

## File Structure

### Shared Contracts

- Modify: `src/shared/memory-runtime.ts`
  - Replace run/publish/review contracts with orchestrator-only contracts.

### Core Runtime

- Modify: `src/main/session-event-bridge.ts`
  - Turn it into Hook Gateway plus orchestration dispatcher.
- Modify: `src/core/hook-event-adapter.ts`
  - Normalize provider hook payloads into raw observed events without memory-runtime assumptions.
- Modify: `src/core/memory/session-evidence-store.ts`
  - Keep evidence persistence and add turn sealing plus evidence-ref resolution.
- Modify: `src/core/memory/transcript-snapshot.ts`
  - Keep transcript or turn-slice capture as immutable evidence.
- Create or replace: `src/core/memory/runtime-state-store.ts`
  - Keep only sealed-turn and maintenance-job state.
- Replace: `src/core/memory/evolver-client.ts`
  - Make it an Evolver Bridge facade with `warmStart`, `recall`, `observeWrite`, and `processTurn`.
- Delete: `src/core/memory/runtime.ts`
- Delete: `src/core/memory/evolver-maintainer.ts`
- Delete: `src/core/memory/claude-code-injector.ts`
- Delete: `src/core/memory/cli-ai-provider.ts`
- Delete: `src/core/memory/api-ai-provider.ts`

### Providers

- Modify: `src/extensions/providers/claude-code-provider.ts`
  - Install command hooks for injection phases and HTTP hooks for observation phases.
- Modify: `src/extensions/providers/codex-provider.ts`
  - Align lifecycle hook coverage with the new orchestration model.

### Evolver Fork

- Modify: `research/upstreams/evolver/index.js`
  - Add machine-readable bridge commands for host orchestration.
- Create: `research/upstreams/evolver/src/stoa/hostBridge.js`
  - Thin wrapper over Evolver internals for `warmStart`, `recall`, `observeWrite`, and `processTurn`.

### Tests

- Modify: `src/core/memory/evolver-client.test.ts`
- Modify: `src/core/memory/session-evidence-store.test.ts`
- Modify: `src/core/memory/runtime-state-store.test.ts`
- Delete/replace: `src/core/memory/runtime.test.ts`
- Delete/replace: `src/core/memory/evolver-maintainer.test.ts`
- Delete/replace: `src/core/memory/claude-code-injector.test.ts`
- Modify: `src/main/session-event-bridge.test.ts`
- Modify: `src/extensions/providers/claude-code-provider.test.ts`
- Modify: `tests/e2e/provider-integration.test.ts`
- Delete/replace: `tests/e2e/evolver-memory-pipeline.test.ts`
- Delete/replace: `tests/e2e/evolver-memory-real-api.test.ts`

## Task 1: Replace Shared Contracts

**Files:**
- Modify: `src/shared/memory-runtime.ts`
- Test: `src/core/memory/evolver-client.test.ts`
- Test: `src/core/memory/runtime-state-store.test.ts`

- [ ] Write failing tests that assert the new shared contract no longer exposes `MemoryRunRecord`, `PublishedMemoryRecord`, `SemanticSessionSummary`, `ReviewDecision`, or `DistillationResponse`.
- [ ] Run the focused tests and confirm type or import failures.
- [ ] Replace the shared contract with `ObservedEvent`, `EvidenceRef`, `RuntimeState`, `DeliveryEnvelope`, and `Consumer`.
- [ ] Re-run the focused tests and fix import usage until they pass.

## Task 2: Rebuild Evidence Ledger And Runtime State

**Files:**
- Modify: `src/core/memory/session-evidence-store.ts`
- Modify: `src/core/memory/session-evidence-store.test.ts`
- Modify: `src/core/memory/runtime-state-store.ts`
- Modify: `src/core/memory/runtime-state-store.test.ts`

- [ ] Write failing tests for turn sealing and evidence-ref lookup by `sessionId + turnId`.
- [ ] Run the ledger tests and verify they fail because the methods do not exist.
- [ ] Implement immutable evidence persistence plus:
  - `sealTurn(projectPath, sessionId, turnId, evidenceIds)`
  - `listEvidenceRefsForTurn(projectPath, sessionId, turnId)`
- [ ] Replace runtime-state persistence with sealed-turn and job-only state.
- [ ] Run the ledger and runtime-state tests until they pass.

## Task 3: Introduce Evolver Bridge Commands

**Files:**
- Modify: `research/upstreams/evolver/index.js`
- Create: `research/upstreams/evolver/src/stoa/hostBridge.js`
- Modify: `src/core/memory/evolver-client.ts`
- Modify: `src/core/memory/evolver-client.test.ts`

- [ ] Write failing tests for `warmStart`, `recall`, `observeWrite`, and `processTurn` command dispatch.
- [ ] Run the client tests and confirm the new methods fail.
- [ ] Add thin host-bridge commands in the pinned Evolver fork.
- [ ] Replace the Stoa client wrapper so it calls only the new host-bridge commands.
- [ ] Re-run the client tests until they pass.

## Task 4: Rewrite Hook Gateway Lifecycle

**Files:**
- Modify: `src/core/hook-event-adapter.ts`
- Modify: `src/main/session-event-bridge.ts`
- Modify: `src/main/session-event-bridge.test.ts`
- Delete: `src/core/memory/runtime.ts`
- Delete: `src/core/memory/evolver-maintainer.ts`
- Delete: `src/core/memory/claude-code-injector.ts`

- [ ] Write failing tests that assert:
  - `SessionStart` requests `warmStart`
  - `UserPromptSubmit` persists evidence then requests `recall`
  - `PostToolUse(Write)` persists evidence then requests `observeWrite`
  - `Stop` seals the turn then queues `processTurn`
- [ ] Run the bridge tests and verify the old runtime path fails those assertions.
- [ ] Replace the bridge orchestration with direct lifecycle dispatch to the Evolver Bridge.
- [ ] Remove references to the old maintainer/runtime/injector path.
- [ ] Re-run the bridge tests until they pass.

## Task 5: Align Provider Hook Installation

**Files:**
- Modify: `src/extensions/providers/claude-code-provider.ts`
- Modify: `src/extensions/providers/claude-code-provider.test.ts`
- Modify: `src/extensions/providers/codex-provider.ts`
- Modify: `tests/e2e/provider-integration.test.ts`

- [ ] Write failing tests for the new hook matrix:
  - Claude `SessionStart` command hook
  - Claude `UserPromptSubmit` command hook
  - Claude `PostToolUse` and `Stop` HTTP hooks
  - Codex lifecycle parity
- [ ] Run provider tests and confirm the old sidecar shape fails.
- [ ] Update provider sidecar generation to the new split command/HTTP model.
- [ ] Re-run provider tests until they pass.

## Task 6: Replace End-To-End Coverage

**Files:**
- Delete/replace: `tests/e2e/evolver-memory-pipeline.test.ts`
- Delete/replace: `tests/e2e/evolver-memory-real-api.test.ts`

- [ ] Write E2E coverage that proves:
  - session-start warm start delivery
  - prompt-time recall delivery
  - write-phase observation dispatch
  - stop-triggered process-turn dispatch
- [ ] Run the targeted E2E suite and confirm failure before implementation is complete.
- [ ] Adjust the tests to the final architecture only after the runtime rewrite is in place.
- [ ] Re-run the targeted E2E suite until it passes.

## Task 7: Full Verification

**Files:**
- Modify any affected generated or behavior assets only if the lifecycle behavior surface changed.

- [ ] Run `npm run test:generate`
- [ ] Run `npm run typecheck`
- [ ] Run `npx vitest run`
- [ ] Run `npm run test:e2e`
- [ ] Run `npm run test:behavior-coverage`
- [ ] If any command fails, fix code and re-run the exact failing command before continuing.
