# Codex PTY Submit Gap

Date: 2026-04-25

## Question

Why do Codex sessions in Stoa stay at runtime-only state (`alive` + `unknown`) even after prompt input reaches the PTY?

## Conclusion

The immediate failure is not in the session-state reducer, observability projection, or renderer.

On Windows with `codex-cli 0.125.0`, interactive Codex can accept PTY-written text into its draft input without accepting that input as a real submit. When that happens:

- the prompt text visibly appears in the Codex TUI
- but no actual turn starts
- so no `UserPromptSubmit`, `PreToolUse`, `Stop`, or notify event is emitted
- Stoa remains stuck at runtime-only `alive/unknown`

## Local Reproductions

### 1. Live Electron app

Observed in a real Electron session launched from this repo:

- `window.stoa.sendSessionInput(sessionId, 'Reply with exactly OK.\\r')` reached `ptyHost.write(...)`
- terminal replay showed the draft line:
  - `› Reply with exactly OK.`
- but there was no webhook debug output for `/hooks/codex`
- and the session stayed:
  - `runtimeState: alive`
  - `agentState: unknown`
  - `lastStateSequence: 2`

### 2. Standalone Windows `node-pty`

Outside Electron, with the same local Codex install:

- `node-pty.write('Reply with exactly OK.\\r')` also left the prompt in the draft line
- the turn still did not begin
- this reproduces the same semantic gap without involving renderer code

### 3. Control check: shell session

In the same Electron app:

- `window.stoa.sendSessionInput(sessionId, 'echo OK\\r')` works for a local shell session
- PowerShell executes the command and prints `OK`

So `Renderer -> IPC -> PTY write -> Enter` is functioning in general. The problem is specific to interactive Codex semantics, not generic PTY input transport.

## External Evidence

Relevant upstream Codex issue:

- GitHub `openai/codex` issue `#15355`
- Title: `Interactive CLI/TUI: opt-in local ingress for trusted local controllers (avoid PTY input emulation)`

Issue body explicitly lists the same failure mode:

- local orchestration today falls back to terminal injection / direct PTY writes
- text can land in the draft without actually submitting

This matches the local reproduction exactly.

## Architectural Meaning

The current Stoa state pipeline assumes:

`PTY write()` -> `provider accepted a submit` -> `provider emits hooks` -> `state updates`

For interactive Codex on Windows, that assumption is false.

The broken link is:

`PTY write()` -> `provider accepted a submit`

That means the current Codex bug should be treated as a provider-ingress/runtime problem, not as a reducer or renderer-state problem.
