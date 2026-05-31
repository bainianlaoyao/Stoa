---
date: 2026-05-29
topic: unified CLI session control, subagent/session lifecycle commands, and frontend synchronization for multi-session trees
status: completed
mode: context-gathering
sources: 13
---

## Context Report: Unified CLI Session Control Best Practices

### Why This Was Gathered

This report gathers bounded external evidence to support a design recommendation for a unified session-control CLI and synchronized multi-session tree UI in this repository.

### Summary

Across terminal multiplexers and agent session managers, the stable pattern is: one authoritative supervisor/server owns session state, clients address sessions by durable IDs, control-plane actions use a small verb set, and output streaming is kept separate from metadata inspection. For a multi-session tree UI, the strongest directly applicable pattern is event-driven refresh against a canonical store, with stable per-node IDs so expansion/selection survive refreshes.

### Key Findings

#### 1. Make one process authoritative for the whole session graph

- `tmux` documents a single server that manages all sessions, while clients attach to those sessions over a socket rather than owning the session state themselves. This is the clearest analogue for keeping the repository's Electron main process authoritative over session lifecycle and topology.  
  Source: https://man7.org/linux/man-pages/man1/tmux.1.html
- Claude Code agent view uses the same shape: a separate supervisor process keeps background sessions alive, reconnects after restart, and stores per-session state on disk.  
  Source: https://code.claude.com/docs/en/agent-view
- Zellij explicitly documents machine-driven external control of existing sessions from outside the interactive terminal.  
  Source: https://zellij.dev/documentation/programmatic-control.html

**Direct implication for this repo:** the CLI and renderer should both be clients of one authoritative main-process session manager, not separate sources of truth.

#### 2. Separate session-resource lifecycle from message/input lifecycle

- OpenAI's Conversations API splits the resource lifecycle into conversation CRUD (`create`, `retrieve`, `update`, `delete`) and message/item operations (`create items`, `list items`). That is a strong primary-source example of not overloading one command to mean both "make a session" and "send input to a session".  
  Source: https://developers.openai.com/api/reference/resources/conversations
- Claude Agent SDK likewise separates "start a fresh session", "continue the most recent session", and "resume a specific session by ID". When multiple sessions exist, the docs require explicit session IDs for deterministic targeting.  
  Source: https://code.claude.com/docs/en/agent-sdk/sessions

**Recommended CLI shape:** keep `create`, `inspect`, `prompt`, and `destroy` as distinct verbs. Treat `prompt` as "append input to an existing session by ID", not as an overloaded create-or-attach shortcut.

#### 3. Provide machine-readable inspection and keep terminal output on a separate channel

- Zellij's programmatic-control docs split state queries from output streaming: `list-panes --json`, `list-tabs --json`, `dump-screen`, and `subscribe --format json` are different interfaces for different jobs.  
  Source: https://zellij.dev/documentation/programmatic-control.html
- Claude agent view exposes shell-level inspection helpers separately from attachment: `claude agents --json`, `claude logs <id>`, `claude stop <id>`, `claude respawn <id>`, and `claude daemon status`.  
  Source: https://code.claude.com/docs/en/agent-view
- `tmux` control mode sends incremental `%output` notifications and separate change notifications when session/window state changes.  
  Source: https://github.com/tmux/tmux/wiki/Control-Mode
- Electron's official IPC guide distinguishes request/response IPC (`ipcRenderer.invoke` / `ipcMain.handle`) from main-to-renderer push (`webContents.send`).  
  Source: https://www.electronjs.org/docs/latest/tutorial/ipc
- `node-pty` exposes terminal I/O as a streaming surface (`onData`) plus imperative control (`write`, `resize`), which is another strong signal to keep terminal bytes separate from session metadata RPC.  
  Source: https://github.com/microsoft/node-pty

**Direct implication for this repo:** `inspect` should return structured JSON. Terminal text should come from a log/stream channel, not be embedded into the control-plane response shape.

#### 4. Stable IDs are mandatory for multi-session trees

- VS Code's tree API refresh model uses `onDidChangeTreeData` for invalidation and refresh.  
  Source: https://code.visualstudio.com/api/extension-guides/tree-view
- VS Code also documents that `TreeItem.id` preserves selection and expansion state; if IDs are derived from changing labels, UI state becomes unstable.  
  Source: https://code.visualstudio.com/updates/v1_20?from=20423&from_column=20423
- Claude Agent SDK requires explicit `session_id` capture when resuming a specific past session instead of "the most recent one", reinforcing the same rule: durable IDs are the addressing primitive once multiple sessions exist.  
  Source: https://code.claude.com/docs/en/agent-sdk/sessions

**Inference for this repo:** a multi-session tree should model durable node IDs explicitly and should not infer identity from display title, order, or active selection. If hierarchy is needed, `parentSessionId` should be first-class rather than inferred from list position.

#### 5. Keep renderer state derived from a canonical store, not from ad hoc UI mutation

- Electron states plainly that IPC is the bridge between main and renderer because the two processes have different responsibilities.  
  Source: https://www.electronjs.org/docs/latest/tutorial/ipc
- Pinia documents getters as the store-level equivalent of computed values, which matches the pattern of keeping raw session entities in store state and deriving filtered/active/tree-specific UI state from getters/computed selectors.  
  Source: https://pinia.vuejs.org/core-concepts/getters.html
- VS Code's tree-view refresh model is event-driven rather than direct view mutation, again pointing toward "authoritative state + invalidation event + derived UI".  
  Source: https://code.visualstudio.com/api/extension-guides/tree-view

**Direct implication for this repo:** synchronize the renderer by hydrating a canonical session store from main-process snapshots or deltas, then derive active rows, tree groupings, and pending-input badges in store getters/computed state.

#### 6. Distinguish stop, remove, and history retention

- Claude agent view explicitly distinguishes stopping a session, removing it from the visible list, and retaining the underlying transcript for later resume.  
  Source: https://code.claude.com/docs/en/agent-view
- `tmux kill-session` is destructive and destroys the target session.  
  Source: https://man7.org/linux/man-pages/man1/tmux.1.html

**Direct implication for this repo:** if the product keeps only one `destroy` verb, its semantics must be explicit. The primary-source systems do not all equate "stop execution", "remove from UI", and "delete recoverable history".

#### 7. Keep tree depth shallow unless the product truly needs deep nesting

- VS Code's UX guidance for tree views explicitly says to avoid deep nesting unless necessary; a few levels is the recommended balance.  
  Source: https://code.visualstudio.com/api/ux-guidelines/views

**Direct implication for this repo:** unless there is a hard product requirement for deep agent/subagent nesting, prefer a shallow tree such as `workspace -> session -> child session` over arbitrarily deep recursion.

### Principles Directly Applicable to This Repository

1. Use one authoritative main-process session supervisor.
2. Use durable session IDs as the only stable addressing key for CLI, IPC, and renderer state.
3. Keep control-plane commands structured and machine-readable.
4. Keep terminal/log output on a separate stream from `inspect`.
5. Model tree identity explicitly; if hierarchy exists, use explicit parent references.
6. Hydrate one canonical frontend store and derive UI state from getters/computed selectors.
7. Separate `stop` semantics from `remove`/history-deletion semantics, even if the user-facing CLI chooses to collapse them later.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| tmux uses one server to manage all sessions; clients attach to sessions | tmux man page | https://man7.org/linux/man-pages/man1/tmux.1.html |
| tmux exposes lifecycle commands such as `new-session`, `list-sessions`, `send-keys`, `kill-session` | tmux man page | https://man7.org/linux/man-pages/man1/tmux.1.html |
| tmux control mode separates `%output` from state-change notifications | tmux control mode wiki | https://github.com/tmux/tmux/wiki/Control-Mode |
| Zellij supports external control of sessions from the CLI | Zellij CLI docs | https://zellij.dev/documentation/controlling-zellij-through-cli.html |
| Zellij programmatic control separates query, output observation, and reaction loops | Zellij programmatic control | https://zellij.dev/documentation/programmatic-control.html |
| OpenAI Conversations API separates conversation CRUD from item append/list operations | OpenAI API reference | https://developers.openai.com/api/reference/resources/conversations |
| Claude CLI exposes resume-by-ID and multi-session background management commands | Claude CLI docs | https://code.claude.com/docs/en/cli-usage |
| Claude Agent SDK documents `continue`, `resume`, `fork`, and `session_id` capture | Claude Agent SDK sessions | https://code.claude.com/docs/en/agent-sdk/sessions |
| Claude agent view exposes `--json`, `logs`, `stop`, `respawn`, `daemon status`, and persisted per-session state | Claude agent view | https://code.claude.com/docs/en/agent-view |
| Electron recommends IPC as the main/renderer bridge and distinguishes invoke/handle from main-to-renderer send | Electron IPC tutorial | https://www.electronjs.org/docs/latest/tutorial/ipc |
| node-pty exposes streaming output and imperative PTY control separately | node-pty README | https://github.com/microsoft/node-pty |
| VS Code tree refresh uses `onDidChangeTreeData` | VS Code Tree View API | https://code.visualstudio.com/api/extension-guides/tree-view |
| VS Code `TreeItem.id` preserves selection/expansion state; deep nesting should be limited | VS Code updates + UX guidelines | https://code.visualstudio.com/updates/v1_20?from=20423&from_column=20423 ; https://code.visualstudio.com/api/ux-guidelines/views |

### Risks / Unknowns

- **[?] Unknown:** whether this repository needs true hierarchical parent/child session trees or only grouped flat sessions. The external sources justify stable IDs and tree refresh patterns, but they do not determine the product requirement.
- **[?] Unknown:** whether `prompt` in this product should mean high-level agent message append, low-level keystroke injection, or both. Analogous systems diverge here: tmux/Zellij expose keystroke/text injection, while Claude's background-session shell interface emphasizes attach/reply/logs/status more than a standalone shell-level "send prompt" verb.
- **[?] Unknown:** whether `destroy` should map to stop-only or stop-plus-remove-plus-history deletion. Primary sources show those are separable concerns.
- **[!] Constraint from evidence:** once multiple concurrent sessions exist, "resume most recent" is not a sufficient addressing model for deterministic automation. Durable IDs are required.

## Context Handoff: Unified CLI Session Control Best Practices

Start here: `research/2026-05-29-session-cli-best-practices.md`

Context only. Use the saved report as the source of truth.
