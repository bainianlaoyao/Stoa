---
date: 2026-04-25
topic: session ID refresh frequency and session switching handling
status: completed
mode: context-gathering
sources: 14
---

## Context Report: Session ID Refresh & Session Switching

### Why This Was Gathered
Need to understand whether the `externalSessionId` held by session entries refreshes during use, and how the system handles users switching sessions mid-use (e.g., running `/new`, `.resume`, or `/clear` inside a CLI provider).

### Summary
**Session IDs are NOT refreshed or rotated during a session's lifetime.** Once `externalSessionId` is set (either seeded at creation for claude-code, or discovered async for opencode/codex), it is treated as immutable. There is **no mechanism to detect that a provider's internal conversation has changed** — if a user switches conversations inside the CLI, the stored ID becomes stale and the next app restart will resume the wrong conversation.

---

## Key Findings

### F1. Session ID is write-once, never refreshed

The `externalSessionId` is set at most once:

- **claude-code**: seeded as `randomUUID()` in `createSession()` (`project-session-manager.ts:107-115`), passed via `--session-id`
- **opencode**: discovered via sidecar plugin webhook event, first event overwrites `null`
- **codex**: discovered via filesystem polling of `~/.codex/sessions/*.jsonl`, overwrites `null`

After initial set, no code path checks whether the stored ID still matches the provider's current conversation.

### F2. No staleness or change detection

- `applySessionEvent()` (`project-session-manager.ts:302-318`) can overwrite `externalSessionId` if a webhook event carries one, but this only fires at initial discovery — there's no diff check against the existing value.
- All `resolveSessionId()` implementations return `null` or the Stoa internal ID — none extract the provider's **current** session ID from event payloads for comparison.
- Zero `setInterval`/`setTimeout`/polling for session validity anywhere in the codebase.

### F3. Session switching is purely Stoa-level (not provider-level)

The system supports switching between **Stoa sessions** (clicking different rows in WorkspaceHierarchyPanel), but **not** detecting switches that happen **inside** a provider CLI:

**What works — Stoa session switch:**
1. User clicks session row → `emit('selectSession')` → `App.vue` → `workspaceStore.setActiveSession()` + IPC to main
2. `TerminalViewport.vue` `watch()` fires on `session.id` change → `disposeTerminal()` kills old xterm → `scheduleTerminalSetup()` creates fresh terminal
3. Observability recalculates `hasUnreadTurn` based on new `activeSessionId`
4. Push-driven: no polling, all via IPC + Vue reactivity

**What doesn't work — provider-internal switch:**
- User runs `/new`, `.resume`, or `/clear` inside Claude Code CLI
- Provider creates new internal conversation ID
- Stoa still holds old `externalSessionId`
- On next app restart, `--resume <old-id>` resumes wrong conversation

### F4. Confidence model already flags this

`observability-projection.ts:225`:
```ts
function confidenceForSession(session: SessionSummary): ObservabilityConfidence {
  return session.externalSessionId ? 'authoritative' : 'stale'
}
```
Sessions with `externalSessionId` are treated as `authoritative`, but this only checks presence — not correctness.

---

## Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| External ID seeded at creation for claude-code | `project-session-manager.ts` | `:107-115` |
| External ID discovered async for codex | `session-runtime.ts` | `:119-130` |
| `applySessionEvent` overwrites without diff check | `project-session-manager.ts` | `:302-318` |
| All `resolveSessionId()` return null or internal ID | providers/*.ts | claude-code `:91-93`, codex `:214-216` |
| No polling or periodic validity checks | grep for setInterval/setTimeout | 0 matches in session code |
| TerminalViewport watch-based swap | `TerminalViewport.vue` | `:220-228` |
| Stoa session switch via store + IPC | `workspaces.ts`, `App.vue` | `:219-227`, `:31-33` |
| Confidence = authoritative if externalId present | `observability-projection.ts` | `:225` |
| Known risk documented | `research/2026-04-24-provider-external-session-id-lifecycle.md` | `:190-198` |

---

## Risks / Unknowns

- [!] **Stale externalSessionId on restart**: If a user runs `/new` or `.resume` inside the CLI, the stored ID points to the wrong conversation. On restart, `--resume <stale-id>` resumes the old one — silent data corruption.
- [!] **No runtime staleness detection**: Nothing in the event pipeline extracts the provider's current session ID from hook/webhook payloads to compare against the stored one.
- [?] **Claude Code hooks payload**: It's unknown whether Claude Code's hook events (e.g., `session_start`, `notification`) include the current session ID in a way that could be used for change detection. If they do, `resolveSessionId()` could be enhanced to return it.
- [?] **Codex file polling**: The codex provider already polls session files — this could potentially be extended to detect when the active session file changes, but this is not currently implemented.
