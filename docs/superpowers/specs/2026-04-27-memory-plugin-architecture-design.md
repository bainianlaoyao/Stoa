# Simplified Evolver Memory Runtime Design

日期：2026-04-27

## Purpose

This document replaces the earlier generic plugin-platform direction with a narrower runtime design that matches the codebase and the verified provider surfaces we actually have.

The target is:

- a complete Evolver memory loop
- one Stoa-owned `memoryAiProvider` setting
- no generic memory plugin platform
- no mandatory Entire dependency on the critical runtime path

## Verified Current State

The current repository establishes these facts:

1. Stoa now persists provider-native evidence snapshots under `.stoa/memory/evidence/`.
   - `src/main/session-event-bridge.ts`
   - `src/core/memory/session-evidence-store.ts`
2. The normal build/runtime path no longer depends on Entire bridge execution.
   - `package.json`
   - `scripts/build-entire-bridge.mjs` remains explicit/offline only
3. The built-in memory runtime is implemented as two fixed stages.
   - `src/core/memory/runtime.ts`
   - `src/core/memory/evolver-maintainer.ts`
   - `src/core/memory/claude-code-injector.ts`
4. Claude Code has a verified local consumer path through project-generated context plus `MEMORY_GRAPH_PATH`.
   - `src/core/memory/claude-code-injector.ts`
   - `src/extensions/providers/claude-code-provider.ts`
5. Codex is still a valid `memoryAiProvider`, but not a published-context consumer target in this repository.
   - `src/core/memory/cli-ai-provider.ts`
   - `src/extensions/providers/codex-provider.ts`
6. Review and distillation decisions are routed through Stoa's selected CLI AI provider rather than Evolver's default `llmReview` stub.
   - `src/core/memory/evolver-maintainer.ts`
   - `research/upstreams/evolver/src/gep/llmReview.js`
7. The pinned Evolver fork exposes machine interfaces that Stoa now consumes directly.
   - `research/upstreams/evolver/src/stoa/publishContext.js`
   - `research/upstreams/evolver/src/stoa/reviewBridge.js`
   - `research/upstreams/evolver/src/stoa/artifactRefs.js`

## Decision

Adopt a fixed internal runtime with two internal stages:

- `maintainer`
- `injector`

These remain architectural boundaries, but they are not plugins.

Stoa will not implement:

- plugin registry
- project/session memory binding config
- external memory plugins
- generic manifest protocol for third parties
- multi-maintainer or multi-injector composition

Instead, Stoa will implement one built-in runtime:

1. capture provider-native evidence into a Stoa-owned evidence store
2. run one built-in Evolver maintainer after turn completion
3. run one built-in injector before session start/resume

## Why Keep Maintainer And Injector

The split stays because it already exists in the current code and because provider delivery semantics are not the same thing as memory maintenance.

What changes is only the amount of machinery around that split.

We are deleting:

- generic plugin lifecycle
- dynamic binding resolution
- third-party execution model
- role-agnostic wrapper configs

We are keeping:

- one stage that produces memory artifacts
- one stage that turns those artifacts into provider-consumable context

## Entire's New Role

`entire` is no longer the mandatory runtime base.

It becomes an optional import source for:

- offline replay
- historical checkpoint import
- debugging or audit flows that need checkpoint-normalized evidence

The primary runtime evidence source should be provider-native capture owned by Stoa.

This change is justified by the current code:

- `entire` currently provides checkpoint export only
- the higher-value memory work (summary, review, distill, publish, inject) lives outside Entire
- Stoa already owns provider hooks and sidecars directly

## Runtime Architecture

### 1. Session Evidence Capture

Stoa adds a persistent evidence layer under `.stoa/memory/evidence/`.

Its job is to store provider-native raw evidence that the maintainer can consume later.

For the first slice, the evidence layer should persist:

- session id
- project id
- provider type
- external session id
- event timestamp
- model when available
- prompt text when available
- last assistant message when available
- transcript path when available
- selected tool metadata when available
- raw hook payload snapshot or extracted normalized evidence

This is required because the current canonical event path does not persist transcripts.

### 2. Maintainer Stage

The maintainer runs after `agent.turn_completed`.

Responsibilities:

- load the latest evidence for the finished session
- normalize transcript/prompt inputs
- generate a semantic session summary using the selected CLI AI provider
- import scoped inputs into an isolated Evolver run workspace
- run Evolver
- handle review decisions through a Stoa-owned CLI AI bridge
- handle distillation through a Stoa-owned CLI AI bridge
- persist run refs and outputs under `.stoa/memory/runs/`

The maintainer is a fixed internal module, not a configurable plugin.

### 3. Injector Stage

The injector runs before provider start/resume.

Responsibilities:

- find the latest successful maintainer run relevant to the session/project
- call native Evolver `publish-context`
- write provider-facing outputs into `.stoa/generated/evolver-context/`
- prepare any provider-specific companion files needed for consumption

The injector is also a fixed internal module.

### 4. AI Provider Selection

Stoa owns one setting:

- `memoryAiProvider: 'codex' | 'claude-code'`

This setting is used only for Stoa's non-interactive AI tasks:

- session summary extraction
- review decision
- distillation response

It must reuse the same executable-path settings that session launch already uses.

It does not mean the selected provider also has to be the session consumer target.

## Provider Scope

### First Complete Consumer Target: Claude Code

Claude Code is the first required end-to-end consumer target because the repository already contains a verified delivery path:

- local wrapper script
- `.stoa/generated/evolver-context/claude-code.jsonl`
- `MEMORY_GRAPH_PATH` handoff

That makes Claude Code the shortest path to a fully closed memory loop.

### Codex Scope In The First Slice

Codex remains in scope as a selectable AI provider for non-interactive summary/review/distill work.

Codex is not the first required published-context consumer target in this slice.

Reason:

- the current repository does not yet contain a verified published-context consumption path for Codex
- the project documentation also records a Windows interactive ingress reliability gap for Codex PTY-driven sessions

Reference:

- `docs/architecture/provider-observable-information.md`

### OpenCode Scope

OpenCode remains out of this slice for automatic consumption.

Its current provider path is not the focus of the simplified plan.

## File-Level Direction

The simplified design implies this structure:

### Shared Contracts

- `src/shared/project-session.ts`
  - add `memoryAiProvider`
  - extend event payloads only as needed for evidence capture

### Core Runtime

- `src/core/provider-path-resolver.ts`
  - shared executable resolution for session launch and memory AI tasks
- `src/core/memory/session-evidence-store.ts`
  - persistent provider-native evidence storage
- `src/core/memory/runtime.ts`
  - fixed dispatcher for maintainer/injector stages
- `src/core/memory/evolver-maintainer.ts`
  - built-in maintainer
- `src/core/memory/claude-code-injector.ts`
  - built-in injector
- `src/core/memory/cli-ai-provider.ts`
  - selected CLI execution for summary/review/distill

### Provider Integration

- `src/core/hook-event-adapter.ts`
  - stop discarding high-value provider fields
- `src/core/webhook-server.ts`
  - validate the additional evidence fields Stoa chooses to persist
- `src/extensions/providers/claude-code-provider.ts`
  - keep the current Claude consumption path, but make it runtime-owned
- `src/extensions/providers/codex-provider.ts`
  - improve evidence capture only; do not promise automatic consumer support in this slice

### Evolver Fork

Patch the pinned Evolver fork with machine interfaces for:

- `publish-context`
- review state I/O
- distillation prepare/complete I/O

Do not depend on `EVOLVER_LLM_REVIEW=true`.

## Explicit Non-Goals

This slice does not include:

- memory plugin registry
- external memory plugin execution
- project/session memory binding overrides
- generic plugin permissions model
- generic maintainer manifest schema for third parties
- multi-plugin ordering/conflict resolution
- automatic OpenCode injection
- Codex consumer-side automatic injection as a completion requirement

## Legacy Cleanup Status

The previous `direct-memory` runtime entry points have been removed from the active architecture.

The remaining position for `entire` is optional offline/audit tooling only. It is not part of the normal memory loop.

## Acceptance Criteria

This simplified design is complete when:

1. Stoa can persist provider-native session evidence without Entire.
2. A built-in maintainer can run Evolver using that evidence plus the selected CLI AI provider.
3. A built-in Claude Code injector can publish and deliver Evolver context before the next session.
4. `entire` is no longer required for the normal runtime loop.
5. The design no longer depends on a generic memory plugin platform.
