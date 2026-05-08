import { afterEach, describe, expect, test } from 'vitest'
import { request } from 'node:http'
import { createHermesControlServer } from './hermes-control-server'

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

describe('Hermes control server', () => {
  afterEach(async () => {
    await Promise.allSettled(servers.splice(0).map((server) => server.stop()))
  })

  test('serves /ctl/work-sessions/:id/context?level=full as plain text and /ctl/state/brief as json', async () => {
    const server = createHermesControlServer({
      getSessionSecret(sessionId) {
        return sessionId === 'hermes_1' ? 'secret-1' : null
      },
      snapshotSource: {
        snapshot() {
          return {
            activeProjectId: 'project_1',
            activeSessionId: 'session_1',
            terminalWebhookPort: 43127,
            projects: [],
            sessions: [{
              id: 'session_1',
              projectId: 'project_1',
              type: 'codex',
              runtimeState: 'alive',
              turnState: 'running',
              turnEpoch: 1,
              lastTurnOutcome: 'none',
              blockingReason: null,
              failureReason: null,
              hasUnseenCompletion: false,
              runtimeExitCode: null,
              runtimeExitReason: null,
              lastStateSequence: 2,
              title: 'session one',
              summary: 'Running tests',
              recoveryMode: 'resume-external',
              externalSessionId: 'codex-1',
              createdAt: '2026-05-07T08:00:00.000Z',
              updatedAt: '2026-05-07T08:10:00.000Z',
              lastActivatedAt: '2026-05-07T08:10:00.000Z',
              archived: false
            }]
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
})
