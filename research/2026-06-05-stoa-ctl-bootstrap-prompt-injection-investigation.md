---
date: 2026-06-05
topic: stoa-ctl-bootstrap-prompt-injection-investigation
status: completed
mode: context-gathering
sources: 15
---

## Context Report: stoa-ctl Bootstrap Prompt Injection Investigation

### Why This Was Gathered
Investigate why stoa-ctl usage instructions (bootstrap prompts) are still being injected into sessions even when the stoa-ctl toggle is disabled. Search for stoa-ctl system prompt injection points, toggle implementation, and conditional logic that should gate the injection.

### Summary
The bootstrap prompt is **unconditionally injected** into all sessions regardless of the stoa-ctl enabled/disabled state. The `SessionBootstrapPromptService.getPrompt()` always returns the full `UNIFIED_SESSION_BOOTSTRAP_PROMPT` which contains extensive stoa-ctl usage instructions, and there is **no conditional logic** checking `stoaCtlGate.isEnabled()` before injection.

### Key Findings
1. **Bootstrap prompt is unconditional** - `SessionBootstrapPromptService.getPrompt()` always returns the full prompt with stoa-ctl instructions
2. **Injection point lacks gating** - SessionEventBridge checks `getSessionBootstrapPrompt()` for all SessionStart events without any enabled/disabled check
3. **4-point gate exists but not applied** - The stoaCtlGate correctly controls shims, PATH, env vars, and HTTP endpoints, but NOT bootstrap prompts
4. **Two bootstrap prompts exist** - One for unified sessions (`UNIFIED_SESSION_BOOTSTRAP_PROMPT`) and one for meta sessions (`META_SESSION_BOOTSTRAP_PROMPT`)

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Bootstrap prompt service always returns full stoa-ctl instructions | `src/core/session-bootstrap-prompt-service.ts:56-59` | `getPrompt()` returns `UNIFIED_SESSION_BOOTSTRAP_PROMPT` unconditionally |
| Bootstrap prompt contains extensive stoa-ctl usage instructions | `src/core/session-bootstrap-prompt-service.ts:3-54` | Full prompt includes `stoa-ctl whoami`, `stoa-ctl capabilities`, `stoa-ctl session list`, etc. |
| Injection point has no stoaCtlGate check | `src/main/session-event-bridge.ts:156-157` | `getSessionBootstrapPrompt?.(event.session_id)` called for all SessionStart events |
| Bootstrap prompt attached to SessionStart events | `src/main/session-event-bridge.ts:174-183` | Prompt returned as `additionalContext` in `hookSpecificOutput` |
| Meta-session bootstrap also has stoa-ctl instructions | `src/core/meta-session-bootstrap-prompt.ts:1-32` | `META_SESSION_BOOTSTRAP_PROMPT` includes `stoa-ctl whoami`, `stoa-ctl work-sessions`, etc. |
| 4-point gate controls shims/PATH/env/HTTP but NOT prompts | `src/main/index.ts:815` | `isCtlEnabled: () => stoaCtlGate.isEnabled()` only passed to sessionControlServer |
| StoaCtlGate correctly tracks enabled/disabled state | `src/core/stoa-ctl-feature.ts:14-31` | `createStoaCtlGate` manages state and emits `enabledChanged` events |
| Settings toggle updates stoaCtlEnabled in store | `src/renderer/stores/settings.ts:90-92` | `updateSetting('stoaCtlEnabled', value)` updates reactive store |
| Main process gate synced with settings | `src/main/index.ts:1401-1403` | `stoaCtlGate.setEnabled(settings.stoaCtlEnabled === true)` on settings update |
| Bootstrap prompt service instantiated once | `src/main/index.ts:578` | `sessionBootstrapPromptService = new SessionBootstrapPromptService()` |
| getSessionBootstrapPrompt callback defined | `src/main/index.ts:747-752` | Callback fetches session and calls `sessionBootstrapPromptService.getPrompt(session.type)` |
| SessionStart events always trigger bootstrap prompt | `src/main/session-event-bridge.ts:155` | `isSessionStart = event.event_type.endsWith('.SessionStart')` |
| Prompt injection happens before lifecycle handling | `src/main/session-event-bridge.ts:171-181` | Bootstrap prompt returned after lifecycle but early in event processing |
| Design spec shows 4-point gate but omits bootstrap prompts | `docs/superpowers/specs/2026-06-03-stoa-ctl-settings-toggle-design.md:29-30` | Only lists shims, PATH, env, HTTP as controlled surfaces |
| Implementation plan does not address bootstrap prompt gating | `docs/superpowers/plans/2026-06-03-stoa-ctl-settings-toggle.md:69-74` | No task for conditional prompt injection |

### Risks / Unknowns
- **[!] Missing conditional**: Bootstrap prompts should respect `stoaCtlGate.isEnabled()` but currently don't
- **[?] Meta-session prompt**: Not clear if `META_SESSION_BOOTSTRAP_PROMPT` is used anywhere or if it needs gating
- **[?] Provider-specific behavior**: Different providers (claude-code, codex, opencode) may handle bootstrap prompts differently
- **[?] Session type filtering**: Only some session types may need bootstrap prompts; current implementation applies to all SessionStart events

### Code Paths

#### Current Flow (Unconditional Injection)
```
SessionStart Event
  ↓
SessionEventBridge.enqueueSessionEvent()
  ↓
getSessionBootstrapPrompt(sessionId)
  ↓
SessionBootstrapPromptService.getPrompt(sessionType)
  ↓
ALWAYS returns UNIFIED_SESSION_BOOTSTRAP_PROMPT (with stoa-ctl instructions)
  ↓
Returned as hookSpecificOutput.additionalContext
```

#### Expected Flow (Should Be Conditional)
```
SessionStart Event
  ↓
SessionEventBridge.enqueueSessionEvent()
  ↓
if (stoaCtlGate.isEnabled()) {
  ↓
  getSessionBootstrapPrompt(sessionId)
  ↓
  SessionBootstrapPromptService.getPrompt(sessionType)
  ↓
  Return full bootstrap prompt
} else {
  ↓
  Return null or minimal prompt without stoa-ctl instructions
}
```

### Recommended Fix Location

**File**: `src/main/session-event-bridge.ts` (lines 156-157)

**Current code**:
```typescript
const bootstrapPrompt = isSessionStart
  ? this.getSessionBootstrapPrompt?.(event.session_id) ?? null
  : null
```

**Should be**:
```typescript
const bootstrapPrompt = isSessionStart
  ? (this.isCtlEnabled?.() ?? true
      ? this.getSessionBootstrapPrompt?.(event.session_id) ?? null
      : null)
  : null
```

**Also need**:
- Add `isCtlEnabled?: () => boolean` to `SessionEventBridgeOptions`
- Pass `isCtlEnabled: () => stoaCtlGate.isEnabled()` when creating SessionEventBridge in main/index.ts
- Consider making `SessionBootstrapPromptService.getPrompt()` conditional based on enabled state

### Related Files for Fix
- `src/main/session-event-bridge.ts:60,82,109,156-157` - Add isCtlEnabled option and conditional logic
- `src/main/index.ts:739-753` - Pass isCtlEnabled callback to SessionEventBridge
- `src/core/session-bootstrap-prompt-service.ts:56-59` - Consider making getPrompt conditional
- `src/core/meta-session-bootstrap-prompt.ts` - May need similar conditional logic