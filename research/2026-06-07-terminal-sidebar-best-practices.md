---
date: 2026-06-07
topic: terminal sidebar best practices
status: completed
mode: context-gathering
sources: 18
---

## Context Report: Terminal Right Sidebar Best Practices

### Why This Was Gathered

The terminal page's right sidebar is currently incomplete and error-prone. This report gathers bounded evidence from production IDEs, terminal products, AI coding workbenches, and design systems to guide a production-grade redesign without changing product code.

### Summary

A production-grade right context sidebar should not be a general dumping ground. Mature workbenches treat sidebars/tool windows as contextual, rearrangeable support surfaces for coding tasks, with a small number of grouped views, clear ownership, concise names, badges for feedback, local progress/error states, and escape hatches into logs/history. AI terminal products add one important pattern: keep the terminal clean by default, but make context attachment, active agent/session status, and review/undo/resume controls immediately available when relevant.

### Key Findings

1. The right sidebar is best treated as an auxiliary context surface, not the primary terminal surface. VS Code's Secondary Side Bar defaults to Chat and can receive moved views; JetBrains tool windows support coding without leaving the main workspace.
2. Keep the information architecture small: 3-5 views is the comfortable maximum from VS Code's sidebar guidance. Group related views and avoid adding content that could be a command.
3. The core production views for a terminal/agent sidebar should be: Session/Agent, Context, Problems/Diagnostics, Changes/Review, and Logs/Notifications. These map directly to VS Code/JetBrains/Warp/Cursor/OpenCode patterns.
4. Status and errors should be local before global: show progress in the view/editor when possible, show badges/dots for unseen changes/errors, and keep notifications in a log/timeline that users can revisit.
5. Empty states are not decorative. They should explain what would appear, why it is empty, and the next safe action; for irrelevant project states, hide the view/button instead of showing a dead panel.
6. AI context needs explicit inspectability. Warp, Cursor, and OpenCode all expose file/block/session references; the sidebar should show exactly what context is attached, stale, excluded, or pending.
7. Noise control is a first-class requirement: avoid repeated notifications, promotional panels, excessive toolbar buttons, deep trees, and always-visible controls that are only useful in a specific mode.

### Recommended Right Sidebar Model

#### Primary Purpose

Use the right sidebar for "context around the active terminal/session": current agent/session state, attached context, relevant diagnostics, pending changes, and recoverable event history. Do not make it a second terminal, a marketing surface, or a settings page.

#### Suggested Views

| View | Purpose | Key interactions | State model |
|---|---|---|---|
| Session / Agent | Active session, provider/model, running task, plan/checklist, permissions, resume/stop/take-over | New/resume session, pause/stop, switch mode, copy/share/export, open details | idle, active, waiting approval, failed, completed, disconnected |
| Context | Files, folders, selections, terminal blocks, docs, rules, memory/context index | Add/remove context, inspect source, refresh stale context, reveal file/block, clear all | empty, attached, stale, indexing, excluded, over budget |
| Problems / Diagnostics | Terminal exit failures, test failures, lint/build errors, environment checks | Filter by severity/source, jump to output/file, attach to agent, retry command | no issues, warning, error, resolving, muted |
| Changes / Review | Agent edits, pending diffs, checkpoints, undo/redo/revert | Review file diff, accept/reject, restore checkpoint, open in editor | no changes, pending review, partially accepted, reverted |
| Events / Logs | Notifications, agent/tool history, command history, background runs | Search, filter, copy, open log, clear read items | timeline empty, unread, error, background running |

Keep this to one view container with tabs/segmented navigation. Add badges to the container/view icons for unread/error counts, but do not change icons just because content changed.

### Interaction Patterns

- Provide direct jumps between sidebar items and the terminal/editor: selecting a diagnostic should reveal the block/file; selecting a context item should reveal its origin.
- Use view toolbar actions only for frequent commands and filters. Move secondary commands to an overflow/context menu.
- Provide keyboard-friendly quick actions: focus sidebar, return to terminal/editor, attach previous block, clear context, resume last session.
- Prefer inline/tool-window progress for long operations. Global notifications are a fallback, not the default.
- Persist layout and session state across reloads, but show stale/disconnected indicators when runtime state cannot be trusted.

### Status, Error, Empty, and Loading States

| State | Production behavior |
|---|---|
| Empty context | Explain that no context is attached; offer one primary action such as "Attach active block/file" and one secondary docs link. |
| No diagnostics | Quiet success state; avoid celebratory copy and avoid occupying vertical space once the user understands the view. |
| Agent idle | Show last session/resume affordance and current workspace/provider readiness. |
| Agent running | Show step/progress, current tool/command, cancel/stop, and link to logs. |
| Waiting approval | Use a clear inline decision row with allow/deny/always options if supported. |
| Command failed | Show exit code, command, compact output summary, "attach to agent", "copy", "open full output", and retry if safe. |
| Context stale/indexing | Show sync/indexing status locally; keep agent features available if possible but label degraded context. |
| Disconnected provider/runtime | Show actionable recovery: reconnect/retry/check config/open logs. |

### Noise Control Rules

- Sidebar view count: target 3-5, matching VS Code's guidance for most screen sizes.
- Toolbar buttons: only frequent actions and active filters; overflow the rest.
- Badges: use counts/dots for new updates/errors; do not mutate icons to signal state.
- Notifications: one at a time, no repeated notifications, "do not show again" where appropriate, and always log recoverable events.
- Trees: shallow, labeled, and filterable; avoid using tree rows as command buttons.
- AI context: show summaries and sources, not giant pasted logs; expand on demand.
- Hide irrelevant project-specific views by default instead of showing inert panels.

### Evidence Chain

| Finding | Source | Evidence |
|---|---|---|
| VS Code's Secondary Side Bar is an auxiliary, movable view surface and defaults to Chat. | https://code.visualstudio.com/docs/editing/userinterface | Secondary Side Bar is opposite the Primary Side Bar, contains Chat by default, and accepts dragged views. |
| VS Code separates editor, sidebars, status bar, activity bar, and panel responsibilities. | https://code.visualstudio.com/docs/editing/userinterface | Basic layout names sidebars for project assistance, status bar for project/file info, panel for output/debug/problems/terminal. |
| VS Code sidebars should group related content and avoid excessive views or command-only content. | https://code.visualstudio.com/api/ux-guidelines/sidebars | Guidance says group related views, use descriptive names, avoid excessive view containers/views, avoid simple-command sidebar content, and 3-5 views is a comfortable max. |
| VS Code views should be minimal, iconized, native where possible, and movable. | https://code.visualstudio.com/api/ux-guidelines/views | Views can be tree/welcome/webview views, can move between containers, should minimize count/name length, and should limit custom webviews. |
| VS Code empty views should guide users with limited, clear actions. | https://code.visualstudio.com/api/ux-guidelines/views | Welcome views are for empty views; use them only when necessary, limit content/buttons, prefer links, and avoid promotions. |
| VS Code warns against noisy toolbars. | https://code.visualstudio.com/api/ux-guidelines/views | View Actions guidance says not to add too many actions to avoid noise/confusion. |
| VS Code notification guidance prioritizes user attention and local progress. | https://code.visualstudio.com/api/ux-guidelines/notifications | Notifications should be limited, one at a time, non-repeated; progress is best kept in a view/editor, with global progress as a last resort. |
| JetBrains tool windows are support surfaces for coding work. | https://plugins.jetbrains.com/docs/intellij/tool-window.html | Tool windows provide information/tools/services that support coding: project management, run/debug, git changes, external systems. |
| JetBrains recommends short names, icons, badges, tabs, and frequent-action toolbars. | https://plugins.jetbrains.com/docs/intellij/tool-window.html | Tool window structure includes short descriptive names, monochrome icons, badges for content changes/errors, tabs for similar instances, and toolbars for frequent actions/filters. |
| JetBrains hides irrelevant tool windows and shows empty states only for relevant no-content views. | https://plugins.jetbrains.com/docs/intellij/tool-window.html | Visibility guidance says show default button only for broadly useful windows, hide irrelevant project configuration windows, and show empty state when a tool window has no content. |
| JetBrains uses badges/dots and a persistent Notifications tool window to reduce interruption. | https://www.jetbrains.com/help/idea/notifications.html | Notifications can be disabled/configured by group; notification tool window persists messages, with blue/red indicators for regular/error events. |
| JetBrains tool window layout should reserve stable size for filled state, not shrink to empty state. | https://plugins.jetbrains.com/docs/intellij/window-sizes.html | Vertical tool windows default to 20% app width with 200x500 minimum; empty component sizes should be defined by filled state. |
| Warp separates terminal mode from agent conversation mode to keep terminal clean. | https://docs.warp.dev/agent-platform/local-agents/interacting-with-agents/terminal-and-agent-modes/ | Terminal mode is clean/minimal; Agent Mode surfaces model selection, voice, image attachments, and conversation management. |
| Warp keeps terminal and agent context scoped to avoid clutter. | https://docs.warp.dev/agent-platform/local-agents/interacting-with-agents/terminal-and-agent-modes/ | Agent conversation blocks stay scoped to that conversation while terminal blocks remain in the terminal block list, keeping terminal view clean while preserving context. |
| Warp exposes explicit context attachment and context chips. | https://docs.warp.dev/terminal/universal-input | Toolbelt supports context, slash commands, voice, attachments, profiles, model selection; @ can attach files, folders, symbols, Warp Drive objects, or blocks. |
| Warp makes terminal output attachable for error fixing. | https://docs.warp.dev/agent-platform/local-agents/agent-context/blocks-as-context/ | Blocks can be attached as context; common use case is attaching an error and asking Agent Mode to fix it. |
| Warp surfaces codebase indexing status and degraded availability. | https://docs.warp.dev/agent-platform/capabilities/codebase-context | Codebase context indexes on triggers, can be managed in settings, and agents do not use it until indexing completes while agentic features remain available. |
| Cursor's Agent is sidepane-based and combines modes, tools, diffs, tabs, checkpoints, terminal integration, history, export, and rules. | https://docs.cursor.com/chat/overview | Official docs describe Agent access from sidepane with Ctrl+I and features including modes, tools, apply changes, review diffs, chat tabs, checkpoints, terminal integration, history, export, and rules. |
| Cursor context references include files/folders/code/docs/git/past chats/rules/web/lint errors/definitions. | https://docs.cursor.com/context/%40-symbols/overview | Official docs list @ symbols for files, folders, code, docs, git, past chats, rules, web, recent changes, lint errors, and definitions. |
| Cursor background agents use a sidebar for searching, viewing status, starting agents, sending follow-ups, and taking over. | https://docs.cursor.com/background-agent | Official docs describe a Background Agent Sidebar to view all agents, search existing agents, start new ones, view status, send follow-ups, or take over. |
| OpenCode TUI uses @ file references, ! shell commands, slash commands, session switching, export/share, undo/redo, and thinking/detail toggles. | https://opencode.ai/docs/tui/ | TUI docs describe @ file references, ! shell output as tool result, slash commands, /sessions, /export, /share, /undo, /redo, /thinking, and /details. |
| OpenCode IDE extension auto-shares current editor selection/tab and inserts line-specific references. | https://opencode.ai/docs/ide/ | IDE docs describe split terminal launch, new session, context awareness, and file reference shortcuts such as @File#L37-42. |
| Atlassian empty states should tell users what to do next and can live inside panels/containers. | https://atlassian.design/components/empty-state | Empty state component describes no-data state and what users can do next. |
| Atlassian message guidance distinguishes local section/inline messages from global banners/flags/modals. | https://design-system-docs-proxy.services.atlassian.com/foundations/content/designing-messages/ | Section messages alert within a screen area; inline messages signal required action/info; banners are for critical system-level messaging. |

### Risks / Unknowns

- [!] Cursor docs are currently rendered through a dynamic docs shell and may not expose stable line-level text to static crawlers. Treat the official URLs as citation anchors, not line-citable artifacts.
- [!] Warp's UI model is terminal-first, not right-sidebar-first. Its evidence is most useful for terminal/agent context behavior, not literal sidebar placement.
- [?] The best concrete sidebar layout for Stoa still depends on the existing terminal page architecture, current right sidebar defects, and available runtime/session state.
- [?] If the product must support narrow windows, some views may need to collapse into a single drawer or bottom panel rather than remain as a persistent right rail.

## Context Handoff: Terminal Sidebar Best Practices

Start here: `research/2026-06-07-terminal-sidebar-best-practices.md`

Context only. Use the saved report as the source of truth.
