---
date: 2026-04-26
topic: xterm.js alternate screen scrollback preservation strategies
status: completed
mode: context-gathering
sources: 18
---

## Context Report: Alternate Screen Scrollback Preservation in xterm.js

### Why This Was Gathered
Validate whether parser.registerCsiHandler interception (blocking CSI ?1049h and CSI 3J) is a community-verified best practice or a hack for preserving scrollback in xterm.js when hosting TUI apps that force alternate screen mode.

### Summary
egisterCsiHandler interception is a **valid, documented approach** used by multiple production terminals (Canopy IDE, Wave Terminal, OpenAI Codex workaround), but it is not a native xterm.js API — it is patching at the wrong abstraction layer. The xterm.js maintainer (Tyriar) considers it a workaround. Better approaches exist: (1) keeping the xterm instance persistent across TUI sessions, (2) using iTerm2-style alt buffer scrollback emulation, or (3) collaborating with TUI apps to avoid scrollback-clearing sequences.

### Key Findings

#### 1. xterm.js Has No Native Disable Alternate Screen API
There is **no options.altScreenMode or equivalent** in xterm.js. The alternate screen buffer (DECSET 1049/47/1047) is a first-class terminal feature that xterm.js implements per spec. Disabling it requires intercepting escape sequences.

#### 2. registerCsiHandler Is Documented and Used in Production
An xterm.js maintainer (jerch) provided this exact pattern in issue #5745:

`	ypescript
const suppressScrollbackClear = term.parser.registerCsiHandler({ final: '\''J'\'' }, params => {
  if (params[0] === 3) return true; // skip scrollbuffer clearing
  return false;
});
`

Source: https://github.com/xtermjs/xterm.js/issues/5745

Another maintainer suggested using parser.registerCsiHandler with prefix ? final h to track DECSET modes 47/1047/1049. Source: https://github.com/canopyide/canopy/issues/1490

#### 3. Maintainer Verdict: Patching at the Wrong End
From issue #5745, xterm.js maintainer (jerch):
> But again this is patching at the wrong end. If the codex programmers write ED3, then they wanted the scrollbuffer to be cleared.

The maintainer position: if an application sends CSI 3J (scrollback clear), it intentionally wants to clear scrollback. Interception overrides that intent.

#### 4. Better Approach: Keep xterm Instance Persistent
The recommended fix for scrollback loss is not interception — it is architectural:
> What might fix it is keeping the xterm instance persistent with the same lifecycle as the PTY session... if the emulator is getting recreated between commands, scrollback will never build up.

Source: https://github.com/xtermjs/xterm.js/issues/5745

#### 5. scrollOnEraseInDisplay Option (PR #5224)
xterm.js merged scrollOnEraseInDisplay which changes CSI 2J behavior — instead of wiping the screen, it pushes erased text to scrollback (PuTTY-style). This does NOT disable alternate screen.

Source: https://github.com/xtermjs/xterm.js/pull/5224

#### 6. Alt Buffer Scrollback Emulation (Issue #3607)
Tyriar on adding scrollback to alt buffer:
> This would probably be pretty easy to do, just add scrollback to our alt buffer.

However, this was closed as **out-of-scope** in January 2026.

Source: https://github.com/xtermjs/xterm.js/issues/3607

#### 7. iTerm2 Approach (Community Standard)
iTerm2 has two options:
- **Save lines to scrollback in alternate screen mode**: Captures lines scrolled off the top of alt buffer into normal scrollback
- **Disable save/restore alternate screen**: Completely disables alt screen buffer

iTerm2 implementation: appendLines:toLineBuffer moves lines from grid into LineBuffer when they scroll off the top.

Source: https://iterm2.com/documentation-preferences-profiles-terminal.html

#### 8. WezTerm Approach
WezTerm has pane:is_alt_screen_active() API but does NOT offer a built-in option to preserve alt screen content on exit.

Source: https://wezfurlong.org/wezterm/config/lua/pane/is_alt_screen_active.html

#### 9. Canopy IDE Pattern (Most Relevant)
Canopy IDE implements three-layer detection for alternate screen:
1. Escape sequence tracking via registerCsiHandler (prefix ?, final h for DECSET)
2. Runtime buffer check (terminal.buffer.active === terminal.buffer.alternate)
3. Config file check for known agent settings

They use registerCsiHandler to track buffer mode switches, not block them.

Source: https://github.com/canopyide/canopy/issues/1490

#### 10. Wave Terminal Request
Wave Terminal explicitly requests term:preservealtscreen = true config option. Implementation approach suggested:
> hooking the parser for DECRST ?47/?1047/?1049, snapshotting the alt buffer via the buffer API, and injecting it into the main scrollback after the switch.

Source: https://github.com/wavetermdev/waveterm/issues/2837

#### 11. xterm titeInhibit Resource
xterm (the original terminal) has titeInhibit resource which inhibits switching to the alternate screen. This is a first-class option in xterm proper, but xterm.js has no equivalent.

#### 12. OpenAI Codex Lessons
OpenAI Codex tried --no-alt-screen to preserve scrollback in xterm.js hosts. This failed because TUI apps that do screen-level repaints still clear scrollback via CSI 2J/CSI 3J. The proper fix required changes on the Codex side, not xterm.js.

Source: https://github.com/openai/codex/issues/14277

### Recommendations

**Option A: registerCsiHandler Interception (Quick, Valid)**
- Block CSI 3J (ED param 3) to prevent scrollback clear
- Track DECSET ?1049h/?1049l via prefix ?, final h/l handlers
- Used by Canopy IDE, Wave Terminal (proposed), others
- Downside: Overrides TUI app explicit intent

**Option B: Persistent xterm Instance (Architectural, Better)**
- Keep Terminal instance alive across TUI session boundaries
- Re-use same PTY session
- What xterm.js maintainers recommend
- Downside: Requires restructuring app lifecycle

**Option C: Hybrid (Recommended)**
1. Use registerCsiHandler to track buffer mode state (for UI: scrollbar visibility)
2. Implement preserve alt screen on exit: on DECRST ?1049, snapshot alt buffer visible content and append to normal scrollback
3. Implement scrollOnEraseInDisplay: true
4. Document that some TUI apps may still break scrollback if they send CSI 2J/CSI 3J

### Risks / Unknowns
- [!] Blocking CSI 3J may break TUI apps that legitimately need scrollback cleared
- [?] registerCsiHandler behavior may vary across minor versions — not a stable API contract
- [?] Whether to block CSI ?1049h entirely vs. preserving content on exit is a design decision with tradeoffs
- [?] scrollOnEraseInDisplay only handles CSI 2J, not CSI 3J or alt screen switching — necessary but not sufficient

### Downstream
Report saved at: research/2026-04-26-alternate-screen-scrollback-strategies.md
