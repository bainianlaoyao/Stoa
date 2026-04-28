# Stoa-Owned Entire Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the direct memory bridge's dependency on a user-installed `entire.exe` with a Stoa-owned Entire checkpoint bridge.

**Architecture:** Keep Stoa's existing `EntireStoaCheckpointRef` and `EntireStoaCheckpointExport` contracts. Add a small Go helper under `tools/entire-bridge` that imports pinned Entire Go packages and emits Stoa JSON. Update the TS `EntireClient` so the default command is the repository-owned bridge binary path, while tests can still inject a command runner.

**Tech Stack:** TypeScript, Vitest, Node child_process, Go, go-git via `github.com/entireio/cli`.

---

### Task 1: TS Adapter Defaults

**Files:**
- Modify: `src/core/direct-memory/entire-client.ts`
- Modify: `src/core/direct-memory/entire-client.test.ts`

- [ ] Add failing tests that construct `new EntireClient({ cwd })` without a command and assert it uses the Stoa-owned bridge path.
- [ ] Verify the tests fail because `command` is currently required.
- [ ] Make `command` optional and resolve the default bridge path from the app root.
- [ ] Keep `listCheckpoints()` and `exportCheckpoint()` output contracts unchanged.
- [ ] Run `npx vitest run src/core/direct-memory/entire-client.test.ts`.

### Task 2: Go Bridge

**Files:**
- Create: `tools/entire-bridge/go.mod`
- Create: `tools/entire-bridge/main.go`
- Create: `tools/entire-bridge/main_test.go`

- [ ] Add Go tests for argument parsing and Stoa JSON mapping.
- [ ] Verify `go test ./...` fails before implementation.
- [ ] Implement `checkpoints --repo <path>` and `checkpoint export <id> --repo <path>`.
- [ ] Use Entire Go readers instead of parsing CLI stdout.
- [ ] Run `go test ./...` inside `tools/entire-bridge`.

### Task 3: Build/Verification Script

**Files:**
- Modify: `package.json`
- Create: `scripts/build-entire-bridge.mjs`

- [ ] Add a script that builds `tools/entire-bridge` into `dist/tools/entire-bridge/`.
- [ ] Add an npm verification script for `go test` and bridge build.
- [ ] Run the bridge verification script.
- [ ] Run repository quality gate.
