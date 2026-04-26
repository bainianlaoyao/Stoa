<p align="center">
  <img src="docs/assets/readme/stoa-icon.png" alt="Stoa" width="96" height="96">
</p>

# Stoa

[中文版](README.md)

Stoa is a fully open-source local workspace for AI-powered development.

It gives developers a clean, focused desktop console for managing multiple projects, multiple agents, and multiple CLI sessions. Its core paths are maintained by nearly one thousand tests, with the goal of turning AI CLI workflows from temporary terminal sessions into a stable, recoverable, production-grade experience.

## Screenshots

![Claude Code session running in Stoa](docs/assets/readme/stoa-claude-code-session.png)

_Run Claude Code inside Stoa while keeping session state, workspace navigation, and terminal context in one local console._

![OpenCode session running in Stoa](docs/assets/readme/stoa-opencode-session.png)

_OpenCode sessions connect through the same provider model and can be managed alongside other CLI agents._

## Why Stoa

### Stability Guarded by Nearly One Thousand Tests

Stoa is not a concept-only demo. The project uses unit tests, integration tests, Electron E2E tests, generated Playwright journeys, and behavior coverage checks to protect the core workflow and push multi-session AI development toward a production-grade desktop experience.

### Clean, Focused UI

Stoa does not try to replace your IDE, and it does not stack unnecessary panels. The interface is built around one primary workflow: manage workspaces and session state on the left, focus on the terminal on the right. You can move across projects and agent sessions without letting the UI become the work.

### Multiple CLI Tools

Stoa connects to AI CLI tools through providers instead of hardcoding a single vendor or command. Codex, Claude, OpenCode, and other CLI tools can act as session backends inside the Stoa workspace.

### Fully Open Source

The desktop shell, state management, provider integration model, behavior assets, and test system are all open in this repository. You can inspect how Stoa manages sessions, restores state, hosts terminals, and coordinates provider workflows, or adapt it to your own AI CLI setup.

### Local-First Session Orchestration

Stoa is a local desktop application, not a cloud platform. It organizes projects, hosts terminals, manages session state, and coordinates recovery on your machine. Network access, authentication, and model usage still belong to the individual CLI tools you choose to run.

## Problems Stoa Solves

- Manage multiple projects, workspaces, and AI CLI sessions in one local console.
- Keep terminal sessions alive while switching workspaces.
- Reduce the risk of losing context during long-running AI development work.
- Use structured status channels for agent state instead of guessing from terminal text.
- Bring scattered AI terminal windows into a stable, recoverable desktop workflow.
- Provide a verifiable foundation for long-running, multi-task, concurrent AI development.

## What It Can Do Today

- Create, switch, and manage workspaces.
- Host real CLI terminal sessions inside the desktop app.
- Keep background sessions running to reduce interruption during context switches.
- Display states such as running, waiting for input, error, and recoverable through a side-channel status model.
- Connect different AI CLI tools through a provider model.
- Verify key journeys with generated Playwright paths, behavior coverage, and Electron E2E tests.

## Coming Soon: Project-Level Auto Evolution

Stoa's next major direction is to make the project itself a continuously evolving system.

The project-level auto evolution workflow is intended to connect requirement understanding, plan generation, implementation, test verification, behavior asset updates, and regression checks into one loop. The goal is not simply to let AI edit code, but to make every change pass through context understanding, plan constraints, automatic verification, and durable project memory so the project becomes more stable and clearer over time.

## Quick Start

### Download the App

Download the installer for your platform from [GitHub Releases](../../releases):

- Windows: download the `.exe` installer
- macOS: download the `.dmg` or `.zip` installer
- Linux: download the `.AppImage` or distribution-specific package

After installation, start Stoa, add a workspace, and create an AI CLI session.

## CLI Tool Requirements

Stoa manages workspaces, session state, and terminal containers. The actual AI capabilities come from the CLI tools installed on your machine.

Before using a provider, install and sign in to the corresponding CLI:

- Claude Code
- OpenCode
- Codex

If Stoa cannot detect a CLI executable automatically, configure its executable path manually in the Providers settings page.

## Supported Platforms

Stoa is built with Electron and targets Windows, macOS, and Linux.

Current development and screenshots are primarily based on Windows. Other platform installers are published and verified as part of the release flow.

## Basic Usage

1. Start Stoa.
2. Add or select a workspace.
3. Create an AI CLI session inside the workspace.
4. Work with the CLI agent in the terminal on the right.
5. Switch projects and sessions from the workspace list on the left.
6. Use the session status indicators to understand whether a session is running, waiting for input, failed, or recoverable.

## Project Status

Stoa is still evolving quickly at the API and product-shape level; the core usage paths are maintained with a production-grade stability target.

At this stage, improvements are allowed to be breaking changes by default. The project does not maintain compatibility migration logic during prototyping. The priority is to keep the product direction, architecture boundaries, test system, and user experience correct.

## Documentation

- [Vision and Principles](docs/overview/vision-and-principles.md)
- [System Architecture](docs/architecture/system-architecture.md)
- [Workspace Console UX](docs/product/workspace-console-ux.md)
- [Repository Layout](docs/engineering/repository-layout.md)
- [Design Language](docs/engineering/design-language.md)
- [Local Development Environment](docs/engineering/local-dev-environment.md)
- [State Storage and Recovery](docs/operations/state-storage-and-recovery.md)
- [Release and Update Runbook](docs/operations/release-and-update-runbook.md)

## Contributing and Quality Gate

The package manager is pnpm. The quality gate below intentionally keeps the repository's current `npm run` / `npx` command form as the verification entrypoint.

### Development Requirements

- Node.js 24 or a compatible version
- pnpm 10.33.0
- A local desktop environment that supports Electron

### Local Development

```bash
pnpm install
pnpm run dev
```

### Build

```bash
pnpm run build
```

Generated test assets are part of the project behavior contract. Do not manually edit files under `tests/generated/`.

Before verifying an implementation change, regenerate deterministic test assets:

```bash
npm run test:generate
```

Full quality gate:

```bash
npm run test:generate
npm run typecheck
npx vitest run
npm run test:e2e
npm run test:behavior-coverage
```

One-shot verification:

```bash
npm run test:all
```

When adding user-visible behavior, you usually need to update:

- `testing/behavior/`
- `testing/topology/`
- `testing/journeys/`

Then run `npm run test:generate` to regenerate Playwright journeys.

## Technical Architecture

Stoa uses Electron as the local desktop shell. The main process owns real state and process coordination, while the Vue renderer maps state to UI and forwards user intent.

Core stack:

- Electron
- Vue 3
- Pinia
- xterm.js
- node-pty
- Express webhook server
- TypeScript
- Vitest
- Playwright

Core architecture boundaries:

- The renderer does not own real session control.
- `node-pty` only lives in the main process or controlled backend modules.
- Terminal character streams are for humans to read, not for the system to infer state from.
- Agent lifecycle, tool calls, error signals, and session pointers should flow through structured side channels.
- Providers integrate through explicit capability contracts, instead of hardcoding one CLI's behavior into the UI.

## License

This repository has not declared a formal license yet. Check the future `LICENSE` file before using, redistributing, or building derivative work from the project.
