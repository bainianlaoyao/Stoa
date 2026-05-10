# Hook Lease-Driven Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stale-port workspace hooks with a lease-driven late-bound dispatch architecture for Claude Code, Codex, and OpenCode.

**Architecture:** STOA owns session-scoped hook leases under a shared runtime root, while workspaces contain only stable hook entrypoints plus a shared dispatcher artifact. Provider runtimes receive a lease pointer and managed-session markers; every hook invocation resolves routing and auth from the current lease at dispatch time.

**Tech Stack:** TypeScript, Node.js, Electron main process, Vitest, Playwright/E2E, filesystem-backed runtime coordination.

---

## File Map

- Create: `src/main/stoa-runtime-root.ts`
- Create: `src/main/stoa-runtime-root.test.ts`
- Create: `src/main/hook-lease-registry.ts`
- Create: `src/main/hook-lease-registry.test.ts`
- Create: `src/main/hook-dispatch-failure-journal.ts`
- Create: `src/main/hook-dispatch-failure-journal.test.ts`
- Create: `src/extensions/providers/shared-hook-dispatch.ts`
- Create: `src/extensions/providers/shared-hook-dispatch.test.ts`
- Modify: `src/shared/project-session.ts`
- Modify: `src/extensions/providers/index.ts`
- Modify: `src/extensions/providers/managed-sidecar-installer.ts`
- Modify: `src/extensions/providers/claude-hook-sidecar.ts`
- Modify: `src/extensions/providers/claude-code-provider.ts`
- Modify: `src/extensions/providers/codex-provider.ts`
- Modify: `src/extensions/providers/opencode-provider.ts`
- Modify: `src/core/webhook-server.ts`
- Modify: `src/core/webhook-server.test.ts`
- Modify: `src/core/webhook-server-validation.test.ts`
- Modify: `src/core/session-runtime.ts`
- Modify: `src/core/session-runtime.test.ts`
- Modify: `src/main/launch-tracked-session-runtime.ts`
- Modify: `src/main/launch-tracked-session-runtime.test.ts`
- Modify: `src/main/session-event-bridge.ts`
- Modify: `src/main/session-event-bridge.test.ts`
- Modify: `src/main/managed-sidecar-maintenance.ts`
- Modify: `src/main/managed-sidecar-maintenance.test.ts`
- Modify: `src/main/index.ts`
- Modify: `tests/e2e/provider-integration.test.ts`

### Task 1: Shared Runtime Root And Lease Registry

**Files:**
- Create: `src/main/stoa-runtime-root.ts`
- Create: `src/main/stoa-runtime-root.test.ts`
- Create: `src/main/hook-lease-registry.ts`
- Create: `src/main/hook-lease-registry.test.ts`

- [ ] **Step 1: Write the failing runtime-root tests**

```ts
import { describe, expect, test } from 'vitest'
import { resolveStoaRuntimeRoot } from './stoa-runtime-root'

describe('resolveStoaRuntimeRoot', () => {
  test('uses LOCALAPPDATA on Windows', () => {
    expect(resolveStoaRuntimeRoot({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:/Users/test/AppData/Local' }
    })).toBe('C:/Users/test/AppData/Local/Stoa/runtime')
  })

  test('uses XDG_STATE_HOME on Linux when present', () => {
    expect(resolveStoaRuntimeRoot({
      platform: 'linux',
      env: { XDG_STATE_HOME: '/home/test/.state', HOME: '/home/test' }
    })).toBe('/home/test/.state/stoa/runtime')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/stoa-runtime-root.test.ts`
Expected: FAIL because `resolveStoaRuntimeRoot()` does not exist yet.

- [ ] **Step 3: Write the failing lease-registry tests**

```ts
import { describe, expect, test } from 'vitest'
import { createHookLeaseRegistry } from './hook-lease-registry'

test('acquire creates a lease with owner generation and secret', async () => {
  const registry = createHookLeaseRegistry({ instanceId: 'instance-a', runtimeRoot: 'D:/tmp/stoa-runtime' })
  const lease = await registry.acquire({
    sessionId: 'session-1',
    projectId: 'project-1',
    provider: 'codex',
    webhookBaseUrl: 'http://127.0.0.1:43127'
  })

  expect(lease.ownerInstanceId).toBe('instance-a')
  expect(lease.provider).toBe('codex')
  expect(lease.generation).toBe(1)
  expect(lease.sessionSecret).toEqual(expect.any(String))
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/main/hook-lease-registry.test.ts`
Expected: FAIL because the registry does not exist yet.

- [ ] **Step 5: Implement runtime-root + registry minimally**

```ts
export function resolveStoaRuntimeRoot(input: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv }): string {
  // platform-specific path derivation with no userData coupling
}

export interface SessionHookLease {
  version: 1
  sessionId: string
  projectId: string
  provider: 'claude-code' | 'codex' | 'opencode'
  leaseState: 'active' | 'released'
  ownerInstanceId: string
  generation: number
  webhookBaseUrl: string
  sessionSecret: string
  createdAt: string
  updatedAt: string
  heartbeatAt: string
  expiresAt: string
  releasedAt?: string
}
```

- [ ] **Step 6: Run focused tests to green**

Run: `npx vitest run src/main/stoa-runtime-root.test.ts src/main/hook-lease-registry.test.ts`
Expected: PASS.

### Task 2: Receiver Authorization And Failure Journal

**Files:**
- Create: `src/main/hook-dispatch-failure-journal.ts`
- Create: `src/main/hook-dispatch-failure-journal.test.ts`
- Modify: `src/core/webhook-server.ts`
- Modify: `src/core/webhook-server.test.ts`
- Modify: `src/core/webhook-server-validation.test.ts`

- [ ] **Step 1: Write the failing auth tests**

```ts
test('rejects hook request when project header does not match active lease project', async () => {
  const response = await postClaudeHook(port, { hook_event_name: 'Stop' }, {
    'x-stoa-session-id': 'session-1',
    'x-stoa-project-id': 'wrong-project',
    'x-stoa-secret': 'lease-secret'
  })

  expect(response.statusCode).toBe(401)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/webhook-server.test.ts src/core/webhook-server-validation.test.ts`
Expected: FAIL because hook auth only checks session-secret lookup today.

- [ ] **Step 3: Write the failing journal tests**

```ts
test('appends a managed delivery failure record with metadata source', async () => {
  await journal.append({
    sessionId: 'session-1',
    projectId: 'project-1',
    ownerInstanceId: 'instance-a',
    generation: 2,
    provider: 'claude-code',
    failureClass: 'target_unreachable',
    metadataSource: 'managed-marker'
  })

  expect(await readFile(journalPath, 'utf8')).toContain('"failureClass":"target_unreachable"')
})
```

- [ ] **Step 4: Implement lease-authoritative auth and journal append**

```ts
interface HookAuthorization {
  ok: boolean
  leaseProjectId?: string
  leaseProvider?: 'claude-code' | 'codex' | 'opencode'
}
```

- [ ] **Step 5: Run focused tests to green**

Run: `npx vitest run src/main/hook-dispatch-failure-journal.test.ts src/core/webhook-server.test.ts src/core/webhook-server-validation.test.ts`
Expected: PASS.

### Task 3: Stable Dispatcher Artifacts And Provider Sidecars

**Files:**
- Create: `src/extensions/providers/shared-hook-dispatch.ts`
- Create: `src/extensions/providers/shared-hook-dispatch.test.ts`
- Modify: `src/extensions/providers/managed-sidecar-installer.ts`
- Modify: `src/extensions/providers/claude-hook-sidecar.ts`
- Modify: `src/extensions/providers/claude-code-provider.ts`
- Modify: `src/extensions/providers/codex-provider.ts`
- Modify: `src/extensions/providers/opencode-provider.ts`
- Modify: `src/shared/project-session.ts`

- [ ] **Step 1: Write failing sidecar contract tests**

```ts
test('claude settings use command hooks through the shared launcher', async () => {
  expect(readCommandHook(content, 'SessionStart')).toMatchObject({
    type: 'command'
  })
  expect(content).toContain('.stoa/hook-dispatch')
  expect(content).not.toContain('http://127.0.0.1:')
})
```

- [ ] **Step 2: Write failing dispatcher execution tests**

```ts
test('dispatcher reads lease path and posts to lease webhook base url', async () => {
  const result = await invokeDispatcher({
    provider: 'codex',
    hookEventName: 'Stop',
    leasePath,
    stdinBody: { hook_event_name: 'Stop' }
  })

  expect(result.exitCode).toBe(0)
  expect(observedRequest.url).toBe('/hooks/codex')
})
```

- [ ] **Step 3: Run tests to verify red**

Run: `npx vitest run src/extensions/providers/shared-hook-dispatch.test.ts src/extensions/providers/claude-code-provider.test.ts tests/e2e/provider-integration.test.ts`
Expected: FAIL because providers still emit HTTP or provider-private scripts.

- [ ] **Step 4: Implement shared dispatcher artifacts and rewrite provider sidecars**

```ts
export const HOOK_CONTRACT_VERSION = 1

export function buildSharedHookArtifacts(): Array<{ relativePath: string; content: string }> {
  return [
    { relativePath: '.stoa/hook-dispatch.mjs', content: dispatcherRuntime },
    { relativePath: '.stoa/hook-dispatch.cmd', content: windowsLauncher },
    { relativePath: '.stoa/hook-dispatch', content: posixLauncher },
    { relativePath: '.stoa/hook-contract.json', content: contractManifest }
  ]
}
```

- [ ] **Step 5: Run focused tests to green**

Run: `npx vitest run src/extensions/providers/shared-hook-dispatch.test.ts src/extensions/providers/claude-code-provider.test.ts tests/e2e/provider-integration.test.ts`
Expected: PASS.

### Task 4: Runtime Lease Acquisition, Heartbeat, Release, And Startup Guards

**Files:**
- Modify: `src/core/session-runtime.ts`
- Modify: `src/core/session-runtime.test.ts`
- Modify: `src/main/launch-tracked-session-runtime.ts`
- Modify: `src/main/launch-tracked-session-runtime.test.ts`
- Modify: `src/main/session-event-bridge.ts`
- Modify: `src/main/session-event-bridge.test.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Write failing runtime-env tests**

```ts
test('injects managed hook env markers and lease path into provider command env', async () => {
  expect(start).toHaveBeenCalledWith(
    'session-1',
    expect.objectContaining({
      env: expect.objectContaining({
        STOA_HOOK_LEASE_PATH: expect.stringContaining('/hook-leases/session-1.json'),
        STOA_HOOK_MANAGED: '1',
        STOA_HOOK_PROVIDER: 'codex'
      })
    }),
    expect.any(Function),
    expect.any(Function),
    undefined
  )
})
```

- [ ] **Step 2: Write failing startup-guard tests**

```ts
test('fails startup when hook contract version mismatches the workspace contract', async () => {
  await expect(launchTrackedSessionRuntime(...)).resolves.toBe(false)
  expect(markRuntimeFailedToStart).toHaveBeenCalledWith('session-1', expect.stringContaining('contract version'))
})
```

- [ ] **Step 3: Run tests to verify red**

Run: `npx vitest run src/core/session-runtime.test.ts src/main/launch-tracked-session-runtime.test.ts src/main/session-event-bridge.test.ts`
Expected: FAIL because runtime launch still issues in-memory secrets and no lease context exists.

- [ ] **Step 4: Implement acquisition, heartbeat, release, and startup failure surfaces**

```ts
const lease = await hookLeaseRegistry.acquireOrReclaim(...)
const commandEnv = {
  STOA_HOOK_LEASE_PATH: lease.path,
  STOA_HOOK_MANAGED: '1',
  STOA_HOOK_SESSION_ID: session.id,
  STOA_HOOK_PROJECT_ID: session.projectId,
  STOA_HOOK_PROVIDER: session.type,
  STOA_HOOK_SPAWN_OWNER_INSTANCE_ID: lease.ownerInstanceId,
  STOA_HOOK_SPAWN_GENERATION: String(lease.generation)
}
```

- [ ] **Step 5: Run focused tests to green**

Run: `npx vitest run src/core/session-runtime.test.ts src/main/launch-tracked-session-runtime.test.ts src/main/session-event-bridge.test.ts`
Expected: PASS.

### Task 5: Managed Sidecar Maintenance And Workspace Contract Enforcement

**Files:**
- Modify: `src/main/managed-sidecar-maintenance.ts`
- Modify: `src/main/managed-sidecar-maintenance.test.ts`
- Modify: `src/extensions/providers/managed-sidecar-installer.ts`

- [ ] **Step 1: Write failing maintenance tests**

```ts
test('maintenance reinstalls stable artifacts without embedding webhook port', async () => {
  await syncManagedSidecars(...)
  expect(await readFile(join(projectDir, '.claude', 'settings.json'), 'utf8')).not.toContain('127.0.0.1')
  expect(await readFile(join(projectDir, '.stoa', 'hook-contract.json'), 'utf8')).toContain('"contractVersion":1')
})
```

- [ ] **Step 2: Run maintenance tests to verify red**

Run: `npx vitest run src/main/managed-sidecar-maintenance.test.ts`
Expected: FAIL because maintenance still refreshes baked webhook URLs.

- [ ] **Step 3: Implement contract-version checks and atomic replace writes**

```ts
if (installedContractVersion !== HOOK_CONTRACT_VERSION) {
  throw new Error(`Hook contract version mismatch: installed=${installedContractVersion} running=${HOOK_CONTRACT_VERSION}`)
}
```

- [ ] **Step 4: Run maintenance tests to green**

Run: `npx vitest run src/main/managed-sidecar-maintenance.test.ts`
Expected: PASS.

### Task 6: End-To-End Provider Coverage And Quality Gate

**Files:**
- Modify: `tests/e2e/provider-integration.test.ts`
- Modify when required: `tests/e2e/backend-lifecycle.test.ts`
- Modify when required: `tests/e2e/ipc-bridge.test.ts`

- [ ] **Step 1: Add failing end-to-end assertions**

```ts
test('stoa restart does not require rewriting workspace hook files before a later hook can deliver', async () => {
  expect(dispatcherArtifactsBeforeRestart).toEqual(dispatcherArtifactsAfterRestart)
  expect(lateHookDelivery.statusCode).toBe(204)
})
```

- [ ] **Step 2: Run targeted E2E tests to verify red**

Run: `npx vitest run tests/e2e/provider-integration.test.ts tests/e2e/backend-lifecycle.test.ts`
Expected: FAIL until dispatcher + lease flow is wired through.

- [ ] **Step 3: Make the tests pass with minimal production changes**

```ts
// No new compatibility layer. Fix the production flow until the lease-based contract passes.
```

- [ ] **Step 4: Run the full repository gate**

Run: `npm run test:generate`
Expected: deterministic generated output.

Run: `npm run typecheck`
Expected: PASS.

Run: `npx vitest run`
Expected: PASS.

Run: `npm run test:e2e`
Expected: PASS.

Run: `npm run test:behavior-coverage`
Expected: PASS.

- [ ] **Step 5: Completion audit**

Check:
- Claude sidecars are command-hook based.
- Workspace files contain no webhook port or session secret.
- Codex and OpenCode use the shared late-bound dispatcher contract.
- Lease acquisition, heartbeat, reclaim, and release are covered by tests.
- Contract mismatch blocks managed startup.
- Failure journal exists for managed delivery failures.
