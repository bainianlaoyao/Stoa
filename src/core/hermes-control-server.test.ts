import { afterEach, describe, expect, test } from 'vitest'
import { request } from 'node:http'
import { createHermesControlServer } from './hermes-control-server'
import type { HermesSessionSummary } from '@shared/hermes'

const servers: Array<ReturnType<typeof createHermesControlServer>> = []

async function get(
  port: number,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: string; contentType: string | undefined }> {
  return await new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body,
            contentType: response.headers['content-type']
          })
        })
      }
    )

    req.on('error', reject)
    req.end()
  })
}

async function post(
  port: number,
  path: string,
  headers: Record<string, string> = {},
  body?: string
): Promise<{ statusCode: number; body: string; contentType: string | undefined }> {
  return await new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          ...headers,
          ...(body ? { 'content-type': 'application/json' } : {})
        }
      },
      (response) => {
        let responseBody = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          responseBody += chunk
        })
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: responseBody,
            contentType: response.headers['content-type']
          })
        })
      }
    )

    req.on('error', reject)
    if (body) {
      req.write(body)
    }
    req.end()
  })
}

function createWorkSession() {
  return {
    id: 'session_1',
    projectId: 'project_1',
    type: 'codex' as const,
    runtimeState: 'alive' as const,
    turnState: 'running' as const,
    turnEpoch: 1,
    lastTurnOutcome: 'none' as const,
    blockingReason: null,
    failureReason: null,
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    lastStateSequence: 2,
    title: 'session one',
    summary: 'Running tests',
    recoveryMode: 'resume-external' as const,
    externalSessionId: 'codex-1',
    createdAt: '2026-05-07T08:00:00.000Z',
    updatedAt: '2026-05-07T08:10:00.000Z',
    lastActivatedAt: '2026-05-07T08:10:00.000Z',
    archived: false
  }
}

function createHermesSession(id = 'hermes_1') {
  return {
    id,
    title: id === 'hermes_1' ? 'Global Triage' : 'Second Hermes',
    status: 'running' as const,
    capabilityLevel: 3 as const,
    pendingProposalCount: 1,
    activeTargetCount: 2,
    lastSummary: 'Review pending approvals',
    lastRisk: 'Freeform prompt pending approval',
    resumeSessionId: `resume-${id}`,
    createdAt: '2026-05-07T08:00:00.000Z',
    updatedAt: '2026-05-07T08:10:00.000Z',
    lastActivatedAt: '2026-05-07T08:10:00.000Z'
  }
}

describe('Hermes control server', () => {
  afterEach(async () => {
    await Promise.allSettled(servers.splice(0).map((server) => server.stop()))
  })

  test('serves /ctl/work-sessions/:id/context?level=full as plain text and /ctl/state/brief as json', async () => {
    const server = createHermesControlServer({
      getSessionSecret(sessionId) {
        return sessionId === 'hermes_1' ? 'secret-1' : null
      },
      hermesSessionSource: {
        snapshot() {
          return {
            activeHermesSessionId: 'hermes_1',
            sessions: [createHermesSession()],
            inspectorTarget: { kind: 'app' }
          }
        },
        getSession(sessionId) {
          return sessionId === 'hermes_1' ? createHermesSession() : null
        },
        async createSession() {
          return createHermesSession('hermes_created')
        },
        async setActiveSession() {},
        async closeSession() {}
      },
      snapshotSource: {
        snapshot() {
          return {
            activeProjectId: 'project_1',
            activeSessionId: 'session_1',
            terminalWebhookPort: 43127,
            projects: [],
            sessions: [createWorkSession()]
          }
        }
      },
      getSessionPresence() {
        return null
      },
      contextAssembler: {
        async getStatus() {
          return { level: 'status', sessionId: 'session_1' }
        },
        async getBundle() {
          return { level: 'bundle', sessionId: 'session_1' }
        },
        async getFullContext() {
          return {
            text: '[Assistant]\nReview the failing tests.\n[Terminal]\nnpm test',
            truncated: false,
            nextCursor: null
          }
        }
      } as never,
      dispatcher: {
        async promptWorkSession() {
          return { kind: 'approval_required' }
        },
        async dispatchProposal() {
          return { kind: 'dispatched' }
        }
      } as never,
      proposals: {
        list() {
          return []
        },
        get() {
          return null
        }
      } as never
    })
    servers.push(server)
    const port = await server.start()

    const authHeaders = {
      'x-stoa-session-id': 'hermes_1',
      'x-stoa-secret': 'secret-1'
    }

    const full = await get(port, '/ctl/work-sessions/session_1/context?level=full', authHeaders)
    const brief = await get(port, '/ctl/state/brief', authHeaders)

    expect(full.statusCode).toBe(200)
    expect(full.body).toContain('[Assistant]')
    expect(full.contentType).toContain('text/plain')
    expect(brief.statusCode).toBe(200)
    expect(JSON.parse(brief.body)).toMatchObject({
      ok: true
    })
  })

  test('serves whoami, capabilities, work-session collections, and Hermes session collections', async () => {
    const server = createHermesControlServer({
      getSessionSecret(sessionId) {
        return sessionId === 'hermes_1' ? 'secret-1' : null
      },
      hermesSessionSource: {
        snapshot() {
          return {
            activeHermesSessionId: 'hermes_1',
            sessions: [createHermesSession(), createHermesSession('hermes_2')],
            inspectorTarget: { kind: 'app' }
          }
        },
        getSession(sessionId) {
          return [createHermesSession(), createHermesSession('hermes_2')].find((session) => session.id === sessionId) ?? null
        },
        async createSession() {
          return createHermesSession('hermes_created')
        },
        async setActiveSession() {},
        async closeSession() {}
      },
      snapshotSource: {
        snapshot() {
          return {
            activeProjectId: 'project_1',
            activeSessionId: 'session_1',
            terminalWebhookPort: 43127,
            projects: [],
            sessions: [createWorkSession()]
          }
        }
      },
      getSessionPresence() {
        return null
      },
      contextAssembler: {
        getStatus() {
          return { level: 'status', session: createWorkSession(), presence: null }
        },
        getEvents() {
          return {
            events: [{ eventId: 'evt_1' }],
            nextCursor: null
          }
        },
        getBundle() {
          return {
            level: 'bundle',
            session: createWorkSession(),
            presence: null,
            events: [{ eventId: 'evt_1' }]
          }
        },
        async getFullContext() {
          return {
            text: '[Assistant]\nReview the failing tests.',
            truncated: false,
            nextCursor: null
          }
        }
      } as never,
      dispatcher: {
        async promptWorkSession() {
          return { kind: 'approval_required' }
        },
        async dispatchProposal() {
          return { kind: 'dispatched' }
        }
      } as never,
      proposals: {
        list() {
          return []
        },
        get() {
          return null
        }
      } as never
    })
    servers.push(server)
    const port = await server.start()

    const authHeaders = {
      'x-stoa-session-id': 'hermes_1',
      'x-stoa-secret': 'secret-1'
    }

    const whoami = await get(port, '/ctl/whoami', authHeaders)
    const capabilities = await get(port, '/ctl/capabilities', authHeaders)
    const workSessions = await get(port, '/ctl/work-sessions', authHeaders)
    const workSession = await get(port, '/ctl/work-sessions/session_1', authHeaders)
    const events = await get(port, '/ctl/work-sessions/session_1/events?limit=10&cursor=12&includeEphemeral=1', authHeaders)
    const hermesSessions = await get(port, '/ctl/hermes-sessions', authHeaders)
    const hermesSession = await get(port, '/ctl/hermes-sessions/hermes_2', authHeaders)

    expect(JSON.parse(whoami.body)).toMatchObject({
      ok: true,
      data: {
        sessionId: 'hermes_1',
        title: 'Global Triage',
        capabilityLevel: 3
      }
    })
    expect(JSON.parse(capabilities.body)).toMatchObject({
      ok: true,
      data: {
        capabilityLevel: 3
      }
    })
    expect(JSON.parse(workSessions.body)).toMatchObject({
      ok: true,
      data: {
        sessions: [{
          id: 'session_1'
        }]
      }
    })
    expect(JSON.parse(workSession.body)).toMatchObject({
      ok: true,
      data: {
        session: {
          id: 'session_1'
        }
      }
    })
    expect(JSON.parse(events.body)).toMatchObject({
      ok: true,
      data: {
        events: [{
          eventId: 'evt_1'
        }]
      }
    })
    expect(JSON.parse(hermesSessions.body)).toMatchObject({
      ok: true,
      data: {
        sessions: [{
          id: 'hermes_1'
        }, {
          id: 'hermes_2'
        }]
      }
    })
    expect(JSON.parse(hermesSession.body)).toMatchObject({
      ok: true,
      data: {
        session: {
          id: 'hermes_2'
        }
      }
    })
  })

  test('creates activates and closes Hermes sessions through control routes', async () => {
    const hermesSessions: HermesSessionSummary[] = [createHermesSession()]
    let activeHermesSessionId: string | null = 'hermes_1'

    const server = createHermesControlServer({
      getSessionSecret(sessionId) {
        return sessionId === 'hermes_1' ? 'secret-1' : null
      },
      hermesSessionSource: {
        snapshot() {
          return {
            activeHermesSessionId,
            sessions: hermesSessions.map((session) => ({ ...session })),
            inspectorTarget: { kind: 'app' }
          }
        },
        getSession(sessionId) {
          return hermesSessions.find((session) => session.id === sessionId) ?? null
        },
        async createSession(request) {
          const created = {
            ...createHermesSession('hermes_2'),
            title: request.title,
            capabilityLevel: request.capabilityLevel
          }
          hermesSessions.push(created)
          return created
        },
        async setActiveSession(sessionId) {
          activeHermesSessionId = sessionId
        },
        async closeSession(sessionId) {
          const target = hermesSessions.find((session) => session.id === sessionId)
          if (target) {
            target.status = 'closed'
          }
        }
      },
      snapshotSource: {
        snapshot() {
          return {
            activeProjectId: 'project_1',
            activeSessionId: 'session_1',
            terminalWebhookPort: 43127,
            projects: [],
            sessions: [createWorkSession()]
          }
        }
      },
      getSessionPresence() {
        return null
      },
      contextAssembler: {
        getStatus() {
          return { level: 'status', session: createWorkSession(), presence: null }
        },
        getBundle() {
          return { level: 'bundle', session: createWorkSession(), presence: null, events: [] }
        },
        async getFullContext() {
          return { text: '', truncated: false, nextCursor: null }
        }
      } as never,
      dispatcher: {
        async promptWorkSession() {
          return { kind: 'approval_required' }
        },
        async dispatchProposal() {
          return { kind: 'dispatched' }
        }
      } as never,
      proposals: {
        list() {
          return []
        },
        get() {
          return null
        }
      } as never
    })
    servers.push(server)
    const port = await server.start()

    const authHeaders = {
      'x-stoa-session-id': 'hermes_1',
      'x-stoa-secret': 'secret-1'
    }

    const created = await post(port, '/ctl/hermes-sessions', authHeaders, '{"title":"global-triage","capabilityLevel":3}')
    const activated = await post(port, '/ctl/hermes-sessions/hermes_2/activate', authHeaders)
    const closed = await post(port, '/ctl/hermes-sessions/hermes_2/close', authHeaders)

    expect(JSON.parse(created.body)).toMatchObject({
      ok: true,
      data: {
        id: 'hermes_2',
        title: 'global-triage'
      }
    })
    expect(JSON.parse(activated.body)).toMatchObject({
      ok: true,
      data: {
        activeHermesSessionId: 'hermes_2'
      }
    })
    expect(JSON.parse(closed.body)).toMatchObject({
      ok: true,
      data: {
        session: {
          id: 'hermes_2',
          status: 'closed'
        }
      }
    })
  })

  test('serves attention queue and supports proposal creation plus preset dispatch routes', async () => {
    const server = createHermesControlServer({
      getSessionSecret(sessionId) {
        return sessionId === 'hermes_1' ? 'secret-1' : null
      },
      hermesSessionSource: {
        snapshot() {
          return {
            activeHermesSessionId: 'hermes_1',
            sessions: [createHermesSession()],
            inspectorTarget: { kind: 'app' }
          }
        },
        getSession(sessionId) {
          return sessionId === 'hermes_1' ? createHermesSession() : null
        },
        async createSession() {
          return createHermesSession('hermes_created')
        },
        async setActiveSession() {},
        async closeSession() {}
      },
      snapshotSource: {
        snapshot() {
          return {
            activeProjectId: 'project_1',
            activeSessionId: 'session_1',
            terminalWebhookPort: 43127,
            projects: [],
            sessions: [{
              ...createWorkSession(),
              failureReason: 'provider_error',
              lastTurnOutcome: 'failed',
              hasUnseenCompletion: false
            }]
          }
        }
      },
      getSessionPresence() {
        return {
          sessionId: 'session_1',
          projectId: 'project_1',
          providerId: 'codex',
          providerLabel: 'Codex',
          modelLabel: null,
          phase: 'failure',
          runtimeState: 'alive',
          turnState: 'idle',
          turnEpoch: 1,
          lastTurnOutcome: 'failed',
          blockingReason: null,
          failureReason: 'provider_error',
          hasUnseenCompletion: false,
          runtimeExitCode: null,
          runtimeExitReason: null,
          confidence: 'authoritative',
          health: 'lost',
          lastAssistantSnippet: null,
          lastEventAt: '2026-05-07T08:10:00.000Z',
          lastEvidenceType: null,
          hasUnreadTurn: false,
          recoveryPointerState: 'trusted',
          evidenceSequence: 0,
          sourceSequence: 0,
          updatedAt: '2026-05-07T08:10:00.000Z'
        }
      },
      contextAssembler: {
        getStatus() {
          return { level: 'status', session: createWorkSession(), presence: null }
        },
        getEvents() {
          return { events: [], nextCursor: null }
        },
        getBundle() {
          return { level: 'bundle', session: createWorkSession(), presence: null, events: [] }
        },
        async getFullContext() {
          return { text: '', truncated: false, nextCursor: null }
        }
      } as never,
      dispatcher: {
        async promptWorkSession() {
          return {
            kind: 'approval_required',
            proposal: {
              id: 'proposal_2',
              status: 'pending_approval'
            }
          }
        },
        async createPromptProposal() {
          return {
            id: 'proposal_2',
            status: 'pending_approval'
          }
        },
        async dispatchPreset() {
          return {
            kind: 'dispatched',
            presetName: 'run-tests-only'
          }
        },
        async dispatchProposal() {
          return { kind: 'dispatched' }
        }
      } as never,
      proposals: {
        list() {
          return []
        },
        get() {
          return null
        }
      } as never
    })
    servers.push(server)
    const port = await server.start()

    const authHeaders = {
      'x-stoa-session-id': 'hermes_1',
      'x-stoa-secret': 'secret-1'
    }

    const attentionQueue = await get(port, '/ctl/state/attention-queue', authHeaders)
    const conflicts = await get(port, '/ctl/state/conflicts', authHeaders)
    const createdProposal = await post(
      port,
      '/ctl/proposals',
      authHeaders,
      '{"kind":"prompt","targetSessionId":"session_1","text":"Review the diff only."}'
    )
    const dispatchedPreset = await post(
      port,
      '/ctl/dispatch/preset/run-tests-only',
      authHeaders,
      '{"targetSessionId":"session_1"}'
    )

    expect(JSON.parse(attentionQueue.body)).toMatchObject({
      ok: true,
      data: {
        sessions: [{
          sessionId: 'session_1',
          attentionReason: 'provider_error'
        }]
      }
    })
    expect(JSON.parse(conflicts.body)).toMatchObject({
      ok: true,
      data: {
        conflicts: []
      }
    })
    expect(JSON.parse(createdProposal.body)).toMatchObject({
      ok: true,
      data: {
        id: 'proposal_2'
      }
    })
    expect(JSON.parse(dispatchedPreset.body)).toMatchObject({
      ok: true,
      data: {
        kind: 'dispatched',
        presetName: 'run-tests-only'
      }
    })
  })
})
