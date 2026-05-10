# Hook Sidecar Port Staleness & Multi-STOA Conflict

> Date: 2026-05-09
> Scope: Claude Code HTTP hooks, Codex command hooks, STOA webhook server lifecycle

## Problem Statement

1. Codex hooks silently fail — no session state flows back to STOA
2. Starting Claude Code from a terminal inside a STOA-managed workspace produces mass hook errors
3. Unclear whether the current hook architecture can survive multiple STOA instances targeting the same workspace

## Architecture Overview

### Webhook Server

`src/core/webhook-server.ts` — `createLocalWebhookServer({ port: 0 })`

- Binds to `127.0.0.1` on an **OS-assigned random port** (`port: 0`)
- Exposes endpoints: `/hooks/claude-code`, `/hooks/codex`, `/hooks/opencode`
- Port changes every time STOA (the Electron app) restarts

### Hook Installation

`src/main/managed-sidecar-maintenance.ts` — `syncManagedSidecars()`

- Called once during STOA startup, after the webhook server binds
- Iterates all registered projects and providers
- Calls `provider.installSidecar()` for each, which writes hook config files to disk

### Claude Code Hooks

`src/extensions/providers/claude-hook-sidecar.ts` — `installClaudeHooks()`

- Writes `.claude/settings.json` with `type: "http"` hooks
- URL is **baked in at write time**: `http://127.0.0.1:${webhookPort}/hooks/claude-code`
- Headers use `${STOA_SESSION_ID}`, `${STOA_PROJECT_ID}`, `${STOA_SESSION_SECRET}` (env var substitution via Claude Code's `allowedEnvVars`)

### Codex Hooks

`src/extensions/providers/codex-provider.ts` — `writeSharedHookSidecar()`

- Writes `.codex/hooks.json` with `type: "command"` hooks
- Command: `node .codex/hook-stoa.mjs <EventName>`
- Sidecar script reads `STOA_WEBHOOK_PORT` from env at runtime
- Posts to `http://127.0.0.1:${webhookPort}/hooks/codex`

### Provider Environment

All providers inject env vars when launching agent processes:

- `STOA_SESSION_ID`, `STOA_PROJECT_ID`, `STOA_SESSION_SECRET` — identity/auth
- `STOA_WEBHOOK_PORT` — the current webhook server port
- `STOA_PROVIDER_PORT` — provider-specific port
- `STOA_CTL_BASE_URL` — for stoa-ctl (`http://127.0.0.1:${webhookPort}`)

## Root Causes

### RC-1: Hardcoded Port in Claude Code HTTP Hooks

`.claude/settings.json` contains the port as a literal in the URL string:

```json
{ "type": "http", "url": "http://127.0.0.1:58985/hooks/claude-code" }
```

This port is captured at `installClaudeHooks()` write time. Claude Code's `type: "http"` hook mechanism has no way to dynamically resolve the port — the URL is fixed after loading.

Consequences:
- STOA restarts → new random port → URL in settings.json is stale → connection refused
- `syncManagedSidecars()` rewrites the file on next STOA startup, but does not help if Claude Code is already running

### RC-2: Missing Env Vars on Manual CLI Launch

When Claude Code or Codex is started from a terminal (not launched by STOA's provider), the STOA env vars are absent.

**Claude Code:**
- Hook fires, reaches the URL (if port happens to match)
- Headers `${STOA_SESSION_ID}` etc. resolve to empty strings
- Webhook server rejects with 401 (`invalid_secret`)
- Visible as hook errors in the terminal

**Codex:**
- `hook-stoa.mjs` checks env vars at the top:
  ```javascript
  if (!sessionId || !projectId || !sessionSecret || !webhookPort || !hookEventName) {
    process.exit(0)  // silent no-op
  }
  ```
- Exits silently — no error, no output, hooks appear "broken" with zero diagnostics

### RC-3: Single-File Sidecar Cannot Serve Multiple STOA Instances

Both `.claude/settings.json` and `.codex/hooks.json` are per-workspace files. Only one webhook URL can be stored at a time.

If two STOA instances manage the same workspace:
- Last `syncManagedSidecars()` call overwrites the file → earlier instance's hooks point to the wrong port
- There is no multiplexing or routing layer between the file and the agents
- Claude Code http hooks are especially affected (fixed URL); Codex command hooks at least read the port from env at runtime, but only when launched by STOA

### RC-4: Port Changes on Every STOA Restart

`createLocalWebhookServer({ port: 0 })` → OS assigns a new random port each time.

Design relies on `syncManagedSidecars()` rewriting sidecar files on startup, but this breaks in:
- STOA not running (stale URL, connection refused)
- Agent already started before STOA restarted (loaded config in memory, won't re-read)
- Manual terminal launches (no STOA env vars at all)

## Key Files

| File | Role |
|------|------|
| `src/core/webhook-server.ts` | Local HTTP server with hook endpoints, random port binding |
| `src/extensions/providers/claude-hook-sidecar.ts` | Writes `.claude/settings.json` with hardcoded-port HTTP hooks |
| `src/extensions/providers/codex-provider.ts` | Writes `.codex/hooks.json` + `.codex/hook-stoa.mjs` sidecar |
| `src/main/managed-sidecar-maintenance.ts` | `syncManagedSidecars()` — rewrites all sidecars on startup |
| `src/extensions/providers/managed-sidecar-installer.ts` | Generic sidecar file writer with manifest tracking |
| `src/extensions/providers/hermes-agent-provider.ts` | Hermes env var injection including `STOA_CTL_BASE_URL` |
| `src/main/index.ts:578-582` | Startup: bind webhook port, then sync sidecars |

## Data Flow Diagrams

### Happy Path (agent launched by STOA)

```
STOA starts
  → webhook server binds port P
  → syncManagedSidecars() writes settings.json with port P
  → user creates session
  → provider launches agent process with STOA_WEBHOOK_PORT=P in env
  → agent fires hook
  → hook reaches 127.0.0.1:P → webhook server → session event bridge ✓
```

### Broken Path (agent launched from terminal, STOA running)

```
User opens terminal, launches claude/codex manually
  → STOA_WEBHOOK_PORT not in env
  → Claude Code: http hook reaches old port or current port
    → headers empty (STOA_SESSION_ID etc. not set)
    → 401 or connection refused → hook error in terminal ✗
  → Codex: hook-stoa.mjs exits silently (env check fails) ✗
```

### Broken Path (STOA restarted, agent already running)

```
Claude Code running (loaded settings.json with port P1)
  → STOA restarts → webhook server binds port P2
  → syncManagedSidecars() rewrites settings.json with P2
  → Claude Code does NOT re-read settings.json
  → next hook fires → reaches 127.0.0.1:P1 → connection refused ✗
```

### Broken Path (multiple STOA, same workspace)

```
STOA-A starts → binds port PA → writes settings.json with PA
STOA-B starts → binds port PB → overwrites settings.json with PB
  → STOA-A's sessions → hooks reach PB → session not found → 401 ✗
  → STOA-B's sessions → hooks reach PB → works ✓
```

## Open Questions

1. Should the webhook server use a **fixed port** instead of `port: 0`? Trade-off: conflicts if two STOA instances run, but eliminates staleness.
2. Can Claude Code's `type: "http"` hooks support **env var substitution in the URL** (not just headers)? If so, `STOA_WEBHOOK_PORT` could be used dynamically.
3. Should `hook-stoa.mjs` produce a diagnostic warning instead of `process.exit(0)` when env vars are missing?
4. Is there a mechanism for Claude Code to **hot-reload** `.claude/settings.json` without restart?
