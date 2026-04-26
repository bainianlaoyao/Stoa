---
date: 2026-04-27
topic: cross-platform compatibility
status: completed
mode: context-gathering
sources: 18
---

## Context Report: Cross-Platform Compatibility

### Why This Was Gathered
The project currently packages only Windows builds, but the runtime should be checked for macOS/Linux blockers before adding `electron-builder` targets.

### Summary
Runtime compatibility looks generally reasonable: shell detection, provider lookup, VS Code detection, shell wrapping, terminal rendering, and Electron window lifecycle all have platform-aware logic. The main blockers are packaging/release automation, native dependency rebuild handling for `node-pty`, and one behavior mismatch where local shell sessions ignore the detected/configured shell path.

### Key Findings
- Packaging is Windows-only: `electron-builder.yml` defines only `win` targets (`nsis` and portable x64), and no `mac` or `linux` section exists.
- Release verification and packaged smoke scripts are hardcoded to Windows artifacts (`win-unpacked`, `.exe`, `latest.yml`, NSIS installer/blockmap).
- `node-pty` is unpacked from asar, but `npmRebuild` is disabled and the rebuild script is only a placeholder. This is the main native-module risk for macOS/Linux packaging.
- Runtime shell/provider detection is already platform-aware: Windows uses COMSPEC/PowerShell/where, Unix-like systems use `$SHELL`, common POSIX shells, `which`, and macOS/Linux VS Code candidate paths.
- External agent providers are mostly cross-platform because they emit executable names (`opencode`, `codex`, `claude`) or configured paths, and session runtime wraps providers through the detected/configured shell when the descriptor asks for wrapping.
- Local shell sessions do not use the detected/configured shell path. The main process resolves `shellPath`, but `local-shell` always returns `powershell.exe` on Windows and `bash` elsewhere, while the descriptor explicitly disables shell wrapping.
- VS Code workspace opening is mostly cross-platform because it uses Electron `shell.openPath` for file-manager opening and platform-aware VS Code detection, but the hardcoded fallback candidate list still includes `code.cmd` on non-Windows after detection fails.
- macOS app lifecycle is handled correctly enough for baseline Electron behavior: closing all windows quits only when `process.platform !== 'darwin'`.
- Test fixtures mostly account for Windows vs POSIX commands. The targeted compatibility test subset passed on the current Windows environment.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Electron Builder config only defines `win` targets. | electron-builder.yml | lines 15-25 |
| Native module is unpacked from asar. | electron-builder.yml | lines 8-9 |
| Package rebuild is disabled. | electron-builder.yml | line 26 |
| Release verification expects `release/win-unpacked/Stoa.exe`. | scripts/verify-packaging-baseline.mjs | lines 4-7 |
| Release verification requires `.exe` installer and NSIS-style blockmap. | scripts/verify-packaging-baseline.mjs | lines 30-65 |
| Packaged smoke script only searches `release/win-unpacked` and `.exe`. | scripts/smoke-packaged-release.mjs | lines 7-75 |
| Packaged smoke has only child termination branching, not artifact resolution branching. | scripts/smoke-packaged-release.mjs | lines 78-96 |
| `node-pty` rebuild script is a placeholder. | scripts/rebuild-node-pty.mjs | line 1 |
| Shell detection uses Windows COMSPEC/PowerShell and POSIX `$SHELL` / `/bin/*` fallbacks. | src/core/settings-detector.ts | lines 31-52 |
| Provider detection uses `.cmd` and Windows paths on Windows, Unix common paths and shell/which lookup elsewhere. | src/core/settings-detector.ts | lines 54-80 |
| VS Code detection has Windows, macOS, and Linux candidate sets. | src/core/settings-detector.ts | lines 83-99 |
| Shell wrapping supports PowerShell, cmd, and POSIX shells. | src/core/shell-command.ts | lines 3-99 |
| Session runtime wraps opencode/codex through `shellPath` when provider descriptors ask for it. | src/core/session-runtime.ts | lines 98-101 |
| Provider descriptors wrap opencode/codex, not local shell or claude-code. | src/shared/provider-descriptors.ts | lines 15-59 |
| Main process resolves detected/configured shell and provider paths before launch. | src/main/index.ts | lines 473-501 |
| Local shell provider ignores shellPath and defaults to `bash` outside Windows. | src/extensions/providers/local-shell-provider.ts | lines 4-14 |
| Workspace launcher validates directories, uses file-manager `shellOpenPath`, and launches VS Code with detected/configured executable. | src/core/workspace-launcher.ts | lines 69-121 |
| Renderer xterm enables Windows PTY options only on `win32`. | src/renderer/terminal/xterm-runtime.ts | lines 51-57 and 142-157 |
| macOS close behavior is handled with the standard `window-all-closed` guard. | src/main/index.ts | lines 917-920 |

### Verification
- Ran: `npx vitest run src/core/settings-detector.test.ts src/core/shell-command.test.ts src/core/workspace-launcher.test.ts src/core/session-runtime.test.ts src/renderer/terminal/xterm-runtime.test.ts tests/e2e/session-runtime-lifecycle.test.ts tests/e2e/store-lifecycle-sync.test.ts`
- Result: 7 test files passed, 75 tests passed.
- Note: after Vitest reported success, `node-pty` printed a Windows `AttachConsole failed` stack from `conpty_console_list_agent.js`; the command exit code was still 0.

### Risks / Unknowns
- [!] macOS/Linux package artifacts will not pass current verification/smoke scripts until those scripts branch by platform.
- [!] `node-pty` must be rebuilt or installed for the Electron ABI per platform/arch; current config disables rebuild and the rebuild script is a placeholder.
- [!] Local shell sessions on macOS/Linux always try `bash` rather than the detected/configured shell, which is likely acceptable on common distros but is inconsistent with the settings model and weaker on systems without Bash.
- [?] No macOS/Linux runner was used in this pass, so POSIX behavior is inferred from code and existing tests rather than executed on those platforms.

## Context Handoff: Cross-Platform Compatibility

Start here: `research/2026-04-27-cross-platform-compatibility.md`

Context only. Use the saved report as the source of truth.
