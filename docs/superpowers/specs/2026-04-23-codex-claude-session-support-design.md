# Codex And Claude Code Session Support Design

Date: 2026-04-23
Status: Approved for implementation via subagent-reviewed flow

## Goal

Add first-class `codex` and `claude-code` session types so they behave like provider-backed project sessions, support restart recovery through `externalSessionId`, and fit the existing renderer and main-process session architecture without compatibility shims.

## Problem

The current architecture hardcodes a binary split:

- `shell` maps to `local-shell`
- everything else maps to `opencode`

This blocks any third provider. Runtime behavior, path detection, recovery, icon/name mapping, and default title generation are spread across multiple files and branch on `session.type === 'opencode'`.

That is incompatible with adding both:

- `claude-code`, which can seed a stable external session UUID at create time
- `codex`, which can resume by session UUID but usually needs that UUID discovered after startup

## Design

### 1. Provider descriptors become the routing source of truth

Introduce a shared descriptor registry that answers:

- which provider backs a `SessionType`
- which executable name should be detected
- whether the provider supports resume
- whether the provider supports structured events
- whether the provider can seed `externalSessionId` at create time
- whether runtime should wrap the provider command through the user's shell
- how display names and default title prefixes should be rendered

All main-process, settings, runtime, and renderer routing should read from this descriptor layer instead of branching on `session.type`.

### 2. `externalSessionId` is provider-managed, not opencode-special

Each provider gets one of three binding modes:

- `none`
  `shell`
- `seed-at-create`
  `claude-code`
- `discover-after-start`
  `opencode`, `codex`

The manager/runtime stack must support both:

- synchronous `externalSessionId` creation before PTY spawn
- asynchronous `externalSessionId` patching after PTY spawn

### 3. Recovery stays on the existing `resume-external` / `fresh-shell` model

No migration of recovery modes is needed. The repository already has the right abstraction:

- `fresh-shell`
- `resume-external`

The change is that `resume-external` becomes provider-driven instead of synonymous with `opencode`.

### 4. Provider-specific recovery strategy

#### Shell

- Start with a direct shell PTY
- Never resume
- `externalSessionId = null`

#### OpenCode

- Keep current behavior
- Discover provider session ID through structured sidecar events
- Resume through provider `buildResumeCommand()`

#### Claude Code

- Generate a UUID when the app creates a session
- Persist it immediately as `externalSessionId`
- Start via `claude --session-id <uuid>`
- Resume via `claude --resume <uuid>`
- Do not implement sidecar/webhook events in this phase

#### Codex

- Start a fresh interactive `codex` process
- Watch the local Codex session store for a new session whose metadata matches the current workspace and start time
- Patch that UUID into `externalSessionId`
- Resume via `codex resume <uuid>`
- If the UUID cannot be discovered, allow a narrow fallback to `codex resume --last`

## Architecture Changes

### Shared types

- Extend `SessionType` with `codex` and `claude-code`
- Keep `SessionRecoveryMode` unchanged
- Add shared provider metadata helpers usable by main and renderer

### Provider layer

- Add `codex-provider.ts`
- Add `claude-code-provider.ts`
- Refactor registry to expose descriptors plus provider implementations
- Make executable detection use descriptor `executableName`, not provider id

### Main/runtime layer

- Replace hardcoded `shell ? local-shell : opencode` routing
- Replace `session.type === 'opencode'` resume logic with descriptor-driven capability checks
- Replace `session.type === 'opencode'` shell wrapping with provider-driven shell-wrap rules
- Add async external-session discovery for providers that need it

### Renderer layer

- Replace hardcoded icon/name/title mappings with descriptor-driven metadata
- Add Codex and Claude icons
- Keep current design language and token usage

## Constraints

- No compatibility migration code
- No fallback alias types
- No partial UI support without backend support
- No provider path detection based on UI session type strings
- Final completion gate is `npx vitest run` with zero unexpected failures

## Testing Requirements

- Unit coverage for descriptor routing and runtime decisions
- Provider tests for `codex` and `claude-code` command building
- Detection tests for executable-name mapping
- Renderer tests for new provider visibility and default title generation
- E2E/provider integration coverage for registry membership and recovery command shapes
- Config guard coverage that prevents hardcoded main-process provider routing from reappearing

## Non-Goals

- Structured event sidecars for Codex or Claude Code
- Multi-terminal attachment UX for the same Claude external session
- Session fork UI for Codex or Claude
- Deep inspection of provider transcript stores beyond what is necessary to recover `externalSessionId`
