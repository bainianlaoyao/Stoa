---
date: 2026-05-24
topic: product-positioning-brief
status: completed
mode: context-gathering
sources: 14
---

## Context Report: Stoa Product-Positioning Brief for Community Outreach

### Why This Was Gathered

Manual community outreach (forums, social media, developer communities) needs a grounded, factual positioning brief derived from repo-local evidence only — no marketing invention.

### Summary

**Stoa** is a local-first Electron desktop workbench that unifies multiple AI CLI agents (Claude Code, Codex, OpenCode) into a single multi-workspace terminal console. At version 0.3.0, it is in active prototype stage (Phase 4–5 of 5-phase roadmap). It solves the chaos of managing proliferating AI CLI sessions across multiple projects by providing structured state tracking, session resumption, and a dual-channel architecture that never relies on terminal output parsing.

### Key Findings

#### 1. What the Product Is

Stoa is a local AI programming workbench ("本地编程工作台" / "本地调度台"). It is **not** an IDE, cloud platform, or chat UI. It is a desktop container that hosts real AI CLI processes inside managed PTY terminals and provides workspace-level orchestration. The product name is **Stoa** (`package.json` name field), currently at **v0.3.0**, licensed Apache-2.0.

#### 2. Current Prototype Status

- Roadmap defines 5 phases. Docs indicate the project is between **Phase 4 (white-box extensions and panels)** and **Phase 5 (packaging and stability)**.
- Phase 0–3 are architecturally complete: dual-channel pipeline, multi-workspace switching, session resumption, state persistence all implemented.
- Phase 4 is active: provider extensions for Claude Code, Codex, OpenCode, and local shell exist with sidecar injection and hook event adapters.
- Phase 5 is in progress: Windows/macOS/Linux packaging scripts exist (`package:win`, `package:mac`, `package:linux`), electron-updater integrated, auto-update support added.
- Active X/Twitter promotion pipeline (`src/core/promo/`) is being built, indicating the project is approaching public visibility.

#### 3. Target Users

Developers who:
- Actively use AI CLI tools (Claude Code, Codex, OpenCode) for daily programming
- Work across multiple projects simultaneously
- Need to keep multiple AI agent sessions alive in parallel
- Value local-first tools over cloud platforms
- Prefer deterministic, testable software ("近千个测试守住核心路径")
- Use vibe-coding / AI-augmented development workflows

#### 4. Key Workflows

1. **Multi-workspace management**: Left-rail card list for projects, right-side xterm.js terminal view. Click-to-switch with zero-buffer-loss (PTY kept alive in background).
2. **Session creation**: Select local project path → system creates workspace → spawns PTY + CLI → injects hook sidecar → binds terminal view.
3. **Session resumption ("resurrection")**: On app restart, reads persisted `last_cli_session_id` per workspace → re-spawns CLI with session pointer → CLI restores its own context.
4. **State event pipeline**: CLI hooks fire structured JSON events → Express webhook receives them → Session Manager synthesizes state → IPC pushes to Pinia → UI updates status lights/summaries.
5. **Provider-agnostic switching**: Same workspace console supports Claude Code, Codex, OpenCode, or plain shell, each with provider-specific command building, sidecar injection, and event adaptation.

#### 5. Core Pain Points Solved

| Pain Point | Stoa's Solution |
|---|---|
| AI CLI sessions multiply and become unmanageable across projects | Multi-workspace console with persistent cards and status lights |
| Terminal state guessed by parsing stdout (fragile, brittle) | Dual-channel architecture: visual stream + separate structured state channel via hooks |
| Session state lost on app restart | Session resumption using CLI-native session IDs (`last_cli_session_id`) |
| No unified view across different AI CLI tools | Provider model: Claude Code, Codex, OpenCode, local shell all managed in one console |
| Switching between projects/tabs kills terminal buffers | Background PTY instances stay alive; only view visibility toggles |
| Agent internal state invisible to GUI | Hook sidecars capture structured events (tool calls, errors, thinking) and relay via webhook |

#### 6. Distinctive UI / Design-Language Traits

- **Modern Minimalist Glassmorphism + Clean UI**: Influenced by macOS, visionOS, premium SaaS aesthetics. Uses transparency, blur (`backdrop-filter: blur(40px)`), subtle shadows, and restrained accents — not heavy borders or noisy visual treatment.
- **Design-token-driven**: All colors, shadows, radii drawn from shared CSS variables (`--canvas`, `--surface`, `--surface-solid`, `--text-strong`, `--text`, `--muted`, `--accent`, `--line`).
- **Binary layout**: Left workspace console + right terminal viewport. No complex multi-panel IDE layout.
- **Z-axis hierarchy**: Layering through transparency/blur/shadow rather than thick borders.
- **Restrained micro-interactions**: Subtle hover transparency changes, smooth 0.2s ease transitions, no decorative animation.
- **Strict font discipline**: UI font (`--font-ui`) for navigation/labels, mono font (`--font-mono`) for terminal/logs/paths/code.
- **"Dumb UI, smart backend"**: Renderer only mirrors state; all real control lives in Electron main process.

#### 7. Architectural Differentiators (for technical communities)

- **Dual-channel model**: Visual channel (PTY → xterm.js) and state channel (hooks → webhook → Session Manager → IPC → Pinia) are fully separated. No terminal output parsing.
- **White-box extensions**: Not a sandboxed plugin system. Extensions run inside the main process with shared state access, optimized for internal velocity over third-party ecosystem.
- **Provider capability contract**: Three-tier model (Level 0: no resume, Level 1: resume only, Level 2: full contract). Honest degradation — never fakes state.
- **Near-thousand test suite**: Four-tier test architecture (unit, E2E integration, generated contract/journey assets, config guard static analysis). Includes real Playwright Electron E2E journeys.
- **Bilingual (zh/en)**: Vue I18n integrated; promotion copy targets both Chinese and English-speaking communities.

#### 8. High-Signal Search Keywords for Community Outreach

| # | Keyword / Phrase | Intended Community |
|---|---|---|
| 1 | `AI CLI workbench` | General developer tools |
| 2 | `Claude Code desktop` | Claude Code users |
| 3 | `Codex CLI desktop manager` | Codex/OpenAI users |
| 4 | `multi-agent terminal` | AI agent orchestration |
| 5 | `vibe coding tool` | Vibecoding community |
| 6 | `AI coding session management` | Developer productivity |
| 7 | `Electron terminal manager` | Electron/desktop app community |
| 8 | `local AI programming workbench` | Local-first / privacy-focused devs |
| 9 | `AI CLI session resumption` | Developer workflow automation |
| 10 | `structured terminal state` | Developer tooling / observability |
| 11 | `open source AI coding console` | Open source community |
| 12 | `多Agent编程工具` (multi-agent programming tool) | Chinese developer community |

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Product name "stoa", version 0.3.0, Apache-2.0 | package.json | `package.json:2-6` |
| Vision: local dispatch console for AI concurrent programming | vision-and-principles.md | `docs/overview/vision-and-principles.md:5-11` |
| Three core pain points (session loss, UI interruption, dirty state parsing) | vision-and-principles.md | `docs/overview/vision-and-principles.md:8-11` |
| Design direction: Modern Minimalist Glassmorphism | design-language.md | `docs/engineering/design-language.md:9-14` |
| Dual-channel architecture definition | dual-channel-model.md | `docs/architecture/dual-channel-model.md:5-10` |
| 5-phase roadmap (Phase 0–5) | roadmap.md | `docs/overview/roadmap.md:1-25` |
| Binary layout: left workspace console + right terminal | workspace-console-ux.md | `docs/product/workspace-console-ux.md:4-6` |
| Provider extensions: Claude Code, Codex, OpenCode, local shell | file listing | `src/extensions/providers/*.ts` |
| Provider capability contract (Level 0–2) | provider-capability-contract.md | `docs/architecture/provider-capability-contract.md:24-37` |
| Promotion copy targeting WeChat circles and LINUX DO | promotion-copy.md | `docs/product/promotion-copy.md:1-95` |
| Tech stack: Electron + Vue 3 + Pinia + node-pty + xterm.js + Express + TypeScript | tech-stack-rationale.md | `docs/engineering/tech-stack-rationale.md:1-25` |
| Hook signal chain: 4 provider paths + shared downstream | hook-signal-chain.md | `docs/architecture/hook-signal-chain.md:9-32` |
| Design tokens: --canvas, --surface, --text-strong, --accent, etc. | design-language.md | `docs/engineering/design-language.md:21-37` |
| White-box extension model (not sandboxed plugins) | extension-model.md | `docs/architecture/extension-model.md:6-10` |

### Risks / Unknowns

- [!] **Prototype stage**: v0.3.0 with known gaps (e.g., Codex interactive PTY submit on Windows not reliable; Claude Code and OpenCode lack live CLI capture verification per `hook-signal-chain.md:399-401`).
- [!] **No README found**: The repo root has no README.md (not in glob results for top-level *.md), which could hinder organic discovery.
- [?] **Release cadence and distribution**: Auto-update is integrated (electron-updater) but no public release cadence is documented.
- [?] **Community traction**: X/Twitter promotion pipeline exists in code but no evidence of existing community engagement metrics.
- [?] **Internationalization coverage**: Vue I18n is a dependency but the depth of non-Chinese locale coverage is not visible from this research scope.
