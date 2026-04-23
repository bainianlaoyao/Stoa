# Codex And Claude Code Session Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `codex` and `claude-code` session types with provider-driven routing, restart recovery, renderer metadata, and test coverage across unit and E2E layers.

**Architecture:** Move session routing to a shared provider descriptor registry so runtime, settings detection, main process startup, and renderer metadata all read the same source of truth. Preserve the existing `fresh-shell` / `resume-external` recovery model, but let each provider decide how it seeds or discovers `externalSessionId`.

**Tech Stack:** Electron, Vue 3, Pinia, node-pty, Vitest, PowerShell, provider CLIs (`opencode`, `codex`, `claude`)

---

## File Structure

- **Create:** `src/shared/provider-descriptors.ts`
  - Shared provider metadata for session type, provider id, executable name, display name, title prefix, and runtime flags.
- **Modify:** `src/shared/project-session.ts`
  - Add new `SessionType` members and any runtime context fields needed for provider-driven launch.
- **Modify:** `src/extensions/providers/index.ts`
  - Register all providers and expose descriptor-backed lookup helpers.
- **Create:** `src/extensions/providers/codex-provider.ts`
  - Codex command construction and post-start external-session discovery.
- **Create:** `src/extensions/providers/claude-code-provider.ts`
  - Claude command construction with seeded session UUIDs.
- **Modify:** `src/extensions/providers/opencode-provider.ts`
  - Keep behavior but align with descriptor-backed registry interfaces.
- **Modify:** `src/core/settings-detector.ts`
  - Detect executables by descriptor `executableName`.
- **Modify:** `src/core/project-session-manager.ts`
  - Generalize recovery-mode creation and seeded external session IDs.
- **Modify:** `src/core/session-runtime.ts`
  - Use provider capabilities for resume, shell wrapping, and asynchronous external session binding.
- **Modify:** `src/main/index.ts`
  - Descriptor-based provider selection and runtime path resolution.
- **Modify:** `src/renderer/composables/provider-icons.ts`
  - Add Codex and Claude icons.
- **Modify:** `src/renderer/components/command/ProviderRadialMenu.vue`
  - Descriptor-driven labels.
- **Modify:** `src/renderer/components/command/ProviderFloatingCard.vue`
  - Descriptor-driven labels.
- **Modify:** `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
  - Descriptor-driven default title generation.
- **Modify tests:** unit and E2E coverage in `src/**/*.test.ts` and `tests/e2e/*.test.ts`

## Constraints

- Breaking changes are allowed; do not add compatibility shims.
- `claude-code` executable detection must resolve `claude`, not `claude-code`.
- `codex` discovery should patch `externalSessionId` asynchronously; it must not block session start forever.
- The main process may not contain hardcoded session-type-to-provider ternaries after this refactor.
- Final verification command: `npx vitest run`

---

### Task 1: Introduce Shared Provider Descriptors And Types

**Files:**
- Create: `src/shared/provider-descriptors.ts`
- Modify: `src/shared/project-session.ts`
- Test: `src/shared/project-session.test.ts`
- Test: `tests/e2e/provider-integration.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/project-session.test.ts
import { describe, expect, test } from 'vitest'
import { getProviderDescriptorBySessionType } from './provider-descriptors'
import type { SessionType } from './project-session'

describe('provider descriptors', () => {
  test('supports all session types including codex and claude-code', () => {
    const types: SessionType[] = ['shell', 'opencode', 'codex', 'claude-code']
    expect(types.map(getProviderDescriptorBySessionType).map(item => item.providerId)).toEqual([
      'local-shell',
      'opencode',
      'codex',
      'claude-code'
    ])
  })
})
```

```ts
// tests/e2e/provider-integration.test.ts
test('listProviders returns local-shell opencode codex and claude-code providers', () => {
  const ids = listProviders().map(provider => provider.providerId)
  expect(ids).toEqual(expect.arrayContaining(['local-shell', 'opencode', 'codex', 'claude-code']))
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx vitest run src/shared/project-session.test.ts tests/e2e/provider-integration.test.ts`

Expected: FAIL because `codex` and `claude-code` are not valid session types and no shared descriptor registry exists.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/shared/provider-descriptors.ts
import type { SessionType } from './project-session'

export interface ProviderDescriptor {
  sessionType: SessionType
  providerId: string
  executableName: string
  displayName: string
  titlePrefix: string
  supportsResume: boolean
  supportsStructuredEvents: boolean
  seedsExternalSessionId: boolean
}

const DESCRIPTORS: Record<SessionType, ProviderDescriptor> = {
  shell: { sessionType: 'shell', providerId: 'local-shell', executableName: 'shell', displayName: 'Shell', titlePrefix: 'shell', supportsResume: false, supportsStructuredEvents: false, seedsExternalSessionId: false },
  opencode: { sessionType: 'opencode', providerId: 'opencode', executableName: 'opencode', displayName: 'OpenCode', titlePrefix: 'opencode', supportsResume: true, supportsStructuredEvents: true, seedsExternalSessionId: false },
  codex: { sessionType: 'codex', providerId: 'codex', executableName: 'codex', displayName: 'Codex', titlePrefix: 'codex', supportsResume: true, supportsStructuredEvents: false, seedsExternalSessionId: false },
  'claude-code': { sessionType: 'claude-code', providerId: 'claude-code', executableName: 'claude', displayName: 'Claude Code', titlePrefix: 'claude', supportsResume: true, supportsStructuredEvents: false, seedsExternalSessionId: true }
}

export function getProviderDescriptorBySessionType(type: SessionType): ProviderDescriptor {
  return DESCRIPTORS[type]
}
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npx vitest run src/shared/project-session.test.ts tests/e2e/provider-integration.test.ts`

Expected: PASS with the new session types and registry visible to tests.

### Task 2: Refactor Main Runtime Routing To Descriptor-Based Behavior

**Files:**
- Modify: `src/core/project-session-manager.ts`
- Modify: `src/core/session-runtime.ts`
- Modify: `src/core/settings-detector.ts`
- Modify: `src/main/index.ts`
- Test: `src/core/project-session-manager.test.ts`
- Test: `src/core/session-runtime.test.ts`
- Test: `src/core/session-runtime-callbacks.test.ts`
- Test: `src/core/settings-detector.test.ts`
- Test: `tests/e2e/main-config-guard.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('claude-code sessions use resume-external and preserve seeded external session ids', async () => {
  const session = await manager.createSession({
    projectId: project.id,
    type: 'claude-code',
    title: 'Claude',
    externalSessionId: '11111111-1111-1111-1111-111111111111'
  })

  expect(session.recoveryMode).toBe('resume-external')
  expect(session.externalSessionId).toBe('11111111-1111-1111-1111-111111111111')
})

test('detectProvider resolves claude-code via claude executable name', async () => {
  const detected = await detectProvider('claude', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  expect(detected).toContain('claude')
})
```

```ts
test('main process source uses descriptor lookup instead of shell/opencode ternary', async () => {
  const source = await readFile('src/main/index.ts', 'utf8')
  expect(source).not.toContain(\"session.type === 'shell' ? 'local-shell' : 'opencode'\")
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx vitest run src/core/project-session-manager.test.ts src/core/session-runtime.test.ts src/core/session-runtime-callbacks.test.ts src/core/settings-detector.test.ts tests/e2e/main-config-guard.test.ts`

Expected: FAIL because runtime and main still special-case `opencode`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/core/project-session-manager.ts
function createSessionRecoveryMode(type: SessionType) {
  return type === 'shell' ? 'fresh-shell' : 'resume-external'
}

// src/core/session-runtime.ts
const descriptor = getProviderDescriptorBySessionType(session.type)
const canResume =
  descriptor.supportsResume &&
  !!session.externalSessionId &&
  session.status !== 'needs_confirmation'
```

```ts
// src/main/index.ts
const descriptor = getProviderDescriptorBySessionType(session.type)
const provider = getProvider(descriptor.providerId)
const providerPath = descriptor.providerId === 'local-shell'
  ? null
  : await detectProvider(descriptor.executableName, shellPath)
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npx vitest run src/core/project-session-manager.test.ts src/core/session-runtime.test.ts src/core/session-runtime-callbacks.test.ts src/core/settings-detector.test.ts tests/e2e/main-config-guard.test.ts`

Expected: PASS with descriptor-based routing and no hardcoded main-process ternary.

### Task 3: Implement Claude And Codex Providers

**Files:**
- Create: `src/extensions/providers/claude-code-provider.ts`
- Create: `src/extensions/providers/codex-provider.ts`
- Modify: `src/extensions/providers/index.ts`
- Test: `tests/e2e/provider-integration.test.ts`
- Test: `src/core/session-runtime-callbacks.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('claude-code buildStartCommand seeds session id', async () => {
  const provider = getProvider('claude-code')
  const command = await provider.buildStartCommand(target, context)
  expect(command.command).toContain('claude')
  expect(command.args).toEqual(['--session-id', target.external_session_id!])
})

test('claude-code buildResumeCommand resumes by external session id', async () => {
  const provider = getProvider('claude-code')
  const command = await provider.buildResumeCommand(target, '11111111-1111-1111-1111-111111111111', context)
  expect(command.args).toEqual(['--resume', '11111111-1111-1111-1111-111111111111'])
})

test('codex buildResumeCommand resumes by session id', async () => {
  const provider = getProvider('codex')
  const command = await provider.buildResumeCommand(target, '019c75d6-5db6-7c21-8d2f-f0602da4f64d', context)
  expect(command.args).toEqual(['resume', '019c75d6-5db6-7c21-8d2f-f0602da4f64d'])
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx vitest run tests/e2e/provider-integration.test.ts src/core/session-runtime-callbacks.test.ts`

Expected: FAIL because no Codex or Claude providers are registered.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/extensions/providers/claude-code-provider.ts
export const claudeCodeProvider: ProviderDefinition = {
  providerId: 'claude-code',
  supportsResume: () => true,
  supportsStructuredEvents: () => false,
  buildStartCommand: async (target, context) => ({
    command: context.providerPath?.trim() || 'claude',
    args: ['--session-id', target.external_session_id ?? target.session_id],
    cwd: target.path,
    env: process.env as Record<string, string>
  }),
  buildResumeCommand: async (target, externalSessionId, context) => ({
    command: context.providerPath?.trim() || 'claude',
    args: ['--resume', externalSessionId],
    cwd: target.path,
    env: process.env as Record<string, string>
  }),
  resolveSessionId: () => null,
  installSidecar: async () => {}
}
```

```ts
// src/extensions/providers/codex-provider.ts
export const codexProvider: ProviderDefinition = {
  providerId: 'codex',
  supportsResume: () => true,
  supportsStructuredEvents: () => false,
  buildStartCommand: async (target, context) => ({
    command: context.providerPath?.trim() || 'codex',
    args: [],
    cwd: target.path,
    env: process.env as Record<string, string>
  }),
  buildResumeCommand: async (target, externalSessionId, context) => ({
    command: context.providerPath?.trim() || 'codex',
    args: ['resume', externalSessionId],
    cwd: target.path,
    env: process.env as Record<string, string>
  }),
  resolveSessionId: () => null,
  installSidecar: async () => {}
}
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npx vitest run tests/e2e/provider-integration.test.ts src/core/session-runtime-callbacks.test.ts`

Expected: PASS with both new providers registered and resumable.

### Task 4: Add Asynchronous Codex External Session Discovery

**Files:**
- Modify: `src/extensions/providers/index.ts`
- Modify: `src/core/session-runtime.ts`
- Modify: `src/main/session-runtime-controller.ts`
- Test: `src/core/session-runtime-callbacks.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('runtime patches externalSessionId after start when provider discovers it asynchronously', async () => {
  const markSessionRunning = vi.fn()
  const provider = createProvider({
    providerId: 'codex',
    discoverExternalSessionIdAfterStart: vi.fn().mockResolvedValue('019c75d6-5db6-7c21-8d2f-f0602da4f64d')
  })

  await startSessionRuntime({ session: createBaseSession({ type: 'codex', externalSessionId: null }), provider, ...deps })

  expect(markSessionRunning).toHaveBeenCalledWith(
    'session_op_1',
    '019c75d6-5db6-7c21-8d2f-f0602da4f64d'
  )
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run src/core/session-runtime-callbacks.test.ts`

Expected: FAIL because runtime has no async discovery hook.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/extensions/providers/index.ts
discoverExternalSessionIdAfterStart?(
  target: ProviderRuntimeTarget,
  context: ProviderCommandContext
): Promise<string | null>

// src/core/session-runtime.ts
const discoveredExternalSessionId = provider.discoverExternalSessionIdAfterStart
  ? await provider.discoverExternalSessionIdAfterStart(target, context)
  : null

await manager.markSessionRunning(
  session.id,
  activeExternalSessionId ?? discoveredExternalSessionId
)
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npx vitest run src/core/session-runtime-callbacks.test.ts`

Expected: PASS with Codex-style post-start binding supported.

### Task 5: Update Renderer Metadata And Titles

**Files:**
- Modify: `src/renderer/composables/provider-icons.ts`
- Modify: `src/renderer/components/command/ProviderRadialMenu.vue`
- Modify: `src/renderer/components/command/ProviderFloatingCard.vue`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
- Test: `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('quick-create menu exposes codex and claude-code providers', async () => {
  const labels = wrapper.findAll('[aria-label^=\"Create \"]').map(node => node.attributes('aria-label'))
  expect(labels).toContain('Create Codex session')
  expect(labels).toContain('Create Claude Code session')
})

test('default titles use descriptor title prefixes', async () => {
  await clickCodex()
  expect(emittedCreate[0]).toMatchObject({ title: 'codex-demo-project' })
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx vitest run src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`

Expected: FAIL because UI only knows about shell and opencode.

- [ ] **Step 3: Write the minimal implementation**

```ts
const descriptor = getProviderDescriptorBySessionType(type)
if (type === 'shell') {
  const count = project?.sessions.filter(s => s.type === 'shell').length ?? 0
  return `shell-${count + 1}`
}
return `${descriptor.titlePrefix}-${project?.name ?? 'session'}`
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npx vitest run src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`

Expected: PASS with new providers visible and titled correctly.

### Task 6: Full Verification And Review Gate

**Files:**
- Modify: any files required by prior tasks
- Test: full repository

- [ ] **Step 1: Run targeted tests for every touched area**

Run:
`npx vitest run src/shared/project-session.test.ts src/core/project-session-manager.test.ts src/core/session-runtime.test.ts src/core/session-runtime-callbacks.test.ts src/core/settings-detector.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts tests/e2e/provider-integration.test.ts tests/e2e/main-config-guard.test.ts`

Expected: PASS

- [ ] **Step 2: Run the full suite**

Run: `npx vitest run`

Expected: PASS with zero unexpected failures.

- [ ] **Step 3: Run spec-compliance review and code-quality review**

Review inputs:
- Spec: `docs/superpowers/specs/2026-04-23-codex-claude-session-support-design.md`
- Plan: `docs/superpowers/plans/2026-04-23-codex-claude-session-support.md`
- Diff: current branch versus baseline branch

Expected: reviewers either approve or return concrete issues to fix before completion.

## Self-Review

- Spec coverage: all requirements map to at least one task:
  provider descriptor architecture (`Task 1`, `Task 2`)
  Claude seeded recovery (`Task 2`, `Task 3`)
  Codex async discovery (`Task 4`)
  renderer integration (`Task 5`)
  regression protection (`Task 2`, `Task 6`)
- Placeholder scan: no `TODO`, `TBD`, or implicit “write tests later” steps remain.
- Type consistency: the same public names are used throughout the plan:
  `ProviderDescriptor`
  `externalSessionId`
  `discoverExternalSessionIdAfterStart`
  `titlePrefix`
