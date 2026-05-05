---
date: 2026-05-05
topic: vscode-terminal-stack
status: completed
mode: context-gathering
sources: 9
---

## Context Report: VS Code terminal stack vs current project

### Why This Was Gathered
To verify whether VS Code's integrated terminal is, at a high level, using essentially the same stack as this project's Windows terminal path.

### Summary
Yes at the high level, but the precise statement should be: both are broadly `xterm.js` on the renderer side plus `node-pty` on the backend, and on Windows that backend uses ConPTY. So "basically equivalent" is fair if you mean the core terminal-emulation and PTY layers.

The part that is not precise is saying the current project is directly `ConPTY + xterm.js`. In this repo the backend is `node-pty`, not a direct ConPTY binding. VS Code is also not just those two pieces; it adds a dedicated pty host layer and shell-integration features around them.

### Key Findings
- This project depends on `@xterm/xterm` and `node-pty`.
- This project's PTY backend is created through `node-pty.spawn(...)`, not a direct ConPTY API call.
- This project's xterm runtime marks Windows PTY metadata as `backend: 'conpty'`.
- VS Code currently depends on both `@xterm/xterm` and `node-pty`.
- VS Code's terminal frontend imports `@xterm/xterm`.
- VS Code's terminal backend imports `spawn` from `node-pty`.
- VS Code enables ConPTY on Windows builds that support it and reports the Windows PTY backend as `conpty`.
- VS Code's own terminal wiki describes terminal dependencies as `xterm.js`, `node-pty`, and `conpty`.
- VS Code has additional terminal layers beyond the core pair, including a dedicated pty host service.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Project depends on xterm.js and node-pty | local package.json | `package.json:39-50` |
| Project spawns backend PTY via node-pty | local source | `src/core/pty-host.ts:1-23` |
| Project labels Windows PTY backend as conpty in xterm runtime | local source | `src/renderer/terminal/xterm-runtime.ts:154-185` |
| VS Code package currently includes xterm and node-pty | VS Code repo package.json | https://github.com/microsoft/vscode/blob/main/package.json#L128-L138 |
| VS Code terminal frontend imports xterm | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts#L6 |
| VS Code terminal backend imports and uses node-pty spawn | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/terminalProcess.ts#L22 and https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/terminalProcess.ts#L315 |
| VS Code enables ConPTY on supported Windows builds | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/terminalProcess.ts#L158-L170 |
| VS Code reports Windows PTY backend as conpty | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/terminalProcess.ts#L645-L646 |
| VS Code official wiki names xterm.js, node-pty, conpty as terminal dependencies | VS Code wiki | https://github.com/microsoft/vscode/wiki/Terminal-Issues |
| VS Code has a dedicated pty host service | VS Code source | https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/ptyHostService.ts#L33 |
| node-pty README says it powers VS Code and uses Windows ConPTY | node-pty README | https://github.com/microsoft/node-pty |

### Risks / Unknowns
- [!] Saying "ConPTY + xterm.js" is directionally right but skips the `node-pty` abstraction layer, which is important technically.
- [!] "Basically equivalent" only holds for the core terminal transport/emulation path, not for all terminal features and process architecture.
- [?] If someone means remote terminals, browser-only terminals, or extension-provided pseudo terminals, VS Code's picture becomes broader than this comparison.
