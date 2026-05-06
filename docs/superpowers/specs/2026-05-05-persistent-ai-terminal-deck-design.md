# Persistent AI Terminal Deck Design

## Goal

Make live `codex`, `opencode`, and `claude-code` terminal sessions persist in the renderer so switching sessions or leaving the command surface does not destroy and rebuild their xterm instances.

## Problem

The current renderer owns a single `TerminalViewport` instance and rebuilds it whenever the active session changes. That behavior is acceptable for plain shell output replay but breaks stateful AI TUIs because the rebuilt xterm instance no longer has the original alternate-screen, mouse-mode, and layout negotiation state.

This causes:

- Codex history appearing truncated after remount or recovery
- OpenCode losing click and scroll behavior
- Selection falling back to browser/xterm-native behavior instead of staying inside the TUI interaction model

## Scope

This change covers the renderer lifetime only.

- Within one app run, switching active AI sessions must not destroy their terminal instances.
- Switching away from the command surface and back must not destroy active AI terminals.
- App relaunch recovery is not fully solved here; existing replay remains a cold-start fallback.

This is a breaking-change prototype implementation. No compatibility layer or behavior flag will be added.

## Architecture

### Session terminal deck

Introduce a renderer-side terminal deck component that renders one `TerminalViewport` per visible live AI session and keeps those component instances mounted after first activation.

Responsibilities:

- create a terminal viewport lazily the first time a session becomes active
- keep previously activated AI-session terminals mounted
- toggle visibility instead of unmounting when the active session changes
- pass through `openWorkspace` events from the active terminal

### Command surface

`CommandSurface` remains the composition surface. It will stop rendering a single active `TerminalViewport` directly and instead render the new terminal deck.

### App shell

`AppShell` will keep `CommandSurface` mounted even when archive/settings is selected. Surface switching becomes a visibility concern instead of a mount/unmount concern for the command surface subtree.

### Terminal viewport

`TerminalViewport` keeps its current responsibility: one terminal runtime per session id. It should still rebuild on session-id changes inside one component instance, but in the new architecture AI-session instances will generally not receive session-id changes because each session gets its own long-lived component instance.

## Session policy

### Persisted in renderer

- `codex`
- `opencode`
- `claude-code`

### Not persisted in renderer in this slice

- `shell`

Reasoning:

- AI TUI sessions are the source of the correctness bug.
- Shell sessions can continue to use the simpler active-session model for now.
- This keeps memory growth lower in the first slice and reduces migration risk.

## Visibility model

The deck renders:

- one active visible terminal
- zero or more hidden but still mounted AI-session terminals
- one active shell terminal rendered through the existing single-instance path

Hidden terminals must not visually affect layout or pointer interaction. Their wrapper stays in the DOM with hidden/inert presentation while preserving the mounted Vue and xterm instances.

## Data flow

1. `AppShell` receives `activeSurface`, `activeSession`, and hierarchy props.
2. `CommandSurface` stays mounted and receives the same reactive props.
3. The terminal deck computes which AI-session ids have been activated.
4. The deck renders a stable `TerminalViewport` instance per activated AI session id.
5. Each `TerminalViewport` continues to subscribe to terminal data for its own session id.
6. Only the active terminal is visible.

## Error handling

- If a session disappears from the hierarchy after archival/deletion, its persistent viewport can be removed from the deck.
- If the active AI session becomes null, all cached terminals remain mounted but hidden.
- If `TerminalViewport` initialization fails, existing local error handling remains authoritative.

## Testing

Add focused renderer tests for:

- `AppShell`: switching surfaces does not unmount `CommandSurface`
- `CommandSurface`: switching active AI sessions preserves both terminal component instances
- `CommandSurface`: shell sessions still render through the non-persistent path
- `TerminalViewport`: existing same-session behavior remains valid

Do not attempt protocol-level alt-screen simulation in this slice. The goal is proving the mount lifecycle fix.

## Success criteria

- Switching between two active AI sessions no longer destroys the previously mounted terminal component.
- Switching from command to archive/settings and back no longer destroys the command surface subtree.
- Existing command-surface event forwarding continues to work.
- Tests cover the new persistent-mount behavior.
