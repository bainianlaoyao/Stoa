---
date: 2026-05-05
topic: vscode-terminal-parity
status: completed
mode: context-gathering
sources: 18
---

## Context Report: VS Code terminal parity roadmap for this project

### Why This Was Gathered
To determine how to move this project's terminal experience closer to VS Code's integrated terminal, with concrete guidance on which settings and behaviors can be matched directly and which require additional architecture.

### Summary
This project already shares VS Code's core terminal substrate: `xterm.js` in the renderer plus `node-pty` on the backend, using ConPTY semantics on Windows. But current parity is shallow: the repo only exposes font family and font size as persistent terminal settings, while most runtime behavior is hardcoded in the xterm constructor.

VS Code-level terminal experience is not just xterm tuning. It has three distinct layers:
1. xterm option surface and platform defaults
2. PTY/backend/runtime environment behavior
3. shell integration and command-awareness protocols

This repo currently covers layer 1 partially, layer 2 minimally, and layer 3 almost not at all. Therefore the right path is phased parity: first align xterm defaults/settings, then align launch environment and renderer behavior, then add shell integration and command-detection capabilities.

### Key Findings
- This repo uses `@xterm/xterm` and `node-pty`.
- This repo starts PTYs through `node-pty.spawn(...)`, not a direct ConPTY API.
- This repo currently persists only `terminalFontSize` and `terminalFontFamily` in app settings.
- This repo hardcodes many xterm options in `createTerminalRuntime(...)`.
- Several current defaults diverge from VS Code, including cursor blinking.
- VS Code exposes a much broader terminal setting surface in source, including copy on selection, font weight, line height, letter spacing, cursor behavior, scrollback, GPU acceleration, right-click behavior, Unicode version, shell integration, and more.
- VS Code has shell integration injection plus OSC-based command/CWD detection, which is a major part of its terminal experience.
- This repo currently shows no evidence of shell integration injection, OSC 633/133 handling, command detection, or CWD reporting.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Project depends on xterm.js and node-pty | local package.json | `package.json:39-50` |
| Project spawns PTY via node-pty | local source | `src/core/pty-host.ts:11-23` |
| Project sets `TERM`, `COLORTERM`, `TERM_PROGRAM` in PTY env | local source | `src/core/pty-host.ts:17-22` |
| Project persists only font size/family among terminal settings | local type/defaults | `src/shared/project-session.ts:129-169` |
| Project settings store only exposes font size/family for terminal | local store | `src/renderer/stores/settings.ts:13-16`, `src/renderer/stores/settings.ts:51-59` |
| Project settings UI only exposes terminal font family/size | local UI | `src/renderer/components/settings/GeneralSettings.vue:177-201` |
| Project xterm runtime hardcodes many terminal options | local source | `src/renderer/terminal/xterm-runtime.ts:154-185` |
| Current project defaults include `cursorBlink: true` | local source | `src/renderer/terminal/xterm-runtime.ts:162-165` |
| Current project defaults include `scrollback: 10000`, `minimumContrastRatio: 4.5`, `fastScrollSensitivity: 5` | local source | `src/renderer/terminal/xterm-runtime.ts:166-177` |
| Current project uses Unicode 11 addon and sets Windows PTY backend to conpty | local source | `src/renderer/terminal/xterm-runtime.ts:183-202` |
| VS Code default terminal font size is 14 on non-macOS | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts#L43 |
| VS Code default `copyOnSelection` is false | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts#L157-L161 |
| VS Code terminal settings include font family, ligatures, font size, letter spacing, line height, minimum contrast, tab stop width, scroll sensitivities | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts#L178-L244 |
| VS Code terminal settings include font weights, cursor blinking/style/width, scrollback | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts#L253-L317 |
| VS Code terminal settings include GPU acceleration and right click behavior | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts#L332-L369 |
| VS Code terminal settings include Unicode version | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts#L535-L543 |
| VS Code enables shell integration by default | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts#L614-L617 |
| VS Code shell integration provides decorations, timeout, quick fix, env reporting settings | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts#L618-L649 |
| VS Code has alt-click cursor movement, bell, visual bell, word separators settings | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts#L152-L153 and https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts#L248-L249 and https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts#L416-L417 and https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts#L503-L504 |
| VS Code shell integration injects env vars like `VSCODE_INJECTION`, `VSCODE_NONCE`, `VSCODE_SHELL_ENV_REPORTING`, `VSCODE_STABLE` and shell-specific init scripts | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/terminalEnvironment.ts#L53-L153 and https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/terminalEnvironment.ts#L258-L339 |
| VS Code terminal process applies shell integration env mixin before spawn | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/terminalProcess.ts#L210-L244 |
| VS Code shell integration addon parses OSC 633/133 and CWD sequences for command/CWD detection | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/common/xterm/shellIntegrationAddon.ts#L53-L88 and https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/common/xterm/shellIntegrationAddon.ts#L107-L214 and https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/common/xterm/shellIntegrationAddon.ts#L369-L376 and https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/common/xterm/shellIntegrationAddon.ts#L485-L592 and https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/common/xterm/shellIntegrationAddon.ts#L647-L723 |
| This repo has no shell integration markers in source search | local repo search | `rg -n "OSC 633|OSC 133|VSCODE_SHELL_INTEGRATION|shellIntegration|CurrentDir=|HasRichCommandDetection" src tests testing package.json` |
| node-pty supports ConPTY on Windows 1809+ and powers VS Code | node-pty README | https://github.com/microsoft/node-pty/blob/main/README.md#L12 and https://github.com/microsoft/node-pty/blob/main/README.md#L47-L49 |

### Parity Matrix
- Layer 1: xterm option parity
  Status: partially present
  Present now: font family, font size, cursor style, inactive cursor style, scrollback, contrast ratio, fast scroll sensitivity, web links, clipboard, Unicode 11, WebGL when available
  Missing as configurable settings: copy on selection, font weight, bold weight, letter spacing, line height, cursor blinking, cursor width, GPU acceleration policy, right click behavior, mouse wheel sensitivity, word separators, Unicode version toggle, ligatures, bell controls

- Layer 2: backend/runtime parity
  Status: basic
  Present now: node-pty spawn, `xterm-256color`, `COLORTERM=truecolor`, resize/input/replay, Windows build number passed to xterm
  Missing or divergent: VS Code-like terminal env markers, richer shell-specific launch behavior, shell integration injection pipeline, renderer selection policy beyond simple WebGL feature detection

- Layer 3: shell integration and command awareness
  Status: largely absent
  Present now: none found
  Missing: shell init script injection, OSC 633 parsing, command boundaries, command exit codes, prompt detection, CWD reporting, overview/gutter command decorations, command-aware quick fixes, shell env reporting

### Recommended Roadmap
- Phase 1: Match VS Code xterm defaults and setting surface
  Add persisted settings for:
  `cursorBlinking`, `cursorStyle`, `cursorStyleInactive`, `cursorWidth`, `lineHeight`, `letterSpacing`, `fontWeight`, `fontWeightBold`, `copyOnSelection`, `scrollback`, `rightClickBehavior`, `mouseWheelScrollSensitivity`, `fastScrollSensitivity`, `minimumContrastRatio`, `gpuAcceleration`, `unicodeVersion`, `wordSeparators`

  Rationale:
  This is the highest ROI path. It directly improves feel and control without needing protocol work.

- Phase 2: Align runtime behavior and launch environment
  Add:
  `TERM_PROGRAM` strategy closer to editor-hosted terminal semantics
  optional `TERM_PROGRAM_VERSION`
  consistent GPU policy selection instead of simple `webgl2` capability check
  platform-specific right-click and alt-click behavior
  multi-line paste warning behavior

  Rationale:
  This improves behavioral parity and avoids “looks similar but acts differently”.

- Phase 3: Add shell integration architecture
  Add:
  shell-specific injection support for at least `pwsh`, `bash`, `zsh`, `fish`
  nonce-based env injection
  parser-level OSC handlers for VS Code-style command/CWD markers or a project-specific equivalent
  command start/end tracking and exit code capture
  CWD detection and command history metadata
  UI surfaces for command decorations and command-aware actions

  Rationale:
  This is the main gap between “xterm emulator” and “VS Code terminal experience”.

### Suggested First Breaking-Change Slice
- Expand `AppSettings` terminal model to include the Phase 1 settings.
- Replace hardcoded xterm runtime defaults with a normalized terminal-settings object.
- Change current default `cursorBlink: true` to VS Code-like default `false`.
- Add platform-aware right click behavior abstraction instead of fixed `rightClickSelectsWord`.
- Add `gpuAcceleration` policy and map it to addon selection rather than “if webgl2 exists then load WebGL”.
- Add tests for settings normalization, store hydration, settings UI, and runtime option mapping.

### Risks / Unknowns
- [!] “VS Code-level simulation” cannot be achieved by xterm option tuning alone; shell integration is a large architectural gap.
- [!] Some VS Code capabilities depend on internal services and UI surfaces not yet present here, so exact parity is not just a terminal component task.
- [!] `TERM_PROGRAM='xterm.js'` is technically fine today, but if the goal is behavioral mimicry rather than factual reporting, env strategy should be revisited deliberately.
- [?] Whether to emulate VS Code’s exact OSC protocol or define a project-local protocol depends on long-term interoperability goals.
- [?] Some VS Code defaults are platform-dependent or tied to editor-wide settings like font family and multi-cursor modifier, so a direct literal port may not be the right product choice for every setting.

## Context Handoff: VS Code terminal parity

Start here: `research/2026-05-05-vscode-terminal-parity-research.md`

Context only. Use the saved report as the source of truth.
