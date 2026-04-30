---
date: 2026-04-27
topic: evolver-real-source-integration
status: completed
mode: context-gathering
sources: 18
---

> **Status: DEPRECATED.** This document describes investigation done before the Stoa x Evolver hard boundary cleanup (2026-04-30). The `host-bridge` / `publish-context` / `uv-pip capsule` / `src/stoa/*` surfaces described here are no longer part of Stoa's integration. See `research/2026-04-30-evolver-upstream-hardcoding-inventory.md` for the current boundary state.

## Context Report: Evolver Real Source Integration

### Why This Was Gathered

We need to connect Stoa's Entire checkpoint pipeline to real Evolver, then publish the evolved result to agents such as Claude Code and Codex. This report replaces earlier assumptions and fake Evolver simulations with evidence from the cloned upstream source.

Cloned upstream: `research/upstreams/evolver`, remote `https://github.com/EvoMap/evolver.git`, HEAD `34e738d83b83d2add656c9ea3eb0d5f61d16865c`.

### Summary

Real Evolver is installable as the `evolver` CLI from package `@evomap/evolver`, but its current public machine interface is not the interface Stoa previously modeled. The CLI has `run`, `review`, `solidify`, `distill`, `fetch`, `asset-log`, `setup-hooks`, and ATP commands; it does not expose a verified `publish-context` command, and only `asset-log`/some ATP flows have documented JSON output.

Evolver's primary documented run artifact is a GEP prompt printed to stdout, plus auditable memory/assets written under memory and GEP asset paths. It has native Claude Code and Codex hook installers that can write `CLAUDE.md` / `AGENTS.md`, but those hooks inject summaries from a memory graph, not a local provider-specific published memory file.

### Key Findings

- Evolver package metadata says the binary is `evolver: index.js`; the package version in the cloned source is `1.70.0-beta.4`, and the license is `GPL-3.0-or-later`.
- The CLI dispatch treats no command, `run`, `/evolve`, or `--loop` as an evolution run. `review` and `--review` are separate review-mode dispatch paths. `setup-hooks` is implemented. No `publish-context` command appears in the command dispatch or help output.
- `--json` in `index.js` is implemented for `asset-log`; the help also documents `--json` for ATP `orders`. There is no verified `run --json`, `review --json`, or `publish-context --json`.
- Evolver's README describes the tool as a prompt generator, not a code patcher. It says a successful first run prints a GEP prompt to stdout, then writes audit information into memory.
- Path semantics are usable for Stoa isolation: `EVOLVER_REPO_ROOT` overrides repo root, `MEMORY_DIR` controls memory root, `EVOLUTION_DIR` controls evolution root, `GEP_ASSETS_DIR` controls asset root, and `EVOLVER_SESSION_SCOPE` appends scoped subdirectories for evolution/assets.
- Asset store paths are concrete and readable: `genes.json`, `genes.jsonl`, `capsules.json`, `capsules.jsonl`, `events.jsonl`, `candidates.jsonl`, `external_candidates.jsonl`, and `failed_capsules.json`.
- `memoryGraph` has internal functions such as `recordSignalSnapshot`, `recordHypothesis`, `recordAttempt`, and `recordOutcomeFromState`; tests verify it writes JSONL events with `type: "MemoryGraphEvent"` and kinds like `signal`, `hypothesis`, and `attempt`.
- `skillPublisher` can convert a Gene object to `SKILL.md` content via `geneToSkillMd`, and can publish/update a Skill to the remote Hub. It does not provide a local `publish-context` function.
- Claude Code native integration writes `.claude/settings.json`, copies hook scripts, and injects an Evolver section into `CLAUDE.md`.
- Codex native integration writes `.codex/hooks.json`, enables `codex_hooks = true` in `.codex/config.toml`, copies hook scripts, and injects an Evolver section into `AGENTS.md`.
- Hook scripts communicate via JSON fields expected by host runtimes: session start emits `agent_message` and `additionalContext`; file edit detection emits `additional_context` and `additionalContext`; session end emits `followup_message`, `stopMessage`, and `additionalContext`.
- Important implementation caveat: copied hook scripts find the memory graph through `MEMORY_GRAPH_PATH`, or by resolving an Evolver root and then reading `<evolverRoot>/memory/evolution/memory_graph.jsonl`. The adapter commands copied into `.claude/hooks` or `.codex/hooks` do not themselves set `EVOLVER_ROOT` or `MEMORY_GRAPH_PATH`. Stoa should set these explicitly if using Evolver's hook scripts.
- Core files `src/evolve.js`, `src/gep/prompt.js`, `src/gep/solidify.js`, and `src/gep/memoryGraph.js` are obfuscated in this clone. This makes deep function-level integration possible only as an internal dependency, not a clean public source contract.

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| Package binary, version, license, repository | `research/upstreams/evolver/package.json` | lines 2-24 |
| CLI dispatch for run/default/loop | `research/upstreams/evolver/index.js` | lines 126-145 |
| Review dispatch and review state semantics | `research/upstreams/evolver/index.js` | lines 615-635 |
| Review approval calls `solidify`; rejection performs rollback and marks state | `research/upstreams/evolver/index.js` | lines 703-750 |
| `asset-log --json` is implemented | `research/upstreams/evolver/index.js` | lines 929-947 |
| `setup-hooks` command calls `setupHooks` with platform/force/uninstall | `research/upstreams/evolver/index.js` | lines 972-999 |
| CLI help lists commands and flags; no `publish-context` appears | `research/upstreams/evolver/index.js` | lines 1034-1055 |
| Runtime check of `node index.js --help` matched command list and did not list `publish-context` | command output | `node index.js --help` in `research/upstreams/evolver` |
| Repo root precedence includes `EVOLVER_REPO_ROOT` and nearest git roots | `research/upstreams/evolver/src/gep/paths.js` | lines 6-45 |
| Memory/evolution/assets path env vars and scoping | `research/upstreams/evolver/src/gep/paths.js` | lines 102-134 |
| Path helpers are exported | `research/upstreams/evolver/src/gep/paths.js` | lines 203-216 |
| README says a successful run scans memory, prints a GEP prompt, and writes an audit event | `research/upstreams/evolver/README.md` | lines 91-114 |
| README says Evolver is a prompt generator and not a code patcher | `research/upstreams/evolver/README.md` | lines 157-169 |
| README describes standalone stdout behavior and host-runtime interpretation | `research/upstreams/evolver/README.md` | lines 171-177 |
| Asset store reads genes from `genes.json` and `genes.jsonl` | `research/upstreams/evolver/src/gep/assetStore.js` | lines 168-204 |
| Asset store reads capsules from JSON and JSONL stores | `research/upstreams/evolver/src/gep/assetStore.js` | lines 206-230 |
| Asset store writes/ensures genes, capsules, events, candidates, failed capsules | `research/upstreams/evolver/src/gep/assetStore.js` | lines 349-448 |
| Memory graph tests set `MEMORY_GRAPH_PATH` and verify JSONL event shapes | `research/upstreams/evolver/test/memoryGraph.test.js` | lines 45-57, 176-193, 201-217, 225-257 |
| `geneToSkillMd` converts a Gene object to `SKILL.md` content | `research/upstreams/evolver/src/gep/skillPublisher.js` | lines 55-90 |
| Skill publisher publishes/updates to remote Hub endpoints | `research/upstreams/evolver/src/gep/skillPublisher.js` | lines 239-349 |
| Skill publisher tests verify `geneToSkillMd` behavior | `research/upstreams/evolver/test/skillPublisher.test.js` | lines 7-115 |
| Claude Code adapter writes hooks and `CLAUDE.md` section | `research/upstreams/evolver/src/adapters/claudeCode.js` | lines 8-60, 63-99 |
| Codex adapter writes hooks, enables `codex_hooks`, and writes `AGENTS.md` section | `research/upstreams/evolver/src/adapters/codex.js` | lines 8-70, 73-114 |
| Hook adapter detects platforms, copies scripts, merges config, and invokes adapters | `research/upstreams/evolver/src/adapters/hookAdapter.js` | lines 5-21, 44-57, 75-96, 162-205 |
| Adapter tests assert Claude Code and Codex installation outputs | `research/upstreams/evolver/test/adapters.test.js` | lines 212-260, 265-310 |
| Session-start hook resolves `MEMORY_GRAPH_PATH` and emits `agent_message` / `additionalContext` | `research/upstreams/evolver/src/adapters/scripts/evolver-session-start.js` | lines 28-40, 118-152 |
| Session-end hook appends local JSONL outcome entries and emits stop/followup context | `research/upstreams/evolver/src/adapters/scripts/evolver-session-end.js` | lines 129-143, 149-193 |
| Signal-detect hook emits `additional_context` / `additionalContext` on matched signals | `research/upstreams/evolver/src/adapters/scripts/evolver-signal-detect.js` | lines 6-55 |
| Search audit: no `publish-context` string was found; `--json` only appears in asset-log, ATP, export script, tests, and docs | command output | `rg -n "publish-context|--json|run --json|review --json|..." research/upstreams/evolver` |
| Runtime export check: `index.js` exports only `main`, `readJsonSafe`, `rejectPendingRun`, `isPendingSolidify` | command output | `node -e "console.log(Object.keys(require('./index.js')))"` |
| Runtime export check: `src/evolve` exports `run` plus helper functions, but this is an internal module | command output | `node -e "console.log(Object.keys(require('./src/evolve')))"` |
| Runtime export check: `memoryGraph` exports record/advice helpers | command output | `node -e "console.log(Object.keys(require('./src/gep/memoryGraph')))"` |
| Runtime export check: `skillPublisher` exports `geneToSkillMd` and Hub publish/update helpers | command output | `node -e "console.log(Object.keys(require('./src/gep/skillPublisher')))"` |

### Integration Judgement

#### Can Stoa use current Evolver CLI as-is?

Partially.

Stoa can run Evolver as a subprocess in an isolated worktree and control paths through environment variables. This is the safest currently verified boundary:

```text
EVOLVER_REPO_ROOT=<isolated checkpoint worktree>
MEMORY_DIR=<stoa run dir>/memory
EVOLUTION_DIR=<stoa run dir>/memory/evolution
GEP_ASSETS_DIR=<stoa run dir>/assets/gep
MEMORY_GRAPH_PATH=<stoa run dir>/memory/evolution/memory_graph.jsonl
EVOLVER_SESSION_SCOPE=<checkpoint/session id>
node <evolver>/index.js run
```

However, Stoa cannot rely on current Evolver CLI as the exact previously-designed machine protocol. `run --json`, `review --json`, and `publish-context --target=... --json` are not verified upstream capabilities.

#### Is a function interface better than relying on a user exe?

Not with the current source as the stable boundary.

Facts:

- `require('./src/evolve').run` exists.
- `memoryGraph` and `skillPublisher` export useful helper functions.
- The package public `index.js` does not export a structured Evolver client API.
- Key core files are obfuscated and the run path prints to stdout and writes state.

Judgement:

- For a prototype, Stoa may call internal functions in a pinned cloned repo during experiments.
- For the actual bridge contract, prefer a subprocess boundary or patch Evolver to expose a first-class machine API. The subprocess boundary avoids coupling Stoa to obfuscated internal function names, module side effects, and GPL-linked distribution questions.

#### Is Evolver's final product a memory file?

Not exactly.

Verified source/docs say the run product is:

- A GEP prompt printed to stdout.
- Audit/memory artifacts under memory/evolution and GEP asset files.
- Native hooks consume recent memory graph outcomes and inject summaries into agents.

So Stoa should treat Evolver output as a bundle:

```text
stdout GEP prompt
memory/evolution/*
assets/gep/genes.json + genes.jsonl
assets/gep/capsules.json + capsules.jsonl
assets/gep/events.jsonl
memory/evolution/memory_graph.jsonl
```

#### Does Evolver natively provide publication to Claude Code / Codex?

It provides native hook setup, not a verified local `publish-context` command.

Native hook setup can:

- Register Claude Code hooks and inject `CLAUDE.md`.
- Register Codex hooks, enable `codex_hooks`, and inject `AGENTS.md`.
- Emit per-session JSON context through hook scripts.

It does not currently provide the Stoa-mode function "publish a selected Evolver output bundle into stable provider markdown context files".

### Recommended Access Plan

1. Keep the Stoa-owned Entire bridge as the source of session checkpoints.

Entire should continue producing a canonical checkpoint export that includes session messages, tool activity, user corrections, repository path, commit identity, and stable checkpoint id.

2. Add an Evolver input adapter in Stoa.

For each Entire checkpoint:

- Create an isolated worktree for the checkpoint.
- Create a Stoa-owned Evolver run directory.
- Write checkpoint-derived session facts into Evolver-readable local memory/log files.
- Set `EVOLVER_REPO_ROOT`, `MEMORY_DIR`, `EVOLUTION_DIR`, `GEP_ASSETS_DIR`, `MEMORY_GRAPH_PATH`, and `EVOLVER_SESSION_SCOPE`.
- Run `node <cloned-evolver>/index.js run` as a subprocess.
- Capture stdout to a file such as `<runDir>/evolver/stdout.txt`.
- Save a Stoa manifest with exit code, env, paths, stdout path, and discovered asset paths.

3. Do not parse Evolver stdout as a long-term protocol.

The documented stdout GEP prompt is human/host-facing. For automation, Stoa should either:

- Use Stoa's manifest around the subprocess outputs, or
- Patch Evolver to add `run --json` that returns machine data.

4. Publish to agents through Stoa-owned provider context files first.

Recommended prototype output:

```text
.stoa/generated/evolver-context/claude-code.md
.stoa/generated/evolver-context/codex.md
CLAUDE.md  -> stable Stoa-managed reference block
AGENTS.md  -> stable Stoa-managed reference block
```

This is more deterministic than relying on Evolver's hook auto-discovery. It also keeps Stoa's "agent consumption" contract independent of the host's hook support.

5. Treat Evolver native `setup-hooks` as an optional mode, not the primary bridge.

If we use native hooks, Stoa should generate or patch hook commands so they include explicit env:

```text
EVOLVER_ROOT=<cloned-evolver>
MEMORY_GRAPH_PATH=<stoa run/current memory_graph.jsonl>
```

Without explicit env, the copied hook scripts may not find the intended Evolver root or Stoa memory graph in a normal project installation layout.

6. Minimal upstream-compatible Evolver patch, if we choose to modify Evolver.

Add first-class machine commands:

```text
evolver run --json
evolver review --json
evolver review --approve --json
evolver review --reject --json
evolver publish-context --target=codex|claude-code --format=markdown --out=<dir> --json
```

Expected `run --json` shape:

```json
{
  "ok": true,
  "run_id": "string",
  "repo_root": "string",
  "memory_dir": "string",
  "evolution_dir": "string",
  "gep_assets_dir": "string",
  "memory_graph_path": "string",
  "prompt_artifact_path": "string",
  "selected_gene_id": "string|null",
  "signals": []
}
```

Expected `publish-context --json` shape:

```json
{
  "ok": true,
  "target": "codex",
  "format": "markdown",
  "files": ["..."],
  "source": {
    "memory_graph_path": "...",
    "genes_path": "...",
    "events_path": "..."
  }
}
```

This patch would make Stoa's existing `EvolverClient` design match real upstream behavior instead of wrapping undocumented stdout.

### Risks / Unknowns

- [!] Core modules are obfuscated. Internal function integration can break without readable diffs, even if exported names currently exist.
- [!] License is `GPL-3.0-or-later`. Linking or distributing Evolver as an embedded library may have project-level implications. Keep a subprocess boundary unless legal/project policy approves deeper embedding.
- [!] Native hook scripts' root/memory discovery is fragile for Stoa unless env vars are explicitly injected.
- [?] The exact structured shape of Evolver's `last_run` state is not fully documented in clear source because `evolve.js` and `solidify.js` are obfuscated. We can observe it by running a real isolated Evolver cycle, but we should not infer undocumented fields as stable.
- [?] The real Evolver run's quality depends on what checkpoint-derived logs/signals we provide under memory. A follow-up test should use the two-session uv-vs-pip scenario and inspect resulting stdout/assets.

## Context Handoff: Evolver Real Source Integration

Start here: `research/2026-04-27-evolver-real-source-integration.md`

Context only. Use this report as the verified source of truth for connecting Stoa's Entire checkpoint output to real Evolver. The recommended bridge is subprocess plus explicit env/path isolation, followed by Stoa-owned provider markdown publication. Do not assume `run --json` or `publish-context` exists unless we patch Evolver or verify a newer upstream version.
