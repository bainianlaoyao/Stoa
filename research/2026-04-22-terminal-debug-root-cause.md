---
date: 2026-04-22
topic: terminal session switching and opencode black screen root cause
status: completed
mode: context-gathering
sources: 11
---

## Context Report: Terminal Session Switching And OpenCode Black Screen

### Why This Was Gathered
Support a no-experiment root-cause investigation for why clicking a session does not produce a real terminal switch and why OpenCode sessions can still appear black.

### Summary
The primary root cause is in the renderer, not in the session selection store path. The session click path is intact, but `TerminalViewport` now mixes async replay, global mutable terminal references, and uncancelled side effects; this allows stale replay from an old session to write into the newly mounted terminal and makes the switch appear fake or black.

There are also two deeper architectural defects in the OpenCode integration. First, the app persists a fake `shell-*` UUID as `externalSessionId`, then later uses it as the OpenCode `--session` resume id. Second, the sidecar/webhook status pipeline is only half-implemented: the provider writes a plugin that posts lifecycle events, but the main app never starts a webhook server and never supplies a real session secret.

### Key Findings
- The session click path itself is not the broken link. The renderer session button emits `selectSession`, `App.vue` immediately updates the Pinia store locally, and the main process `session:set-active` handler only persists selection state; there is no backend "terminal attach" primitive to perform a real switch.
- `TerminalViewport` has a stale-async bug. It stores the current xterm instance in a module-level mutable `terminal` variable, then calls `window.stoa.getTerminalReplay(sessionId)` asynchronously. If session A is disposed and session B mounts before A's replay Promise resolves, A's replay callback can write into B's terminal because the callback only checks `if (!terminal)` instead of verifying mount identity.
- The same component has a second sequencing problem: it relies on xterm `write()` as if it were immediate, but xterm's official API says `write()` is processed asynchronously and provides a callback when parsing completes. The component never waits for that callback, so replay/live ordering is not protected by parser completion.
- The OpenCode resume path is fundamentally incorrect. `PtyHost.start()` fabricates a local `shell-${uuid}` id for every process, and `startSessionRuntime()` stores that fabricated id as `externalSessionId` for new OpenCode sessions. But the provider later passes `externalSessionId` to `opencode --session`, and OpenCode's CLI docs define `--session` as the session ID to continue, not an arbitrary local PTY id.
- The structured event architecture is incomplete. The provider writes a `.opencode/plugins/stoa-status.ts` plugin that posts to `http://127.0.0.1:${webhookPort}/events` and maps `session.idle` to `awaiting_input`, and OpenCode docs confirm project plugins are auto-loaded and `session.idle` is a real event. But the desktop app never creates or starts `createLocalWebhookServer()` in `src/main/index.ts`, and it constructs runtimes with `webhookPort: null` in state bootstrap and with no `sessionSecret` at all. That means the sidecar status path cannot work in the real app.
- A latent UI contract bug remains even after the webhook path is fixed: `TerminalViewport` only renders xterm when `session.status === 'running'`. The provider sidecar explicitly maps OpenCode `session.idle` to `awaiting_input`, so once the webhook path is working, idle-but-still-open OpenCode terminals will be unmounted by the renderer.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Session button emits selection event | WorkspaceHierarchyPanel | `src/renderer/components/command/WorkspaceHierarchyPanel.vue:199` |
| App immediately updates local store on session click | App | `src/renderer/app/App.vue:24-26` |
| Main process only persists active session selection | Main index | `src/main/index.ts:113-114` |
| PTY write/resize are keyed by session id, not global active state | PtyHost | `src/core/pty-host.ts:33-42` |
| Replay request is async and mount identity is not tracked | TerminalViewport | `src/renderer/components/TerminalViewport.vue:51-55,131-149` |
| Watcher rebuilds terminal on session id changes, but no async cleanup token is used | TerminalViewport | `src/renderer/components/TerminalViewport.vue:153-160` |
| Vue documents cleanup for invalidated watcher side effects via `onWatcherCleanup()` | Vue docs | `https://vuejs.org/guide/essentials/watchers` |
| Electron documents `ipcRenderer.invoke()` as async Promise-based IPC handled by `ipcMain.handle()` | Electron docs | `https://www.electronjs.org/docs/api/ipc-renderer/` |
| xterm documents `write()` as asynchronous and recommends callback to know when parsing completed | xterm docs | `https://xtermjs.org/docs/api/terminal/classes/terminal/` |
| New OpenCode sessions persist fabricated `shell-*` id | PtyHost + session runtime | `src/core/pty-host.ts:14,30` and `src/core/session-runtime.ts:89-90` |
| OpenCode CLI defines `--session/-s` as the session ID to continue | OpenCode CLI docs | `https://opencode.ai/docs/zh-cn/cli/` |
| Provider resume path passes persisted `externalSessionId` into `--session` | OpenCode provider | `src/extensions/providers/opencode-provider.ts:55` |
| Provider writes sidecar plugin posting to `/events` and maps `session.idle` to `awaiting_input` | OpenCode provider | `src/extensions/providers/opencode-provider.ts:37` |
| OpenCode loads project plugins from `.opencode/plugins/` at startup | OpenCode plugin docs | `https://opencode.ai/docs/plugins/` |
| OpenCode exposes `session.idle` as a plugin event | OpenCode plugin docs | `https://opencode.ai/docs/plugins/` |
| Main app never starts webhook server in real runtime | Repo search + main index | `src/main/index.ts` and `src/core/webhook-server.ts` |
| Runtime context defaults `sessionSecret` to empty string | Session runtime | `src/core/session-runtime.ts:51-55` |
| Main runtime launch passes no `sessionSecret` | Main index | `src/main/index.ts:89-95,193-199` |
| Terminal only mounts when status is exactly `running` | TerminalViewport | `src/renderer/components/TerminalViewport.vue:14,177-183` |

### Risks / Unknowns
- [!] This report is intentionally static-only. It identifies code-path root causes without running a live Electron session in this pass.
- [!] There may still be an additional UI-layer click interception issue, but the current static code strongly suggests the more visible symptom is stale terminal rendering rather than a broken selection event chain.
- [!] The exact runtime semantics of `--pure` are not fully documented in the currently discoverable OpenCode CLI docs, so this report does not treat `--pure` itself as the core root cause.

## Context Handoff: Terminal Session Switching And OpenCode Black Screen

Start here: `D:\Data\DEV\ultra_simple_panel\research\2026-04-22-terminal-debug-root-cause.md`

Context only. Use the saved report as the source of truth.
