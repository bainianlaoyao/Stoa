---
date: 2026-05-05
topic: terminal-emulator-embedding-research
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Embeddable Terminal Emulators for Electron

### Why This Was Gathered
Evaluating terminal emulator solutions to replace/improve current xterm.js + node-pty approach in an Electron app, targeting VS Code terminal parity.

### Summary
No Rust-based terminal emulator (Ghostty, WezTerm, Alacritty, Kitty) provides an embeddable library suitable for Electron. Zed ships the most mature open-source terminal at 38k stars, but its terminal is tightly coupled to Zed's GPUI framework. VS Code shell integration via xterm.js addon is the closest to a reusable reference. Tabby is a full Electron app with modular components but not a library.

### Key Findings

#### 1. Ghostty — BEST EMBEDDABILITY CANDIDATE
- **GitHub**: https://github.com/mitchellh/ghostty (49.5k stars, Zig)
- **Embeddable**: YES — `libghostty` is a C-ABI compatible library for embedding
- **Shell Integration**: Partial via libghostty-vt (VT parsing), but NO built-in shell integration sequences
- **Electron**: Possible via native module + C bridge, but significant complexity
- **Status**: libghostty API not yet stable for general use; examples exist in C and Zig

**Evidence**: Ghostty docs state "libghostty is a cross-platform, zero-dependency C and Zig library for building terminal emulators or utilizing terminal functionality... Anyone can use libghostty to build a terminal emulator or embed a terminal into their own applications." (https://github.com/mitchellh/ghostty)

#### 2. Zed Editor Terminal — STRONGEST TERMINAL, NOT EXTRACTABLE
- **GitHub**: https://github.com/zed-industries/zed (38.2k stars, Rust)
- **Embeddable**: NO — terminal is tightly integrated with GPUI framework
- **Shell Integration**: YES — full OSC 133/633/iTerm2 support, command detection, cwd tracking, PromptInputModel
- **Electron**: Not applicable (Rust/WGPU native app)
- **Key insight**: Zed uses `alacritty_terminal` crate (0.25.x) as backend with custom GPUI rendering. The shell integration addon at `crates/terminal/src/` is Zed-specific.

**Evidence**: Zed terminal view at `crates/terminal_view/src/terminal_view.rs` shows deep GPUI integration. Shell integration parsed via `ShellIntegrationAddon` reading OSC 133/633 sequences (https://github.com/zed-industries/zed)

#### 3. WezTerm — POPULAR BUT NOT EMBEDDABLE
- **GitHub**: https://github.com/wez/wezterm (14k stars, Rust)
- **Embeddable**: NO — issue #802 explicitly rejected embedding; issue #6020 for library embedding also rejected
- **Shell Integration**: YES — termwiz crate provides rich terminal abstractions
- **Electron**: Would require significant native module work
- **Note**: Wez discussed publishing `wezterm-term` crate but has reservations about API stability

**Evidence**: Wezterm issue #802: "I have no plans to do this myself" regarding embed feature. Issue #6020 confirms no library embedding planned (https://github.com/wez/wezterm/issues/6020)

#### 4. Alacritty — NO EMBEDDABILITY
- **GitHub**: https://github.com/alacritty/alacritty (33k stars, Rust)
- **Embeddable**: NO — only as inspiration; `iced_term` and `egui_term` are third-party attempts
- **Shell Integration**: No
- **Note**: Zed terminal is effectively the best Alacritty-based reference implementation

#### 5. Kitty — NO EMBEDDABILITY
- **GitHub**: https://github.com/kovidgoyal/kitty (26k stars, Rust + Python)
- **Embeddable**: NO — only remote control API, kitten system; XEmbed rejected as out-of-scope
- **Shell Integration**: Strong via OSC 133/633 but not designed for embedding

**Evidence**: Kitty issue #7083 (XEmbed support) was rejected; maintainer stated "you can run an editor GTK interface inside kitty directly" but not as embeddable library (https://github.com/kovidgoyal/kitty/issues/7083)

#### 6. iced_term — EXPERIMENTAL EMBEDDABLE ATTEMPT
- **GitHub**: https://github.com/Harzu/iced_term (158 stars, Rust)
- **Embeddable**: YES (unstable API) — terminal widget using alacritty_terminal + iced framework
- **Shell Integration**: No
- **Status**: Actively developed (0.8.0 released 2026-03-27) but unstable API, missing full features
- **Not recommended** for production without major work

#### 7. Tabby (Eugeny) — ELECTRON-NATIVE, MOST RELEVANT
- **GitHub**: https://github.com/Eugeny/tabby (25k+ stars, TypeScript/Electron)
- **Embeddable**: PARTIAL — `tabby-core` provides modular services; `tabby-electron` is the Electron app
- **Shell Integration**: VT220 terminal + extensions, progress detection, notification on completion
- **Electron**: YES — built on Electron, shares architecture with target use case
- **Key insight**: Tabby is itself an Electron terminal app; its components (terminal, tabs, settings) are Angular modules, not a library

**Evidence**: Tabby core at `tabby-core` provides AppService, TabContextMenuItemProvider, settings plugin API, terminal plugin API (https://github.com/Eugeny/tabby/tree/master/tabby-core)

#### 8. Lapce Terminal — NOT EXTRACTABLE
- **GitHub**: https://github.com/lapce/lapce (38k stars, Rust + Floem)
- **Embeddable**: NO — terminal is built into lapce-app, uses Floem GUI framework
- **Shell Integration**: Basic terminal profiles only, experimental
- **Note**: Pure Rust, but architecture not designed for extraction

#### 9. xterm.js Shell Integration — THE PRACTICAL PATH
- **Source**: VS Code (https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/common/xterm/shellIntegrationAddon.ts)
- **Type**: Reference implementation — OSC 133/633/iTerm2 sequence parsing, command detection, PromptInputModel
- **Reusability**: Could be adapted as a standalone xterm.js addon
- **Status**: xterm.js core maintainers explicitly said shell integration is "out of scope" for the library (issue #5807)
- **Community**: No widely-adopted shell integration addon exists beyond VS Code's implementation

**Evidence**: xterm.js issue #5807: "Shell integration is out of scope of the lib imo... have a persistence layer if reconnecting, etc. It makes sense to have this live outside." (https://github.com/xtermjs/xterm.js/issues/5807)

#### 10. xterm.js Addon Ecosystem — LIMITED
- **Official addons**: fit, clipboard, search, unicode, webgl, serialize, fit
- **Community**: Sparse; `xterm-js-shell` (RangerMauve) provides CLI environment building blocks but not shell integration
- **@nicely_de/xterm-addon-shell-integration**: Not found in search
- **Reality**: VS Code's `ShellIntegrationAddon` is the de facto standard for shell integration in xterm.js

### Evidence Chain

| Finding | Source |
|---------|--------|
| Ghostty libghostty embeddable | https://ghostty.org/docs/about + https://www.mintlify.com/ghostty-org/ghostty/api/embedding |
| Zed terminal architecture (alacritty + GPUI) | https://deepwiki.com/zed-industries/zed/12.1-provider-architecture-and-abstractions |
| Zed shell integration addon | https://github.com/zed-industries/zed/blob/79b9cae2/crates/terminal/src/terminal.rs |
| WezTerm no embedding plan | https://github.com/wez/wezterm/issues/6020 + https://github.com/wez/wezterm/issues/802 |
| Kitty XEmbed rejected | https://github.com/kovidgoyal/kitty/issues/7083 |
| iced_term experimental | https://crates.io/crates/iced_term |
| Tabby core modules | https://github.com/Eugeny/tabby/tree/master/tabby-core |
| xterm.js shell integration out of scope | https://github.com/xtermjs/xterm.js/issues/5807 |
| VS Code shell integration addon | https://github.com/microsoft/vscode/blob/4c055a03/src/vs/platform/terminal/common/xterm/shellIntegrationAddon.ts |

### Risks / Unknowns

- [!] **No embeddable terminal library found** — all mature terminals are standalone apps
- [!] **Ghostty libghostty still unstable** — API may change, not production-ready
- [?] **Could Zed terminal be extracted?** — Deep coupling to GPUI makes extraction high-effort
- [?] **xterm.js shell integration addon existence** — `@nicely_de/xterm-addon-shell-integration` could not be verified; VS Code implementation may be the only reference
