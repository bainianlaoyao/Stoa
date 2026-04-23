# Terminal Session Reality Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make session switching show the real terminal, eliminate stale OpenCode black screens, and restore correct OpenCode resume/state semantics.

**Architecture:** Keep the current project/session model, but stop abusing PTY-local ids as OpenCode resume ids. Add a real main-process session event bridge for webhook-sidecar events, propagate the real provider session id and `awaiting_input` state from OpenCode, and make `TerminalViewport` mount/write logic cancellation-safe and xterm-write-ordered.

**Tech Stack:** Vue 3, Pinia, Electron IPC, node-pty, xterm, Express webhook server, Vitest

---

## File Structure

- **Modify:** `src/core/pty-host.ts`
  - PTY runtime ownership only. Do not fabricate a provider resume id here.
- **Modify:** `src/core/session-runtime.ts`
  - Runtime start contract. Fresh OpenCode starts must not persist fake resume ids.
- **Modify:** `src/core/project-session-manager.ts`
  - Canonical persisted session state. Add an explicit terminal webhook port setter and a generic session status updater.
- **Modify:** `src/shared/project-session.ts`
  - Shared runtime/event contracts. Extend `SessionEventPayload` for provider session id handoff.
- **Create:** `src/main/session-event-bridge.ts`
  - Main-process webhook runtime bridge. Own session secrets, webhook lifecycle, and canonical event translation.
- **Modify:** `src/main/index.ts`
  - Start the webhook bridge, hand real secrets/ports into runtime startup, and cleanly stop the bridge on shutdown.
- **Modify:** `src/main/session-runtime-controller.ts`
  - Push canonical session status changes and terminal backlog replay, but no longer infer provider ids from PTY ids.
- **Modify:** `src/extensions/providers/opencode-provider.ts`
  - Emit fixed internal `session_id`, plus `payload.externalSessionId` and `awaiting_input` when OpenCode becomes idle.
- **Modify:** `src/renderer/components/TerminalViewport.vue`
  - Make replay/live writes mount-scoped and ordered; keep terminal mounted for live-but-idle OpenCode states.
- **Modify/Test:** `src/core/session-runtime.test.ts`
- **Modify/Test:** `src/core/session-runtime-callbacks.test.ts`
- **Modify/Test:** `src/core/project-session-manager.test.ts`
- **Create/Test:** `src/main/session-event-bridge.test.ts`
- **Modify/Test:** `src/main/session-runtime-controller.test.ts`
- **Modify/Test:** `src/renderer/components/TerminalViewport.test.ts`
- **Modify/Test:** `tests/e2e/provider-integration.test.ts`
- **Modify/Test:** `tests/e2e/webhook-runtime-integration.test.ts`
- **Modify/Test:** `tests/e2e/backend-lifecycle.test.ts`

## Constraints From Root-Cause Analysis

- The session click path in the renderer is already correct; do not add workaround code in `App.vue` or `WorkspaceHierarchyPanel.vue`.
- `externalSessionId` remains the persisted OpenCode resume id for this plan to minimize churn. Shell sessions must keep it `null`.
- `PtyHost` runtime ids remain internal-only and must never leak into `externalSessionId`.
- `TerminalViewport` must treat stale async replay as invalid work and discard it.
- `awaiting_input` is a live terminal state, not an overlay-only state.

---

### Task 1: Stop Persisting Fake OpenCode Resume IDs

**Files:**
- Modify: `src/core/pty-host.ts`
- Modify: `src/core/session-runtime.ts`
- Modify: `src/core/project-session-manager.ts`
- Test: `src/core/session-runtime.test.ts`
- Test: `src/core/session-runtime-callbacks.test.ts`
- Test: `src/core/project-session-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/core/session-runtime.test.ts
test('fresh opencode start does not persist a fabricated shell runtime id', async () => {
  const provider = createProviderStub()
  const manager = createManagerSpy()
  const ptyHost = {
    start() {
      return { runtimeId: 'session_op_1' }
    }
  }

  await startSessionRuntime({
    session: {
      id: 'session_op_1',
      projectId: 'project_1',
      path: 'D:/demo',
      title: 'OpenCode',
      type: 'opencode',
      status: 'bootstrapping',
      externalSessionId: null
    },
    webhookPort: 43127,
    provider,
    ptyHost,
    manager
  })

  expect(manager.markSessionRunning).toHaveBeenCalledWith('session_op_1', null)
})

// src/core/session-runtime-callbacks.test.ts
test('shell sessions mark running without writing externalSessionId', async () => {
  const markSessionRunning = vi.fn()
  await startSessionRuntime({
    session: createBaseSession({ type: 'shell', externalSessionId: null }),
    webhookPort: 43127,
    provider: createProvider(),
    ptyHost: createPtyHost(),
    manager: createManager({ markSessionRunning })
  })

  expect(markSessionRunning).toHaveBeenCalledWith('session_1', null)
})

// src/core/project-session-manager.test.ts
test('markSessionRunning preserves null externalSessionId when runtime has no provider id yet', async () => {
  const session = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'OpenCode 1' })
  await manager.markSessionRunning(session.id, null)

  const updated = manager.snapshot().sessions[0]
  expect(updated?.status).toBe('running')
  expect(updated?.externalSessionId).toBeNull()
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx vitest run src/core/session-runtime.test.ts src/core/session-runtime-callbacks.test.ts src/core/project-session-manager.test.ts`

Expected: FAIL because `startSessionRuntime()` still passes `started.sessionId` into `markSessionRunning()` and the PTY host still fabricates `shell-*` ids.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/core/pty-host.ts
export interface PtySession {
  runtimeId: string
}

start(runtimeId: string, command: ProviderCommand, onData: (data: string) => void, onExit: (exitCode: number) => void): PtySession {
  const terminal = pty.spawn(command.command, command.args, {
    cwd: command.cwd,
    name: 'xterm-color',
    cols: 120,
    rows: 30,
    env: command.env
  })

  terminal.onData(onData)
  terminal.onExit(({ exitCode }) => {
    this.sessions.delete(runtimeId)
    onExit(exitCode)
  })

  this.sessions.set(runtimeId, terminal)
  return { runtimeId }
}

// src/core/session-runtime.ts
const started = ptyHost.start(
  session.id,
  command,
  (data) => {
    void manager.appendTerminalData({ sessionId: session.id, data })
  },
  (exitCode) => {
    void manager.markSessionExited(session.id, `${session.type} 已退出 (${exitCode})`)
  }
)

await manager.markSessionRunning(
  session.id,
  canResume ? session.externalSessionId : null
)
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npx vitest run src/core/session-runtime.test.ts src/core/session-runtime-callbacks.test.ts src/core/project-session-manager.test.ts`

Expected: PASS. Fresh OpenCode starts now stay `externalSessionId = null` until a real provider id arrives later.

- [ ] **Step 5: Commit**

```bash
git add src/core/pty-host.ts src/core/session-runtime.ts src/core/project-session-manager.ts src/core/session-runtime.test.ts src/core/session-runtime-callbacks.test.ts src/core/project-session-manager.test.ts
git commit -m "fix: stop persisting fake opencode runtime ids"
```

---

### Task 2: Add A Real Main-Process Session Event Bridge

**Files:**
- Create: `src/main/session-event-bridge.ts`
- Modify: `src/core/project-session-manager.ts`
- Modify: `src/main/session-runtime-controller.ts`
- Modify: `src/main/index.ts`
- Modify: `src/shared/project-session.ts`
- Test: `src/main/session-runtime-controller.test.ts`
- Create/Test: `src/main/session-event-bridge.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/session-event-bridge.test.ts
test('issueSessionSecret returns a secret that the webhook server accepts for the same session', async () => {
  const manager = ProjectSessionManager.createForTest()
  const controller = createControllerStub()
  const bridge = new SessionEventBridge(manager, controller)
  const port = await bridge.start()
  const secret = bridge.issueSessionSecret('session_1')

  const response = await httpPost(
    port,
    '/events',
    {
      event_version: 1,
      event_id: 'evt_1',
      event_type: 'session.idle',
      timestamp: new Date().toISOString(),
      session_id: 'session_1',
      project_id: 'project_1',
      source: 'hook-sidecar',
      payload: {
        status: 'awaiting_input',
        summary: 'session.idle',
        externalSessionId: 'opencode-real-123'
      }
    },
    { 'x-stoa-secret': secret }
  )

  expect(response.statusCode).toBe(202)
  expect(controller.applySessionEvent).toHaveBeenCalledWith({
    sessionId: 'session_1',
    status: 'awaiting_input',
    summary: 'session.idle',
    externalSessionId: 'opencode-real-123'
  })
})

// src/main/session-runtime-controller.test.ts
test('applySessionEvent updates state and pushes awaiting_input through IPC', async () => {
  const controller = new SessionRuntimeController(manager, () => win)
  await controller.applySessionEvent({
    sessionId: session.id,
    status: 'awaiting_input',
    summary: 'session.idle',
    externalSessionId: 'opencode-real-123'
  })

  expect(manager.snapshot().sessions[0]?.status).toBe('awaiting_input')
  expect(manager.snapshot().sessions[0]?.externalSessionId).toBe('opencode-real-123')
  expect(sent.at(-1)?.data).toEqual({
    sessionId: session.id,
    status: 'awaiting_input',
    summary: 'session.idle'
  })
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx vitest run src/main/session-runtime-controller.test.ts src/main/session-event-bridge.test.ts`

Expected: FAIL because there is no `SessionEventBridge`, no real webhook lifecycle in main, and no generic `applySessionEvent()` method.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/shared/project-session.ts
export interface SessionEventPayload {
  status?: SessionStatus
  summary?: string
  isProvisional?: boolean
  externalSessionId?: string
}

// src/core/project-session-manager.ts
async setTerminalWebhookPort(port: number): Promise<void> {
  this.state.terminalWebhookPort = port
  await this.persist()
}

async applySessionEvent(
  sessionId: string,
  status: SessionStatus,
  summary: string,
  externalSessionId?: string | null
): Promise<void> {
  const session = this.state.sessions.find(candidate => candidate.id === sessionId)
  if (!session) return
  session.status = status
  session.summary = summary
  if (externalSessionId !== undefined) {
    session.externalSessionId = externalSessionId
  }
  session.updatedAt = new Date().toISOString()
  await this.persist()
}

// src/main/session-runtime-controller.ts
async applySessionEvent(event: {
  sessionId: string
  status: SessionStatus
  summary: string
  externalSessionId?: string | null
}): Promise<void> {
  await this.manager.applySessionEvent(
    event.sessionId,
    event.status,
    event.summary,
    event.externalSessionId
  )
  this.pushSessionEvent(event.sessionId, event.status, event.summary)
}

// src/main/session-event-bridge.ts
export class SessionEventBridge {
  private readonly secrets = new Map<string, string>()
  private server: LocalWebhookServer | null = null
  private port: number | null = null

  constructor(
    private readonly manager: ProjectSessionManager,
    private readonly controller: SessionRuntimeController
  ) {}

  async start(): Promise<number> {
    if (this.server && this.port !== null) return this.port

    this.server = createLocalWebhookServer({
      getSessionSecret: (sessionId) => this.secrets.get(sessionId) ?? null,
      onEvent: async (event) => {
        await this.controller.applySessionEvent({
          sessionId: event.session_id,
          status: event.payload.status ?? 'running',
          summary: event.payload.summary ?? event.event_type,
          externalSessionId: event.payload.externalSessionId
        })
      }
    })

    this.port = await this.server.start()
    await this.manager.setTerminalWebhookPort(this.port)
    return this.port
  }

  issueSessionSecret(sessionId: string): string {
    const secret = `stoa-${randomUUID()}`
    this.secrets.set(sessionId, secret)
    return secret
  }

  async stop(): Promise<void> {
    await this.server?.stop()
    this.server = null
    this.port = null
    this.secrets.clear()
  }
}

// src/main/index.ts
const bridge = new SessionEventBridge(projectSessionManager, runtimeController)
const webhookPort = await bridge.start()
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npx vitest run src/main/session-runtime-controller.test.ts src/main/session-event-bridge.test.ts`

Expected: PASS. The real app now has a webhook bridge, a real secret registry, and a generic path for `awaiting_input`.

- [ ] **Step 5: Commit**

```bash
git add src/main/session-event-bridge.ts src/core/project-session-manager.ts src/main/session-runtime-controller.ts src/main/index.ts src/shared/project-session.ts src/main/session-runtime-controller.test.ts src/main/session-event-bridge.test.ts
git commit -m "feat: add runtime session event bridge"
```

---

### Task 3: Propagate Real OpenCode Provider Session IDs And Idle State

**Files:**
- Modify: `src/extensions/providers/opencode-provider.ts`
- Modify: `tests/e2e/provider-integration.test.ts`
- Modify: `tests/e2e/webhook-runtime-integration.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/core/session-runtime.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/e2e/provider-integration.test.ts
test('sidecar plugin keeps internal session_id fixed and sends payload.externalSessionId from OpenCode events', async () => {
  const workspaceDir = await createTempDir('stoa-sidecar-provider-id-')
  const provider = getProvider('opencode')

  await provider.installSidecar(
    createTarget({ path: workspaceDir, session_id: 'session_internal_1' }),
    createContext({ webhookPort: 43127, sessionSecret: 'secret-1' })
  )

  const content = await readFile(join(workspaceDir, '.opencode', 'plugins', 'stoa-status.ts'), 'utf8')
  expect(content).toContain(\"session_id: 'session_internal_1'\")
  expect(content).toContain('externalSessionId: event.properties?.sessionID ?? undefined')
  expect(content).toContain(\"status: event.type === 'session.idle' ? 'awaiting_input' : 'running'\")
})

// tests/e2e/webhook-runtime-integration.test.ts
test('webhook running event persists the provider externalSessionId', async () => {
  const harness = await createWebhookHarness()
  const response = await httpPost(
    harness.port,
    '/events',
    {
      event_version: 1,
      event_id: 'evt_running_1',
      event_type: 'session.started',
      timestamp: new Date().toISOString(),
      session_id: harness.session.id,
      project_id: harness.session.projectId,
      source: 'hook-sidecar',
      payload: {
        status: 'running',
        summary: 'session.started',
        externalSessionId: 'opencode-real-123'
      }
    },
    { 'x-stoa-secret': harness.secret }
  )

  expect(response.statusCode).toBe(202)
  await waitFor(() => getSessionState(harness.manager, harness.session.id).externalSessionId === 'opencode-real-123')
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx vitest run tests/e2e/provider-integration.test.ts tests/e2e/webhook-runtime-integration.test.ts`

Expected: FAIL because the generated plugin still overloads `session_id` and never sends `payload.externalSessionId`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/extensions/providers/opencode-provider.ts
await writeFile(
  pluginPath,
  `export const StoaStatusPlugin = async () => ({\n  event: async ({ event }) => {\n    await fetch('http://127.0.0.1:${context.webhookPort}/events', {\n      method: 'POST',\n      headers: {\n        'content-type': 'application/json',\n        'x-stoa-secret': '${context.sessionSecret}'\n      },\n      body: JSON.stringify({\n        event_version: 1,\n        event_id: event.id ?? crypto.randomUUID(),\n        event_type: event.type ?? 'session.status_changed',\n        timestamp: new Date().toISOString(),\n        session_id: '${target.session_id}',\n        project_id: '${target.project_id}',\n        correlation_id: event.properties?.messageID ?? undefined,\n        source: 'hook-sidecar',\n        payload: {\n          status: event.type === 'session.idle' ? 'awaiting_input' : 'running',\n          summary: event.type,\n          isProvisional: false,\n          externalSessionId: event.properties?.sessionID ?? undefined\n        }\n      })\n    })\n  }\n})\n`,
  'utf-8'
)

// src/core/session-runtime.ts
const runtimeExternalSessionId =
  canResume
    ? session.externalSessionId
    : session.type === 'opencode'
      ? null
      : null

await manager.markSessionRunning(session.id, runtimeExternalSessionId)
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npx vitest run tests/e2e/provider-integration.test.ts tests/e2e/webhook-runtime-integration.test.ts`

Expected: PASS. The webhook path can now carry the real OpenCode session id into persisted state.

- [ ] **Step 5: Commit**

```bash
git add src/extensions/providers/opencode-provider.ts src/core/session-runtime.ts tests/e2e/provider-integration.test.ts tests/e2e/webhook-runtime-integration.test.ts
git commit -m "fix: propagate real opencode session ids"
```

---

### Task 4: Make TerminalViewport Switching Cancellation-Safe And Status-Correct

**Files:**
- Modify: `src/renderer/components/TerminalViewport.vue`
- Modify: `src/renderer/components/TerminalViewport.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/renderer/components/TerminalViewport.test.ts
test('stale replay from a previous session does not write into the newly mounted terminal', async () => {
  let resolveFirstReplay!: (value: string) => void
  const firstReplay = new Promise<string>((resolve) => {
    resolveFirstReplay = resolve
  })

  mockApi.getTerminalReplay = vi
    .fn()
    .mockReturnValueOnce(firstReplay)
    .mockResolvedValueOnce('session-b-frame')

  const { default: TerminalViewport } = await import('./TerminalViewport.vue')
  const wrapper = mount(TerminalViewport, {
    props: { project: baseProject, session: baseSession }
  })
  await flushTerminal()

  await wrapper.setProps({
    session: {
      ...baseSession,
      id: 'session_op_2',
      title: 'OpenCode 2'
    }
  })
  await flushTerminal()

  resolveFirstReplay('session-a-frame')
  await flushTerminal()

  const { Terminal } = await import('@xterm/xterm')
  const instances = (Terminal as unknown as { instances: Array<{ writes: string[] }> }).instances
  expect(instances.at(-1)?.writes).not.toContain('session-a-frame')
  expect(instances.at(-1)?.writes).toContain('session-b-frame')
})

test('awaiting_input still renders the live terminal instead of the overlay', async () => {
  const { default: TerminalViewport } = await import('./TerminalViewport.vue')
  const wrapper = mount(TerminalViewport, {
    props: {
      project: baseProject,
      session: {
        ...baseSession,
        status: 'awaiting_input'
      }
    }
  })
  await flushTerminal()

  expect(wrapper.find('.terminal-viewport__xterm').exists()).toBe(true)
  expect(wrapper.find('.terminal-viewport__overlay').exists()).toBe(false)
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npx vitest run src/renderer/components/TerminalViewport.test.ts`

Expected: FAIL because stale replay can still target the current global `terminal` reference, and `awaiting_input` still falls into the overlay branch.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/renderer/components/TerminalViewport.vue
const liveStatuses: SessionStatus[] = ['starting', 'running', 'awaiting_input', 'degraded', 'needs_confirmation']
const isLiveTerminal = computed(() => {
  return props.session ? liveStatuses.includes(props.session.status) : false
})

let mountVersion = 0

function writeChunk(localTerminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => {
    localTerminal.write(data, () => resolve())
  })
}

function setupTerminal() {
  if (!terminalContainer.value || !props.session) return

  const localSessionId = props.session.id
  const localMountVersion = ++mountVersion
  const stoa = window.stoa
  if (!stoa) return

  const localTerminal = new Terminal({
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    lineHeight: 1.5,
    scrollback: 10_000,
    convertEol: true
  })

  terminal = localTerminal
  const pendingLiveData: string[] = []
  let replayReady = false
  let writeChain = Promise.resolve()

  const enqueueWrite = (data: string) => {
    writeChain = writeChain.then(async () => {
      if (mountVersion !== localMountVersion || terminal !== localTerminal) return
      await writeChunk(localTerminal, data)
    })
  }

  unsubscribeData = stoa.onTerminalData((chunk) => {
    if (chunk.sessionId !== localSessionId) return
    if (!replayReady) {
      pendingLiveData.push(chunk.data)
      return
    }
    enqueueWrite(chunk.data)
  })

  void stoa.getTerminalReplay(localSessionId)
    .then((replay) => {
      if (mountVersion !== localMountVersion || terminal !== localTerminal) return
      if (replay) enqueueWrite(replay)
      for (const chunk of pendingLiveData) enqueueWrite(chunk)
    })
    .finally(() => {
      if (mountVersion !== localMountVersion || terminal !== localTerminal) return
      replayReady = true
    })
}

watch(
  [() => props.session?.id ?? null, isLiveTerminal],
  ([sessionId, live]) => {
    disposeTerminal()
    nextTick(() => {
      if (sessionId && live) {
        setupTerminal()
      }
    })
  }
)
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npx vitest run src/renderer/components/TerminalViewport.test.ts`

Expected: PASS. Replay is mount-scoped, xterm writes are serialized, and `awaiting_input` keeps the terminal visible.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/TerminalViewport.vue src/renderer/components/TerminalViewport.test.ts
git commit -m "fix: make terminal replay switch-safe"
```

---

### Task 5: Wire The Full App Flow And Run The Required Gate

**Files:**
- Modify: `src/main/index.ts`
- Modify: `tests/e2e/backend-lifecycle.test.ts`
- Modify: `tests/e2e/webhook-runtime-integration.test.ts`
- Modify: `tests/e2e/provider-integration.test.ts`
- Modify: `src/main/preload-path.test.ts` (only if the new bridge lifecycle changes startup ordering assumptions)

- [ ] **Step 1: Write the failing integration tests**

```ts
// tests/e2e/backend-lifecycle.test.ts
test('fresh opencode lifecycle stays resumeless until webhook provides the real external session id', async () => {
  const provider = getProvider('opencode')
  const pty = createMockPtyHost()
  const mock = createMockManager()

  await startSessionRuntime({
    session: {
      id: 'session_op_1',
      projectId: 'project_test',
      path: 'D:/demo',
      title: 'OpenCode Test',
      type: 'opencode',
      status: 'bootstrapping',
      externalSessionId: null,
      sessionSecret: 'secret-1'
    },
    webhookPort: 43127,
    provider,
    ptyHost: pty.host,
    manager: mock.manager
  })

  expect(mock.log[1]).toEqual({
    method: 'markSessionRunning',
    args: ['session_op_1', null]
  })
})

// tests/e2e/webhook-runtime-integration.test.ts
test('session.idle pushes awaiting_input instead of unmount-only semantics', async () => {
  const harness = await createWebhookHarness()

  const response = await httpPost(
    harness.port,
    '/events',
    {
      event_version: 1,
      event_id: 'evt_idle_1',
      event_type: 'session.idle',
      timestamp: new Date().toISOString(),
      session_id: harness.session.id,
      project_id: harness.session.projectId,
      source: 'hook-sidecar',
      payload: {
        status: 'awaiting_input',
        summary: 'session.idle',
        externalSessionId: 'opencode-real-123'
      }
    },
    { 'x-stoa-secret': harness.secret }
  )

  expect(response.statusCode).toBe(202)
  await waitFor(() => getSessionState(harness.manager, harness.session.id).status === 'awaiting_input')
})
```

- [ ] **Step 2: Run the integration slice to verify it fails**

Run: `npx vitest run tests/e2e/backend-lifecycle.test.ts tests/e2e/provider-integration.test.ts tests/e2e/webhook-runtime-integration.test.ts`

Expected: FAIL until main startup issues a real session secret, starts the webhook bridge, and the new status semantics flow through.

- [ ] **Step 3: Finish the main-process wiring**

```ts
// src/main/index.ts
let sessionEventBridge: SessionEventBridge | null = null

app.whenReady().then(async () => {
  projectSessionManager = await ProjectSessionManager.create({ webhookPort: null })
  ptyHost = new PtyHost()
  runtimeController = new SessionRuntimeController(projectSessionManager, () => mainWindow)
  sessionEventBridge = new SessionEventBridge(projectSessionManager, runtimeController)
  const webhookPort = await sessionEventBridge.start()

  ipcMain.handle(IPC_CHANNELS.projectBootstrap, async () => {
    return projectSessionManager?.snapshot() ?? {
      activeProjectId: null,
      activeSessionId: null,
      terminalWebhookPort: webhookPort,
      projects: [],
      sessions: []
    }
  })

  // inside session create / bootstrap recovery
  const sessionSecret = sessionEventBridge.issueSessionSecret(session.id)
  void startSessionRuntime({
    session: {
      id: session.id,
      projectId: session.projectId,
      path: project.path,
      title: session.title,
      type: session.type,
      status: session.status,
      externalSessionId: session.externalSessionId,
      sessionSecret
    },
    webhookPort,
    provider,
    ptyHost,
    manager: runtimeController
  })
})

app.on('window-all-closed', () => {
  void sessionEventBridge?.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

- [ ] **Step 4: Run the full repository gate**

Run: `npx vitest run`

Expected: PASS with zero unexpected failures, matching the repository quality gate.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts tests/e2e/backend-lifecycle.test.ts tests/e2e/provider-integration.test.ts tests/e2e/webhook-runtime-integration.test.ts
git commit -m "fix: restore real terminal switching and opencode lifecycle"
```

---

## Self-Review

### Spec coverage

- Session click should produce a real terminal switch:
  Covered by **Task 4**, which prevents stale replay from writing into the new terminal.
- OpenCode black screen should stop:
  Covered by **Task 3** and **Task 4**. OpenCode now gets real provider ids and `awaiting_input` remains mounted.
- Do not guess about provider/runtime behavior:
  Covered by **Task 2** and **Task 3**, which align the runtime with the webhook/plugin contract and official CLI/plugin semantics already documented in `research/2026-04-22-terminal-debug-root-cause.md`.
- Keep implementation verifiable:
  Covered by focused red/green tests in every task and the final `npx vitest run` gate in **Task 5**.

### Placeholder scan

- No `TODO`, `TBD`, or “handle edge cases” placeholders remain.
- Each task has exact files, real test names, explicit commands, and concrete code snippets.

### Type consistency

- `externalSessionId` is intentionally preserved as the persisted OpenCode provider session id.
- `SessionEventPayload.externalSessionId` is the webhook-to-main handoff field.
- Shell sessions keep `externalSessionId = null`.
- Renderer live terminal predicate uses `SessionStatus` values already defined in `src/shared/project-session.ts`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-22-terminal-session-reality-fix.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
