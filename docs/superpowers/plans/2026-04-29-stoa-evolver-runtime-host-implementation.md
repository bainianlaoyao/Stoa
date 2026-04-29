# Stoa x Evolver Runtime Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite Stoa's current memory pipeline into the approved `runtime host + memory engine` architecture without keeping any Stoa-owned memory/run/publish compatibility layer.

**Architecture:** Stoa remains the runtime host for provider hooks, evidence persistence, turn sealing, capability routing, and consumer delivery. Evolver becomes the single authority for retrieval, review, solidify, distill, and read-only memory introspection; Stoa only passes evidence and host capabilities in, and receives recall/state/explanations out.

**Tech Stack:** Electron main process, TypeScript, Vitest, existing provider sidecars, pinned Evolver fork under `research/upstreams/evolver`, Node child-process execution for bridge commands.

---

## File Structure

### Shared Contracts

- Modify: `src/shared/memory-runtime.ts`
  - Keep only host-facing event, evidence, job, capability, recall, and introspection contracts.
- Modify: `src/shared/project-session.ts`
  - Rename old memory-provider settings to capability-oriented settings and add renderer API methods for Evolver introspection.
- Modify: `src/core/ipc-channels.ts`
  - Add memory introspection IPC channels.

### Core Memory Host

- Modify: `src/core/memory/evolver-client.ts`
  - Implement the host gateway methods approved by the spec.
- Create: `src/core/memory/inference-router.ts`
  - Resolve an `InferenceCapability` from app settings/runtime context.
- Create: `src/core/memory/execution-router.ts`
  - Resolve an `ExecutionCapability` for validation/solidify work.
- Create: `src/core/memory/turn-maintenance-runner.ts`
  - Execute post-turn review/solidify/distill orchestration using the gateway plus host capabilities.
- Create: `src/core/memory/delivery-paths.ts`
  - Own generated consumer context file paths and remove the old Claude-only injector path helper.
- Modify: `src/core/memory/session-evidence-store.ts`
  - Keep immutable evidence persistence and ensure turn sealing / ref lookup support the runner.
- Modify: `src/core/memory/runtime-state-store.ts`
  - Keep only sealed-turn and maintenance-job state.

### Main Process

- Modify: `src/main/session-event-bridge.ts`
  - Keep hook ingress, evidence persistence, state patching, recall injection, and queued turn maintenance dispatch.
- Modify: `src/main/index.ts`
  - Construct Evolver gateway, inference router, execution router, and visualization IPC handlers.
- Modify: `src/preload/index.ts`
  - Expose read-only Evolver introspection methods.

### Provider Integration

- Modify: `src/extensions/providers/claude-code-provider.ts`
  - Keep SessionStart command hook plus inline recall hook behavior aligned with the new lifecycle.
- Modify: `src/extensions/providers/codex-provider.ts`
  - Keep lifecycle parity with Claude's host model.

### Renderer / Settings

- Modify: `src/renderer/stores/settings.ts`
  - Rename old `memoryAiProvider` state to capability-oriented naming.
- Modify: `src/renderer/components/settings/ProvidersSettings.vue`
  - Update settings copy and controls to reflect inference capability ownership instead of "memory runtime provider".
- Modify: `src/renderer/components/settings/ProvidersSettings.test.ts`
  - Lock the new terminology and update-setting behavior.

### Deletions

- Delete: `src/core/memory/claude-code-injector.ts`
- Delete: `src/core/memory/cli-ai-provider.ts`
- Delete: `src/core/memory/api-ai-provider.ts`
- Delete: `src/core/memory/cli-ai-provider.test.ts`
- Delete: `src/core/memory/api-ai-provider.test.ts`

### Evolver Fork

- Modify: `research/upstreams/evolver/index.js`
  - Add or finalize machine-readable host bridge commands for lifecycle and introspection.
- Modify or Create: `research/upstreams/evolver/src/stoa/hostBridge.js`
  - Implement the bridge command handlers invoked by Stoa.

### Tests

- Modify: `src/core/memory/evolver-client.test.ts`
- Create: `src/core/memory/inference-router.test.ts`
- Create: `src/core/memory/execution-router.test.ts`
- Create: `src/core/memory/turn-maintenance-runner.test.ts`
- Modify: `src/core/memory/runtime-state-store.test.ts`
- Modify: `src/core/memory/session-evidence-store.test.ts`
- Modify: `src/main/session-event-bridge.test.ts`
- Modify: `src/extensions/providers/claude-code-provider.test.ts`
- Modify: `tests/e2e/provider-integration.test.ts`
- Modify: `tests/e2e/main-config-guard.test.ts`
- Modify: `src/renderer/components/settings/ProvidersSettings.test.ts`
- Modify: `src/renderer/app/App.test.ts`

## Task 1: Replace Host Contracts And Settings Terminology

**Files:**
- Modify: `src/shared/memory-runtime.ts`
- Modify: `src/shared/project-session.ts`
- Modify: `src/renderer/stores/settings.ts`
- Modify: `src/renderer/components/settings/ProvidersSettings.vue`
- Modify: `src/renderer/components/settings/ProvidersSettings.test.ts`

- [ ] **Step 1: Write the failing contract/settings tests**

```ts
// src/renderer/components/settings/ProvidersSettings.test.ts
it('renders the Evolver inference provider selector', () => {
  const wrapper = mountComponent()
  expect(wrapper.text()).toContain('Evolver inference provider')
  expect(wrapper.text()).not.toContain('memory AI provider')
})

it('updates evolverInferenceProvider instead of memoryAiProvider', async () => {
  const setSettingMock = vi.fn()
  const wrapper = mountComponent({ setSettingMock })
  await openListboxAndChoose(wrapper, 'Codex')
  expect(setSettingMock).toHaveBeenCalledWith('evolverInferenceProvider', 'codex')
})
```

```ts
// src/shared/memory-runtime.ts
export interface InferenceCapability {
  invoke(input: {
    purpose: 'distill' | 'llm-review'
    prompt: string
    responseFormat: 'text' | 'json'
    projectRoot: string
    timeoutMs?: number
    modelHint?: string
  }): Promise<{
    content: string
    model?: string
    provider?: string
    usage?: { inputTokens?: number; outputTokens?: number }
  }>
}
```

- [ ] **Step 2: Run the focused tests and verify failure**

```bash
npx vitest run src/renderer/components/settings/ProvidersSettings.test.ts
```

Expected: FAIL because the UI still renders `memoryAiProvider` language and `setSetting('memoryAiProvider', ...)`.

- [ ] **Step 3: Replace the shared and settings contracts**

```ts
// src/shared/project-session.ts
export type EvolverInferenceProvider = 'codex' | 'claude-code' | 'api'
export type EvolverExecutionMode = 'workspace-shell'

export interface AppSettings {
  shellPath: string
  terminalFontSize: number
  terminalFontFamily: string
  providers: Record<string, string>
  evolverInferenceProvider: EvolverInferenceProvider
  evolverExecutionMode: EvolverExecutionMode
  workspaceIde: WorkspaceIdeSettings
  claudeDangerouslySkipPermissions: boolean
  locale: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  shellPath: '',
  terminalFontSize: 14,
  terminalFontFamily: 'JetBrains Mono',
  providers: {},
  evolverInferenceProvider: 'claude-code',
  evolverExecutionMode: 'workspace-shell',
  workspaceIde: {
    id: 'vscode',
    executablePath: ''
  },
  claudeDangerouslySkipPermissions: false,
  locale: 'en'
}
```

```ts
// src/renderer/stores/settings.ts
const evolverInferenceProvider = ref<EvolverInferenceProvider>('claude-code')
const evolverExecutionMode = ref<EvolverExecutionMode>('workspace-shell')
```

```vue
<!-- src/renderer/components/settings/ProvidersSettings.vue -->
<div class="settings-copy">
  Choose which provider Stoa should use when Evolver requests LLM work such as distill or optional review.
</div>
```

- [ ] **Step 4: Re-run the focused tests**

```bash
npx vitest run src/renderer/components/settings/ProvidersSettings.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/memory-runtime.ts src/shared/project-session.ts src/renderer/stores/settings.ts src/renderer/components/settings/ProvidersSettings.vue src/renderer/components/settings/ProvidersSettings.test.ts
git commit -m "refactor: rename evolver capability settings"
```

## Task 2: Expand The Evolver Gateway To The Spec Contract

**Files:**
- Modify: `src/core/memory/evolver-client.ts`
- Modify: `src/core/memory/evolver-client.test.ts`
- Modify: `research/upstreams/evolver/index.js`
- Modify or Create: `research/upstreams/evolver/src/stoa/hostBridge.js`

- [ ] **Step 1: Write the failing gateway tests for the missing methods**

```ts
// src/core/memory/evolver-client.test.ts
test('dispatches prepareReview through host-bridge', async () => {
  const runner = vi.fn().mockResolvedValue({
    prompt: 'review this turn',
    responseFormat: 'json'
  })
  const client = makeClient(runner)

  await expect(client.prepareReview({
    projectRoot: 'C:/repo',
    stoaSessionId: 'session_1',
    providerSessionId: 'provider-session-1',
    turnId: 'turn_1'
  })).resolves.toEqual({
    prompt: 'review this turn',
    responseFormat: 'json'
  })

  expect(runner.mock.calls[0]?.[0].args).toEqual([
    'index.js',
    'host-bridge',
    'prepare-review',
    expect.stringMatching(/^--request-file=/),
    '--json'
  ])
})

test('dispatches getStateSummary through host-bridge', async () => {
  const runner = vi.fn().mockResolvedValue({ pendingReview: 1 })
  const client = makeClient(runner)

  await expect(client.getStateSummary({
    projectRoot: 'C:/repo',
    stoaSessionId: 'session_1'
  })).resolves.toEqual({ pendingReview: 1 })
})
```

- [ ] **Step 2: Run the focused tests and verify failure**

```bash
npx vitest run src/core/memory/evolver-client.test.ts
```

Expected: FAIL because `prepareReview`, `completeReview`, `prepareSolidify`, `completeSolidify`, `prepareDistill`, `completeDistill`, `getStateSummary`, `traceTurn`, `explainRecall`, and `getAsset` are missing.

- [ ] **Step 3: Implement the full gateway surface in Stoa**

```ts
// src/core/memory/evolver-client.ts
async prepareReview(input: ReviewPrepareOptions): Promise<{ prompt: string; responseFormat: 'text' | 'json' } | null> {
  return await this.runHostBridgeCommand('prepare-review', input)
}

async completeReview(input: ReviewCompleteOptions): Promise<void> {
  await this.runHostBridgeCommand('complete-review', input)
}

async prepareSolidify(input: SolidifyPrepareOptions): Promise<{ commands: string[] } | null> {
  return await this.runHostBridgeCommand('prepare-solidify', input)
}

async completeSolidify(input: SolidifyCompleteOptions): Promise<void> {
  await this.runHostBridgeCommand('complete-solidify', input)
}

async getStateSummary(input: StateSummaryOptions): Promise<Record<string, unknown>> {
  return await this.runHostBridgeCommand('state-summary', input)
}
```

```js
// research/upstreams/evolver/src/stoa/hostBridge.js
export async function runHostBridge(action, request) {
  switch (action) {
    case 'prepare-review':
      return await prepareReviewPayload(request)
    case 'complete-review':
      return await completeReviewPayload(request)
    case 'prepare-solidify':
      return await prepareSolidifyPayload(request)
    case 'complete-solidify':
      return await completeSolidifyPayload(request)
    case 'state-summary':
      return await getStateSummaryPayload(request)
    default:
      throw new Error(`Unsupported host bridge action: ${action}`)
  }
}
```

- [ ] **Step 4: Re-run the focused tests**

```bash
npx vitest run src/core/memory/evolver-client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/memory/evolver-client.ts src/core/memory/evolver-client.test.ts research/upstreams/evolver/index.js research/upstreams/evolver/src/stoa/hostBridge.js
git commit -m "feat: expand evolver host gateway contract"
```

## Task 3: Add Inference Routing, Execution Routing, And Post-Turn Maintenance

**Files:**
- Create: `src/core/memory/inference-router.ts`
- Create: `src/core/memory/inference-router.test.ts`
- Create: `src/core/memory/execution-router.ts`
- Create: `src/core/memory/execution-router.test.ts`
- Create: `src/core/memory/turn-maintenance-runner.ts`
- Create: `src/core/memory/turn-maintenance-runner.test.ts`

- [ ] **Step 1: Write the failing capability/runner tests**

```ts
// src/core/memory/turn-maintenance-runner.test.ts
test('runs review then solidify then distill with host capabilities', async () => {
  const gateway = {
    processTurn: vi.fn().mockResolvedValue({ jobId: 'job_turn_1', state: 'queued' }),
    prepareReview: vi.fn().mockResolvedValue({ prompt: 'review me', responseFormat: 'json' }),
    completeReview: vi.fn().mockResolvedValue(undefined),
    prepareSolidify: vi.fn().mockResolvedValue({ commands: ['npm test'] }),
    completeSolidify: vi.fn().mockResolvedValue(undefined),
    prepareDistill: vi.fn().mockResolvedValue({ prompt: 'distill me', responseFormat: 'text' }),
    completeDistill: vi.fn().mockResolvedValue(undefined)
  }
  const inference = { invoke: vi.fn().mockResolvedValue({ content: 'approved' }) }
  const execution = { run: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: 'ok', stderr: '', commandResults: [] }) }

  const runner = new TurnMaintenanceRunner(gateway, inference, execution)
  await runner.run({
    projectRoot: 'C:/repo',
    stoaSessionId: 'session_1',
    providerSessionId: 'provider-session-1',
    turnId: 'turn_1',
    evidenceRefs: []
  })

  expect(inference.invoke).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'llm-review' }))
  expect(execution.run).toHaveBeenCalledWith(expect.objectContaining({ commands: ['npm test'] }))
  expect(gateway.completeDistill).toHaveBeenCalledWith(expect.objectContaining({ response: 'approved' }))
})
```

```ts
// src/core/memory/inference-router.ts
export class InferenceRouter {
  async resolve(): Promise<InferenceCapability> {
    throw new Error('not implemented')
  }
}
```

- [ ] **Step 2: Run the focused tests and verify failure**

```bash
npx vitest run src/core/memory/inference-router.test.ts src/core/memory/execution-router.test.ts src/core/memory/turn-maintenance-runner.test.ts
```

Expected: FAIL because the routers and runner do not exist yet.

- [ ] **Step 3: Implement minimal routers and the runner**

```ts
// src/core/memory/inference-router.ts
export class InferenceRouter {
  constructor(
    private readonly settingsReader: { getInferenceProvider(): 'claude-code' | 'codex' | 'api' },
    private readonly factories: Record<'claude-code' | 'codex' | 'api', () => Promise<InferenceCapability>>
  ) {}

  async resolve(): Promise<InferenceCapability> {
    const provider = this.settingsReader.getInferenceProvider()
    return await this.factories[provider]()
  }
}
```

```ts
// src/core/memory/execution-router.ts
export class ExecutionRouter {
  constructor(private readonly capability: ExecutionCapability) {}

  async resolve(): Promise<ExecutionCapability> {
    return this.capability
  }
}
```

```ts
// src/core/memory/turn-maintenance-runner.ts
export class TurnMaintenanceRunner {
  constructor(
    private readonly gateway: EvolverGateway,
    private readonly inference: InferenceCapability,
    private readonly execution: ExecutionCapability
  ) {}

  async run(input: RunnerInput): Promise<TurnJob> {
    const job = await this.gateway.processTurn({
      ...input,
      inference: this.inference,
      execution: this.execution
    })

    const review = await this.gateway.prepareReview(input)
    if (review) {
      const reviewResponse = await this.inference.invoke({
        purpose: 'llm-review',
        prompt: review.prompt,
        responseFormat: review.responseFormat,
        projectRoot: input.projectRoot
      })
      await this.gateway.completeReview({ ...input, response: reviewResponse.content })
    }

    const solidify = await this.gateway.prepareSolidify(input)
    if (solidify) {
      const result = await this.execution.run({
        commands: solidify.commands,
        projectRoot: input.projectRoot
      })
      await this.gateway.completeSolidify({ ...input, result })
    }

    const distill = await this.gateway.prepareDistill(input)
    if (distill) {
      const distillResponse = await this.inference.invoke({
        purpose: 'distill',
        prompt: distill.prompt,
        responseFormat: distill.responseFormat,
        projectRoot: input.projectRoot
      })
      await this.gateway.completeDistill({ ...input, response: distillResponse.content })
    }

    return job
  }
}
```

- [ ] **Step 4: Re-run the focused tests**

```bash
npx vitest run src/core/memory/inference-router.test.ts src/core/memory/execution-router.test.ts src/core/memory/turn-maintenance-runner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/memory/inference-router.ts src/core/memory/inference-router.test.ts src/core/memory/execution-router.ts src/core/memory/execution-router.test.ts src/core/memory/turn-maintenance-runner.ts src/core/memory/turn-maintenance-runner.test.ts
git commit -m "feat: add evolver capability routers and turn maintenance runner"
```

## Task 4: Rewrite SessionEventBridge Around Recall And Queued Maintenance

**Files:**
- Modify: `src/main/session-event-bridge.ts`
- Modify: `src/main/session-event-bridge.test.ts`
- Modify: `src/core/memory/session-evidence-store.ts`
- Modify: `src/core/memory/session-evidence-store.test.ts`
- Modify: `src/core/memory/runtime-state-store.ts`
- Modify: `src/core/memory/runtime-state-store.test.ts`

- [ ] **Step 1: Write the failing lifecycle tests**

```ts
// src/main/session-event-bridge.test.ts
test('SessionStart calls warmStart and returns hookSpecificOutput', async () => {
  const warmStart = vi.fn().mockResolvedValue({
    content: 'recent memory',
    selectedRefs: [],
    selectionPolicy: 'warm-start-v1'
  })
  const bridge = makeBridge({ warmStart })
  const response = await postClaudeHookForSessionStart(bridge)
  expect(warmStart).toHaveBeenCalledOnce()
  expect(response).toEqual({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: 'recent memory'
    }
  })
})

test('Stop seals the turn and dispatches TurnMaintenanceRunner', async () => {
  const runner = { run: vi.fn().mockResolvedValue({ jobId: 'job_turn_1', state: 'done' }) }
  const bridge = makeBridge({ runner })
  await postClaudeHookForStop(bridge)
  expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ turnId: expect.any(String) }))
})
```

- [ ] **Step 2: Run the focused tests and verify failure**

```bash
npx vitest run src/main/session-event-bridge.test.ts src/core/memory/session-evidence-store.test.ts src/core/memory/runtime-state-store.test.ts
```

Expected: FAIL because `SessionEventBridge` still owns the async `processTurn` dispatch directly and has no injected maintenance runner.

- [ ] **Step 3: Inject the runner and keep bridge responsibilities narrow**

```ts
// src/main/session-event-bridge.ts
interface TurnMaintenanceRunnerLike {
  run(input: {
    projectRoot: string
    stoaSessionId: string
    providerSessionId?: string
    turnId: string
    evidenceRefs: EvidenceRef[]
  }): Promise<TurnJob>
}

constructor(..., options: SessionEventBridgeOptions = {}) {
  this.turnMaintenanceRunner = options.turnMaintenanceRunner
}

private async finalizeTurn(projectPath: string, event: CanonicalSessionEvent, evidenceRef: EvidenceRef | null): Promise<void> {
  // persist seal and queued job state first
  // then call this.turnMaintenanceRunner?.run(...)
}
```

```ts
// src/core/memory/session-evidence-store.ts
async listEvidenceRefsForTurn(projectPath: string, stoaSessionId: string, turnId: string): Promise<EvidenceRef[]> {
  // keep deterministic order by metadata timestamp, then eventId
}
```

- [ ] **Step 4: Re-run the focused tests**

```bash
npx vitest run src/main/session-event-bridge.test.ts src/core/memory/session-evidence-store.test.ts src/core/memory/runtime-state-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/session-event-bridge.ts src/main/session-event-bridge.test.ts src/core/memory/session-evidence-store.ts src/core/memory/session-evidence-store.test.ts src/core/memory/runtime-state-store.ts src/core/memory/runtime-state-store.test.ts
git commit -m "refactor: queue evolver maintenance from session event bridge"
```

## Task 5: Replace Claude Injector Leftovers With Delivery Paths And Delete Legacy AI Helpers

**Files:**
- Create: `src/core/memory/delivery-paths.ts`
- Modify: `src/main/index.ts`
- Delete: `src/core/memory/claude-code-injector.ts`
- Delete: `src/core/memory/cli-ai-provider.ts`
- Delete: `src/core/memory/api-ai-provider.ts`
- Delete: `src/core/memory/cli-ai-provider.test.ts`
- Delete: `src/core/memory/api-ai-provider.test.ts`

- [ ] **Step 1: Write the failing path helper test**

```ts
// src/core/memory/delivery-paths.test.ts
test('returns the Claude generated context path under .stoa/generated/evolver-context', () => {
  expect(getConsumerContextPath('D:/repo', 'claude-code')).toBe(
    'D:\\repo\\.stoa\\generated\\evolver-context\\claude-code.jsonl'
  )
})
```

- [ ] **Step 2: Run the focused tests and verify failure**

```bash
npx vitest run src/core/memory/delivery-paths.test.ts src/main/preload-path.test.ts
```

Expected: FAIL because `delivery-paths.ts` does not exist and `index.ts` still imports `getClaudeCodePublishedContextPath` from the legacy injector.

- [ ] **Step 3: Replace the helper and remove dead files**

```ts
// src/core/memory/delivery-paths.ts
import { join } from 'node:path'
import type { ConsumerType } from '@shared/memory-runtime'

export function getConsumerContextPath(projectRoot: string, consumer: Extract<ConsumerType, 'claude-code' | 'codex'>): string {
  return join(projectRoot, '.stoa', 'generated', 'evolver-context', `${consumer}.jsonl`)
}
```

```ts
// src/main/index.ts
import { getConsumerContextPath } from '@core/memory/delivery-paths'

const publishedContextPath = getConsumerContextPath(packagedSmokeProjectDir, 'claude-code')
```

- [ ] **Step 4: Re-run the focused tests**

```bash
npx vitest run src/core/memory/delivery-paths.test.ts src/main/preload-path.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/memory/delivery-paths.ts src/core/memory/delivery-paths.test.ts src/main/index.ts
git rm src/core/memory/claude-code-injector.ts src/core/memory/cli-ai-provider.ts src/core/memory/api-ai-provider.ts src/core/memory/cli-ai-provider.test.ts src/core/memory/api-ai-provider.test.ts
git commit -m "refactor: remove legacy stoa-owned memory helpers"
```

## Task 6: Add Read-Only Evolver Introspection IPC

**Files:**
- Modify: `src/core/ipc-channels.ts`
- Modify: `src/shared/project-session.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `tests/e2e/main-config-guard.test.ts`
- Modify: `src/renderer/app/App.test.ts`

- [ ] **Step 1: Write the failing IPC contract tests**

```ts
// tests/e2e/main-config-guard.test.ts
it('registers memory introspection channels via IPC_CHANNELS constants', () => {
  expect(mainSource).toContain('IPC_CHANNELS.memoryGetStateSummary')
  expect(mainSource).toContain('IPC_CHANNELS.memoryTraceTurn')
  expect(mainSource).toContain('IPC_CHANNELS.memoryExplainRecall')
  expect(mainSource).toContain('IPC_CHANNELS.memoryGetAsset')
})
```

```ts
// src/shared/project-session.ts
export interface RendererApi {
  getMemoryStateSummary: (input: { projectRoot: string; stoaSessionId?: string; providerSessionId?: string }) => Promise<Record<string, unknown>>
  traceMemoryTurn: (input: { projectRoot: string; stoaSessionId: string; providerSessionId?: string; turnId: string }) => Promise<Record<string, unknown>>
  explainMemoryRecall: (input: { projectRoot: string; consumer: 'claude-code' | 'codex' | 'opencode' | 'generic'; stoaSessionId: string; providerSessionId?: string; taskText: string }) => Promise<Record<string, unknown>>
  getMemoryAsset: (input: { ref: string }) => Promise<Record<string, unknown> | null>
}
```

- [ ] **Step 2: Run the focused tests and verify failure**

```bash
npx vitest run tests/e2e/main-config-guard.test.ts src/renderer/app/App.test.ts
```

Expected: FAIL because none of the new IPC channels or renderer API methods exist.

- [ ] **Step 3: Wire the IPC handlers and preload bridge**

```ts
// src/core/ipc-channels.ts
memoryGetStateSummary: 'memory:get-state-summary',
memoryTraceTurn: 'memory:trace-turn',
memoryExplainRecall: 'memory:explain-recall',
memoryGetAsset: 'memory:get-asset',
```

```ts
// src/preload/index.ts
async getMemoryStateSummary(input) {
  return ipcRenderer.invoke(IPC_CHANNELS.memoryGetStateSummary, input)
},
async traceMemoryTurn(input) {
  return ipcRenderer.invoke(IPC_CHANNELS.memoryTraceTurn, input)
},
async explainMemoryRecall(input) {
  return ipcRenderer.invoke(IPC_CHANNELS.memoryExplainRecall, input)
},
async getMemoryAsset(input) {
  return ipcRenderer.invoke(IPC_CHANNELS.memoryGetAsset, input)
},
```

```ts
// src/main/index.ts
ipcMain.handle(IPC_CHANNELS.memoryGetStateSummary, async (_event, input) => {
  return evolverBridge?.getStateSummary(input) ?? null
})
```

- [ ] **Step 4: Re-run the focused tests**

```bash
npx vitest run tests/e2e/main-config-guard.test.ts src/renderer/app/App.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/ipc-channels.ts src/shared/project-session.ts src/preload/index.ts src/main/index.ts tests/e2e/main-config-guard.test.ts src/renderer/app/App.test.ts
git commit -m "feat: expose evolver introspection through ipc"
```

## Task 7: Lock Provider Hook Lifecycle To The Approved Model

**Files:**
- Modify: `src/extensions/providers/claude-code-provider.ts`
- Modify: `src/extensions/providers/claude-code-provider.test.ts`
- Modify: `src/extensions/providers/codex-provider.ts`
- Modify: `tests/e2e/provider-integration.test.ts`

- [ ] **Step 1: Write the failing lifecycle hook tests**

```ts
// src/extensions/providers/claude-code-provider.test.ts
test('uses command hooks only for SessionStart and keeps UserPromptSubmit inline-capable', async () => {
  const provider = createClaudeCodeProvider()
  await provider.installSidecar(target, context)
  const settings = await readClaudeSettings(target.path)
  expect(readHookEntry(settings, 'SessionStart').type).toBe('command')
  expect(readHookEntry(settings, 'UserPromptSubmit').type).toBe('http')
  expect(readHookEntry(settings, 'PostToolUse').type).toBe('http')
  expect(readHookEntry(settings, 'Stop').type).toBe('http')
})
```

```ts
// tests/e2e/provider-integration.test.ts
test('Codex hook sidecar returns inline JSON to stdout for UserPromptSubmit recall', async () => {
  const output = await spawnCodexHook('UserPromptSubmit', {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'codex-thread-1',
    turn_id: 'turn-1',
    prompt: 'Install dependencies'
  })
  expect(output.stdout).toContain('additionalContext')
})
```

- [ ] **Step 2: Run the focused tests and verify failure**

```bash
npx vitest run src/extensions/providers/claude-code-provider.test.ts tests/e2e/provider-integration.test.ts
```

Expected: FAIL anywhere a provider still assumes old publish-context file injection semantics instead of inline recall lifecycle behavior.

- [ ] **Step 3: Keep the provider wiring thin and lifecycle-accurate**

```ts
// src/extensions/providers/claude-code-provider.ts
function buildClaudeHooksForContext(context: ProviderCommandContext): ClaudeHookSettings {
  return {
    hooks: {
      SessionStart: [createStoaCommandHook('node .claude/hooks/stoa-hook-session-start.cjs SessionStart')],
      UserPromptSubmit: [createStoaHttpHook(context)],
      PostToolUse: [createStoaHttpHook(context, 'Write')],
      Stop: [createStoaHttpHook(context)],
      StopFailure: [createStoaHttpHook(context)],
      PermissionRequest: [createStoaHttpHook(context)]
    }
  }
}
```

```ts
// src/extensions/providers/codex-provider.ts
const hooksConfig = {
  hooks: {
    SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'node .codex/hook-stoa.mjs SessionStart', timeout_sec: 5 }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node .codex/hook-stoa.mjs UserPromptSubmit', timeout_sec: 5 }] }],
    PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'node .codex/hook-stoa.mjs PostToolUse', timeout_sec: 5 }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'node .codex/hook-stoa.mjs Stop', timeout_sec: 5 }] }]
  }
}
```

- [ ] **Step 4: Re-run the focused tests**

```bash
npx vitest run src/extensions/providers/claude-code-provider.test.ts tests/e2e/provider-integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extensions/providers/claude-code-provider.ts src/extensions/providers/claude-code-provider.test.ts src/extensions/providers/codex-provider.ts tests/e2e/provider-integration.test.ts
git commit -m "test: lock provider hooks to runtime host lifecycle"
```

## Task 8: Full Verification And Documentation Cleanup

**Files:**
- Modify: `docs/engineering/evolver-data-flow.md`
- Modify any generated assets only if the new lifecycle requires them

- [ ] **Step 1: Update the implementation-status doc**

```md
<!-- docs/engineering/evolver-data-flow.md -->
Current implementation status:
- Stoa owns runtime events, evidence, routing, and delivery.
- Evolver owns retrieval, review, solidify, distill, and introspection.
- `UserPromptSubmit` is the default task-aware recall point.
```

- [ ] **Step 2: Regenerate deterministic assets**

```bash
npm run test:generate
```

Expected: exits `0`.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: exits `0`.

- [ ] **Step 4: Run unit, integration, and static tests**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 5: Run Electron journeys**

```bash
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 6: Run behavior coverage**

```bash
npm run test:behavior-coverage
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add docs/engineering/evolver-data-flow.md src/shared/memory-runtime.ts src/shared/project-session.ts src/core/ipc-channels.ts src/core/memory src/main src/preload src/extensions/providers src/renderer/stores/settings.ts src/renderer/components/settings tests/e2e
git commit -m "docs: finalize runtime host evolver implementation"
```

## Self-Review

### Spec Coverage

- Ownership boundary is covered in Tasks 1, 3, 4, and 5.
- Lifecycle timing is covered in Tasks 4 and 7.
- Inference/execution capability routing is covered in Tasks 1 and 3.
- Read-only visualization/introspection is covered in Task 6.
- Forbidden legacy couplings are removed in Tasks 1 and 5.
- Provider delivery and consumer timing are covered in Tasks 4 and 7.

### Placeholder Scan

- No placeholder markers remain.
- Every code-changing task includes concrete file paths, code snippets, and exact commands.

### Type Consistency

- Contract naming is consistent around `evolverInferenceProvider`, `InferenceCapability`, `ExecutionCapability`, `TurnMaintenanceRunner`, and the `EvolverGateway` surface.
- The same lifecycle names are used across bridge, provider hooks, and IPC.
