# Vibecoding Product Completion Execution Plan

> For this repository, execution stays inline in the current session and follows the architecture contracts in `docs/architecture/*` and the master plan in `docs/plans/product-completion-master-plan.md`.

## Goal

Take the repository from the current minimal single-workspace local-shell skeleton to a product-complete desktop runtime with a real provider contract, canonical state events, recovery, concurrent workspaces, functional renderer workbench, extension registration, and packaging verification.

## Locked Execution Order

1. **Provider + canonical event contract**
2. **Recovery correctness**
3. **Concurrent multi-workspace runtime**
4. **Renderer workbench completion**
5. **White-box extension registration**
6. **Packaging and stability**

This order is mandatory because the renderer is only a projection of backend truth.

## Current Repo Gaps

- `src/extensions/providers/opencode-provider.ts` is only a stub.
- `src/core/webhook-server.ts` accepts unchecked events without authentication or idempotency.
- `src/shared/workspace.ts` still uses a demo event shape instead of the canonical contract.
- `src/core/session-manager.ts` only supports a single default local shell workspace and performs permissive state mutation.
- `src/core/pty-host.ts` hardcodes shell startup instead of accepting provider-built commands.
- `src/main/index.ts` only boots one local shell workspace.
- Renderer currently uses one xterm instance and resets on workspace switch.
- Extension registration and packaging flow are not implemented.

## Execution Phases

### Phase 1: Provider contract + state contract

**Files expected to change**

- `src/shared/workspace.ts`
- `src/extensions/providers/opencode-provider.ts`
- `src/extensions/providers/*`
- `src/core/webhook-server.ts`
- `src/core/session-manager.ts`
- `src/core/pty-host.ts`
- `src/main/index.ts`
- `src/core/session-manager.test.ts`
- add targeted provider/webhook/runtime tests as needed

**Required outcomes**

- Canonical snake_case event envelope is the only accepted state event format.
- Session manager enforces legal workspace transitions and event deduplication.
- Webhook server is loopback-only and validates workspace secret.
- Provider layer supports start/resume command generation, sidecar installation, and session-id extraction.
- Local shell provider remains as an honest fallback when structured events are unavailable.

**Verification**

- `npx pnpm test`
- `npx pnpm typecheck`
- `npx pnpm build`
- manual webhook POST verification and real runtime launch

### Phase 2: Recovery completion

**Required outcomes**

- Persist only recovery-critical fields.
- Filter missing workspace paths on startup.
- Attempt resume when provider supports it.
- Degrade to `needs_confirmation` when resume is impossible.
- Preserve provisional state until fresh events arrive.
- Handle corrupt state file with safe fallback.

### Phase 3: Multi-workspace runtime

**Required outcomes**

- Multiple workspaces can exist concurrently.
- Main process manages one PTY/provider runtime per workspace.
- Active workspace input routing is explicit.
- Workspace switching does not destroy other terminal sessions.

### Phase 4: Renderer completion

**Required outcomes**

- Sidebar reflects full workspace state semantics.
- Main terminal area supports live switching and reconnect feedback.
- Recovery/degraded/error/needs_confirmation states are visible.
- UI remains simple and replaceable.

### Phase 5: Extension model

**Required outcomes**

- Provider registry resolves trusted provider modules.
- Panel registry exposes read-only projection surfaces for renderer extensions.
- Extensions cannot become a second source of truth.

### Phase 6: Packaging and stability

**Required outcomes**

- Electron packaging config exists.
- `node-pty` rebuild/native handling is documented and wired.
- Logging and failure snapshots exist.
- Windows packaging path is exercised and validated.

## Execution Rules

- Backend truth before renderer mapping.
- TDD for every behavior change.
- Vue-related work must load `vue-best-practices` and `test-driven-development` before editing renderer files.
- Each major phase ends with test, typecheck, build, and manual runtime evidence.
