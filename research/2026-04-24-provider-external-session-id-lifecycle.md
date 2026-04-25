---
date: 2026-04-24
topic: provider external session ID lifecycle across claude-code, opencode, codex
status: completed
mode: context-gathering
sources: 18
---

## Context Report: Provider External Session ID Lifecycle

### Why This Was Gathered
Need to understand how each provider obtains, stores, and uses the `externalSessionId` for conversation resumption, and what happens when a user internally switches conversations (`.resume`, `/new`) inside the provider CLI.

### Summary
Three providers manage session resumption differently. Claude-code **seeds** its own UUID at creation and passes it via `--session-id`. Opencode and codex **discover** their IDs after start — opencode via sidecar plugin webhook events, codex via polling `~/.codex/sessions/` JSONL files. **None of the three providers detect internal conversation switches** — if a user runs `.resume` or `/new` inside the CLI, the stored `externalSessionId` becomes stale, causing the next app restart to resume the wrong conversation.

---

## Key Findings

### F1. Three distinct ID acquisition strategies

| Provider | Strategy | Initial Value | When ID becomes known |
|----------|----------|---------------|----------------------|
| claude-code | **Seed UUID at creation** | `randomUUID()` | Immediately in `createSession()` |
| opencode | **Discover via sidecar webhook** | `null` | On first `session.idle` / `permission.*` event from plugin |
| codex | **Discover via file polling** | `null` | Within ~10s of start (up to 20 polls × 500ms) |

### F2. Start command differences

| Provider | CLI invocation | Session ID passing |
|----------|---------------|-------------------|
| claude-code | `claude --session-id <uuid>` | CLI flag (UUID is pre-assigned by app) |
| opencode | `opencode` (no args) | Env vars only (`STOA_*`); no ID in command |
| codex | `codex` (no args) | Env vars only (`STOA_*`); no ID in command |

### F3. Resume command differences

| Provider | CLI invocation | Condition |
|----------|---------------|-----------|
| claude-code | `claude --resume <uuid>` | `canResume`: has `externalSessionId` + status allows |
| opencode | `opencode --session <id>` | `canResume`: has `externalSessionId` + status allows |
| codex | `codex resume <id>` | `canResume`: has `externalSessionId` + status allows |
| codex (fallback) | `codex resume --last` | `canFallbackResume`: no `externalSessionId` but has prior session |

### F4. No provider detects internal conversation switches

All three providers have a `resolveSessionId()` method that **always returns `null`** (claude-code, codex) or returns the Stoa internal session ID (opencode). None extract or detect a changed external session ID from incoming events.

Webhook payloads can carry `payload.externalSessionId`, but this is only populated by the opencode sidecar at session start — there is no event type for "conversation switched."

---

## Detailed Evidence by Provider

### Claude-Code Provider

**ID acquisition — seeded UUID:**
- `seedsExternalSessionId: true` in descriptor (`provider-descriptors.ts:57`)
- `createSessionExternalId()` generates `randomUUID()` at creation (`project-session-manager.ts:107-115`)
- Called during `createSession()` at line 346

**Start command:**
- `buildStartCommand` → `claude --session-id <uuid>` (`claude-code-provider.ts:102-103`)
- `requireExternalSessionId()` guard throws if ID missing (lines 85-91)

**Resume command:**
- `buildResumeCommand` → `claude --resume <uuid>` (`claude-code-provider.ts:105-106`)
- No `buildFallbackResumeCommand` — not defined for this provider

**Sidecar (hooks):**
- Writes `.claude/settings.local.json` with two hooks: `Stop` and `PermissionRequest` (`claude-code-provider.ts:33-83`)
- Hooks carry `STOA_SESSION_ID` (internal ID, NOT external UUID) via headers
- `Stop` → `turn_complete`; `PermissionRequest` → `needs_confirmation` (`hook-event-adapter.ts:4-40`)

**Discovery:**
- `discoverExternalSessionIdAfterStart` returns `target.external_session_id ?? null` (`claude-code-provider.ts:114-116`) — effectively a no-op since ID is always seeded
- Guard `!session.externalSessionId` in `session-runtime.ts:119` means discovery is never invoked for claude-code

**`resolveSessionId`:** Always returns `null` (line 108-110)

---

### OpenCode Provider

**ID acquisition — discovered via sidecar plugin webhook:**
- `seedsExternalSessionId: false` (`provider-descriptors.ts:35`)
- `createSessionExternalId()` returns `null` at creation
- External ID arrives asynchronously via sidecar plugin event: `event.properties?.sessionID` → `payload.externalSessionId` (`opencode-provider.ts:38`)
- Flows: sidecar → webhook `/events` → `SessionEventBridge` → `applySessionEvent()` → stored in `session.externalSessionId` (`session-event-bridge.ts:35-41`, `project-session-manager.ts:260-262`)

**Start command:**
- `buildStartCommand` → bare `opencode` with no args (`opencode-provider.ts:52-54`)
- Context injected via env vars `STOA_SESSION_ID`, `STOA_PROJECT_ID`, `STOA_SESSION_SECRET`, `STOA_WEBHOOK_PORT`, `STOA_PROVIDER_PORT`

**Resume command:**
- `buildResumeCommand` → `opencode --session <id>` (`opencode-provider.ts:55-57`)
- No `buildFallbackResumeCommand` — not defined for this provider

**Sidecar (plugin):**
- Writes `.opencode/plugins/stoa-status.ts` into project dir (`opencode-provider.ts:31-41`)
- Captures four event types: `session.idle` → `turn_complete`, `permission.asked` → `needs_confirmation`, `permission.replied` → `running`, `session.error` → `error`
- Posts canonical events to webhook with `externalSessionId: event.properties?.sessionID`

**Discovery:**
- `discoverExternalSessionIdAfterStart` is **not implemented** for opencode
- ID arrives through the webhook event path instead

**`resolveSessionId`:** Returns `event.session_id ?? null` — this is the Stoa internal ID, not the opencode session ID (`opencode-provider.ts:58-60`)

---

### Codex Provider

**ID acquisition — discovered via file-system polling:**
- `seedsExternalSessionId: false` (`provider-descriptors.ts:46`)
- `createSessionExternalId()` returns `null` at creation
- `discoverExternalSessionIdAfterStart` polls `~/.codex/sessions/*.jsonl` up to 20 times × 500ms (max ~10s) (`codex-provider.ts:220-238`)
- Reads first line of each JSONL file, checks for `type === 'session_meta'`, matches `payload.cwd` against project path (`codex-provider.ts:133-190`)
- Time window: only considers files modified within ±60s of `startedAt` (lines 9-14 constants)

**Start command:**
- `buildStartCommand` → bare `codex` with no args (`codex-provider.ts:205-207`)
- Context via env vars; wrapped in shell (`prefersShellWrap: true`, `provider-descriptors.ts:47`)

**Resume command:**
- `buildResumeCommand` → `codex resume <id>` (`codex-provider.ts:211-213`)
- **Has fallback:** `buildFallbackResumeCommand` → `codex resume --last` (`codex-provider.ts:208-210`)
- Fallback used when session has no `externalSessionId` but is being recovered (e.g., app restart before discovery completed)

**Sidecar (notify script):**
- Writes `.codex/config.toml` with `notify = ["node", ".codex/notify-stoa.mjs"]` (`codex-provider.ts:46-48`)
- Writes `.codex/notify-stoa.mjs` script that filters for `agent-turn-complete` events and POSTs to webhook (`codex-provider.ts:52-90`)
- Only carries Stoa's `STOA_SESSION_ID`, NOT the codex external session ID in payloads

**`resolveSessionId`:** Always returns `null` (line 214-216)

**Note:** Descriptor says `supportsStructuredEvents: false` (`provider-descriptors.ts:45`) while provider instance returns `true` (line 204) — descriptor value controls runtime behavior.

---

## Session Runtime Decision Logic (shared)

The command selection cascade in `session-runtime.ts:73-92`:

```
canResume (has externalSessionId + supports resume + status allows)
  → buildResumeCommand(target, externalSessionId, context)

canFallbackResume (no externalSessionId + supports resume + has fallback method + status allows)
  → buildFallbackResumeCommand(target, context) ?? buildStartCommand(target, context)

default
  → buildStartCommand(target, context)
```

---

## Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Claude-code seeds UUID | `provider-descriptors.ts` | line 57: `seedsExternalSessionId: true` |
| UUID seeding logic | `project-session-manager.ts` | lines 107-115: `createSessionExternalId()` |
| Claude-code start: `--session-id` | `claude-code-provider.ts` | line 103 |
| Claude-code resume: `--resume` | `claude-code-provider.ts` | line 106 |
| Claude-code hooks: Stop + PermissionRequest | `claude-code-provider.ts` | lines 33-83 |
| Claude-code discovery is no-op | `claude-code-provider.ts` | lines 114-116 |
| Opencode seedsExternalSessionId false | `provider-descriptors.ts` | line 35 |
| Opencode start: bare command | `opencode-provider.ts` | lines 52-54 |
| Opencode resume: `--session` | `opencode-provider.ts` | lines 55-57 |
| Opencode ID from sidecar plugin | `opencode-provider.ts` | line 38: `event.properties?.sessionID` |
| Opencode sidecar events | `opencode-provider.ts` | lines 34-41 |
| Opencode no discovery method | `opencode-provider.ts` | (method not present on provider object) |
| Codex seedsExternalSessionId false | `provider-descriptors.ts` | line 46 |
| Codex start: bare command | `codex-provider.ts` | lines 205-207 |
| Codex resume: `resume <id>` | `codex-provider.ts` | lines 211-213 |
| Codex fallback resume: `resume --last` | `codex-provider.ts` | lines 208-210 |
| Codex file polling discovery | `codex-provider.ts` | lines 220-238, 133-190 |
| Codex notify sidecar | `codex-provider.ts` | lines 46-90 |
| Resume decision cascade | `session-runtime.ts` | lines 73-92 |
| Webhook event → externalSessionId | `session-event-bridge.ts` | lines 35-41 |
| applySessionEvent stores externalId | `project-session-manager.ts` | lines 249-265 |
| ProviderDefinition interface | `index.ts` | lines 16-36 |

---

## Risks / Unknowns

- [!] **Stale externalSessionId on conversation switch**: If a user runs `.resume`, `/new`, or `/clear` inside any provider CLI, the stored `externalSessionId` becomes stale. On next app restart, `--resume <old-id>` will resume the wrong conversation. No provider detects or updates on internal switches.

- [!] **Opencode has no fallback resume**: If opencode's `externalSessionId` was never received (e.g., sidecar plugin failed), recovery always falls through to `buildStartCommand` — a fresh session with no history link.

- [!] **Codex discovery can fail silently**: The 20-poll × 500ms window (~10s) may not be enough if codex is slow to write session files. If discovery fails, the session gets no `externalSessionId`, and subsequent recovery uses `codex resume --last` which may pick the wrong session.

- [?] **Claude-code hook payloads**: Unknown whether Claude CLI's `Stop` or `PermissionRequest` hooks include a `conversation_id` or `session_id` field in their HTTP body. If they do, `resolveSessionId` could be updated to extract it — but currently returns `null`.

- [?] **Opencode sidecar `sessionID` update cadence**: Unknown whether opencode's `event.properties.sessionID` changes when the user starts a new session within the same process. If it does, the webhook path could theoretically propagate the new ID — but this is unverified.
