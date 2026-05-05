---
date: 2026-05-04
topic: Terminal backlog/replay architecture — raw ANSI trim corruption analysis
status: completed
mode: context-gathering
sources: 18
---

## Context Report: Terminal Backlog/Replay Architecture

### Why This Was Gathered

Users observed broken ANSI control sequence tails (`30H`, `;213m`) rendered as visible text in the terminal viewport when switching sessions. The hypothesis is that `backlog.slice(-250000)` in `trimBacklog()` cuts through mid-sequence ANSI bytes, and the resulting corrupted string is replayed into a fresh xterm instance. This report traces the full data flow, confirms the hypothesis, and maps all touchpoints a fix would need to address.

### Summary

The backlog/replay system stores raw PTY output as a plain `Map<string, string>`, trims it with `backlog.slice(-250000)` (blind character-boundary truncation), and replays the result directly into a **new** xterm instance via `terminal.write()`. There is zero ANSI-aware boundary logic anywhere in the production codebase. SerializeAddon is loaded but never called. Terminal instances are destroyed and recreated on every session switch, making replay the only history mechanism. A chunk ring buffer was designed but never implemented.

### Key Findings

1. **The trim corruption is confirmed and reproducible.** `trimBacklog()` at `session-runtime-controller.ts:143` uses `backlog.slice(-MAX_TERMINAL_BACKLOG_CHARS)` which can cut any CSI/SGR/OSC sequence in half. The result is fed raw to `terminal.write()` at `TerminalViewport.vue:242`.

2. **There is no ANSI-aware trimming anywhere in production code.** No safe boundary detection, no `wasTrimmed` flag, no line-boundary logic, no regex stripping. The only ANSI handling found is `research/trace_ansi_codex.js` — a diagnostic script, not production code.

3. **SerializeAddon is loaded but never used.** It is instantiated at `xterm-runtime.ts:195` and loaded at line 203, but `serialize()` is never called anywhere in the codebase. It could provide an alternative to raw ANSI replay.

4. **Terminal instances are destroyed and recreated on every session switch.** `TerminalViewport.vue` watcher calls `disposeTerminal()` then `scheduleTerminalSetup()`, forcing replay as the only history recovery mechanism.

5. **Single production consumer of replay.** Only `TerminalViewport.vue:235-242` calls `getTerminalReplay()` and writes it to xterm. All other references are tests, mocks, or IPC plumbing.

6. **Chunk ring buffer was planned but never implemented.** `terminal-core-overhaul-spec.md:135` explicitly notes it was discussed but not part of the implemented contract.

7. **Live data path is clean.** Live PTY output flows via IPC `terminalData` channel directly to `queueOrWrite()` → `enqueueWrite()` → `terminal.write()`. No trimming, no corruption risk on the live path.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Backlog stored as `Map<string, string>` | `session-runtime-controller.ts` | `:26` |
| Append uses string concat + blind trim | `session-runtime-controller.ts` | `:72-73` |
| `trimBacklog` uses `slice(-250000)` with no boundary logic | `session-runtime-controller.ts` | `:138-144` |
| `MAX_TERMINAL_BACKLOG_CHARS = 250_000` | `session-runtime-controller.ts` | `:136` |
| `getTerminalReplay` returns raw backlog string | `session-runtime-controller.ts` | `:81-83` |
| PTY output → appendTerminalData callback | `session-runtime.ts` | `:120-122` |
| Main process IPC handler registration | `main/index.ts` | `:955-957` |
| Preload bridge for replay | `preload/index.ts` | `:60-62` |
| Preload bridge for live data | `preload/index.ts` | `:96-100` |
| IPC channel definitions | `ipc-channels.ts` | `:8, :25` |
| Replay consumed in TerminalViewport | `TerminalViewport.vue` | `:235-242` |
| `enqueueWrite` chains `writeChunk` promises | `TerminalViewport.vue` | `:123-133` |
| `writeChunk` calls `terminal.write(data, cb)` | `TerminalViewport.vue` | `:70-74` |
| Live data handler `queueOrWrite` | `TerminalViewport.vue` | `:155-166, :210-214` |
| Terminal destroyed on session switch | `TerminalViewport.vue` | watcher calls `disposeTerminal()` |
| SerializeAddon loaded but `serialize()` never called | `xterm-runtime.ts` | `:195, :203` |
| No `wasTrimmed` flag exists | `session-runtime-controller.ts` | full file search |
| Chunk ring buffer planned but not implemented | `terminal-core-overhaul-spec.md` | `:135` |
| ANSI diagnostic script (research only) | `research/trace_ansi_codex.js` | full file |

### Complete Data Flow

```
PTY output (node-pty onData)
  → pty-host.ts:25                    raw data capture
  → session-runtime.ts:120-122         wraps in {sessionId, data}
  → session-runtime-controller.ts:72   appendTerminalData()
      ├─ :73  trimBacklog(current + chunk.data)  ← CORRUPTION POINT
      └─ :77  IPC send → renderer (live path, clean)

Replay path (on session switch):
  session-runtime-controller.ts:81     getTerminalReplay()
  → main/index.ts:955                  IPC handle
  → preload/index.ts:60                ipcRenderer.invoke()
  → TerminalViewport.vue:235           stoa.getTerminalReplay()
  → TerminalViewport.vue:242           enqueueWrite(replay)   ← CORRUPTED DATA ENTERS XTERM
  → TerminalViewport.vue:70            terminal.write(data)

Live path (ongoing output):
  session-runtime-controller.ts:77     IPC push
  → preload/index.ts:96                onTerminalData listener
  → TerminalViewport.vue:210           queueOrWrite(chunk.data)
  → TerminalViewport.vue:123           enqueueWrite(data)
  → TerminalViewport.vue:70            terminal.write(data)
```

### Risks / Unknowns

- [!] **trimBacklog slice is the confirmed root cause.** Any fix must address line 143 or restructure the storage model.
- [!] **No `wasTrimmed` flag** means even a line-boundary fix needs to know whether the backlog was ever trimmed.
- [!] **Session switch destroys xterm** — a persistent-instance approach would eliminate the need for replay entirely but requires significant refactoring.
- [?] **SerializeAddon.serialize() quality for TUI apps** — it's unclear how well SerializeAddon handles alternate-screen / DEC2026 / cursor-heavy output like Codex. Needs testing.
- [?] **Chunk ring buffer memory characteristics** — the planned chunk ring was never benchmarked. String concat with large PTY output (250K+) may cause GC pressure.
- [?] **250K char limit sufficiency** — Codex sessions can produce very large output. The limit may truncate too aggressively for meaningful history.
