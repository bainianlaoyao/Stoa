# CLI Status Chain Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse CLI session status acquisition, propagation, and display into one backend-owned state fact path and one renderer-facing presence snapshot path.

**Architecture:** Provider hooks/plugins/notify still produce structured events, but status facts reduce only through `SessionSummary` via `reduceSessionState()`. Renderer status UI consumes `SessionPresenceSnapshot` as the only authoritative display input; observability evidence remains metadata enrichment and no longer competes with the status path.

**Tech Stack:** TypeScript, Electron IPC, Vue 3 Composition API, Pinia, Vitest, Playwright, project testing DSL.

---

## Ground Rules

- This is a breaking change. Do not add compatibility shims for old renderer status paths.
- Do not infer agent state from terminal text or PTY data.
- Do not hand-edit generated files under `tests/generated/`.
- Preserve `docs/engineering/design-language.md` for any component touch.
- Keep `SessionSummary` as the backend status fact source.
- Keep `SessionPresenceSnapshot` as the renderer status display source.
- Keep observability evidence for model/snippet/tool/error metadata only.

## File Structure

- Modify `src/shared/project-session.ts`: remove renderer-facing `SessionSummaryEvent` subscription contract if no non-status consumer remains; otherwise rename it away from status semantics.
- Modify `src/core/ipc-channels.ts`: remove or demote the legacy `sessionEvent` channel after renderer status no longer depends on it.
- Modify `src/preload/index.ts`: stop exposing status-driving `onSessionEvent`.
- Modify `src/main/session-runtime-controller.ts`: stop pushing `SessionSummaryEvent` as a status display update; push presence snapshots after every state change.
- Modify `src/main/session-event-bridge.ts`: make state patch application the primary hot path; keep evidence ingestion optional and non-authoritative.
- Modify `src/core/observability-service.ts`: preserve snapshot metadata rebuild, but do not own phase decisions outside `buildSessionPresenceSnapshot()`.
- Modify `src/renderer/stores/workspaces.ts`: make backend presence snapshots authoritative; keep fallback only for bootstrap sessions before a backend snapshot exists.
- Modify `src/renderer/app/App.vue`: remove `onSessionEvent` subscription.
- Modify `src/renderer/components/command/CommandSurface.vue`: remove component-level status fallback.
- Modify `src/renderer/components/WorkspaceList.vue`: remove direct `derivePresencePhase()` status bypass or route it through `SessionPresenceSnapshot`.
- Modify `src/renderer/components/TerminalViewport.vue`: ensure terminal runtime behavior does not depend on legacy `onSessionEvent`.
- Modify tests under `src/**/*.test.ts`, `tests/e2e/**/*.test.ts`, and `testing/**/*.ts` to lock the single status path.

## Task 1: Lock the Shared Status Contract

**Files:**
- Modify: `src/shared/project-session.ts`
- Modify: `src/shared/session-state-reducer.test.ts`
- Modify: `src/shared/observability-projection.test.ts`

- [ ] **Step 1: Add contract tests that presence phase is derived only from `SessionSummary` fields**

Add or extend tests in `src/shared/session-state-reducer.test.ts`:

```ts
it('derives agent provider alive + unknown as ready rather than running', () => {
  expect(derivePresencePhase({
    runtimeState: 'alive',
    agentState: 'unknown',
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    provider: 'codex'
  })).toBe('ready')
})

it('derives shell alive + unknown as running', () => {
  expect(derivePresencePhase({
    runtimeState: 'alive',
    agentState: 'unknown',
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    provider: 'shell'
  })).toBe('running')
})

it('keeps complete visible until completion_seen clears unseen completion', () => {
  const complete = session({
    runtimeState: 'alive',
    agentState: 'idle',
    hasUnseenCompletion: true
  })

  expect(derivePresencePhase({
    runtimeState: complete.runtimeState,
    agentState: complete.agentState,
    hasUnseenCompletion: complete.hasUnseenCompletion,
    runtimeExitCode: complete.runtimeExitCode,
    runtimeExitReason: complete.runtimeExitReason,
    provider: complete.type
  })).toBe('complete')

  const next = reduceSessionState(complete, patch({
    sequence: complete.lastStateSequence + 1,
    intent: 'agent.completion_seen',
    source: 'ui',
    summary: 'Completion seen'
  }), '2026-04-26T00:00:00.000Z')

  expect(next.agentState).toBe('idle')
  expect(next.hasUnseenCompletion).toBe(false)
})
```

- [ ] **Step 2: Run the shared reducer tests**

Run: `npx vitest run src/shared/session-state-reducer.test.ts`

Expected: PASS for existing reducer behavior before larger refactor. If these fail, fix reducer first because all later tasks depend on this contract.

- [ ] **Step 3: Add projection test proving evidence metadata does not override phase**

Add to `src/shared/observability-projection.test.ts`:

```ts
it('keeps phase derived from session state even when metadata is present', () => {
  const snapshot = buildSessionPresenceSnapshot(session({
    runtimeState: 'alive',
    agentState: 'idle',
    hasUnseenCompletion: false,
    type: 'claude-code'
  }), {
    activeSessionId: 'other-session',
    nowIso: '2026-04-26T00:00:00.000Z',
    modelLabel: 'claude-sonnet',
    lastAssistantSnippet: 'Finished the task.',
    lastEvidenceType: 'evidence.assistant_message_observed',
    lastEventAt: '2026-04-26T00:00:00.000Z',
    evidenceSequence: 12,
    sourceSequence: 12
  })

  expect(snapshot.phase).toBe('ready')
  expect(snapshot.modelLabel).toBe('claude-sonnet')
  expect(snapshot.lastAssistantSnippet).toBe('Finished the task.')
})
```

- [ ] **Step 4: Run projection tests**

Run: `npx vitest run src/shared/observability-projection.test.ts`

Expected: PASS. This locks the boundary: evidence can enrich labels/snippets but not invent phase.

- [ ] **Step 5: Commit**

```bash
git add src/shared/session-state-reducer.test.ts src/shared/observability-projection.test.ts
git commit -m "test: lock single-source session presence derivation"
```

## Task 2: Make Presence Snapshot Push the Only Status Update from Main

**Files:**
- Modify: `src/main/session-runtime-controller.ts`
- Modify: `src/main/session-runtime-controller.test.ts`
- Modify: `src/core/ipc-channels.ts`

- [ ] **Step 1: Add controller test that state changes push presence snapshots**

In `src/main/session-runtime-controller.test.ts`, add a test that calls `applyProviderStatePatch()` and asserts the window receives `IPC_CHANNELS.observabilitySessionPresenceChanged`, not just `IPC_CHANNELS.sessionEvent`:

```ts
it('pushes session presence after provider state patches', async () => {
  const manager = ProjectSessionManager.createForTest()
  const project = await manager.createProject({ name: 'Demo', path: 'D:/demo' })
  const session = await manager.createSession({ projectId: project.id, type: 'claude-code', title: 'Claude' })
  await manager.markRuntimeAlive(session.id, 'external-1')

  const sent: Array<{ channel: string; data: unknown }> = []
  const observability = createRuntimeObservabilityReader()
  const controller = new SessionRuntimeController(
    manager,
    () => ({
      isDestroyed: () => false,
      webContents: {
        send: (channel, data) => sent.push({ channel, data })
      }
    }),
    undefined,
    observability
  )

  await controller.applyProviderStatePatch({
    sessionId: session.id,
    sequence: 3,
    occurredAt: '2026-04-26T00:00:00.000Z',
    intent: 'agent.turn_started',
    source: 'provider',
    sourceEventType: 'claude-code.UserPromptSubmit',
    agentState: 'working',
    summary: 'UserPromptSubmit'
  })

  expect(sent.some(event => event.channel === IPC_CHANNELS.observabilitySessionPresenceChanged)).toBe(true)
  expect(sent.some(event => event.channel === IPC_CHANNELS.sessionEvent)).toBe(false)
})
```

If `createRuntimeObservabilityReader()` does not exist in the file, add a small test helper with `syncSessions`, `getSessionPresence`, `getProjectObservability`, and `getAppObservability` methods backed by `ObservabilityService`.

- [ ] **Step 2: Run controller test and confirm failure**

Run: `npx vitest run src/main/session-runtime-controller.test.ts`

Expected: FAIL because `pushSessionSummaryPatch()` currently sends `IPC_CHANNELS.sessionEvent`.

- [ ] **Step 3: Remove status-driving session summary push**

In `src/main/session-runtime-controller.ts`, change state-change methods so they call `finishSessionStateChange(sessionId)` only:

```ts
async applyProviderStatePatch(patch: SessionStatePatchEvent): Promise<void> {
  await this.manager.applySessionStatePatch(patch)
  this.finishSessionStateChange(patch.sessionId)
}
```

Apply the same pattern to `markRuntimeStarting`, `markRuntimeAlive`, `markRuntimeExited`, `markRuntimeFailedToStart`, and `setActiveSession`.

Delete the private `pushSessionSummaryPatch()` method once no method calls it.

- [ ] **Step 4: Keep presence push strict**

In `pushObservabilitySnapshots(sessionId)`, keep this ordering:

```ts
const snapshot = this.manager.snapshot()
this.observability.syncSessions(snapshot.sessions, snapshot.activeSessionId)
const sessionPresence = this.observability.getSessionPresence(sessionId)

if (sessionPresence) {
  win.webContents.send(IPC_CHANNELS.observabilitySessionPresenceChanged, sessionPresence)
}
```

Do not add a fallback `SessionSummaryEvent` send.

- [ ] **Step 5: Run controller tests**

Run: `npx vitest run src/main/session-runtime-controller.test.ts`

Expected: PASS. If tests expecting `sessionEvent` fail, update them to assert presence snapshot push instead.

- [ ] **Step 6: Commit**

```bash
git add src/main/session-runtime-controller.ts src/main/session-runtime-controller.test.ts src/core/ipc-channels.ts
git commit -m "refactor: make presence snapshots the main status push"
```

## Task 3: Remove Legacy Renderer Status Subscription

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/shared/project-session.ts`
- Modify: `src/renderer/app/App.vue`
- Modify: `src/renderer/app/App.test.ts`
- Modify: `tests/e2e/ipc-bridge.test.ts`
- Modify: `tests/e2e/main-config-guard.test.ts`

- [ ] **Step 1: Add failing App test that status updates come from presence subscription**

In `src/renderer/app/App.test.ts`, add:

```ts
it('updates session status display from presence push without onSessionEvent', async () => {
  const sessionPresenceListeners: Array<(snapshot: SessionPresenceSnapshot) => void> = []
  setupStoaApi({
    onSessionEvent: undefined,
    onSessionPresenceChanged: vi.fn().mockImplementation((listener: (snapshot: SessionPresenceSnapshot) => void) => {
      sessionPresenceListeners.push(listener)
      return vi.fn()
    }),
    getSessionPresence: vi.fn().mockResolvedValue(null),
    getBootstrapState: vi.fn().mockResolvedValue({
      activeProjectId: 'p1',
      activeSessionId: 's1',
      terminalWebhookPort: 49152,
      projects: [createProjectSummary({ id: 'p1' })],
      sessions: [createSessionSummary({
        id: 's1',
        projectId: 'p1',
        runtimeState: 'alive',
        agentState: 'idle',
        hasUnseenCompletion: false
      })]
    })
  })

  mount(App)
  await flushPromises()

  sessionPresenceListeners[0]?.(createSessionPresenceSnapshot({
    sessionId: 's1',
    projectId: 'p1',
    phase: 'running',
    agentState: 'working',
    sourceSequence: 9,
    updatedAt: '2026-04-26T00:00:00.000Z'
  }))
  await flushPromises()

  expect(document.body.querySelector('[data-session-status-testid="session-status-running"]')).toBeTruthy()
})
```

- [ ] **Step 2: Run App test and confirm failure**

Run: `npx vitest run src/renderer/app/App.test.ts`

Expected: FAIL if App still assumes `window.stoa.onSessionEvent` exists.

- [ ] **Step 3: Remove `onSessionEvent` from renderer API**

In `src/shared/project-session.ts`, remove:

```ts
export interface SessionSummaryEvent {
  session: SessionSummary
}
```

Remove this member from `RendererApi`:

```ts
onSessionEvent: (callback: (event: SessionSummaryEvent) => void) => () => void
```

In `src/preload/index.ts`, remove the import of `SessionSummaryEvent` and delete:

```ts
onSessionEvent(callback: (event: SessionSummaryEvent) => void) {
  const handler = (_event: Electron.IpcRendererEvent, event: SessionSummaryEvent) => callback(event)
  ipcRenderer.on(IPC_CHANNELS.sessionEvent, handler)
  return () => ipcRenderer.removeListener(IPC_CHANNELS.sessionEvent, handler)
}
```

- [ ] **Step 4: Remove App subscription**

In `src/renderer/app/App.vue`, delete:

```ts
let unsubscribeSessionEvent: (() => void) | null = null
```

Delete this mounted subscription:

```ts
unsubscribeSessionEvent = window.stoa?.onSessionEvent?.((event: SessionSummaryEvent) => {
  workspaceStore.updateSession(event.session.id, event.session)
})
```

Delete this unmount line:

```ts
unsubscribeSessionEvent?.()
```

Remove `SessionSummaryEvent` from imports.

- [ ] **Step 5: Update IPC guard tests**

In `tests/e2e/main-config-guard.test.ts`, remove expectations that preload exposes `onSessionEvent`. Keep expectations for:

```ts
onSessionPresenceChanged
onProjectObservabilityChanged
onAppObservabilityChanged
```

In `tests/e2e/ipc-bridge.test.ts`, replace any renderer round-trip assertions for `onSessionEvent` with `onSessionPresenceChanged`.

- [ ] **Step 6: Run affected tests**

Run:

```bash
npx vitest run src/renderer/app/App.test.ts tests/e2e/ipc-bridge.test.ts tests/e2e/main-config-guard.test.ts
```

Expected: PASS. There should be no remaining type usage of `SessionSummaryEvent`.

- [ ] **Step 7: Search for remaining legacy subscription usage**

Run: `rg -n "onSessionEvent|SessionSummaryEvent|IPC_CHANNELS\\.sessionEvent" src tests testing`

Expected: no renderer/preload status subscription usage. If `IPC_CHANNELS.sessionEvent` remains only as an unused constant, remove it and update guard tests.

- [ ] **Step 8: Commit**

```bash
git add src/shared/project-session.ts src/preload/index.ts src/renderer/app/App.vue src/renderer/app/App.test.ts tests/e2e/ipc-bridge.test.ts tests/e2e/main-config-guard.test.ts
git commit -m "refactor: remove legacy session status subscription"
```

## Task 4: Centralize Renderer Presence Fallback in Pinia Store

**Files:**
- Modify: `src/renderer/stores/workspaces.ts`
- Modify: `src/renderer/stores/workspaces.test.ts`
- Modify: `src/renderer/components/command/CommandSurface.vue`
- Modify: `src/renderer/components/command/CommandSurface.test.ts`

- [ ] **Step 1: Add store test for one-time bootstrap fallback**

In `src/renderer/stores/workspaces.test.ts`, add:

```ts
it('creates fallback presence during hydrate before backend snapshots exist', () => {
  const store = useWorkspaceStore()
  store.hydrate({
    activeProjectId: 'p1',
    activeSessionId: 's1',
    terminalWebhookPort: 49152,
    projects: [projectFixture({ id: 'p1' })],
    sessions: [sessionFixture({
      id: 's1',
      projectId: 'p1',
      type: 'codex',
      runtimeState: 'alive',
      agentState: 'unknown'
    })]
  })

  expect(store.sessionPresenceById.s1?.phase).toBe('ready')
})
```

- [ ] **Step 2: Add store test that backend snapshot permanently owns status**

Add:

```ts
it('does not let local session updates overwrite backend presence snapshots', () => {
  const store = useWorkspaceStore()
  store.hydrate({
    activeProjectId: 'p1',
    activeSessionId: 's1',
    terminalWebhookPort: 49152,
    projects: [projectFixture({ id: 'p1' })],
    sessions: [sessionFixture({
      id: 's1',
      projectId: 'p1',
      runtimeState: 'alive',
      agentState: 'idle'
    })]
  })

  store.applySessionPresenceSnapshot(sessionPresenceFixture({
    sessionId: 's1',
    projectId: 'p1',
    phase: 'running',
    agentState: 'working',
    sourceSequence: 10,
    updatedAt: '2026-04-26T00:00:00.000Z'
  }))

  store.updateSession('s1', {
    agentState: 'idle',
    hasUnseenCompletion: false,
    lastStateSequence: 3
  })

  expect(store.sessionPresenceById.s1?.phase).toBe('running')
})
```

If `applySessionPresenceSnapshot` is private, expose it from the store return object for tests and event handling. It is already a renderer-facing application action, so exposing it is cleaner than testing through hidden listener plumbing.

- [ ] **Step 3: Run store tests and confirm failure**

Run: `npx vitest run src/renderer/stores/workspaces.test.ts`

Expected: FAIL until hydrate creates fallback and backend ownership is explicit.

- [ ] **Step 4: Create fallback during hydrate**

In `src/renderer/stores/workspaces.ts`, update `hydrate(state)`:

```ts
function hydrate(state: BootstrapState): void {
  projects.value = state.projects
  sessions.value = state.sessions
  activeProjectId.value = state.activeProjectId
  activeSessionId.value = state.activeSessionId
  terminalWebhookPort.value = state.terminalWebhookPort

  for (const session of state.sessions) {
    syncSessionPresenceFromSummary(session)
  }
}
```

Keep `syncSessionPresenceFromSummary()` guarded by `backendSessionPresenceIds.has(session.id)`.

- [ ] **Step 5: Expose presence action**

In the store return object, add:

```ts
applySessionPresenceSnapshot
```

Use this same action inside `subscribeToObservability()`.

- [ ] **Step 6: Remove component-level fallback**

In `src/renderer/components/command/CommandSurface.vue`, delete the import:

```ts
import { buildSessionPresenceSnapshot } from '@shared/observability-projection'
```

Change the computed loop from:

```ts
const presence = sessionPresenceMap.value[session.id] ?? buildSessionPresenceSnapshot(session, {
  activeSessionId: props.activeSessionId,
  nowIso
})
```

to:

```ts
const presence = sessionPresenceMap.value[session.id]
if (!presence) {
  continue
}
```

Then keep:

```ts
viewModels[session.id] = toSessionRowViewModel(session, presence, nowIso)
```

- [ ] **Step 7: Run store and command surface tests**

Run:

```bash
npx vitest run src/renderer/stores/workspaces.test.ts src/renderer/components/command/CommandSurface.test.ts
```

Expected: PASS. If command rows disappear in tests, ensure test setup calls `store.hydrate()` with sessions rather than passing raw props alone.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/stores/workspaces.ts src/renderer/stores/workspaces.test.ts src/renderer/components/command/CommandSurface.vue src/renderer/components/command/CommandSurface.test.ts
git commit -m "refactor: centralize renderer presence fallback"
```

## Task 5: Remove Direct UI Phase Bypasses

**Files:**
- Modify: `src/renderer/components/WorkspaceList.vue`
- Modify: `src/renderer/components/WorkspaceList.test.ts`
- Modify: `src/renderer/components/command/TerminalMetaBar.vue`
- Modify: `src/renderer/components/command/TerminalMetaBar.test.ts`

- [ ] **Step 1: Search for direct phase derivation in renderer components**

Run: `rg -n "derivePresencePhase|buildSessionPresenceSnapshot|runtimeState.*agentState|agentState.*runtimeState" src/renderer`

Expected known hits before this task:

```text
src/renderer/components/WorkspaceList.vue
src/renderer/components/command/CommandSurface.vue
```

After Task 4, `CommandSurface.vue` should no longer appear.

- [ ] **Step 2: Convert `WorkspaceList.vue` to receive presence map**

In `src/renderer/components/WorkspaceList.vue`, remove:

```ts
import { derivePresencePhase } from '@shared/session-state-reducer'
```

Add:

```ts
import type { SessionPresenceSnapshot } from '@shared/observability'
```

Add prop:

```ts
sessionPresenceMap: Record<string, SessionPresenceSnapshot>
```

Replace `presenceLabel(session)` implementation with:

```ts
function presenceLabel(session: ProjectHierarchyNode['sessions'][number]): string {
  return props.sessionPresenceMap[session.id]?.phase ?? 'ready'
}
```

- [ ] **Step 3: Update `WorkspaceList` tests**

In `src/renderer/components/WorkspaceList.test.ts`, pass:

```ts
sessionPresenceMap: {
  session_1: {
    sessionId: 'session_1',
    projectId: 'project_1',
    providerId: 'codex',
    providerLabel: 'Codex',
    modelLabel: null,
    phase: 'running',
    runtimeState: 'alive',
    agentState: 'working',
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    confidence: 'authoritative',
    health: 'healthy',
    blockingReason: null,
    lastAssistantSnippet: null,
    lastEventAt: '2026-04-26T00:00:00.000Z',
    lastEvidenceType: null,
    hasUnreadTurn: false,
    recoveryPointerState: 'trusted',
    evidenceSequence: 1,
    sourceSequence: 1,
    updatedAt: '2026-04-26T00:00:00.000Z'
  }
}
```

- [ ] **Step 4: Remove raw fallback display from `TerminalMetaBar`**

In `src/renderer/components/command/TerminalMetaBar.vue`, remove `hasFallbackMeta` and the fallback template that renders:

```vue
<span>{{ session.type }}</span>
<span>{{ session.runtimeState }} / {{ session.agentState }}</span>
```

Change the root condition to:

```vue
<div v-if="activeViewModel" class="terminal-meta" data-testid="terminal-status-bar">
```

Keep only the `activeViewModel` rendering branch.

- [ ] **Step 5: Update `TerminalMetaBar` tests**

In `src/renderer/components/command/TerminalMetaBar.test.ts`, remove tests expecting raw `runtimeState / agentState` fallback. Add:

```ts
it('does not render raw session state without an active view model', () => {
  render(TerminalMetaBar, {
    props: {
      project: mockProject,
      session: mockSession,
      activeViewModel: null
    }
  })

  expect(document.body.textContent).not.toContain('alive / idle')
  expect(document.body.querySelector('[data-testid="terminal-status-bar"]')).toBeNull()
})
```

- [ ] **Step 6: Run renderer component tests**

Run:

```bash
npx vitest run src/renderer/components/WorkspaceList.test.ts src/renderer/components/command/TerminalMetaBar.test.ts
```

Expected: PASS. No renderer component should directly derive status from raw session runtime/agent fields.

- [ ] **Step 7: Verify no direct renderer phase bypass remains**

Run: `rg -n "derivePresencePhase|buildSessionPresenceSnapshot|runtimeState.*agentState|agentState.*runtimeState" src/renderer`

Expected: no hits in `.vue` files. Test fixtures may still construct raw sessions.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/WorkspaceList.vue src/renderer/components/WorkspaceList.test.ts src/renderer/components/command/TerminalMetaBar.vue src/renderer/components/command/TerminalMetaBar.test.ts
git commit -m "refactor: remove renderer phase bypasses"
```

## Task 6: Split State Patch and Evidence Handling in the Bridge

**Files:**
- Modify: `src/main/session-event-bridge.ts`
- Modify: `src/main/session-event-bridge.test.ts`
- Modify: `src/core/observability-service.ts`
- Modify: `src/core/observability-service.test.ts`

- [ ] **Step 1: Add bridge test that state patch applies even when observability is absent**

In `src/main/session-event-bridge.test.ts`, add or extend:

```ts
it('applies provider state patches without requiring observability ingestion', async () => {
  const manager = ProjectSessionManager.createForTest()
  const project = await manager.createProject({ name: 'Demo', path: 'D:/demo' })
  const session = await manager.createSession({ projectId: project.id, type: 'claude-code', title: 'Claude' })
  await manager.markRuntimeAlive(session.id, 'external-1')

  const applied: SessionStatePatchEvent[] = []
  const bridge = new SessionEventBridge(
    manager,
    {
      applyProviderStatePatch: async (patch) => {
        applied.push(patch)
      }
    }
  )

  await bridge.debugEnqueueSessionEventForTest({
    event_version: 1,
    event_id: 'event-1',
    event_type: 'claude-code.UserPromptSubmit',
    timestamp: '2026-04-26T00:00:00.000Z',
    session_id: session.id,
    project_id: project.id,
    source: 'provider-adapter',
    payload: {
      intent: 'agent.turn_started',
      agentState: 'working',
      summary: 'UserPromptSubmit',
      model: 'claude-sonnet',
      snippet: 'User asked for a plan.'
    }
  })

  expect(applied).toHaveLength(1)
  expect(applied[0]!.intent).toBe('agent.turn_started')
})
```

If `debugEnqueueSessionEventForTest()` does not exist, add a public test-only method:

```ts
async debugEnqueueSessionEventForTest(event: CanonicalSessionEvent): Promise<void> {
  await this.enqueueSessionEvent(event)
}
```

- [ ] **Step 2: Add evidence propagation test**

In the same test file, assert model/snippet are sent to observability payload:

```ts
it('forwards model and snippet as evidence metadata', async () => {
  const ingested: ObservationEvent[] = []
  const bridge = new SessionEventBridge(
    manager,
    controller,
    {
      ingest: (event) => {
        ingested.push(event)
        return true
      }
    }
  )

  await bridge.debugEnqueueSessionEventForTest(canonicalEvent({
    payload: {
      intent: 'agent.turn_completed',
      agentState: 'idle',
      hasUnseenCompletion: true,
      summary: 'Stop',
      model: 'gpt-5.4',
      snippet: 'Done.'
    }
  }))

  expect(ingested[0]!.payload.model).toBe('gpt-5.4')
  expect(ingested[0]!.payload.snippet).toBe('Done.')
})
```

- [ ] **Step 3: Run bridge tests and confirm failure for metadata**

Run: `npx vitest run src/main/session-event-bridge.test.ts`

Expected: metadata test fails because `toObservationEvent()` currently only forwards `summary` and `externalSessionId`.

- [ ] **Step 4: Forward evidence fields without changing phase authority**

In `src/main/session-event-bridge.ts`, update `toObservationEvent()` payload construction:

```ts
const payload: Record<string, unknown> = {
  summary: event.payload.summary
}

if (event.payload.model !== undefined) {
  payload.model = event.payload.model
}

if (event.payload.snippet !== undefined) {
  payload.snippet = event.payload.snippet
}

if (event.payload.toolName !== undefined) {
  payload.toolName = event.payload.toolName
}

if (event.payload.error !== undefined) {
  payload.error = event.payload.error
}

if (event.payload.externalSessionId !== undefined) {
  payload.externalSessionId = event.payload.externalSessionId
}
```

Do not read these fields in `toSessionStatePatch()` except `externalSessionId`, which already belongs to recovery metadata.

- [ ] **Step 5: Run bridge and observability tests**

Run:

```bash
npx vitest run src/main/session-event-bridge.test.ts src/core/observability-service.test.ts
```

Expected: PASS. `ObservabilityService` may now show model/snippet metadata, but `phase` remains derived from session state.

- [ ] **Step 6: Commit**

```bash
git add src/main/session-event-bridge.ts src/main/session-event-bridge.test.ts src/core/observability-service.ts src/core/observability-service.test.ts
git commit -m "refactor: separate state patch and evidence metadata"
```

## Task 7: Update Terminal Runtime Consumers

**Files:**
- Modify: `src/renderer/components/TerminalViewport.vue`
- Modify: `src/renderer/components/TerminalViewport.test.ts`
- Modify: `tests/e2e-playwright/terminal-journey.test.ts`

- [ ] **Step 1: Search TerminalViewport legacy dependency**

Run: `rg -n "onSessionEvent|runtimeState|agentState|SessionSummaryEvent" src/renderer/components/TerminalViewport.vue src/renderer/components/TerminalViewport.test.ts`

Expected before change: `onSessionEvent` usage exists in `TerminalViewport.vue`.

- [ ] **Step 2: Replace session event subscription with presence subscription**

In `src/renderer/components/TerminalViewport.vue`, replace:

```ts
unsubscribeEvents = stoa.onSessionEvent((event) => {
  // existing raw session update handling
})
```

with:

```ts
unsubscribeEvents = stoa.onSessionPresenceChanged((snapshot) => {
  if (snapshot.sessionId !== props.session?.id) {
    return
  }

  applyPresenceSnapshot(snapshot)
})
```

Add a local helper if needed:

```ts
function applyPresenceSnapshot(snapshot: SessionPresenceSnapshot): void {
  latestPresence.value = snapshot
}
```

Use `latestPresence.phase` for overlay/live terminal decisions. Keep PTY data subscription unchanged.

- [ ] **Step 3: Add terminal test for presence-driven overlay behavior**

In `src/renderer/components/TerminalViewport.test.ts`, add:

```ts
it('keeps terminal live from presence snapshot without onSessionEvent', async () => {
  let presenceListener: ((snapshot: SessionPresenceSnapshot) => void) | null = null
  setupStoaApi({
    onSessionEvent: undefined,
    onSessionPresenceChanged: vi.fn().mockImplementation((listener: (snapshot: SessionPresenceSnapshot) => void) => {
      presenceListener = listener
      return vi.fn()
    })
  })

  render(TerminalViewport, {
    props: {
      project: baseProject,
      session: sessionSummary({
        id: 'session_1',
        runtimeState: 'alive',
        agentState: 'unknown'
      })
    }
  })
  await flushPromises()

  presenceListener?.(sessionPresenceFixture({
    sessionId: 'session_1',
    phase: 'running',
    runtimeState: 'alive',
    agentState: 'working'
  }))
  await flushPromises()

  expect(document.body.querySelector('[data-testid="terminal-xterm"]')).toBeTruthy()
})
```

- [ ] **Step 4: Run terminal tests**

Run: `npx vitest run src/renderer/components/TerminalViewport.test.ts`

Expected: PASS. Terminal data path remains `onTerminalData`; only status/liveness decisions move to presence.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/TerminalViewport.vue src/renderer/components/TerminalViewport.test.ts tests/e2e-playwright/terminal-journey.test.ts
git commit -m "refactor: drive terminal status from presence snapshots"
```

## Task 8: Update Behavior Assets and Generated Journeys

**Files:**
- Modify: `testing/behavior/session.behavior.ts`
- Modify: `testing/journeys/session-telemetry.journey.ts`
- Modify: `testing/topology/session-status.topology.ts`
- Regenerate: `tests/generated/playwright/*.generated.spec.ts`

- [ ] **Step 1: Update behavior wording to single status channel**

In `testing/behavior/session.behavior.ts`, update session telemetry behavior descriptions so assertions refer to presence snapshot UI state rather than raw session summary events.

Use this wording for the main behavior:

```ts
description: 'Provider structured events reduce into backend session state and push a single authoritative presence snapshot to the command surface.'
```

- [ ] **Step 2: Update journey setup/assert names if needed**

In `testing/journeys/session-telemetry.journey.ts`, ensure assertions keep UI-oriented names:

```ts
'command.sessionStatusRunningVisible'
'command.sessionStatusBlockedVisible'
'command.sessionStatusCompleteVisible'
'command.sessionStatusReadyVisible'
```

Do not add assertions for `onSessionEvent`.

- [ ] **Step 3: Run generator**

Run: `npm run test:generate`

Expected: generated Playwright specs update deterministically.

- [ ] **Step 4: Run behavior asset tests**

Run:

```bash
npx vitest run testing/behavior/session.behavior.test.ts testing/journeys/session-telemetry.journey.test.ts testing/topology/session-status.topology.test.ts testing/generators/generate-playwright.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add testing/behavior/session.behavior.ts testing/journeys/session-telemetry.journey.ts testing/topology/session-status.topology.ts tests/generated/playwright
git commit -m "test: update session status behavior assets"
```

## Task 9: Full Verification Gate

**Files:**
- No source edits unless a gate fails.

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`

Expected: PASS. If typecheck fails for removed `onSessionEvent`, remove all remaining imports/usages rather than adding compatibility fields.

- [ ] **Step 2: Run generated test regeneration**

Run: `npm run test:generate`

Expected: PASS and deterministic output. If generated files change after Task 8, inspect and commit them.

- [ ] **Step 3: Run Vitest quality gate**

Run: `npx vitest run`

Expected: PASS. Fix implementation or tests that still assume legacy `onSessionEvent` status updates.

- [ ] **Step 4: Run real Electron Playwright journeys**

Run: `npm run test:e2e`

Expected: PASS. If a journey depends on raw session status events, update it to use visible UI state or presence push.

- [ ] **Step 5: Run behavior coverage**

Run: `npm run test:behavior-coverage`

Expected: PASS.

- [ ] **Step 6: Final search for removed chain**

Run:

```bash
rg -n "onSessionEvent|SessionSummaryEvent|IPC_CHANNELS\\.sessionEvent|derivePresencePhase|buildSessionPresenceSnapshot" src/renderer src/preload src/main tests/e2e
```

Expected:

- No `onSessionEvent` or `SessionSummaryEvent`.
- No `IPC_CHANNELS.sessionEvent` unless it is intentionally removed from all runtime paths.
- No `derivePresencePhase` or `buildSessionPresenceSnapshot` in renderer components.
- `buildSessionPresenceSnapshot` may remain in shared projection, backend observability, and Pinia bootstrap fallback.

- [ ] **Step 7: Commit verification fixes**

```bash
git add .
git commit -m "chore: verify single-channel session status flow"
```

## Acceptance Criteria

- Provider structured events remain the only source of agent status.
- `SessionSummary` remains the only backend status fact model.
- `SessionPresenceSnapshot` is the only renderer-facing status display model.
- Renderer components do not derive status from raw `runtimeState`/`agentState`.
- `onSessionEvent` no longer participates in status display.
- Observability evidence enriches metadata but cannot override phase.
- Bootstrap fallback exists only in Pinia and is permanently superseded by backend snapshots.
- The full required gate passes:
  - `npm run test:generate`
  - `npm run typecheck`
  - `npx vitest run`
  - `npm run test:e2e`
  - `npm run test:behavior-coverage`

## Self-Review

- Spec coverage: the plan covers backend fact source, renderer presence channel, observability demotion, fallback centralization, UI bypass removal, behavior assets, and full verification.
- Placeholder scan: no task contains `TBD`, `TODO`, or open-ended "handle later" language.
- Type consistency: `SessionSummary`, `SessionPresenceSnapshot`, `SessionStatePatchEvent`, `CanonicalSessionEvent`, and IPC names match current repository types.
