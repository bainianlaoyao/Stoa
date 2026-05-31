---
date: 2026-05-29
topic: Orca upstream session, worktree, and terminal lifecycle patterns
status: completed
mode: context-gathering
sources: 25
---

## Context Report: Orca Upstream Session/Worktree/Terminal Lifecycle Patterns

### Why This Was Gathered
Bounded research on Orca's upstream patterns for session persistence, worktree lifecycle, and PTY/terminal management — to extract reusable design patterns without modifying upstream.

### Summary

Orca's lifecycle architecture splits concerns across three layers: a Zustand store slice owns worktree metadata and active selection, a main-process session persistence layer owns workspace session JSON (tabs, editors, browser state), and an out-of-process terminal daemon owns PTY sessions with scrollback snapshots. Worktree IDs use a composite `${repoId}::${absolutePath}` format; PTY session IDs embed the worktree ID as `${worktreeId}@@${shortUuid}`. The renderer never holds local scrollback buffers for local PTYs — those are owned by the daemon and survive relaunch. Persistence is gated by a two-flag contract (`workspaceSessionReady` + `hydrationSucceeded` both true).

---

### Key Findings

#### 1. Worktree ID Format and Parsing

**Format**: `${repoId}::${absolutePath}` — composite, not a UUID.
- `src/shared/worktree-id.ts:20–28` (`splitWorktreeId`): parses by `::` separator
- `src/shared/pty-session-id-format.ts:15`: exports `WORKTREE_ID_SEPARATOR = '::'`
- `src/shared/worktree-ownership.ts:90–114` (`classifyWorktreeOwnership`): ownership is classified as `orca-managed | external | unknown-legacy` using metadata presence, create-path pattern, or layout nesting

**Folder projects** can have multiple workspace sessions backed by the same directory; their IDs carry a UUID suffix (`::workspace:{uuid}`), but filesystem callers strip it:
- `src/shared/worktree-id.ts:31–43` (`splitWorktreeIdForFilesystem`): strips the UUID suffix so callers get the real folder path

**Lookup**: `src/renderer/src/store/slices/worktree-helpers.ts:152–164` (`findWorktreeById`): linear search across `worktreesByRepo` map.

#### 2. Worktree Lifecycle and State Purge

Worktree removal triggers cascading state deletion via `buildWorktreePurgeState`:
- `src/renderer/src/store/slices/worktrees.ts:436–564`: builds a patch that deletes from all relevant maps keyed by worktree ID (`tabsByWorktree`, `ptyIdsByTabId`, `openFiles`, `browserTabsByWorktree`, `activeFileIdByWorktree`, `gitStatusByWorktree`, `expandedDirs`, `lastVisitedAtByWorktreeId`, etc.)
- Active-state fallbacks: if `activeWorktreeId` or `activeTabId` belonged to the removed worktree, they are set to `null`
- `src/renderer/src/store/slices/worktrees.ts:579–591` (`fetchDetectedWorktrees`): stores two parallel lists — `worktreesByRepo` (visible-only, filtered) and `detectedWorktreesByRepo` (authoritative full scan result with ownership metadata)
- `src/renderer/src/store/slices/worktrees.ts:654–730` (`fetchAllWorktrees`): hydration-time one-shot purge of stale `tabsByWorktree` entries whose IDs no longer appear in the authoritative scan; guarded by `hasHydratedWorktreePurge` flag

#### 3. Session Persistence Schema and Gate

**Schema**: `src/shared/workspace-session-schema.ts` uses Zod to validate the workspace session JSON at read time. Policy is "tolerant of extra fields, strict on types" — a corrupted read falls back to defaults rather than crashing the renderer.

**Persistence gate** (two-flag contract):
- `src/renderer/src/lib/workspace-session.ts:24–28` (`shouldPersistWorkspaceSession`): both `workspaceSessionReady` AND `hydrationSucceeded` must be true
- `workspaceSessionReady` flips true even on error (so users aren't locked out)
- `hydrationSucceeded` stays false forever if hydration ever threw

**Relevant fields list** (compile-time exhaustiveness check):
- `src/renderer/src/lib/workspace-session.ts:63–87` (`SESSION_RELEVANT_FIELDS`): array of fields that trigger debounced session writes; any new field added to `WorkspaceSessionSnapshot` type fails `_exhaustive` compile check

**Payload builder**:
- `src/renderer/src/lib/workspace-session.ts:192–323` (`buildWorkspaceSessionPayload`): builds the persisted `WorkspaceSessionState`; `pendingActivationSpawn` is stripped (transient renderer-only handoff, `workspace-session.ts:259–267`)

**IPC handlers** (`src/main/ipc/session.ts`): `session:get` reads, `session:set` writes, `session:set-sync` is synchronous for `beforeunload`.

#### 4. Terminal Tab and PTY Session Lifecycle

**PTY session ID format**: `${worktreeId}@@${shortUuid}` minted by `src/main/daemon/pty-session-id.ts:21–25` (`mintPtySessionId`).
- `src/shared/pty-session-id-format.ts:27–41` (`parsePtySessionId`): reverses the format by splitting on `@@`, then verifying `::` exists in the left-hand side — rejects bare UUIDs and degenerate formats
- `src/main/daemon/pty-session-id.ts:49–68` (`isSafePtySessionId`): filesystem containment check — `join(userDataPath, id)` result must be strictly inside `userDataPath`

**TerminalHost** (`src/main/daemon/terminal-host.ts`):
- `sessions: Map<string, Session>` — owns all live PTY sessions in-memory
- `killedTombstones: Map<string, number>` — records killed session IDs with timestamp; capped at `maxTombstones` (default 1000); prevents re-killing the same session
- `createOrAttach` (`terminal-host.ts:67–141`): if session exists AND is alive AND NOT terminating → reattach with snapshot; otherwise dispose dead session, spawn new
- `dispose` (`terminal-host.ts:223–260`): write final checkpoints for live sessions, then `forceKillAndDisposeSubprocess` for live sessions (SIGKILL + destroy on same tick) and `disposeSubprocess` for already-exited sessions (destroy only — SIGKILL on a reaped POSIX pid risks killing an unrelated recycled process)

**Session class** (`src/main/daemon/session.ts`):
- State machine: `created | spawning | running | exiting | exited` (`session.ts:43`)
- Shell ready state: `pending | ready | timed_out | unsupported` (`session.ts:44`)
- Pre-ready stdin queue: data written before shell ready is buffered; flushed via `PostReadyFlushGate` after shell emits the `\x1b]777;orca-shell-ready\x07` marker (`session.ts:51, 370–380`)
- Three teardown paths:
  1. `dispose()` — natural exit, clears attachedClients, emits `onExit`
  2. `forceDispose()` — `kill()` timeout (5s), sends `SIGKILL` via `forceKill`, emits `onExit(-1)`
  3. `forceKillAndDisposeSubprocess()` — for `TerminalHost.dispose()` on live sessions, bypasses 5s timer
  4. `disposeSubprocess()` — fd-release only, for already-exited sessions; skips all kill signals
- `attachedClients` support multiple simultaneous listeners; `attachClient` returns a token symbol for later `detachClient`
- Snapshot via `HeadlessEmulator`: `getSnapshot()` returns `{ snapshotAnsi, scrollbackAnsi, rehydrateSequences, cwd, modes, cols, rows, scrollbackLines }` (`types.ts:15–26`)

**Daemon-server** (`src/main/daemon/daemon-server.ts`):
- Named socket on filesystem; token written to `tokenPath` (mode 0o600)
- Maintains `TerminalHost` instance; routes NDJSON RPC requests; streams data events via separate socket
- `lastInputAtBySessionId` Map: used for interactive-output batching (100ms window, 1024 char cap)

#### 5. Scrollback Buffer Persistence Policy

**Split by connection type** (`src/shared/workspace-session-terminal-buffers.ts`):
- **SSH/remote**: scrollback buffers ARE preserved in session JSON (relay teardown may leave no local history to cold-restore)
- **Local**: scrollback buffers are pruned from session JSON (daemon history/checkpoints are authoritative)

`pruneLocalTerminalScrollbackBuffers` (`workspace-session-terminal-buffers.ts:37–77`): iterates `terminalLayoutsByTabId`, removes `buffersByLeafId` for worktrees whose `connectionId` is falsy.

**Restart behavior** (E2E spec `tests/e2e/terminal-restart-persistence.spec.ts`):
- Clean quit: daemon keeps scrollback via its in-process history
- Restart: daemon reattaches, replays snapshot through xterm `write()` during pane mount
- Tab ids are regenerated on each launch (not persisted); tab count and layout survive

#### 6. Workspace Session State Schema

`src/shared/types.ts:567–607` (`WorkspaceSessionState`): key fields:
- `activeRepoId`, `activeWorktreeId`, `activeTabId` — top-level active selection
- `tabsByWorktree` — legacy terminal tab list per worktree
- `terminalLayoutsByTabId` — layout snapshot (leaf IDs, pane titles, scrollback buffers)
- `activeWorktreeIdsOnShutdown` — worktrees that had live PTYs at shutdown; used for eager PTY respawn on restart
- `unifiedTabs`, `tabGroups`, `tabGroupLayouts`, `activeGroupIdByWorktree` — unified tab+group model (read first, falls back to legacy)
- `openFilesByWorktree`, `activeFileIdByWorktree` — editor state (only edit-mode files; diffs/conflicts are transient)
- `browserTabsByWorktree`, `browserPagesByWorkspace`, `activeBrowserTabIdByWorktree` — browser state
- `remoteSessionIdsByTabId` — SSH relay PTY IDs preserved across disconnect/reconnect cycles
- `lastVisitedAtByWorktreeId` — focus-recency timestamps for Cmd+J ordering

#### 7. Active Worktree Selection

`setActiveWorktree` (`worktrees.ts:1654–1881`):
- Restores per-worktree state: `activeFileIdByWorktree`, `activeBrowserTabIdByWorktree`, `activeTabTypeByWorktree`, `rightSidebarTabByWorktree`, `activeGroupIdByWorktree`
- Unified tab model is consulted first (group-owned surface), then legacy fallbacks
- `everActivatedWorktreeIds` Set: first activation tagged; `pendingActivationSpawn` flag suppresses activity bump and sortEpoch bump for reattach/fresh-spawn tabs on first activation only
- `lastActivityAt` is NOT stamped on activation (would cause jump-after-focus bug); only `isUnread` clearing is a side-effect of activation

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Worktree ID format `${repoId}::${path}` | `src/shared/worktree-id.ts:20–28` | `splitWorktreeId` |
| PTY session ID format `${worktreeId}@@${shortUuid}` | `src/main/daemon/pty-session-id.ts:21–25` | `mintPtySessionId` |
| PTY ID parse reverses worktree ID | `src/shared/pty-session-id-format.ts:27–41` | `parsePtySessionId` |
| Session states `running/exited/terminating` | `src/main/daemon/session.ts:43,47,101` | `_state`, `_isTerminating` |
| Shell ready states | `src/main/daemon/session.ts:44` | `_shellState` |
| Three teardown paths with distinct kill semantics | `src/main/daemon/session.ts:194–268` | `dispose`, `forceDispose`, `forceKillAndDisposeSubprocess`, `disposeSubprocess` |
| TerminalHost owns in-memory session Map | `src/main/daemon/terminal-host.ts:55` | `sessions = new Map()` |
| TerminalHost tombstone cap | `src/main/daemon/terminal-host.ts:56` | `killedTombstones` |
| createOrAttach reattaches non-terminating alive sessions | `src/main/daemon/terminal-host.ts:67–86` | `if (existing && existing.isAlive && !existing.isTerminating)` |
| Session persistence gate (two-flag) | `src/renderer/src/lib/workspace-session.ts:24–28` | `shouldPersistWorkspaceSession` |
| Zod schema validates at read boundary | `src/shared/workspace-session-schema.ts:1–262` | `parseWorkspaceSession` |
| Local scrollback pruned, SSH preserved | `src/shared/workspace-session-terminal-buffers.ts:37–77` | `pruneLocalTerminalScrollbackBuffers` |
| Worktree purge cascades to 30+ map fields | `src/renderer/src/store/slices/worktrees.ts:436–564` | `buildWorktreePurgeState` |
| Hydration-time stale state purge | `src/renderer/src/store/slices/worktrees.ts:654–730` | `fetchAllWorktrees` |
| Two parallel worktree lists | `src/renderer/src/store/slices/worktrees.ts:566–568` | `worktreesByRepo`, `detectedWorktreesByRepo` |
| SESSION_RELEVANT_FIELDS exhaustiveness check | `src/renderer/src/lib/workspace-session.ts:63–94` | `_exhaustive` compile-time guard |
| pendingActivationSpawn stripped at persistence boundary | `src/renderer/src/lib/workspace-session.ts:259–277` | `buildWorkspaceSessionPayload` |
| Daemon socket with token file | `src/main/daemon/daemon-server.ts:70–76` | `start()` |
| Daemon interactive output batching | `src/main/daemon/daemon-server.ts:52–53` | `INTERACTIVE_OUTPUT_WINDOW_MS` |
| IPC session handlers | `src/main/ipc/session.ts:5–23` | `session:get/set/set-sync` |
| activeWorktreeIdsOnShutdown for eager PTY respawn | `src/shared/types.ts:573–576` | `WorkspaceSessionState.activeWorktreeIdsOnShutdown` |
| First-activation tagging suppresses activity bump | `src/renderer/src/store/slices/worktrees.ts:1815–1830` | `pendingActivationSpawn` |

---

### Risks / Unknowns

- [!] **Source-of-truth split is complex**: Daemon owns PTY scrollback; renderer owns layout. If daemon crashes mid-write, scrollback may be lost even though session JSON is intact. Recovery path depends on `terminalLayoutsByTabId.buffersByLeafId` for SSH (which IS persisted) but not for local.
- [?] **Folder project UUID suffix handling**: `splitWorktreeIdForFilesystem` strips the suffix but `splitWorktreeId` does not — callers must choose the right parser. Whether this dual-path is intentional or a legacy artifact is unclear from the code.
- [?] **Tombstone cap behavior under pressure**: `killedTombstones` is capped at 1000 entries and only the oldest is evicted. Under extreme tab-churn, this may not be sufficient. Unknown whether this has caused issues in practice.
- [?] **pendingActivationSpawn lifecycle**: The flag is set on first activation and consumed by `updateTabPtyId`, but there is no explicit cleanup path documented — it may accumulate stale values if the activation flow is interrupted.

---

### Report Path
`D:\Data\DEV\ultra_simple_panel\research\2026-05-29-orca-lifecycle-patterns-subagent.md`