---
date: 2026-05-05
topic: codex-opencode-terminal-compat-root-cause
status: completed
mode: context-gathering
sources: 24
---

## Context Report: Codex / OpenCode Terminal Compatibility Root Cause

### Why This Was Gathered
Investigate why this project breaks Codex and OpenCode terminal behavior relative to VS Code, despite using the same broad terminal stack.

### Summary
The primary root cause is not `xterm.js`, `node-pty`, or ConPTY themselves. It is this app's terminal lifecycle model.

The app treats live AI TUI sessions as disposable renderer terminals that can be rebuilt from a capped raw-byte replay buffer. That is fundamentally incompatible with full-screen TUIs like Codex and OpenCode, which rely on terminal state that is not faithfully recoverable from a truncated text replay: alternate-screen state, scrollback erasure, mouse-reporting modes, and early-session negotiation sequences.

This explains the observed asymmetry:

- **Freshly created sessions work** because the xterm instance sees the PTY stream from byte 0.
- **Old / resumed / switched-back sessions degrade** because a new xterm instance is reconstructed from partial replay plus live chunks, often missing the state-setting sequences that made the TUI interactive in the first place.

Two secondary amplifiers make the problem worse:

1. recovery launches do **not** wait for first renderer dimensions the way fresh session creation does
2. replay/history is intentionally lossy: `1000` xterm scrollback lines and `250_000` chars of main-process backlog

### Key Findings

#### 1. The app uses a lossy replay model instead of persistent terminal state

- Main-process terminal history is not a terminal-state snapshot. It is a capped raw string backlog keyed by session id, trimmed to `250_000` chars and cleared on every `markRuntimeStarting(...)`. `src/main/session-runtime-controller.ts:39-41`, `src/main/session-runtime-controller.ts:76-77`, `src/main/session-runtime-controller.ts:114-115`, `src/main/session-runtime-controller.ts:169`, `src/main/session-runtime-controller.ts:183-192`
- The renderer does not attach to a persistent terminal model. It creates a fresh xterm instance, asks main for `getTerminalReplay(sessionId)`, writes that text back into xterm, then appends live IPC chunks. `src/renderer/components/TerminalViewport.vue:70-71`, `src/renderer/components/TerminalViewport.vue:180-187`, `src/renderer/components/TerminalViewport.vue:237`, `src/renderer/components/TerminalViewport.vue:260-271`
- `SerializeAddon` is loaded, but it is not used to restore terminal state. `src/renderer/terminal/xterm-runtime.ts:216-233`

This architecture is acceptable for plain shell output, but not for stateful full-screen TUIs.

#### 2. Full-screen TUIs depend on terminal state that raw replay does not preserve reliably

- xterm.js has distinct **normal** and **alternate** buffers. Upstream docs describe alternate-buffer activation via DECSET `?47`, `?1047`, and `?1049`, and document `CSI 3 J` as scrollback erasure. If a rebuilt host misses those earlier control sequences, the reconstructed terminal is not equivalent to the original session. Sources:
  - https://xtermjs.org/docs/api/terminal/interfaces/ibuffernamespace/
  - https://xtermjs.org/docs/api/vtfeatures/
- xterm upstream has long treated alt-screen scrollback as tricky / expected terminal behavior rather than a bug to "patch around". Source:
  - https://github.com/xtermjs/xterm.js/issues/802
- xterm maintainers explicitly recommended keeping the xterm instance persistent with the PTY lifecycle rather than reconstructing from replay when Codex-like tools lose scrollback in TUI flows. Source:
  - https://github.com/xtermjs/xterm.js/issues/5745

This matches the local architecture mismatch exactly.

#### 3. This directly explains the OpenCode interaction regression

- OpenCode's own TUI docs expose `mouse: true|false` and state that `mouse: false` preserves the terminal's native selection and scrolling behavior. Source:
  - https://opencode.ai/docs/tui/
- In other words, when TUI mouse mode is active, the TUI owns click / scroll semantics. If a rebuilt xterm instance misses the mouse-enable sequences from earlier in the session, the TUI stops receiving those events and browser/xterm-native selection takes over instead.
- That matches the observed symptom pattern:
  - cannot click
  - cannot scroll
  - selection no longer respects the TUI boundary and can spill into the right side UI

This is a much stronger fit than CSS or overlay interference.

#### 4. This also explains the Codex history truncation

- Local xterm scrollback defaults to `1000` lines. `src/shared/terminal-settings.ts:51`, `src/renderer/terminal/xterm-runtime.ts:194`
- Main-process replay is additionally capped to `250_000` chars. `src/main/session-runtime-controller.ts:169`, `src/main/session-runtime-controller.ts:183-192`
- Codex upstream has an open issue showing that even "no alternate screen" mode can still lose scrollback in xterm.js / VS Code hosts because screen-clearing and repaint behavior remain. Sources:
  - https://github.com/openai/codex/issues/14277
  - https://github.com/openai/codex/issues/10331

So Codex "history got truncated" is not one bug. It is the combined effect of:

- upstream TUI redraw / clear behavior
- small local replay and scrollback caps
- non-persistent terminal reconstruction

#### 5. Fresh create vs later recovery is a real local code-path split

- Fresh session creation waits for renderer dimensions before PTY spawn. `src/main/index.ts:733-744`
- Bootstrap recovery and session restore do **not** request `awaitDimensions`. They launch immediately and rely on later `fit()` / resize propagation. `src/main/index.ts:909-918`, `src/main/index.ts:963-964`
- The PTY starts with fallback dimensions when no initial dimensions are provided. `src/core/pty-host.ts:47-53`

This is the clearest local explanation for the "first created session works, recovered / revisited session often doesn't" asymmetry.

It is also consistent with xterm's own `windowsPty` documentation, which warns that bad resize timing on Windows/ConPTY can cause missing or replaced rows. Source:

- https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/

#### 6. Provider sessions are also launched under a non-VS-Code host identity

- The PTY env always sets `TERM_PROGRAM=Stoa` and `TERM_PROGRAM_VERSION=0.1.1`. `src/core/pty-host.ts:29-32`
- Both OpenCode and Codex are flagged `prefersShellWrap: true`, so they are launched through a shell wrapper rather than directly. `src/shared/provider-descriptors.ts:27-47`, `src/core/session-runtime.ts:95-101`, `src/core/shell-command.ts:45-88`
- VS Code, by contrast, layers persistent-session / reconnection behavior and shell-integration services around the same core stack. Source:
  - https://code.visualstudio.com/docs/terminal/advanced
  - https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/terminalEnvironment.ts

This is likely a secondary behavior difference, not the primary root cause, but it means "same stack" is only directionally true.

#### 7. Codex recovery has an additional correctness risk

- Codex resume falls back to `codex resume --last` when no external session id is available. `src/extensions/providers/codex-provider.ts:253-257`
- Codex external session ids are discovered only after start by scanning `~/.codex/sessions/**/*.jsonl` for a matching cwd/time window. `src/extensions/providers/codex-provider.ts:12-17`, `src/extensions/providers/codex-provider.ts:136-177`, `src/extensions/providers/codex-provider.ts:244-270`

If discovery misses, a later resume can bind to the wrong Codex session. That is not the main TUI breakage, but it is a separate recovery integrity bug.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| PTY env uses `TERM_PROGRAM=Stoa` | local source | `src/core/pty-host.ts:29-32` |
| PTY starts with fallback cols/rows when dimensions are missing | local source | `src/core/pty-host.ts:47-53` |
| OpenCode/Codex prefer shell wrapping | local source | `src/shared/provider-descriptors.ts:27-47` |
| Shell wrapping uses PowerShell/cmd/posix shell wrapper commands | local source | `src/core/shell-command.ts:45-88` |
| Runtime chooses wrapped provider command | local source | `src/core/session-runtime.ts:95-101` |
| Fresh session create waits for renderer dimensions | local source | `src/main/index.ts:733-744` |
| Restore path does not wait for dimensions | local source | `src/main/index.ts:909-918` |
| Bootstrap recovery does not wait for dimensions | local source | `src/main/index.ts:963-964` |
| Replay buffer cleared on runtime start | local source | `src/main/session-runtime-controller.ts:39-41` |
| Replay buffer trimmed to `250_000` chars | local source | `src/main/session-runtime-controller.ts:76-77`, `src/main/session-runtime-controller.ts:169`, `src/main/session-runtime-controller.ts:183-192` |
| Renderer rebuilds xterm from replay + live chunks | local source | `src/renderer/components/TerminalViewport.vue:180-187`, `src/renderer/components/TerminalViewport.vue:237`, `src/renderer/components/TerminalViewport.vue:260-271` |
| Terminal rebuilds on session id or terminal settings change | local source | `src/renderer/components/TerminalViewport.vue:284-287` |
| xterm scrollback default is `1000` | local source | `src/shared/terminal-settings.ts:51`, `src/renderer/terminal/xterm-runtime.ts:194` |
| xterm enables `scrollOnEraseInDisplay` but this does not solve alt-screen/mouse-state recovery | local source | `src/renderer/terminal/xterm-runtime.ts:196` |
| xterm runtime sets right-click and alt-click behaviors globally | local source | `src/renderer/terminal/xterm-runtime.ts:204-205` |
| xterm has normal and alternate buffers | xterm docs | https://xtermjs.org/docs/api/terminal/interfaces/ibuffernamespace/ |
| xterm supports `47/1047/1049` and `CSI 3J` | xterm docs | https://xtermjs.org/docs/api/vtfeatures/ |
| xterm alt-screen scrollback is longstanding tricky behavior | xterm issue | https://github.com/xtermjs/xterm.js/issues/802 |
| xterm maintainers recommend persistent terminal lifecycle for Codex-like TUI scrollback loss | xterm issue | https://github.com/xtermjs/xterm.js/issues/5745 |
| xterm recommends headless + serialize for stateful restore / reconnect scenarios | xterm README | https://github.com/xtermjs/xterm.js |
| VS Code uses persistent session reconnection / revive | VS Code docs | https://code.visualstudio.com/docs/terminal/advanced |
| VS Code shell environment layer exists beyond raw xterm+pty | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/terminalEnvironment.ts |
| Codex inline mode / alternate screen config exists | Codex source | https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json |
| Codex still loses scrollback in xterm/VS Code even without alt-screen | Codex issue | https://github.com/openai/codex/issues/14277 |
| Codex can repaint full-screen in main buffer too | Codex issue | https://github.com/openai/codex/issues/10331 |
| Codex mouse / selection tradeoff is documented upstream | Codex issue | https://github.com/openai/codex/issues/1247 |
| OpenCode mouse setting preserves native selection/scroll when disabled | OpenCode docs | https://opencode.ai/docs/tui/ |
| OpenCode upstream has TUI scrollback / mouse related issues | OpenCode issues | https://github.com/anomalyco/opencode/issues/3020 and https://github.com/anomalyco/opencode/issues/220 |

### Recommended Solution

#### Primary Fix

Stop treating Codex / OpenCode live sessions as "destroyable terminals that can be rebuilt from recent text".

Use one of these models instead:

1. **Persistent renderer xterm per live session**
   Keep one xterm runtime instance alive for each live AI session and hide/show it when the active session changes.
   Do not dispose and reconstruct it on revisit.

2. **Persistent terminal-state snapshots, not raw byte replay**
   If renderer persistence is too expensive, maintain a canonical terminal state via headless xterm / serialize-based snapshots and restore from that state, not from a trimmed byte backlog.

3. **Only use raw replay as a degraded fallback for plain shell sessions**
   It is acceptable for shells, but not authoritative enough for full-screen AI TUIs.

#### Secondary Fixes

1. Make `session-restore` and `bootstrap-recovery` wait for initial renderer dimensions, exactly like `session-create`.
2. Treat missing Codex external session id as a recovery failure, not `resume --last`.
3. Raise replay limits only as a mitigation, not as the fix.
4. Revisit `TERM_PROGRAM` / shell-wrap behavior only after the lifecycle issue is corrected.

#### Optional Product Knobs

These are tradeoffs, not the main fix:

1. Offer Codex inline / `alternate_screen = never` mode for users who prioritize scrollback over full TUI fidelity.
2. Offer OpenCode `mouse = false` for users who prioritize native terminal selection / scrolling over in-TUI mouse interaction.

### What Not To Do

- Do not try to "fix" this by filtering out all `1049` / `3J` / mouse-mode control sequences in xterm.
- Do not rely on `scrollOnEraseInDisplay` as the main remedy.
- Do not assume "same stack as VS Code" means "same lifecycle semantics as VS Code".

Those are the wrong abstraction layer for this problem.

### Risks / Unknowns

- Some Codex / OpenCode UX tradeoffs are upstream TUI behavior, not fully host-fixable behavior.
- Persisting one renderer xterm per live AI session changes memory usage and requires a deliberate inactive-session policy.
- If cross-window / app-relaunch restore is a hard requirement, headless terminal-state persistence may be preferable to renderer-only persistence.

## Context Handoff: Codex / OpenCode terminal compatibility root cause

Start here: `research/2026-05-05-codex-opencode-terminal-compat-root-cause.md`

Context only. Use the saved report as the source of truth.
