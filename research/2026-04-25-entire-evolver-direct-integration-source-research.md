---
date: 2026-04-25
topic: Entire + Evolver direct integration source research
status: completed
mode: context-gathering
sources: 17
---

## Context Report: Entire + Evolver Direct Integration

### Why This Was Gathered

This report supports a direct-integration design for bringing Entire checkpoints and Evolver automation into Stoa with minimal Stoa-owned logic.

The question is not whether Stoa can imitate these systems. The question is where the real ownership boundaries are if Entire and Evolver remain the primary engines.

### Summary

Direct integration is viable, but only if Stoa stays thin.

Entire already owns the checkpoint transcript, metadata, storage topology, and attribution model. Evolver already owns the evolution run state, review flow, validation report, rollback behavior, and asset stores. Stoa should therefore own only orchestration, import cursors, mapping refs, local annotations, and isolated worktree setup.

The biggest practical constraints are:

- Entire checkpoint format is currently in v1, but v2 is actively changing.
- Evolver is now GPL-3.0-or-later and much of the GEP core is obfuscated in the published repo, so subprocess/worktree integration is the lower-risk path operationally and for license posture, not deep embedding.
- Current Stoa Codex integration still overwrites `.codex/config.toml` and `.codex/hooks.json`, and generates its own notify/hook scripts, which conflicts with Entire's Codex hook manager unless direct mode changes that installer behavior.

### Key Findings

- Entire stores committed checkpoint metadata in `entire/checkpoints/v1` and temporary full-state checkpoints on local shadow branches. The committed per-session metadata already contains the fields Stoa would otherwise be tempted to model itself, including `checkpoint_id`, `session_id`, `strategy`, `created_at`, `branch`, `files_touched`, `agent`, `model`, `turn_id`, `tool_use_id`, token usage, summary, and initial line attribution.  
  Source: `research/upstreams/entire-cli/cmd/entire/cli/checkpoint/checkpoint.go:425-475`

- Entire's normalized lifecycle `Event` model already covers session start/end, turn start/end, compaction, subagent start/end, and model updates. That means Stoa does not need a second checkpoint-event schema in direct mode.  
  Source: `research/upstreams/entire-cli/cmd/entire/cli/agent/event.go:11-129`

- Entire's hook integration is agent-specific but already compositional:
  - Codex: read-modify-write of `.codex/hooks.json`, preserve existing top-level keys, append hooks to an existing null-matcher group, remove only Entire-managed commands, and ensure `codex_hooks = true` in `.codex/config.toml`.  
    Source: `research/upstreams/entire-cli/cmd/entire/cli/agent/codex/hooks.go:25-153`, `research/upstreams/entire-cli/cmd/entire/cli/agent/codex/hooks.go:280-368`
  - Claude Code: read-modify-write of `.claude/settings.json`, preserve unknown hooks and permissions, and remove only Entire-managed entries.  
    Source: `research/upstreams/entire-cli/cmd/entire/cli/agent/claudecode/hooks.go:43-224`, `research/upstreams/entire-cli/cmd/entire/cli/agent/claudecode/hooks.go:250-366`, `research/upstreams/entire-cli/cmd/entire/cli/agent/claudecode/hooks.go:467-490`
  - OpenCode: write a dedicated plugin file `.opencode/plugins/entire.ts`, which naturally coexists with other plugins.  
    Source: `research/upstreams/entire-cli/cmd/entire/cli/agent/opencode/hooks.go:17-113`

- Entire uses provider-native `session_id` as its `Event.SessionID` for the providers inspected here:
  - Codex maps `raw.SessionID` into `Event.SessionID`.  
    Source: `research/upstreams/entire-cli/cmd/entire/cli/agent/codex/lifecycle.go:68-108`
  - Claude Code maps `raw.SessionID` into `Event.SessionID`.  
    Source: `research/upstreams/entire-cli/cmd/entire/cli/agent/claudecode/lifecycle.go:106-178`
  - OpenCode maps `raw.SessionID` into `Event.SessionID`.  
    Source: `research/upstreams/entire-cli/cmd/entire/cli/agent/opencode/lifecycle.go:42-112`

- Entire checkpoint v2 is actively changing. The current changelog explicitly calls out v2 as work in progress and notes that `full.jsonl` is being renamed to `raw_transcript`. Direct mode should therefore pin Entire to checkpoint v1 first or reject unsupported versions.  
  Source: `research/upstreams/entire-cli/CHANGELOG.md:8-28`

- Entire's security model matters operationally: committed transcripts go to `entire/checkpoints/v1`, while temporary shadow branches contain unredacted snapshots and are not meant to be pushed. Stoa should import refs from the committed branch and avoid treating shadow branches as durable remote-safe artifacts.  
  Source: `research/upstreams/entire-cli/docs/security-and-privacy.md:7-24`

- Evolver is a CLI package named `@evomap/evolver`, currently at `1.70.0-beta.3`, licensed `GPL-3.0-or-later`, and shipped with a CLI entrypoint `evolver`. This is a material reason to prefer subprocess/check-out integration over linked application-code embedding.  
  Source: `research/upstreams/evolver/package.json:2-24`

- Evolver is explicitly git-dependent. The README states that running in a non-git directory fails, and the current code performs a startup `git --version` preflight plus git-based repo-root detection.  
  Source: `research/upstreams/evolver/README.md:62-66`, `research/upstreams/evolver/index.js:145-163`, `research/upstreams/evolver/src/gep/paths.js:6-31`

- Evolver is still primarily a prompt generator / evolution orchestrator, not a library meant to be linked into another app. It runs as `evolver`, `evolver --review`, or `evolver --loop`. The README is explicit that standalone mode prints artifacts to stdout and that review mode is the human-in-the-loop path.  
  Source: `research/upstreams/evolver/README.md:91-113`, `research/upstreams/evolver/README.md:157-179`, `research/upstreams/evolver/README.md:221-229`

- Evolver's native asset stores already exist and should be treated as authoritative:
  - `assets/gep/genes.json`
  - `assets/gep/capsules.json`
  - `assets/gep/events.jsonl`
  - `assets/gep/candidates.jsonl`
  - `assets/gep/external_candidates.jsonl`
  - `assets/gep/failed_capsules.json`
  - `memory/evolution/memory_graph.jsonl` via the evolution dir  
  Sources: `research/upstreams/evolver/README.md:349-357`, `research/upstreams/evolver/src/gep/assetStore.js:168-175`, `research/upstreams/evolver/src/gep/assetStore.js:385-430`, `research/upstreams/evolver/src/gep/localStateAwareness.js:176-180`

- Evolver already has a machine-readable `ValidationReport` schema. If Stoa needs validation evidence, it should import this report, not define a second report format.  
  Source: `research/upstreams/evolver/src/gep/validationReport.js:8-39`

- Evolver's rollback behavior is destructive by default. `rollbackTracked(repoRoot)` supports `none`, `stash`, and `hard`, with `hard` doing `git restore --staged --worktree .` and `git reset --hard`. This makes isolated worktree execution non-negotiable in direct mode.  
  Source: `research/upstreams/evolver/src/gep/gitOps.js:132-156`

- Evolver already has a review flow keyed off `evolution_solidify_state.json`. `evolver review` shows the pending run, `evolver review --approve` calls `solidify()`, and `evolver review --reject` rolls back git changes and marks the run rejected in state. Stoa should drive this native review flow instead of recreating it.  
  Source: `research/upstreams/evolver/index.js:615-750`

- Evolver can be targeted at an arbitrary host repo and scoped without embedding its code:
  - `EVOLVER_REPO_ROOT` overrides the repo it evolves
  - `EVOLUTION_DIR`, `GEP_ASSETS_DIR`, and `EVOLVER_SESSION_SCOPE` isolate state and assets  
  Source: `research/upstreams/evolver/src/gep/paths.js:24-31`, `research/upstreams/evolver/src/gep/paths.js:102-130`

- Current Stoa already understands provider-side external session IDs, but direct-mode alignment is incomplete:
  - Claude hooks now forward `body.session_id` as `externalSessionId`.  
    Source: `src/core/hook-event-adapter.ts:4-47`
  - Codex hooks still normalize `thread_id` / `thread-id`, not `session_id`.  
    Source: `src/core/hook-event-adapter.ts:49-89`
  - Stoa's Codex provider currently overwrites `.codex/config.toml` and `.codex/hooks.json`, and also writes `notify-stoa.mjs` and `hook-stoa.mjs`, which would collide with Entire's Codex hook manager and installer ownership.  
    Source: `src/extensions/providers/codex-provider.ts:41-187`
  - Stoa's Claude provider writes `.claude/settings.local.json`, which is easier to compose with Entire's `.claude/settings.json`.  
    Source: `src/extensions/providers/claude-code-provider.ts:35-66`
  - Stoa's OpenCode provider writes `.opencode/plugins/stoa-status.ts`, which naturally coexists with Entire's `.opencode/plugins/entire.ts`.  
    Source: `src/extensions/providers/opencode-provider.ts:31-40`
  - Stoa's runtime/auth/webhook routing still uses its own internal session ID end-to-end. In direct mode, provider-native session IDs should be treated as imported external join keys, not assumed to replace Stoa's local runtime primary key wholesale.  
    Source: `src/main/launch-tracked-session-runtime.ts:29-67`, `src/core/session-runtime.ts:45-147`, `src/core/webhook-server.ts:136-250`, `src/shared/project-session.ts:247-266`

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Entire committed metadata schema | `checkpoint.go` | `research/upstreams/entire-cli/cmd/entire/cli/checkpoint/checkpoint.go:425-475` |
| Entire committed branch layout | `checkpoint.go` | `research/upstreams/entire-cli/cmd/entire/cli/checkpoint/checkpoint.go:497-525` |
| Entire initial attribution fields | `checkpoint.go` | `research/upstreams/entire-cli/cmd/entire/cli/checkpoint/checkpoint.go:561-580` |
| Entire normalized event model | `event.go` | `research/upstreams/entire-cli/cmd/entire/cli/agent/event.go:11-129` |
| Entire hook support boundary | `agent.go` | `research/upstreams/entire-cli/cmd/entire/cli/agent/agent.go:80-110` |
| Entire Codex hook composition | `codex/hooks.go` | `research/upstreams/entire-cli/cmd/entire/cli/agent/codex/hooks.go:25-153`, `research/upstreams/entire-cli/cmd/entire/cli/agent/codex/hooks.go:280-368` |
| Entire Claude hook composition | `claudecode/hooks.go` | `research/upstreams/entire-cli/cmd/entire/cli/agent/claudecode/hooks.go:43-224`, `research/upstreams/entire-cli/cmd/entire/cli/agent/claudecode/hooks.go:250-366`, `research/upstreams/entire-cli/cmd/entire/cli/agent/claudecode/hooks.go:467-490` |
| Entire OpenCode plugin installation | `opencode/hooks.go` | `research/upstreams/entire-cli/cmd/entire/cli/agent/opencode/hooks.go:17-113` |
| Entire Codex lifecycle uses session_id | `codex/lifecycle.go` | `research/upstreams/entire-cli/cmd/entire/cli/agent/codex/lifecycle.go:68-108` |
| Entire Claude lifecycle uses session_id | `claudecode/lifecycle.go` | `research/upstreams/entire-cli/cmd/entire/cli/agent/claudecode/lifecycle.go:106-178` |
| Entire OpenCode lifecycle uses session_id | `opencode/lifecycle.go` | `research/upstreams/entire-cli/cmd/entire/cli/agent/opencode/lifecycle.go:42-112` |
| Entire checkpoint v2 churn | `CHANGELOG.md` | `research/upstreams/entire-cli/CHANGELOG.md:8-28` |
| Entire committed vs shadow branch privacy boundary | `security-and-privacy.md` | `research/upstreams/entire-cli/docs/security-and-privacy.md:7-24` |
| Evolver package identity and GPL | `package.json` | `research/upstreams/evolver/package.json:2-24` |
| Evolver git requirement | `README.md`, `index.js`, `paths.js` | `research/upstreams/evolver/README.md:62-66`, `research/upstreams/evolver/index.js:145-163`, `research/upstreams/evolver/src/gep/paths.js:6-31` |
| Evolver CLI and review shape | `README.md`, `index.js` | `research/upstreams/evolver/README.md:91-113`, `research/upstreams/evolver/README.md:157-179`, `research/upstreams/evolver/index.js:615-750` |
| Evolver asset store files | `README.md`, `assetStore.js`, `localStateAwareness.js` | `research/upstreams/evolver/README.md:349-357`, `research/upstreams/evolver/src/gep/assetStore.js:168-175`, `research/upstreams/evolver/src/gep/assetStore.js:385-430`, `research/upstreams/evolver/src/gep/localStateAwareness.js:176-180` |
| Evolver validation report schema | `validationReport.js` | `research/upstreams/evolver/src/gep/validationReport.js:8-39` |
| Evolver rollback modes | `gitOps.js` | `research/upstreams/evolver/src/gep/gitOps.js:132-156` |
| Evolver repo/asset/session scoping env vars | `paths.js` | `research/upstreams/evolver/src/gep/paths.js:24-31`, `research/upstreams/evolver/src/gep/paths.js:102-130` |
| Stoa Claude external session extraction | `hook-event-adapter.ts` | `src/core/hook-event-adapter.ts:4-47` |
| Stoa Codex still uses thread_id | `hook-event-adapter.ts` | `src/core/hook-event-adapter.ts:49-89` |
| Stoa Codex overwrites config and owns notify/hook sidecars | `codex-provider.ts` | `src/extensions/providers/codex-provider.ts:41-187` |
| Stoa Claude writes settings.local.json | `claude-code-provider.ts` | `src/extensions/providers/claude-code-provider.ts:35-66` |
| Stoa OpenCode writes separate plugin file | `opencode-provider.ts` | `src/extensions/providers/opencode-provider.ts:31-40` |
| Stoa local session ID is still the runtime/auth/webhook primary key | `launch-tracked-session-runtime.ts`, `session-runtime.ts`, `webhook-server.ts`, `project-session.ts` | `src/main/launch-tracked-session-runtime.ts:29-67`, `src/core/session-runtime.ts:45-147`, `src/core/webhook-server.ts:136-250`, `src/shared/project-session.ts:247-266` |

### Risks / Unknowns

- [!] Entire v2 and newer checkpoint formats are actively moving. Importing native artifacts without version gating is unsafe.
- [!] Evolver's published repo contains obfuscated GEP core files. Deep embedding would force Stoa to rely on unstable, partially opaque internals.
- [!] GPL-3.0-or-later means bundling or linking Evolver code into Stoa likely changes the compliance posture relative to subprocess use of a separate checkout. This report is not legal advice.
- [!] Current Stoa Codex integration still owns `.codex/config.toml`, `.codex/hooks.json`, and related sidecar script installation; direct mode must change that or it will race with Entire.
- [!] Current Stoa runtime/auth/webhook routing still uses local session IDs. Direct mode should treat provider session IDs as external join keys unless a broader runtime-ID redesign is explicitly taken on.
- [!] `failed_capsules.json` exists, so the older blanket statement "all failed attempts are lost" is no longer safe. What is guaranteed to be emitted for every failed run still needs a direct runtime check on the current version.
- [?] Entire provider coverage is broader than the three providers inspected here. This report verifies Codex, Claude Code, and OpenCode because they overlap most directly with current Stoa work.

## Context Handoff: Entire + Evolver Direct Integration

Start here: `research/2026-04-25-entire-evolver-direct-integration-source-research.md`

Context only. Use this file as the source-backed handoff for the direct integration addendum spec.
