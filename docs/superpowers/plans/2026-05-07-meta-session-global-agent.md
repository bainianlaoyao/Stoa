# Meta Session Global Control Plane Implementation Plan

> Terminology note: this plan started as a `Hermes` implementation plan. The repository has since standardized on `Meta Session` / `meta-session`. Remaining `Hermes` references in historical steps or sketch snippets are legacy wording, not the current implementation contract; old `hermes-agent` examples are historical design artifacts only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first complete Hermes vertical slice: a dedicated Hermes surface with parallel Hermes sessions, a provider-managed Hermes runtime, a loopback `stoa-ctl` control API, session full-context reads, prompt injection, proposal gating, and provider-style Hermes resume.

**Architecture:** Hermes is a new provider-managed runtime plus a separate system control plane. Work-session truth stays in existing main-process managers; Hermes consumes those facts through a new `/ctl/*` API and a standalone `stoa-ctl` CLI. The renderer gets a new `hermes` surface with a Hermes-session list, a persistent Hermes terminal deck, and a native inspector/action rail.

**Tech Stack:** Electron main/preload IPC, Vue 3 + Pinia + `<script setup lang="ts">`, Express-style local HTTP handlers, xterm.js terminal surface, Vitest, Playwright, TypeScript.

---

### Task 1: Extend Shared Contracts For Hermes Surface, Hermes Sessions, And Control API

**Files:**
- Modify: `src/shared/project-session.ts`
- Modify: `src/shared/provider-descriptors.ts`
- Modify: `src/core/ipc-channels.ts`
- Modify: `src/renderer/components/GlobalActivityBar.vue`
- Test: `src/shared/project-session.test.ts`
- Test: `tests/e2e/main-config-guard.test.ts`
- Test: `src/renderer/components/AppShell.test.ts`

- [ ] **Step 1: Write the failing shared-contract tests**

```ts
// src/shared/project-session.test.ts
it('includes hermes-agent in the session type contract and hermes surface bootstrap types', () => {
  const descriptor = getProviderDescriptorBySessionType('hermes-agent')

  expect(descriptor).toMatchObject({
    providerId: 'hermes-agent',
    executableName: 'hermes-agent',
    displayName: 'Hermes',
    supportsResume: true,
    supportsStructuredEvents: true
  })
})
```

```ts
// src/renderer/components/AppShell.test.ts
it('renders a Hermes surface entry in the activity bar and keeps command surface mounted when Hermes is selected', async () => {
  const wrapper = mountAppShell()
  await wrapper.get('[data-activity-item="hermes"]').trigger('click')

  expect(wrapper.find('[data-surface="hermes"][aria-label="Hermes surface"]').exists()).toBe(true)
  expect(wrapper.find('[data-surface="command"][aria-label="Command surface"]').exists()).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/shared/project-session.test.ts src/renderer/components/AppShell.test.ts tests/e2e/main-config-guard.test.ts
```

Expected:

- `hermes-agent` is not assignable to `SessionType`
- `hermes` is missing from activity bar/app shell
- static guard tests fail because new IPC/surface channels are absent

- [ ] **Step 3: Extend the shared types and descriptors minimally**

```ts
// src/shared/project-session.ts
export type SessionType = 'shell' | 'opencode' | 'codex' | 'claude-code' | 'hermes-agent'

export interface HermesSessionSummary {
  id: string
  title: string
  status: 'created' | 'starting' | 'running' | 'waiting_approval' | 'idle' | 'failed' | 'closed'
  capabilityLevel: 0 | 1 | 2 | 3
  pendingProposalCount: number
  activeTargetCount: number
  lastSummary: string
  lastRisk: string | null
  resumeSessionId: string | null
  createdAt: string
  updatedAt: string
  lastActivatedAt: string | null
}
```

```ts
// src/shared/provider-descriptors.ts
'hermes-agent': {
  sessionType: 'hermes-agent',
  providerId: 'hermes-agent',
  executableName: 'hermes-agent',
  displayName: 'Hermes',
  titlePrefix: 'hermes',
  supportsResume: true,
  supportsStructuredEvents: true,
  seedsExternalSessionId: false,
  prefersShellWrap: true
}
```

```ts
// src/core/ipc-channels.ts
hermesBootstrap: 'hermes:bootstrap',
hermesSessionCreate: 'hermes:session-create',
hermesSessionSetActive: 'hermes:session-set-active',
hermesSessionClose: 'hermes:session-close',
hermesSessionEvent: 'hermes:session-event',
```

- [ ] **Step 4: Add the Hermes activity item and keep command surface mounted**

```ts
// src/renderer/components/GlobalActivityBar.vue
export type AppSurface = 'command' | 'hermes' | 'archive' | 'settings'
```

```ts
// topItems
{
  id: 'hermes',
  title: t('activityBar.hermes'),
  iconKind: 'hermes-orbit',
  iconPaths: [
    'M12 5.25v13.5',
    'M5.25 12h13.5',
    'M7.5 7.5l9 9',
    'M16.5 7.5l-9 9'
  ]
}
```

- [ ] **Step 5: Run tests to verify the contract pass**

Run:

```bash
npx vitest run src/shared/project-session.test.ts src/renderer/components/AppShell.test.ts tests/e2e/main-config-guard.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/project-session.ts src/shared/provider-descriptors.ts src/core/ipc-channels.ts src/renderer/components/GlobalActivityBar.vue src/shared/project-session.test.ts src/renderer/components/AppShell.test.ts tests/e2e/main-config-guard.test.ts
git commit -m "feat: add Hermes shared surface contracts"
```

### Task 2: Add Hermes State Store And Provider-Managed Runtime Recovery

**Files:**
- Create: `src/shared/hermes.ts`
- Create: `src/core/hermes-state-store.ts`
- Create: `src/core/hermes-manager.ts`
- Create: `src/extensions/providers/hermes-agent-provider.ts`
- Modify: `src/extensions/providers/index.ts`
- Modify: `src/core/state-store.ts`
- Modify: `src/main/launch-tracked-session-runtime.ts`
- Test: `src/core/hermes-state-store.test.ts`
- Test: `src/core/hermes-manager.test.ts`
- Test: `src/extensions/providers/hermes-agent-provider.test.ts`
- Test: `src/main/launch-tracked-session-runtime.test.ts`

- [ ] **Step 1: Write failing Hermes persistence and provider tests**

```ts
// src/core/hermes-manager.test.ts
it('creates a Hermes session with a provider-managed resume pointer and persists it separately from project sessions', async () => {
  const manager = await HermesManager.create({ statePath: tempStatePath })

  const created = await manager.createSession({ title: 'global-triage', capabilityLevel: 2 })

  expect(created.title).toBe('global-triage')
  expect(created.resumeSessionId).not.toBeNull()
  expect((await manager.listSessions())).toHaveLength(1)
})
```

```ts
// src/extensions/providers/hermes-agent-provider.test.ts
it('builds fresh and resume commands for the Hermes agent CLI', async () => {
  const fresh = await hermesAgentProvider.buildStartCommand(target, context)
  const resume = await hermesAgentProvider.buildResumeCommand(target, 'resume-123', context)

  expect(fresh.args).toContain('--stoa-hermes')
  expect(resume.args).toEqual(expect.arrayContaining(['resume', 'resume-123']))
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/core/hermes-state-store.test.ts src/core/hermes-manager.test.ts src/extensions/providers/hermes-agent-provider.test.ts src/main/launch-tracked-session-runtime.test.ts
```

Expected:

- missing Hermes manager/store/provider modules
- launch path does not know `hermes-agent`

- [ ] **Step 3: Implement the minimal Hermes state and provider**

```ts
// src/shared/hermes.ts
export interface PersistedHermesStateV1 {
  version: 1
  active_hermes_session_id: string | null
  sessions: PersistedHermesSession[]
  proposals: PersistedHermesProposal[]
  inspector_target: PersistedHermesInspectorTarget | null
}
```

```ts
// src/extensions/providers/hermes-agent-provider.ts
export const hermesAgentProvider: ProviderDefinition = {
  providerId: 'hermes-agent',
  supportsResume: () => true,
  supportsStructuredEvents: () => true,
  async buildStartCommand(target, context) {
    return {
      command: context.providerPath?.trim() || 'hermes-agent',
      args: ['start', '--stoa-hermes', '--session-id', target.session_id],
      cwd: target.path,
      env: buildHermesEnv(target, context)
    }
  },
  async buildResumeCommand(target, externalSessionId, context) {
    return {
      command: context.providerPath?.trim() || 'hermes-agent',
      args: ['resume', externalSessionId, '--stoa-hermes'],
      cwd: target.path,
      env: buildHermesEnv(target, context)
    }
  },
  resolveSessionId(event) {
    return event.payload.externalSessionId ?? null
  },
  async installSidecar() {}
}
```

- [ ] **Step 4: Wire the provider into the existing provider registry and recovery entrypoint**

```ts
// src/extensions/providers/index.ts
[hermesAgentProvider.providerId, hermesAgentProvider]
```

```ts
// src/main/launch-tracked-session-runtime.ts
type = session.type
// with shared provider descriptor lookup now accepting 'hermes-agent'
```

- [ ] **Step 5: Run tests to verify Hermes state and provider recovery pass**

Run:

```bash
npx vitest run src/core/hermes-state-store.test.ts src/core/hermes-manager.test.ts src/extensions/providers/hermes-agent-provider.test.ts src/main/launch-tracked-session-runtime.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/hermes.ts src/core/hermes-state-store.ts src/core/hermes-manager.ts src/extensions/providers/hermes-agent-provider.ts src/extensions/providers/index.ts src/core/state-store.ts src/main/launch-tracked-session-runtime.ts src/core/hermes-state-store.test.ts src/core/hermes-manager.test.ts src/extensions/providers/hermes-agent-provider.test.ts src/main/launch-tracked-session-runtime.test.ts
git commit -m "feat: add Hermes provider-managed session recovery"
```

### Task 3: Implement `/ctl/*` Control API, Session Full Context, Prompt Injection, And `stoa-ctl`

**Files:**
- Create: `src/core/context/full-text-context.ts`
- Create: `src/core/hermes-context-assembler.ts`
- Create: `src/core/hermes-proposal-store.ts`
- Create: `src/core/hermes-command-dispatcher.ts`
- Create: `src/core/hermes-control-server.ts`
- Create: `tools/stoa-ctl/index.ts`
- Modify: `src/main/index.ts`
- Modify: `package.json`
- Test: `src/core/hermes-context-assembler.test.ts`
- Test: `src/core/hermes-command-dispatcher.test.ts`
- Test: `src/core/hermes-control-server.test.ts`
- Test: `tests/e2e/ipc-bridge.test.ts`
- Test: `tests/e2e/main-config-guard.test.ts`

- [ ] **Step 1: Write failing control API and full-context tests**

```ts
// src/core/hermes-context-assembler.test.ts
it('returns full context as large human-readable text with terminal replay merged in and tool payloads excluded', async () => {
  const text = await assembler.getFullContext(session.id, { maxChars: 100_000 })

  expect(text).toContain('[User]')
  expect(text).toContain('[Terminal]')
  expect(text).toContain('npm test')
  expect(text).not.toContain('"toolName":')
})
```

```ts
// src/core/hermes-command-dispatcher.test.ts
it('creates a proposal instead of directly injecting a freeform prompt when approval is required', async () => {
  const result = await dispatcher.promptWorkSession({
    hermesSessionId: 'hermes_1',
    targetSessionId: 'session_1',
    text: 'Refactor and edit the code now.'
  })

  expect(result.kind).toBe('approval_required')
  expect(result.proposal?.status).toBe('pending_approval')
})
```

```ts
// src/core/hermes-control-server.test.ts
it('serves /ctl/work-sessions/:id/context?level=full as plain text and /ctl/state/brief as json', async () => {
  const full = await request(server).get('/ctl/work-sessions/session_1/context').query({ level: 'full' })
  const brief = await request(server).get('/ctl/state/brief')

  expect(full.status).toBe(200)
  expect(full.text).toContain('[Assistant]')
  expect(brief.body.ok).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/core/hermes-context-assembler.test.ts src/core/hermes-command-dispatcher.test.ts src/core/hermes-control-server.test.ts tests/e2e/main-config-guard.test.ts
```

Expected:

- missing assembler/dispatcher/control-server
- missing CLI package entry

- [ ] **Step 3: Implement the minimal context assembler and dispatcher**

```ts
// src/core/hermes-context-assembler.ts
export class HermesContextAssembler {
  async getStatus(sessionId: string): Promise<WorkSessionStatusContext> { /* session + presence */ }
  async getBundle(sessionId: string): Promise<WorkSessionContextBundle> { /* session + events + evidence refs + jobs */ }
  async getFullContext(sessionId: string, input: { maxChars?: number; cursor?: string | null }): Promise<{
    text: string
    truncated: boolean
    nextCursor: string | null
  }> { /* merge replay + readable evidence text */ }
}
```

```ts
// src/core/hermes-command-dispatcher.ts
export class HermesCommandDispatcher {
  async promptWorkSession(input: PromptDispatchInput): Promise<PromptDispatchResult> {
    if (requiresApproval(input.text)) {
      return { kind: 'approval_required', proposal: await this.proposals.createPromptProposal(input) }
    }

    await this.sessionInputRouter.send(input.targetSessionId, `${input.text}\r`)
    return { kind: 'dispatched' }
  }
}
```

- [ ] **Step 4: Add the loopback control routes and standalone CLI**

```ts
// package.json
"stoa-ctl": "tsx --tsconfig tsconfig.node.json tools/stoa-ctl/index.ts"
```

```ts
// tools/stoa-ctl/index.ts
const command = process.argv.slice(2)
// resolve STOA_CTL_BASE_URL and STOA_CTL_TOKEN
// GET/POST /ctl/* and write json or full text to stdout
```

- [ ] **Step 5: Run focused tests to verify the control slice passes**

Run:

```bash
npx vitest run src/core/hermes-context-assembler.test.ts src/core/hermes-command-dispatcher.test.ts src/core/hermes-control-server.test.ts tests/e2e/main-config-guard.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/context/full-text-context.ts src/core/hermes-context-assembler.ts src/core/hermes-proposal-store.ts src/core/hermes-command-dispatcher.ts src/core/hermes-control-server.ts tools/stoa-ctl/index.ts src/main/index.ts package.json src/core/hermes-context-assembler.test.ts src/core/hermes-command-dispatcher.test.ts src/core/hermes-control-server.test.ts tests/e2e/main-config-guard.test.ts
git commit -m "feat: add Hermes control API and stoa-ctl"
```

### Task 4: Add Hermes Surface, Hermes Session UI, And Approval Flow

**Files:**
- Create: `src/renderer/components/hermes/HermesSurface.vue`
- Create: `src/renderer/components/hermes/HermesSessionList.vue`
- Create: `src/renderer/components/hermes/HermesTerminalDeck.vue`
- Create: `src/renderer/components/hermes/HermesInspectorPanel.vue`
- Create: `src/renderer/components/hermes/HermesActionPanel.vue`
- Create: `src/renderer/stores/hermes.ts`
- Modify: `src/renderer/components/AppShell.vue`
- Modify: `src/renderer/app/App.vue`
- Modify: `src/preload/index.ts`
- Test: `src/renderer/components/hermes/HermesSurface.test.ts`
- Test: `src/renderer/stores/hermes.test.ts`
- Test: `src/renderer/components/AppShell.test.ts`
- Test: `tests/e2e/frontend-store-projection.test.ts`

- [ ] **Step 1: Write failing renderer tests**

```ts
// src/renderer/components/hermes/HermesSurface.test.ts
it('renders Hermes session list, persistent Hermes terminal deck, and native inspector rail', () => {
  const wrapper = mountHermesSurface()

  expect(wrapper.find('[data-testid="hermes-session-list"]').exists()).toBe(true)
  expect(wrapper.find('[data-testid="hermes-terminal-deck"]').exists()).toBe(true)
  expect(wrapper.find('[data-testid="hermes-inspector-panel"]').exists()).toBe(true)
})
```

```ts
// src/renderer/stores/hermes.test.ts
it('hydrates Hermes sessions separately from work-session hierarchy and tracks the active inspector target', () => {
  const store = useHermesStore()
  store.hydrate({
    activeHermesSessionId: 'hermes_1',
    sessions: [makeHermesSession('hermes_1')],
    inspectorTarget: { kind: 'app' }
  })

  expect(store.activeHermesSession?.id).toBe('hermes_1')
  expect(store.inspectorTarget?.kind).toBe('app')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/renderer/components/hermes/HermesSurface.test.ts src/renderer/stores/hermes.test.ts src/renderer/components/AppShell.test.ts
```

Expected:

- missing Hermes store/components
- AppShell does not mount Hermes surface

- [ ] **Step 3: Implement the minimal Hermes store and surface**

```vue
<!-- src/renderer/components/hermes/HermesSurface.vue -->
<script setup lang="ts">
import HermesSessionList from './HermesSessionList.vue'
import HermesTerminalDeck from './HermesTerminalDeck.vue'
import HermesInspectorPanel from './HermesInspectorPanel.vue'
</script>

<template>
  <section class="h-full min-h-0 grid" data-surface="hermes" aria-label="Hermes surface">
    <div class="h-full min-h-0 grid grid-cols-[260px_minmax(0,1fr)_320px] gap-2.5 p-2.5">
      <HermesSessionList data-testid="hermes-session-list" />
      <HermesTerminalDeck data-testid="hermes-terminal-deck" />
      <HermesInspectorPanel data-testid="hermes-inspector-panel" />
    </div>
  </section>
</template>
```

- [ ] **Step 4: Wire preload/API methods and AppShell mounting**

```ts
// preload API methods
getHermesBootstrapState()
createHermesSession()
setActiveHermesSession()
closeHermesSession()
onHermesSessionEvent()
```

```vue
<!-- AppShell.vue -->
<HermesSurface v-if="activeSurface === 'hermes'" />
```

- [ ] **Step 5: Run renderer tests to verify the Hermes surface passes**

Run:

```bash
npx vitest run src/renderer/components/hermes/HermesSurface.test.ts src/renderer/stores/hermes.test.ts src/renderer/components/AppShell.test.ts tests/e2e/frontend-store-projection.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/hermes src/renderer/stores/hermes.ts src/renderer/components/AppShell.vue src/renderer/app/App.vue src/preload/index.ts src/renderer/components/hermes/HermesSurface.test.ts src/renderer/stores/hermes.test.ts src/renderer/components/AppShell.test.ts tests/e2e/frontend-store-projection.test.ts
git commit -m "feat: add Hermes surface renderer workflow"
```

### Task 5: Verify Full Repository Quality Gate And Audit Hermes Coverage

**Files:**
- Modify as needed based on failures from previous tasks
- Test: `testing/behavior/*`
- Test: `testing/topology/*`
- Test: `testing/journeys/*`
- Test: `tests/generated/*`

- [ ] **Step 1: Add or update behavior/topology coverage for Hermes**

```ts
// testing/behavior/hermes.behavior.ts
defineBehavior({
  id: 'hermes.read-full-context-and-gate-prompt',
  goal: 'allow a Hermes session to read full text context from a work session and gate high-risk prompt injection through approval'
})
```

```ts
// testing/topology/hermes.topology.ts
defineTopology({
  surface: 'hermes',
  selectors: {
    sessionList: 'hermes-session-list',
    terminalDeck: 'hermes-terminal-deck',
    inspectorPanel: 'hermes-inspector-panel'
  }
})
```

- [ ] **Step 2: Regenerate generated tests**

Run:

```bash
npm run test:generate
```

Expected: generated files update deterministically, no hand-edits under `tests/generated/`

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 4: Run repository test suite**

Run:

```bash
npx vitest run
```

Expected: PASS

- [ ] **Step 5: Run Electron E2E journeys**

Run:

```bash
npm run test:e2e
```

Expected: PASS

- [ ] **Step 6: Run behavior coverage gate**

Run:

```bash
npm run test:behavior-coverage
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add testing tests/generated
git commit -m "test: cover Hermes global agent workflows"
```

## Spec Coverage Check

- `Hermes surface` top-level page: covered by Task 4.
- Multiple parallel Hermes sessions: covered by Tasks 2 and 4.
- Hermes as provider-managed runtime with resume: covered by Task 2.
- `stoa-ctl` shell-facing CLI and `/ctl/*` control API: covered by Task 3.
- `work-sessions context --level full` pure-text guarantee: covered by Task 3.
- Prompt injection into any work session: covered by Task 3.
- Proposal/approval/stale-check: covered by Tasks 3 and 4.
- Quality gate and behavior assets: covered by Task 5.

## Self-Review

- No `TODO`/`TBD` placeholders remain.
- The plan is scoped as one coherent vertical slice rather than unrelated subsystems.
- The filenames, route names, and object names are consistent with the Hermes spec.

Plan complete and saved to `docs/superpowers/plans/2026-05-07-hermes-global-agent.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
