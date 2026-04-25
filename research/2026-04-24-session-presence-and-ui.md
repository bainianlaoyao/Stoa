---
date: 2026-04-24
topic: session presence and frontend presentation
status: completed
mode: context-gathering
sources: 15
---

## Context Report: Session Presence and Frontend Presentation

### Why This Was Gathered
Need a bounded design recommendation for how `stoa` should sense session state more elegantly across providers, and how that state should be presented in the renderer without overloading the sidebar or leaking unreliable provider internals into the primary UI.

### Summary
The current model is still too thin for an elegant UI: the shared contract mainly carries `status`, `summary`, and `externalSessionId`, while the renderer mostly shows a colored dot plus raw `session.status` / `session.type` strings. At the same time, provider-side observability is already rich enough to support a better experience: Claude can expose `model`, `last_assistant_message`, and typed API failures; OpenCode exposes event streams like `message.updated`, `permission.asked`, `session.idle`, and even a `/session/status` API; local research already shows `externalSessionId` can become stale on internal provider conversation switches.

The most elegant direction is a **derived session presence model**: keep the backend canonical `SessionStatus` contract for routing and persistence, but derive a richer renderer-facing view model with four layers: `phase`, `confidence`, `blocking reason`, and `recent evidence`. Then present that model in three density tiers: a compact hierarchy row, a richer terminal meta/header surface, and a detailed inspector/popover. This preserves the repository’s glass/minimal design language, avoids fake certainty, and fixes the current problem where `turn_complete`, `needs_confirmation`, and `degraded` all visually collapse into the same warning dot.

### Key Findings

1. **The current shared contract is too narrow for graceful UI state awareness.**
   - `SessionStatus` is still a flat enum in the shared contract, and `SessionSummary` only keeps `status`, `summary`, and `externalSessionId` as state-related fields. [src/shared/project-session.ts:5](src/shared/project-session.ts:5), [src/shared/project-session.ts:25](src/shared/project-session.ts:25), [src/shared/project-session.ts:33](src/shared/project-session.ts:33)
   - The renderer event bridge only exposes `sessionId`, `status`, and `summary`. [src/shared/project-session.ts:133](src/shared/project-session.ts:133)

2. **The hierarchy panel currently underuses status semantics and overuses raw strings.**
   - Session rows render a status dot, title, and raw `session.type`; they do not render a humanized state label, recency, model, or blocking reason. [src/renderer/components/command/WorkspaceHierarchyPanel.vue:264](src/renderer/components/command/WorkspaceHierarchyPanel.vue:264), [src/renderer/components/command/WorkspaceHierarchyPanel.vue:266](src/renderer/components/command/WorkspaceHierarchyPanel.vue:266), [src/renderer/components/command/WorkspaceHierarchyPanel.vue:267](src/renderer/components/command/WorkspaceHierarchyPanel.vue:267)
   - `turn_complete`, `awaiting_input`, `degraded`, and `needs_confirmation` are currently grouped into the same warning color treatment, which conflates “ready”, “degraded”, and “blocked” into one visual bucket. [src/renderer/components/command/WorkspaceHierarchyPanel.vue:462](src/renderer/components/command/WorkspaceHierarchyPanel.vue:462)
   - The terminal meta bar still shows raw project/session IDs and raw `session.status`, which is useful for debugging but not elegant as a primary status surface. [src/renderer/components/command/TerminalMetaBar.vue:11](src/renderer/components/command/TerminalMetaBar.vue:11), [src/renderer/components/command/TerminalMetaBar.vue:17](src/renderer/components/command/TerminalMetaBar.vue:17), [src/renderer/components/command/TerminalMetaBar.vue:18](src/renderer/components/command/TerminalMetaBar.vue:18)

3. **The current layout is too narrow to carry verbose metadata, so state presentation must be tiered.**
   - The main command layout gives the workspace panel a fixed `240px` width. [src/renderer/components/command/CommandSurface.vue:27](src/renderer/components/command/CommandSurface.vue:27)
   - Existing overflow research shows even project paths already overflow the sidebar when truncation is missing, so any new state UI must be information-dense and intentionally truncated. [research/2026-04-24-session-entry-overflow.md](research/2026-04-24-session-entry-overflow.md)

4. **The repo already acknowledges provisional state, but the renderer does not surface confidence explicitly.**
   - The architecture doc says startup can show `bootstrapping` or the previous `last_known_status`, but that state must be understood as provisional until fresh runtime events arrive. [docs/architecture/workspace-identity-and-state-machine.md:86](docs/architecture/workspace-identity-and-state-machine.md:86)

5. **Claude Code already exposes the exact enrichment fields Stoa is missing.**
   - Official hooks docs state `SessionStart` includes `source` and `model`. `Stop` includes `last_assistant_message`. `StopFailure` includes `error`, optional `error_details`, and optional `last_assistant_message`. `PermissionRequest` includes `tool_name`, `tool_input`, and optional `permission_suggestions`.
   - Sources:
     - https://code.claude.com/docs/en/hooks
     - Specifically: `SessionStart input`, `Stop input`, `StopFailure input`, `PermissionRequest input`

6. **OpenCode exposes a broader observability surface than the current integration uses.**
   - Official plugin docs list `message.updated`, `permission.asked`, `permission.replied`, `session.error`, `session.idle`, `session.status`, `tool.execute.before`, and `tool.execute.after` as available plugin events, and their examples show `session.idle` being used as “session completion” feedback.
   - Official server docs also expose `GET /session/status`, returning per-session `SessionStatus`.
   - Sources:
     - https://opencode.ai/docs/plugins/
     - https://opencode.ai/docs/server/

7. **Local provider research shows the current app is discarding valuable provider evidence.**
   - The provider observability inventory explicitly identifies `SessionStart.model`, `Stop.last_assistant_message`, `StopFailure.error/error_details`, `PreToolUse`, and `PostToolUse` as available but unused for Claude; and message/tool/session data as available but unused for OpenCode and Codex. [docs/architecture/provider-observable-information.md:382](docs/architecture/provider-observable-information.md:382), [docs/architecture/provider-observable-information.md:387](docs/architecture/provider-observable-information.md:387), [docs/architecture/provider-observable-information.md:423](docs/architecture/provider-observable-information.md:423), [docs/architecture/provider-observable-information.md:1248](docs/architecture/provider-observable-information.md:1248)

8. **`externalSessionId` is useful for recovery, but unsafe as the primary UI identity.**
   - Local lifecycle research concludes that none of the three providers detect internal conversation switches like `.resume`, `/new`, or `/clear`, so the stored `externalSessionId` can become stale and resume the wrong conversation later. [research/2026-04-24-provider-external-session-id-lifecycle.md:15](research/2026-04-24-provider-external-session-id-lifecycle.md:15), [research/2026-04-24-provider-external-session-id-lifecycle.md:190](research/2026-04-24-provider-external-session-id-lifecycle.md:190)

9. **External UX guidance strongly favors inline, passive, labeled status rather than color-only dots or interruptive UI.**
   - Apple’s HIG says feedback should help people know what is happening, status feedback should be integrated near the items it describes, and alerts should be reserved for critical actionable cases. Source: https://developer.apple.com/design/human-interface-guidelines/feedback
   - Carbon’s status-indicator guidance says status should rely on multiple elements such as color, shape, and text; shape indicators should be paired with a status label; and status should not rely on color alone. Source: https://v10.carbondesignsystem.com/patterns/status-indicator-pattern/
   - Atlassian defines lozenges as quick-recognition status indicators, which fits compact session chips in dense admin-style surfaces. Source: https://atlassian.design/components/lozenge
   - Carbon’s overflow guidance says truncation should be deliberate, include ellipsis, and offer a reveal path such as a tooltip. Source: https://v10.carbondesignsystem.com/patterns/overflow-content/

### Approaches Considered

#### Approach A: Keep the current enum and only improve labels/colors

Add better labels for existing statuses, split `turn_complete` away from warning yellow, and surface a nicer chip in the hierarchy and meta bar.

**Pros**
- Very low implementation cost
- Minimal data-model change
- Solves the most obvious visual confusion

**Cons**
- Still treats session awareness as a single status field
- Cannot express provisional vs authoritative vs stale
- Cannot elegantly surface model, last assistant turn, blocking reason, or resume trust

#### Approach B: Derived Presence Model on Top of Canonical Statuses

Keep backend `SessionStatus` and canonical events as-is for persistence/routing, but derive a renderer-facing `SessionPresenceViewModel` from canonical status + provider evidence + timestamps + trust flags.

**Pros**
- Best balance of rigor and elegance
- Does not break the current core routing model
- Lets the UI express uncertainty without inventing fake statuses
- Makes room for provider enrichment without coupling the renderer to provider-specific payloads

**Cons**
- Requires a deliberate view-model layer instead of direct template rendering
- Needs precedence rules and freshness rules

#### Approach C: Replace Primary Status With a Full Activity Timeline

Show a per-session event feed or step timeline as the main navigation/status language.

**Pros**
- Maximally rich observability
- Useful for debugging provider integrations

**Cons**
- Too heavy for a 240px sidebar
- Over-optimizes for debugging rather than daily flow
- Violates the project’s minimalist constraint if made primary

### Recommendation

Recommend **Approach B**.

The clean split is:

1. **Backend canonical state remains simple and durable**
   - Keep `SessionStatus` as the authoritative persisted lifecycle field.
   - Continue routing through canonical events.
   - Extend ingestion to capture more evidence, but do not force provider-specific raw payloads into the renderer.

2. **Renderer derives a richer `SessionPresenceViewModel`**

Recommended shape:

```ts
interface SessionPresenceViewModel {
  phase: 'preparing' | 'working' | 'ready' | 'blocked' | 'degraded' | 'failed' | 'exited'
  confidence: 'authoritative' | 'provisional' | 'stale'
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  label: string
  shortLabel: string
  blockingReason?: 'permission' | 'elicitation' | 'resume-confirmation'
  modelLabel?: string
  providerLabel: string
  lastAssistantSnippet?: string
  lastEventAt?: string
  hasUnreadTurn?: boolean
  recoveryPointerState?: 'trusted' | 'suspect' | 'missing'
}
```

3. **State mapping should separate “ready” from “warning”**

Recommended UI mapping:

| Canonical status | Derived phase | Tone | UI label |
|---|---|---|---|
| `bootstrapping`, `starting` | `preparing` | `neutral` | Preparing |
| `running` | `working` | `success` | Working |
| `turn_complete` | `ready` | `accent` | Ready |
| `awaiting_input` | `ready` | `accent` | Idle |
| `needs_confirmation` | `blocked` | `warning` | Needs approval |
| `degraded` | `degraded` | `warning` | Attention needed |
| `error` | `failed` | `danger` | Error |
| `exited` | `exited` | `neutral` or `danger` | Exited |

This is the main visual correction the current UI needs. `turn_complete` is not a warning; it is a live session waiting for the user.

4. **Expose confidence explicitly**

The UI should surface whether a status is:

- `authoritative`: backed by a recent runtime/provider event
- `provisional`: replayed from persisted state during startup
- `stale`: runtime seems alive but provider evidence is missing or old

This follows the existing architecture contract around provisional startup state, but makes it legible to the user. [docs/architecture/workspace-identity-and-state-machine.md:86](docs/architecture/workspace-identity-and-state-machine.md:86)

5. **Do not make `externalSessionId` the primary user-facing identity**

Use it as an advanced “resume pointer” only. In the main UI, show provider/model/phase. In the detail surface, show whether the resume pointer is `trusted`, `suspect`, or `missing`.

This avoids presenting stale provider-native IDs as if they were authoritative conversation identity. [research/2026-04-24-provider-external-session-id-lifecycle.md:190](research/2026-04-24-provider-external-session-id-lifecycle.md:190)

### Recommended Data Acquisition Priorities

#### P0: High-value fields with minimal new infrastructure

- Claude `Stop.last_assistant_message`
- Claude `StopFailure.error` + `error_details`
- OpenCode `message.updated`
- OpenCode `session.idle`, `permission.asked`, `permission.replied`, `session.error`
- Codex `last-assistant-message` and thread identity if already available through the existing notify payload, as documented in local provider research. [docs/architecture/provider-observable-information.md:1323](docs/architecture/provider-observable-information.md:1323)

These immediately unlock:

- last-turn snippets
- real blocking reasons
- typed failure copy
- unread-turn indication for background sessions

#### P1: Provider/model identity

- Claude `SessionStart.model`
- OpenCode model identity from message/session observability
- Codex model/thread identity when the current platform path is verified

#### P2: Activity evidence

- Tool start/finish summaries
- subagent presence
- compact/resume summaries

This data belongs in the detail surface, not the compact sidebar row.

### Recommended Frontend Presentation

#### 1. Workspace Hierarchy Panel: Dense Scan Surface

Goal: let users answer “which session needs me?” in one quick scan.

Use a two-line session row:

- Line 1: session title
- Line 2: compact status chip text + provider/model text

Example:

- `bugfix-auth`
  `Ready · Claude · Sonnet`
- `shell-2`
  `Idle · Shell`
- `investigate-db-lock`
  `Needs approval · OpenCode`

Rules:

- Keep the left status dot, but pair it with text; do not rely on color alone.
- Replace raw `session.type` on the second line with humanized state-first copy.
- If model is unknown, fall back to provider label only.
- Keep truncation end-line for the second line, with full content exposed through tooltip/popover.
- Do not show full project path on the main row; keep it in detail only.

#### 2. Terminal Header / Meta Surface: Focus Surface

Goal: let the active session explain itself without opening a separate inspector.

Replace raw IDs with:

- provider/model chip
- primary status lozenge
- recency text like `updated 12s ago`
- optional one-line last assistant snippet when the session is `ready` or `failed`

IDs and raw external session pointers can move into a secondary inspector or debug copy action.

#### 3. Detail Popover / Side Inspector: Truth Surface

Goal: expose evidence without cluttering the navigation.

Show:

- project path
- internal session ID
- resume pointer state
- last provider event
- last event time
- last assistant snippet
- latest blocking/error details
- provider-specific evidence like tool/permission context when available

This surface is where mono typography belongs for paths, IDs, and exact timestamps, matching the project’s design-language rules.

#### 4. Interruptive UI Only for Real Blockers

Use passive inline status for:

- `ready`
- `working`
- `preparing`
- `degraded`

Use interruptive inline banners / focused prompts only for:

- `needs_confirmation`
- `error`

This matches Apple’s guidance to keep ordinary status inline and reserve interruption for critical actionable cases. Source: https://developer.apple.com/design/human-interface-guidelines/feedback

#### 5. Unread Turn Signaling for Inactive Sessions

If a background session receives a new assistant turn while unfocused, mark the row with a subtle low-attention indicator until visited.

This is a better use of “attention” than treating all waiting states as warning yellow.

### Visual Language Constraints

The design should follow the repository design language:

- glass/minimal layering, not heavy framing
- design tokens only
- mono typography only for IDs, paths, timestamps, and code-like text
- restrained motion

Relevant constraint: [docs/engineering/design-language.md](docs/engineering/design-language.md)

### Proposed Implementation Order

1. Add a renderer-side presence derivation layer, without changing persistence shape first.
2. Fix the current visual mapping so `turn_complete` and `awaiting_input` no longer share the same treatment as `needs_confirmation` and `degraded`.
3. Replace raw `session.type` secondary text with `shortLabel · provider/model`.
4. Enrich provider ingestion with P0 evidence fields.
5. Upgrade the terminal meta/header surface.
6. Add a richer detail inspector or improve the existing popover.

### Risks / Unknowns

- [!] The exact `message.updated` payload shape from OpenCode should be captured before the final implementation contract is locked.
- [!] Codex enrichment still depends on the currently supported integration path for the target platform; local provider research indicates Windows remains a special case for hooks. [docs/architecture/provider-observable-information.md:1327](docs/architecture/provider-observable-information.md:1327)
- [!] Freshness / staleness thresholds need a product decision. A short threshold feels reactive but may create false stale states during quiet long-running work.
- [!] If too much evidence is shown in the hierarchy row, the 240px navigation surface will regress into overflow and noise. [src/renderer/components/command/CommandSurface.vue:27](src/renderer/components/command/CommandSurface.vue:27)

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| Shared session status is a flat enum | `src/shared/project-session.ts` | `:5` |
| Session summary exposes `externalSessionId` but no richer presence fields | `src/shared/project-session.ts` | `:25-33` |
| Renderer event shape only carries `sessionId`, `status`, `summary` | `src/shared/project-session.ts` | `:133-137` |
| Hierarchy row shows dot + title + raw type | `WorkspaceHierarchyPanel.vue` | `:264-267` |
| `turn_complete`, `degraded`, `needs_confirmation` share warning styling | `WorkspaceHierarchyPanel.vue` | `:462-466` |
| Terminal meta bar currently shows raw IDs and raw status | `TerminalMetaBar.vue` | `:11-18` |
| Sidebar width is fixed at `240px` | `CommandSurface.vue` | `:27` |
| Startup state can be provisional | `workspace-identity-and-state-machine.md` | `:86` |
| Claude hooks expose `model` on `SessionStart` | Claude Code docs | https://code.claude.com/docs/en/hooks |
| Claude hooks expose `last_assistant_message` on `Stop` | Claude Code docs | https://code.claude.com/docs/en/hooks |
| Claude hooks expose typed API failure fields on `StopFailure` | Claude Code docs | https://code.claude.com/docs/en/hooks |
| OpenCode plugins expose `message.updated`, `permission.asked`, `session.idle`, `tool.execute.before` | OpenCode docs | https://opencode.ai/docs/plugins/ |
| OpenCode server exposes `/session/status` | OpenCode docs | https://opencode.ai/docs/server/ |
| External session IDs become stale on provider-side internal conversation switches | `research/2026-04-24-provider-external-session-id-lifecycle.md` | `:15`, `:190` |
| Apple recommends inline status feedback near the item and alerts only for critical actionable information | Apple HIG | https://developer.apple.com/design/human-interface-guidelines/feedback |
| Carbon recommends status semantics through shape/color/type, not color alone | Carbon | https://v10.carbondesignsystem.com/patterns/status-indicator-pattern/ |
| Atlassian defines lozenges as quick-recognition status indicators | Atlassian | https://atlassian.design/components/lozenge |
| Carbon recommends deliberate truncation with reveal path | Carbon | https://v10.carbondesignsystem.com/patterns/overflow-content/ |

## Context Handoff: Session Presence and Frontend Presentation

Start here: `research/2026-04-24-session-presence-and-ui.md`

Context only. Use the saved report as the source of truth.
