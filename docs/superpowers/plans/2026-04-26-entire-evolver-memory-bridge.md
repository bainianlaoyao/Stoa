# Entire Evolver Memory Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend/headless Stoa bridge that orchestrates patched Entire and Evolver CLIs, persists native refs, provisions isolated worktrees, and publishes provider-scoped memory context.

**Architecture:** Add a backend-only bridge under `src/core/direct-memory/`. Stoa owns only refs and delivery metadata; patched CLIs own checkpoint and memory assets. Tests use fake local CLI scripts and real filesystem/git commands where useful.

**Tech Stack:** TypeScript, Node child process `execFile`, Vitest, existing state-store atomic JSON helpers, git CLI.

---

## File Structure

- Create `src/shared/direct-memory.ts`: shared contract types for checkpoint refs, Evolver run/review/publish results, bridge refs, and generated context targets.
- Create `src/core/direct-memory/command-runner.ts`: safe command execution wrapper for JSON-only CLI output.
- Create `src/core/direct-memory/entire-client.ts`: calls `entire stoa checkpoints --json` and `entire stoa checkpoint export <id> --json`.
- Create `src/core/direct-memory/evolver-client.ts`: calls `evolver run/review/publish-context` with bridge env.
- Create `src/core/direct-memory/bridge-store.ts`: JSON persistence for Stoa-owned bridge refs and delivery hashes.
- Create `src/core/direct-memory/worktree.ts`: git repo-root detection and isolated worktree provisioning.
- Create `src/core/direct-memory/context-delivery.ts`: writes generated provider context files under `.stoa/generated/evolver-context/`.
- Create `src/core/direct-memory/orchestrator.ts`: coordinates import -> worktree -> evolve -> review -> publish -> delivery.
- Create focused tests next to each module.

## Tasks

### Task 1: Contract Types

**Files:**
- Create: `src/shared/direct-memory.ts`
- Test: `src/shared/direct-memory.test.ts`

- [ ] Write tests that construct valid contract objects for Entire checkpoint export, Evolver run result, published context, and Stoa bridge ref.
- [ ] Implement the exported TypeScript interfaces and literal union types.
- [ ] Run `npx vitest run src/shared/direct-memory.test.ts`.

### Task 2: JSON Command Runner

**Files:**
- Create: `src/core/direct-memory/command-runner.ts`
- Test: `src/core/direct-memory/command-runner.test.ts`

- [ ] Write tests for successful JSON stdout parsing, non-zero exit errors, invalid JSON errors, and stderr preservation.
- [ ] Implement `runJsonCommand`.
- [ ] Run `npx vitest run src/core/direct-memory/command-runner.test.ts`.

### Task 3: Entire and Evolver Clients

**Files:**
- Create: `src/core/direct-memory/entire-client.ts`
- Create: `src/core/direct-memory/evolver-client.ts`
- Test: `src/core/direct-memory/entire-client.test.ts`
- Test: `src/core/direct-memory/evolver-client.test.ts`

- [ ] Write fake command runner tests for exact command, args, cwd, env, and parsed result passthrough.
- [ ] Implement clients against the spec command contracts.
- [ ] Run `npx vitest run src/core/direct-memory/entire-client.test.ts src/core/direct-memory/evolver-client.test.ts`.

### Task 4: Bridge Store

**Files:**
- Create: `src/core/direct-memory/bridge-store.ts`
- Test: `src/core/direct-memory/bridge-store.test.ts`

- [ ] Write tests for empty store, upsert by `(projectId, stoaSessionId, entireCheckpointId)`, delivery hash updates, and malformed store rejection.
- [ ] Implement atomic JSON persistence.
- [ ] Run `npx vitest run src/core/direct-memory/bridge-store.test.ts`.

### Task 5: Worktree Provisioning

**Files:**
- Create: `src/core/direct-memory/worktree.ts`
- Test: `src/core/direct-memory/worktree.test.ts`

- [ ] Write tests for git root detection, non-git rejection, worktree path derivation, and `git worktree add --detach`.
- [ ] Implement with injected command runner so tests do not mutate real repos unless explicitly arranged.
- [ ] Run `npx vitest run src/core/direct-memory/worktree.test.ts`.

### Task 6: Context Delivery

**Files:**
- Create: `src/core/direct-memory/context-delivery.ts`
- Test: `src/core/direct-memory/context-delivery.test.ts`

- [ ] Write tests that Codex writes `.stoa/generated/evolver-context/codex.md`, Claude writes `claude-code.md`, generic writes `generic.json`, and hashes are stable.
- [ ] Implement delivery writer and SHA-256 content hash.
- [ ] Run `npx vitest run src/core/direct-memory/context-delivery.test.ts`.

### Task 7: Orchestrator

**Files:**
- Create: `src/core/direct-memory/orchestrator.ts`
- Test: `src/core/direct-memory/orchestrator.test.ts`

- [ ] Write tests for full happy path using fake clients and store.
- [ ] Write tests that Entire export failure stops before Evolver, Evolver failure persists failure refs, and empty publish result still records successful zero-asset delivery.
- [ ] Implement orchestration.
- [ ] Run `npx vitest run src/core/direct-memory/orchestrator.test.ts`.

### Task 8: Verification

**Files:**
- Modify as needed based on generated outputs only.

- [ ] Run `npm run test:generate`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npx vitest run`.
- [ ] Run `npm run test:e2e`.
- [ ] Run `npm run test:behavior-coverage`.
