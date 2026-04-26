---
date: 2026-04-26
topic: entire-cli function interface viability
status: completed
mode: context-gathering
sources: 11
---

## Context Report: Entire CLI Function Interface Viability

### Why This Was Gathered

Stoa's direct memory bridge currently calls `entire` as an executable. A real smoke test showed the installed CLI does not expose the proposed `stoa` JSON commands. This report checks whether pulling `entireio/cli` source gives Stoa a credible function-level integration path.

### Summary

The upstream repository is a Go module at `github.com/entireio/cli`, and the current source does contain reusable Go read functions for committed checkpoint data. The most useful APIs are `checkpoint.GitStore.ReadCommitted`, `ReadSessionMetadata`, `ReadSessionContent`, `ReadSessionContentByID`, and the v2 equivalents on `checkpoint.V2GitStore`.

The problem is boundary quality: these APIs live under `cmd/entire/cli/...`, not under a stable `pkg/` or SDK package. Stoa cannot directly call them from TypeScript/Electron without adding a Go bridge layer, native binding, WASM layer, or a purpose-built helper process.

### Key Findings

- The repository was cloned at commit `f53b923abed413c17f0b4a3d5fb90f54392487ea`.
- `go.mod` declares module `github.com/entireio/cli`.
- The repository has `cmd/entire/cli/...` packages but no top-level `pkg/` or `internal/` library boundary in this checkout.
- CLI command registration is in `cmd/entire/cli/root.go`; there is no registered `stoa` command.
- `strategy.ListCheckpoints(ctx)` exists and scans the v1 metadata branch `entire/checkpoints/v1`, returning `[]CheckpointInfo`.
- `strategy.CheckpointInfo` is a compact checkpoint listing model, not a full export model.
- `checkpoint.GitStore.ReadCommitted(ctx, checkpointID)` reads root checkpoint `metadata.json` into `CheckpointSummary`.
- `checkpoint.GitStore.ReadSessionMetadata`, `ReadSessionContent`, and `ReadSessionContentByID` read session metadata, transcript, and prompts for v1 checkpoints.
- `checkpoint.V2GitStore` has v2 read APIs for committed checkpoint summary and session content.
- Current checkpoint v2 work is active and changes transcript naming/storage (`full.jsonl` -> `raw_transcript`), so any direct reader must be version-aware.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Go module path is `github.com/entireio/cli`. | `research/upstreams/entire-cli/go.mod` | line 1 |
| Root command registers known subcommands, with no `stoa` command in the registration list. | `research/upstreams/entire-cli/cmd/entire/cli/root.go` | lines 31-106 |
| v1 metadata branch name is `entire/checkpoints/v1`. | `research/upstreams/entire-cli/cmd/entire/cli/paths/paths.go` | line 43 |
| `ListCheckpoints` reads v1 checkpoint metadata from `entire/checkpoints/v1`. | `research/upstreams/entire-cli/cmd/entire/cli/strategy/common.go` | lines 191-207 |
| `ListCheckpoints` scans sharded checkpoint paths and reconstructs checkpoint IDs. | `research/upstreams/entire-cli/cmd/entire/cli/strategy/common.go` | lines 221-290 |
| `CheckpointInfo` is the compact listed checkpoint model. | `research/upstreams/entire-cli/cmd/entire/cli/strategy/manual_commit_types.go` | lines 35-47 |
| `ReadCheckpointMetadata` reads root `metadata.json` and session-level metadata into `CheckpointInfo`. | `research/upstreams/entire-cli/cmd/entire/cli/strategy/common.go` | lines 568-620 |
| `CheckpointSummary` includes checkpoint ID, strategy, branch, files touched, sessions, token usage, and attribution. | `research/upstreams/entire-cli/cmd/entire/cli/checkpoint/checkpoint.go` | lines 515-525 |
| `SessionContent` carries committed session metadata, transcript bytes, and prompts. | `research/upstreams/entire-cli/cmd/entire/cli/checkpoint/checkpoint.go` | lines 414-423 |
| v1 `GitStore` can read committed summary, session metadata, session content, latest session content, and content by session ID. | `research/upstreams/entire-cli/cmd/entire/cli/checkpoint/committed.go` | lines 915-1085 |
| v2 `V2GitStore` can read committed summary and session content by index/session ID. | `research/upstreams/entire-cli/cmd/entire/cli/checkpoint/v2_read.go` | lines 25-40, 247-268, 503-522 |
| v2 checkpoint work is active and includes renaming `full.jsonl` to `raw_transcript`. | `research/upstreams/entire-cli/CHANGELOG.md` | line 27 |

### Integration Assessment

Function-level integration is viable only if we add an explicit bridge boundary. The best target is not `strategy.ListCheckpoints` alone; it is a new upstream/fork package that wraps both v1 and v2 readers and emits Stoa's `EntireStoaCheckpointRef` / `EntireStoaCheckpointExport` contract.

Recommended boundary:

```go
package stoa

type CheckpointSource struct {
  RepoRoot string
}

func (s CheckpointSource) ListCheckpoints(ctx context.Context) ([]CheckpointRef, error)
func (s CheckpointSource) ExportCheckpoint(ctx context.Context, checkpointID string) (*CheckpointExport, error)
```

This package should internally use:

- `checkpoint.NewGitStore(repo)` and `GitStore.ReadCommitted` / `ReadSessionContentByID` for v1.
- `checkpoint.NewV2GitStore(repo, fetchRemote)` and `V2GitStore.ReadCommitted` / `ReadSessionContentByID` for v2, or reject v2 until the export contract is specified.

### Risks / Unknowns

- [!] Importing from `github.com/entireio/cli/cmd/entire/cli/...` directly would depend on CLI-internal packages, not a stable SDK.
- [!] Stoa is TypeScript/Electron, so it cannot call Go functions in-process without a bridge such as a native addon, WASM, local service, or purpose-built helper binary.
- [!] Directly reimplementing these reads in TypeScript would couple Stoa to Entire's branch and file layout, especially risky while v2 is active.
- [?] The desired no-exe interpretation matters: avoiding the installed `entire.exe` is feasible with a vendored Go bridge, but avoiding all helper binaries requires a native/WASM binding strategy.

## Context Handoff: Entire CLI Function Interface Viability

Start here: `research/2026-04-26-entire-cli-function-interface.md`

Context only. Use the saved report as the source of truth.
