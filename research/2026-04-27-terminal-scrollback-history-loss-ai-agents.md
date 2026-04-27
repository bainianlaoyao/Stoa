---
date: 2026-04-27
topic: terminal scrollback history loss xterm.js AI coding agents
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Terminal Scrollback/History Loss with xterm.js and AI Coding Agents

### Why This Was Gathered
Understand common causes and solutions for scrollback history loss when running AI coding agents (OpenCode, Claude Code, Codex CLI) in xterm.js-based terminals.

### Summary

Scrollback/history loss in xterm.js when running AI coding agents is caused by **alternate screen buffer escape sequences** (DECSET 1049/47/1047) and **scrollback-clearing sequences** (CSI 3J aka ED3). Multiple AI coding tools trigger these sequences when they spawn TUI subprocesses (pip, git, editors). xterm.js has **no native option** to disable alternate screen mode or preserve scrollback across TUI boundaries ！ the recommended fix is keeping the Terminal instance persistent with the same lifecycle as the PTY. Community workarounds use egisterCsiHandler interception, but xterm.js maintainers consider this patching at the wrong abstraction layer.

### Key Findings

#### 1. Primary Cause: Alternate Screen Buffer Switching

AI coding agents (OpenCode, Claude Code, Codex CLI) run TUI subprocesses (pip install, git, vim, nano, etc.). These subprocesses send DECSET 1049 (alternate screen buffer) on start and DECRST 1049 on exit. This switches the terminal to a fresh buffer, causing all scrollback history to disappear from the user perspective.

Evidence: https://github.com/xtermjs/xterm.js/issues/5745 ！ The maintainer confirms this is the root cause.

#### 2. Secondary Cause: CSI 3J (ED3) Scrollback Clear

Some TUI programs send CSI 3J which clears the scrollback buffer. This is different from CSI 2J which only clears the visible screen.

Evidence: https://github.com/termux/termux-app/pull/1390 shows ED3 handler clearing transcript buffer.

#### 3. xterm.js Has No Built-in Disable Alternate Screen

There is **no options.altScreenMode or equivalent** in xterm.js. The alternate screen buffer feature is a first-class terminal capability implemented per spec.

Evidence: https://github.com/xtermjs/xterm.js/issues/5745 ！ maintainer confirms no such option exists.

#### 4. OpenAI Codex Learned This the Hard Way

OpenAI Codex tried a --no-alt-screen workaround to preserve scrollback in xterm.js hosts. This failed because TUI apps that do screen-level repaints still clear scrollback via CSI 2J/CSI 3J. The proper fix required changes on the Codex side, not xterm.js.

Evidence: https://github.com/openai/codex/issues/14277 ！ The proper fix required changes on the Codex side, not xterm.js.

#### 5. VS Code Integrated Terminal ！ Same Problem

VS Code integrated terminal uses xterm.js. The scrollback is limited (default 1000 lines) and there is no way to make it infinite.

Evidence: https://github.com/Microsoft/vscode/issues/63452 ！ labeled as-designed, closed in 2018.

#### 6. Community Workaround: registerCsiHandler Interception

Multiple production terminals use this pattern to block scrollback clear:

`	ypescript
const suppressScrollbackClear = term.parser.registerCsiHandler({ final: 'J' }, params => {
  if (params[0] === 3) return true; // skip scrollbuffer clearing (CSI 3J)
  return false;
});
`

Used by: Canopy IDE, Wave Terminal (proposed)

Evidence: https://github.com/xtermjs/xterm.js/issues/5745

#### 7. Maintainer Verdict on Interception

From xterm.js maintainer (jerch) on issue #5745:
> But again this is patching at the wrong end. If the codex programmers write ED3, then they wanted the scrollbuffer to be cleared.

#### 8. Recommended Fix: Persistent Terminal Instance

From issue #5745, xterm.js maintainer (Tyriar):
> What might fix it is keeping the xterm instance persistent with the same lifecycle as the PTY session... if the emulator is getting recreated between commands, scrollback will never build up.

#### 9. scrollOnEraseInDisplay Option (Partial Solution)

xterm.js merged PR #5224 which adds scrollOnEraseInDisplay option ！ changes CSI 2J behavior so erased text goes to scrollback instead of being wiped (PuTTY-style).

Evidence: https://github.com/xtermjs/xterm.js/pull/5224

#### 10. Claude Code Screen Flickering Bug (Related)

Claude Code has a bug where its status indicator causes screen flickering because the entire terminal buffer redraws with each update.

Evidence: https://github.com/anthropics/claude-code/issues/769

### Escape Sequences Reference

| Sequence | Name | Effect |
|---|---|---|
| x1b[?1049h | DECSET 1049 | Enter alternate screen buffer |
| x1b[?1049l | DECRST 1049 | Exit alternate screen buffer |
| x1b[?47h | DECSET 47 | Switch to alternate screen (older) |
| x1b[3J | CSI 3J (ED3) | Clear scrollback buffer |
| x1b[2J | CSI 2J (ED2) | Clear visible screen only |

### Relevant Repositories and Issues

| Repository | Issue | Topic |
|---|---|---|
| xtermjs/xterm.js | #5745 | scrollback lost when running TUI apps |
| xtermjs/xterm.js | #3607 | alt buffer scrollback (declined out-of-scope) |
| xtermjs/xterm.js | #2060 | infinite scrollback proposal |
| xtermjs/xterm.js | PR #5224 | scrollOnEraseInDisplay option |
| openai/codex | #14277 | --no-alt-screen workaround failed |
| anthropics/claude-code | #769 | screen flickering during processing |
| microsoft/vscode | #63452 | unlimited scrollback (as-designed, closed) |
| canopyide/canopy | #1490 | alternate screen tracking pattern |
| wavetermdev/waveterm | #2837 | preserve-altscreen option request |
| spectreconsole/spectre.console | #250 | alternate screen buffer support |

### Risks / Unknowns

- [!] Blocking CSI 3J may break TUI apps that legitimately need scrollback cleared
- [?] registerCsiHandler interception is not a stable API contract
- [?] Wave Terminal proposed snapshot-alt-buffer-on-exit approach is not implemented in any open source xterm.js fork

### Downstream

Report saved at: research/2026-04-27-terminal-scrollback-history-loss-ai-agents.md
