import { afterEach, describe, expect, test } from 'vitest'
import { request } from 'node:http'
import { createMetaSessionControlServer } from './meta-session-control-server'
import type { CreateMetaSessionRequest, MetaSessionSummary } from '@shared/meta-session'

const servers: Array<ReturnType<typeof createMetaSessionControlServer>> = []

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

function createMetaSession(id = 'meta_session_1'): MetaSessionSummary {
  return {
    id,
    title: id === 'meta_session_1' ? 'Global Triage' : 'Second Meta Session',
    status: 'running',
    backendSessionType: 'claude-code',
    capabilityLevel: 3,
    pendingProposalCount: 1,
    activeTargetCount: 2,
    lastSummary: 'Review pending approvals',
    lastRisk: 'Freeform prompt pending approval',
    backendSessionId: `backend-${id}`,
    createdAt: '2026-05-07T08:00:00.000Z',
    updatedAt: '2026-05-07T08:10:00.000Z',
    lastActivatedAt: '2026-05-07T08:10:00.000Z'
  }
}

describe('meta session control server', () => {
  afterEach(async () => {
    await Promise.allSettled(servers.splice(0).map((server) => server.stop()))
  })

  test('serves /ctl/work-sessions/:id/context?level=full as plain text, supports slim text context, and /ctl/state/brief as json', async () => {
    const server = createMetaSessionControlServer({
      metaSessionSource: {
        snapshot() {
          return {
            activeMetaSessionId: 'meta_session_1',
            sessions: [createMetaSession()],
            inspectorTarget: { kind: 'app' }
          }
        },
        getSession(sessionId: string) {
          return sessionId === 'meta_session_1' ? createMetaSession() : null
        },
        async createSession() {
          return createMetaSession('meta_session_created')
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
        async getSlimContext() {
          return {
            text: '[User]\nSummarize the failure.\n[Assistant]\nThe resume pointer is stale.',
            truncated: false,
            nextCursor: null
          }
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
      'x-stoa-session-id': 'meta_session_1'
    }

    const slim = await get(port, '/ctl/work-sessions/session_1/context?level=slim', authHeaders)
    const full = await get(port, '/ctl/work-sessions/session_1/context?level=full', authHeaders)
    const brief = await get(port, '/ctl/state/brief', authHeaders)

    expect(slim.statusCode).toBe(200)
    expect(slim.body).toContain('[User]')
    expect(slim.contentType).toContain('text/plain')
    expect(full.statusCode).toBe(200)
    expect(full.body).toContain('[Assistant]')
    expect(full.contentType).toContain('text/plain')
    expect(brief.statusCode).toBe(200)
    expect(JSON.parse(brief.body)).toMatchObject({
      ok: true
    })
  })

  test('serves whoami, capabilities, work-session collections, and meta session collections', async () => {
    const server = createMetaSessionControlServer({
      metaSessionSource: {
        snapshot() {
          return {
            activeMetaSessionId: 'meta_session_1',
            sessions: [createMetaSession(), createMetaSession('meta_session_2')],
            inspectorTarget: { kind: 'app' }
          }
        },
        getSession(sessionId: string) {
          return [createMetaSession(), createMetaSession('meta_session_2')].find((session) => session.id === sessionId) ?? null
        },
        async createSession() {
          return createMetaSession('meta_session_created')
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
        async getSlimContext() {
          return {
            text: '[User]\nSummarize the failure.',
            truncated: false,
            nextCursor: null
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
      'x-stoa-session-id': 'meta_session_1'
    }

    const whoami = await get(port, '/ctl/whoami', authHeaders)
    const capabilities = await get(port, '/ctl/capabilities', authHeaders)
    const workSessions = await get(port, '/ctl/work-sessions', authHeaders)
    const workSession = await get(port, '/ctl/work-sessions/session_1', authHeaders)
    const events = await get(port, '/ctl/work-sessions/session_1/events?limit=10&cursor=12&includeEphemeral=1', authHeaders)
    const metaSessions = await get(port, '/ctl/meta-sessions', authHeaders)
    const metaSession = await get(port, '/ctl/meta-sessions/meta_session_2', authHeaders)

    expect(JSON.parse(whoami.body)).toMatchObject({
      ok: true,
      data: {
        sessionId: 'meta_session_1',
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
    expect(JSON.parse(metaSessions.body)).toMatchObject({
      ok: true,
      data: {
        sessions: [{
          id: 'meta_session_1'
        }, {
          id: 'meta_session_2'
        }]
      }
    })
    expect(JSON.parse(metaSession.body)).toMatchObject({
      ok: true,
      data: {
        session: {
          id: 'meta_session_2'
        }
      }
    })
  })

  test('creates activates and closes meta sessions through control routes', async () => {
    const metaSessions: MetaSessionSummary[] = [createMetaSession()]
    let activeMetaSessionId: string | null = 'meta_session_1'

    const server = createMetaSessionControlServer({
      metaSessionSource: {
        snapshot() {
          return {
            activeMetaSessionId,
            sessions: metaSessions.map((session) => ({ ...session })),
            inspectorTarget: { kind: 'app' }
          }
        },
        getSession(sessionId: string) {
          return metaSessions.find((session) => session.id === sessionId) ?? null
        },
        async createSession(request: CreateMetaSessionRequest) {
          const created: MetaSessionSummary = {
            ...createMetaSession('meta_session_2'),
            title: request.title,
            backendSessionType: request.backendSessionType,
            capabilityLevel: request.capabilityLevel
          }
          metaSessions.push(created)
          return created
        },
        async setActiveSession(sessionId: string) {
          activeMetaSessionId = sessionId
        },
        async closeSession(sessionId: string) {
          const target = metaSessions.find((session) => session.id === sessionId)
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
        async getSlimContext() {
          return { text: '', truncated: false, nextCursor: null }
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
      'x-stoa-session-id': 'meta_session_1'
    }

    const created = await post(port, '/ctl/meta-sessions', authHeaders, '{"title":"global-triage","backendSessionType":"claude-code","capabilityLevel":3}')
    const activated = await post(port, '/ctl/meta-sessions/meta_session_2/activate', authHeaders)
    const closed = await post(port, '/ctl/meta-sessions/meta_session_2/close', authHeaders)

    expect(JSON.parse(created.body)).toMatchObject({
      ok: true,
      data: {
        id: 'meta_session_2',
        title: 'global-triage'
      }
    })
    expect(JSON.parse(activated.body)).toMatchObject({
      ok: true,
      data: {
        activeMetaSessionId: 'meta_session_2'
      }
    })
    expect(JSON.parse(closed.body)).toMatchObject({
      ok: true,
      data: {
        session: {
          id: 'meta_session_2',
          status: 'closed'
        }
      }
    })
  })

  test('serves attention queue and supports proposal creation plus preset dispatch routes', async () => {
    const server = createMetaSessionControlServer({
      metaSessionSource: {
        snapshot() {
          return {
            activeMetaSessionId: 'meta_session_1',
            sessions: [createMetaSession()],
            inspectorTarget: { kind: 'app' }
          }
        },
        getSession(sessionId: string) {
          return sessionId === 'meta_session_1' ? createMetaSession() : null
        },
        async createSession() {
          return createMetaSession('meta_session_created')
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
        async getSlimContext() {
          return { text: '', truncated: false, nextCursor: null }
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
      'x-stoa-session-id': 'meta_session_1'
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
