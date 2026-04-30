---
date: 2026-04-29
topic: evolver distill validation dependencies
status: completed
mode: context-gathering
sources: 6
---

> **Status: DEPRECATED.** This document describes investigation done before the Stoa x Evolver hard boundary cleanup (2026-04-30). The `host-bridge` / `publish-context` / `uv-pip capsule` / `src/stoa/*` surfaces described here are no longer part of Stoa's integration. See `research/2026-04-30-evolver-upstream-hardcoding-inventory.md` for the current boundary state.

## Context Report: Evolver Distill and Validation Dependencies

### Why This Was Gathered
To determine which parts of upstream Evolver require an LLM, which parts require local execution, and who should provide those dependencies in the Stoa integration.

### Summary
Upstream `distill` is explicitly a two-step external-LLM workflow: Evolver prepares a prompt/request, an external LLM produces a response file, and Evolver then completes the distillation from that file. Upstream `solidify` validation is a local execution workflow: it runs whitelisted validation commands. Optional LLM review exists, but it is not the core validation dependency.

### Key Findings
- Upstream auto-distill fallback literally instructs the operator to read the prompt file, process it with "your LLM", save the response to a file, and run `distill --response-file=...`.
- The `distill` CLI is split into `--prepare` and `--complete --response-file=...`.
- `distillBridge` only prepares payloads and consumes a response file; it does not own an LLM provider.
- `solidify` is the command-executing validation path.
- `llmReview` is optional behind `EVOLVER_LLM_REVIEW`; if enabled in current upstream code, it still auto-approves when no external LLM is configured.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| auto-distill fallback says "process it with your LLM" and then run `distill --response-file` | upstream index | `research/upstreams/evolver/index.js:522` |
| distill CLI is `--prepare` and `--complete --response-file=<path>` | upstream index | `research/upstreams/evolver/index.js:667` |
| `prepareDistillationPayload()` only wraps `prepareDistillation()` | upstream distill bridge | `research/upstreams/evolver/src/stoa/distillBridge.js:8` |
| `completeDistillationPayload()` only reads a response file and passes text to `completeDistillation()` | upstream distill bridge | `research/upstreams/evolver/src/stoa/distillBridge.js:42` |
| core command-executing validation path is `solidify.js` | upstream README | `research/upstreams/evolver/README.md:430` |
| LLM review is optional via `EVOLVER_LLM_REVIEW` | upstream llmReview | `research/upstreams/evolver/src/gep/llmReview.js:9` |
| current review stub auto-approves with `auto-approved (no external LLM configured)` | upstream llmReview | `research/upstreams/evolver/src/gep/llmReview.js:68` |

### Design Implication
- `distill` depends on an inference provider, but upstream treats that dependency as external.
- `solidify` depends on an execution environment, not an LLM provider.
- Therefore, in Stoa integration:
  - LLM inference should be supplied as an explicit host capability to Evolver when distill/review needs it.
  - Validation execution should be supplied as an explicit execution capability to Evolver when solidify needs it.
  - Neither capability should force Stoa to own Evolver's memory state.

## Context Handoff: Evolver Distill and Validation Dependencies

Start here: `research/2026-04-29-evolver-distill-validation-dependencies.md`

Context only. Use the saved report as the source of truth.
