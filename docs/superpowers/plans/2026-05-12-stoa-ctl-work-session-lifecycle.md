# stoa-ctl Work Session Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `stoa-ctl work-sessions create` and `stoa-ctl work-sessions archive` so the CLI can create and archive work sessions with product-equivalent behavior.

**Architecture:** Extend the existing loopback control plane with two new work-session lifecycle routes, wire them to the same main-process flows used by the renderer, and expose matching CLI commands in `tools/stoa-ctl`. Move default work-session title generation to host-owned code so the CLI and renderer share one source of truth.

**Tech Stack:** TypeScript, Electron main process IPC/runtime orchestration, Express control server, Vitest

---

### Task 1: Add failing CLI tests for work-session create/archive

**Files:**
- Modify: `tools/stoa-ctl/index.test.ts`
- Test: `tools/stoa-ctl/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that assert:

```ts
test('creates work sessions through the control plane', async () => {
  const module = await import('./index')
  const writes: string[] = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe('http://127.0.0.1:43129/ctl/work-sessions')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{"projectId":"project_1","type":"codex","title":"codex-myproj"}')
    return createResponse({
      body: '{"ok":true,"data":{"id":"session_2","projectId":"project_1","type":"codex"},"error":null}'
    })
  })

  const exitCode = await module.run([
    'work-sessions',
    'create',
    '--project',
    'project_1',
    '--type',
    'codex',
    '--title',
    'codex-myproj'
  ], {
    fetch: fetchImpl,
    env: metaSessionEnv,
    stdout: { write(chunk: string) { writes.push(chunk) } },
    stderr: { write() {} },
    sleep: async () => {}
  })

  expect(exitCode).toBe(0)
  expect(writes.join('')).toContain('"session_2"')
})

test('creates work sessions without forcing a client-side title', async () => {
  const module = await import('./index')
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe('http://127.0.0.1:43129/ctl/work-sessions')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{"projectId":"project_1","type":"shell"}')
    return createResponse({
      body: '{"ok":true,"data":{"id":"session_3","projectId":"project_1","type":"shell","title":"shell-1"},"error":null}'
    })
  })

  const exitCode = await module.run([
    'work-sessions',
    'create',
    '--project',
    'project_1',
    '--type',
    'shell'
  ], {
    fetch: fetchImpl,
    env: metaSessionEnv,
    stdout: { write() {} },
    stderr: { write() {} },
    sleep: async () => {}
  })

  expect(exitCode).toBe(0)
})

test('archives a work session through the control plane', async () => {
  const module = await import('./index')
  const writes: string[] = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe('http://127.0.0.1:43129/ctl/work-sessions/session_2/archive')
    expect(init?.method).toBe('POST')
    return createResponse({
      body: '{"ok":true,"data":{"session":{"id":"session_2","archived":true}},"error":null}'
    })
  })

  const exitCode = await module.run([
    'work-sessions',
    'archive',
    'session_2'
  ], {
    fetch: fetchImpl,
    env: metaSessionEnv,
    stdout: { write(chunk: string) { writes.push(chunk) } },
    stderr: { write() {} },
    sleep: async () => {}
  })

  expect(exitCode).toBe(0)
  expect(writes.join('')).toContain('"archived":true')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tools/stoa-ctl/index.test.ts`
Expected: FAIL because `work-sessions create` and `work-sessions archive` are not implemented in `tools/stoa-ctl/index.ts`

- [ ] **Step 3: Write minimal CLI implementation**

Add usage lines and command branches in `tools/stoa-ctl/index.ts` for:

```ts
'  work-sessions create --project <projectId> --type <shell|opencode|codex|claude-code> [--title "..."]',
'  work-sessions archive <id>',
```

and request handling equivalent to:

```ts
if (group === 'work-sessions' && action === 'create') {
  const projectId = parseFlagValue(rest, '--project')
  const type = parseFlagValue(rest, '--type')
  const title = parseFlagValue(rest, '--title')
  if (!projectId) {
    throw new CliUsageError('Missing --project')
  }
  if (!type) {
    throw new CliUsageError('Missing --type')
  }

  const body = title
    ? JSON.stringify({ projectId, type, title })
    : JSON.stringify({ projectId, type })

  const { response, text } = await request(resolvedDeps, '/ctl/work-sessions', {
    method: 'POST',
    body
  })
  if (!response.ok) {
    resolvedDeps.stderr.write(`${text}\n`)
    return mapFailureExitCode(response, text)
  }
  resolvedDeps.stdout.write(text)
  return 0
}

if (group === 'work-sessions' && action === 'archive') {
  const sessionId = rest[0]
  if (!sessionId) {
    throw new CliUsageError('Missing session id')
  }

  const { response, text } = await request(resolvedDeps, `/ctl/work-sessions/${sessionId}/archive`, {
    method: 'POST'
  })
  if (!response.ok) {
    resolvedDeps.stderr.write(`${text}\n`)
    return mapFailureExitCode(response, text)
  }
  resolvedDeps.stdout.write(text)
  return 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tools/stoa-ctl/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/stoa-ctl/index.ts tools/stoa-ctl/index.test.ts
git commit -m "feat: add stoa-ctl work session lifecycle commands"
```

### Task 2: Add failing control-server tests for work-session lifecycle routes

**Files:**
- Modify: `src/core/meta-session-control-server.test.ts`
- Test: `src/core/meta-session-control-server.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a work-session source double and tests equivalent to:

```ts
test('creates and archives work sessions through control routes', async () => {
  const workSessions: SessionSummary[] = [createWorkSession()]
  const createdRequests: Array<{ projectId: string; type: string; title?: string }> = []
  const archivedIds: string[] = []

  const snapshotSource = {
    snapshot() {
      return {
        activeProjectId: 'project_1',
        activeSessionId: 'session_1',
        terminalWebhookPort: 43127,
        projects: [{ id: 'project_1', name: 'myproj', path: 'D:/repo', createdAt: '', updatedAt: '' }],
        sessions: workSessions.map((session) => ({ ...session }))
      }
    }
  }

  const server = createMetaSessionControlServer({
    metaSessionSource: /* existing meta-session stub */,
    snapshotSource,
    getSessionPresence() { return null },
    contextAssembler: /* existing stub */,
    dispatcher: /* existing stub */,
    proposals: /* existing stub */,
    workSessionLifecycle: {
      async createSession(request) {
        createdRequests.push(request)
        const created = createWorkSession('session_2', {
          projectId: request.projectId,
          type: request.type,
          title: request.title ?? 'codex-myproj'
        })
        workSessions.push(created)
        return created
      },
      async archiveSession(sessionId: string) {
        archivedIds.push(sessionId)
        const target = workSessions.find((session) => session.id === sessionId)
        if (target) target.archived = true
      }
    }
  })

  const port = await server.start()
  const authHeaders = { 'x-stoa-session-id': 'meta_session_1' }

  const created = await post(port, '/ctl/work-sessions', authHeaders, '{"projectId":"project_1","type":"codex"}')
  const archived = await post(port, '/ctl/work-sessions/session_2/archive', authHeaders)

  expect(createdRequests).toEqual([{ projectId: 'project_1', type: 'codex' }])
  expect(archivedIds).toEqual(['session_2'])
  expect(JSON.parse(created.body)).toMatchObject({
    ok: true,
    data: {
      id: 'session_2',
      title: 'codex-myproj'
    }
  })
  expect(JSON.parse(archived.body)).toMatchObject({
    ok: true,
    data: {
      session: {
        id: 'session_2',
        archived: true
      }
    }
  })
})

test('rejects invalid work-session lifecycle requests', async () => {
  // cover:
  // - missing projectId
  // - invalid type
  // - archive unknown session
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/meta-session-control-server.test.ts`
Expected: FAIL because the control server does not expose work-session lifecycle routes or a work-session lifecycle dependency yet

- [ ] **Step 3: Add minimal control-server support**

Extend `src/core/meta-session-control-server.ts` with a new dependency:

```ts
interface WorkSessionLifecycle {
  createSession(request: { projectId: string; type: SessionType; title?: string }): Promise<SessionSummary>
  archiveSession(sessionId: string): Promise<SessionSummary | null>
}
```

Add routes equivalent to:

```ts
app.post('/ctl/work-sessions', async (request, response) => {
  const projectId = typeof request.body?.projectId === 'string' ? request.body.projectId.trim() : ''
  const type = typeof request.body?.type === 'string' ? request.body.type : ''
  const title = typeof request.body?.title === 'string' ? request.body.title.trim() : undefined

  if (!projectId) {
    invalidRequest(response, 'Missing projectId.')
    return
  }

  if (!['shell', 'opencode', 'codex', 'claude-code'].includes(type)) {
    invalidRequest(response, 'Invalid session type.')
    return
  }

  try {
    const created = await options.workSessionLifecycle.createSession({
      projectId,
      type: type as SessionType,
      ...(title ? { title } : {})
    })
    response.json(jsonEnvelope(created))
  } catch (error) {
    response.status(400).json(jsonEnvelope(null, {
      code: 'invalid_request',
      message: error instanceof Error ? error.message : String(error),
      details: {}
    }))
  }
})

app.post('/ctl/work-sessions/:sessionId/archive', async (request, response) => {
  const archived = await options.workSessionLifecycle.archiveSession(request.params.sessionId)
  if (!archived) {
    notFound(response, 'unknown_session', `Unknown work session: ${request.params.sessionId}`)
    return
  }
  response.json(jsonEnvelope({ session: archived }))
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/meta-session-control-server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/meta-session-control-server.ts src/core/meta-session-control-server.test.ts
git commit -m "feat: add work session lifecycle control routes"
```

### Task 3: Move default work-session title generation to host-owned code

**Files:**
- Create: `src/core/work-session-title.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
- Test: `src/core/project-session-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Add host-owned title generation tests in `src/core/project-session-manager.test.ts` equivalent to:

```ts
test('createSession generates shell title when title is omitted', async () => {
  const manager = await createManager()
  const project = await manager.createProject({ name: 'myproj', path: 'D:/repo' })

  const first = await manager.createSession({ projectId: project.id, type: 'shell', title: '' as never })
  const second = await manager.createSession({ projectId: project.id, type: 'shell', title: '' as never })

  expect(first.title).toBe('shell-1')
  expect(second.title).toBe('shell-2')
})

test('createSession generates provider title when title is omitted', async () => {
  const manager = await createManager()
  const project = await manager.createProject({ name: 'myproj', path: 'D:/repo' })

  const session = await manager.createSession({ projectId: project.id, type: 'codex', title: '' as never })

  expect(session.title).toBe('codex-myproj')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/project-session-manager.test.ts`
Expected: FAIL because `createSession` currently requires a provided title and does not generate host-owned defaults

- [ ] **Step 3: Write minimal host-owned title generation**

Create `src/core/work-session-title.ts`:

```ts
import { getProviderDescriptorBySessionType } from './provider-descriptors'
import type { ProjectSummary, SessionSummary, SessionType } from '@shared/project-session'

export function resolveDefaultWorkSessionTitle(input: {
  project: Pick<ProjectSummary, 'name' | 'id'>
  sessions: SessionSummary[]
  projectId: string
  type: SessionType
}): string {
  if (input.type === 'shell') {
    const shellCount = input.sessions.filter((session) => session.projectId === input.projectId && session.type === 'shell' && !session.archived).length
    return `shell-${shellCount + 1}`
  }

  const descriptor = getProviderDescriptorBySessionType(input.type)
  return `${descriptor.titlePrefix}-${input.project.name}`
}
```

Update `ProjectSessionManager.createSession(...)` to use:

```ts
const resolvedTitle = request.title?.trim()
  ? request.title.trim()
  : resolveDefaultWorkSessionTitle({
      project,
      sessions: this.state.sessions,
      projectId: request.projectId,
      type: request.type
    })
```

Update `WorkspaceHierarchyPanel.vue` to stop generating client-side titles and emit empty-less payloads only when a title is user-specified later:

```ts
function handleFloatingCardCreate(payload: { type: SessionType }) {
  emit('createSession', { projectId: floatingCardProjectId.value, type: payload.type, title: '' })
  floatingCardVisible.value = false
}
```

and same for radial menu.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/project-session-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/work-session-title.ts src/core/project-session-manager.ts src/core/project-session-manager.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.vue
git commit -m "feat: move work session default titles to host"
```

### Task 4: Wire control routes to the existing main-process create/archive flows

**Files:**
- Modify: `src/main/index.ts`
- Test: `tests/e2e/main-config-guard.test.ts`

- [ ] **Step 1: Write the failing regression test**

Add a config/structure guard asserting the control server wiring exists in `src/main/index.ts`, e.g.:

```ts
it('wires work-session lifecycle control routes to host-owned create and archive flows', () => {
  expect(mainSource).toMatch(/workSessionLifecycle\s*:\s*\{/)
  expect(mainSource).toMatch(/createSession\(request\)/)
  expect(mainSource).toMatch(/archiveSession\(sessionId\)/)
  expect(mainSource).toMatch(/projectSessionManager\?\.createSession/)
  expect(mainSource).toMatch(/ptyHost\?\.killAndWait\(sessionId\)/)
  expect(mainSource).toMatch(/projectSessionManager\.archiveSession\(sessionId\)/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/e2e/main-config-guard.test.ts`
Expected: FAIL because `createMetaSessionControlServer(...)` is not yet passed a `workSessionLifecycle` implementation

- [ ] **Step 3: Write minimal main-process wiring**

Update the `createMetaSessionControlServer(...)` call in `src/main/index.ts` with:

```ts
    workSessionLifecycle: {
      async createSession(request) {
        if (!projectSessionManager) {
          throw new Error('Session manager is unavailable.')
        }

        const created = await projectSessionManager.createSession({
          projectId: request.projectId,
          type: request.type,
          title: request.title ?? ''
        })
        syncObservabilityAndPushForSession(created.id)
        await syncUpdateStateToWindow()
        void launchSessionRuntimeWithGuard(created.id, 'session-create', { awaitDimensions: true })
        return created
      },
      async archiveSession(sessionId: string) {
        if (!projectSessionManager || !ptyHost) {
          throw new Error('Session runtime dependencies are unavailable.')
        }

        const session = projectSessionManager.snapshot().sessions.find((candidate) => candidate.id === sessionId)
        if (!session) {
          return null
        }

        sessionInputRouter?.resetSession(sessionId)
        await ptyHost.killAndWait(sessionId)
        await hookLeaseManager?.releaseLease(sessionId)
        await projectSessionManager.archiveSession(sessionId)
        syncObservabilitySessions()
        pushObservabilitySnapshotsForSession(sessionId)
        await syncUpdateStateToWindow()
        return projectSessionManager.snapshot().sessions.find((candidate) => candidate.id === sessionId) ?? null
      }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/e2e/main-config-guard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts tests/e2e/main-config-guard.test.ts
git commit -m "feat: wire work session lifecycle control paths"
```

### Task 5: Run full repository verification

**Files:**
- Test: `tools/stoa-ctl/index.test.ts`
- Test: `src/core/meta-session-control-server.test.ts`
- Test: `src/core/project-session-manager.test.ts`
- Test: `tests/e2e/main-config-guard.test.ts`

- [ ] **Step 1: Run targeted verification**

Run:

```bash
npx vitest run tools/stoa-ctl/index.test.ts src/core/meta-session-control-server.test.ts src/core/project-session-manager.test.ts tests/e2e/main-config-guard.test.ts
```

Expected: PASS

- [ ] **Step 2: Regenerate generated tests**

Run: `npm run test:generate`
Expected: PASS with deterministic generated output

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run full unit/integration suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Run real Electron journeys**

Run: `npm run test:e2e`
Expected: PASS

- [ ] **Step 6: Run behavior coverage gate**

Run: `npm run test:behavior-coverage`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: add stoa-ctl work session lifecycle support"
```
