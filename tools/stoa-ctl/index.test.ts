import { beforeEach, describe, expect, test, vi } from 'vitest'

interface MockResponseInit {
  ok?: boolean
  status?: number
  body?: string
}

function createResponse(init: MockResponseInit = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    async text() {
      return init.body ?? '{"ok":true}'
    }
  } as Response
}

describe('stoa-ctl command surface', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('declares Hermes discovery, session, proposal, and dispatch commands in the usage text', async () => {
    const module = await import('./index')

    expect(module.USAGE_TEXT).toContain('whoami')
    expect(module.USAGE_TEXT).toContain('capabilities')
    expect(module.USAGE_TEXT).toContain('work-sessions list')
    expect(module.USAGE_TEXT).toContain('work-sessions get <id>')
    expect(module.USAGE_TEXT).toContain('work-sessions events <id>')
    expect(module.USAGE_TEXT).toContain('state attention-queue')
    expect(module.USAGE_TEXT).toContain('state conflicts')
    expect(module.USAGE_TEXT).toContain('hermes-sessions list')
    expect(module.USAGE_TEXT).toContain('hermes-sessions create --title "..."')
    expect(module.USAGE_TEXT).toContain('proposals create prompt --target <sessionId> --text "..."')
    expect(module.USAGE_TEXT).toContain('proposals list')
    expect(module.USAGE_TEXT).toContain('proposals get <proposalId>')
    expect(module.USAGE_TEXT).toContain('dispatch preset <name> --target <sessionId>')
    expect(module.USAGE_TEXT).toContain('dispatch proposal <proposalId>')
  })

  test('reads whoami through the control plane', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/whoami')
      return createResponse({
        body: '{"ok":true,"data":{"sessionId":"hermes_1","title":"Global Triage"},"error":null}'
      })
    })

    const exitCode = await module.run(['whoami'], {
      fetch: fetchImpl,
      env: {
        STOA_CTL_BASE_URL: 'http://127.0.0.1:43129',
        STOA_CTL_TOKEN: 'secret-1',
        STOA_HERMES_SESSION_ID: 'hermes_1'
      },
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        }
      },
      stderr: {
        write() {}
      },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"Global Triage"')
  })

  test('lists work-session events with query flags through the control plane', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/work-sessions/session_1/events?limit=10&cursor=12&includeEphemeral=1')
      return createResponse({
        body: '{"ok":true,"data":{"events":[{"eventId":"evt_1"}],"nextCursor":null},"error":null}'
      })
    })

    const exitCode = await module.run([
      'work-sessions',
      'events',
      'session_1',
      '--limit',
      '10',
      '--cursor',
      '12',
      '--include-ephemeral'
    ], {
      fetch: fetchImpl,
      env: {
        STOA_CTL_BASE_URL: 'http://127.0.0.1:43129',
        STOA_CTL_TOKEN: 'secret-1',
        STOA_HERMES_SESSION_ID: 'hermes_1'
      },
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        }
      },
      stderr: {
        write() {}
      },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"evt_1"')
  })

  test('creates Hermes sessions through the control plane', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(String(_input)).toBe('http://127.0.0.1:43129/ctl/hermes-sessions')
      expect(init?.method).toBe('POST')
      expect(init?.body).toBe('{"title":"global-triage","capabilityLevel":3}')
      return createResponse({
        body: '{"ok":true,"data":{"id":"hermes_2","title":"global-triage"},"error":null}'
      })
    })

    const exitCode = await module.run([
      'hermes-sessions',
      'create',
      '--title',
      'global-triage',
      '--capability-level',
      '3'
    ], {
      fetch: fetchImpl,
      env: {
        STOA_CTL_BASE_URL: 'http://127.0.0.1:43129',
        STOA_CTL_TOKEN: 'secret-1',
        STOA_HERMES_SESSION_ID: 'hermes_1'
      },
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        }
      },
      stderr: {
        write() {}
      },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"hermes_2"')
  })

  test('reads the attention queue through the control plane', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/state/attention-queue')
      return createResponse({
        body: '{"ok":true,"data":{"sessions":[{"sessionId":"session_1","attentionReason":"provider_error"}]},"error":null}'
      })
    })

    const exitCode = await module.run(['state', 'attention-queue'], {
      fetch: fetchImpl,
      env: {
        STOA_CTL_BASE_URL: 'http://127.0.0.1:43129',
        STOA_CTL_TOKEN: 'secret-1',
        STOA_HERMES_SESSION_ID: 'hermes_1'
      },
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        }
      },
      stderr: {
        write() {}
      },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"provider_error"')
  })

  test('creates prompt proposals through the control plane', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/proposals')
      expect(init?.method).toBe('POST')
      expect(init?.body).toBe('{"kind":"prompt","targetSessionId":"session_1","text":"Review the diff only."}')
      return createResponse({
        body: '{"ok":true,"data":{"id":"proposal_2","status":"pending_approval"},"error":null}'
      })
    })

    const exitCode = await module.run([
      'proposals',
      'create',
      'prompt',
      '--target',
      'session_1',
      '--text',
      'Review the diff only.'
    ], {
      fetch: fetchImpl,
      env: {
        STOA_CTL_BASE_URL: 'http://127.0.0.1:43129',
        STOA_CTL_TOKEN: 'secret-1',
        STOA_HERMES_SESSION_ID: 'hermes_1'
      },
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        }
      },
      stderr: {
        write() {}
      },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"proposal_2"')
  })

  test('dispatches a safe preset through the control plane', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/dispatch/preset/run-tests-only')
      expect(init?.method).toBe('POST')
      expect(init?.body).toBe('{"targetSessionId":"session_1"}')
      return createResponse({
        body: '{"ok":true,"data":{"kind":"dispatched","presetName":"run-tests-only"},"error":null}'
      })
    })

    const exitCode = await module.run([
      'dispatch',
      'preset',
      'run-tests-only',
      '--target',
      'session_1'
    ], {
      fetch: fetchImpl,
      env: {
        STOA_CTL_BASE_URL: 'http://127.0.0.1:43129',
        STOA_CTL_TOKEN: 'secret-1',
        STOA_HERMES_SESSION_ID: 'hermes_1'
      },
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        }
      },
      stderr: {
        write() {}
      },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"run-tests-only"')
  })

  test('lists proposals through the control plane', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/proposals')
      return createResponse({
        body: '{"ok":true,"data":[{"id":"proposal_1"}],"error":null}'
      })
    })

    const exitCode = await module.run(['proposals', 'list'], {
      fetch: fetchImpl,
      env: {
        STOA_CTL_BASE_URL: 'http://127.0.0.1:43129',
        STOA_CTL_TOKEN: 'secret-1',
        STOA_HERMES_SESSION_ID: 'hermes_1'
      },
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        }
      },
      stderr: {
        write() {}
      },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"proposal_1"')
  })

  test('waits until a proposal leaves pending approval', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(createResponse({
        body: '{"ok":true,"data":{"id":"proposal_1","status":"pending_approval"},"error":null}'
      }))
      .mockResolvedValueOnce(createResponse({
        body: '{"ok":true,"data":{"id":"proposal_1","status":"approved"},"error":null}'
      }))

    const sleep = vi.fn(async () => {})
    const exitCode = await module.run(['proposals', 'wait', 'proposal_1', '--interval-ms', '1', '--timeout-ms', '10'], {
      fetch: fetchImpl,
      env: {
        STOA_CTL_BASE_URL: 'http://127.0.0.1:43129',
        STOA_CTL_TOKEN: 'secret-1',
        STOA_HERMES_SESSION_ID: 'hermes_1'
      },
      stdout: {
        write(chunk: string) {
          writes.push(chunk)
        }
      },
      stderr: {
        write() {}
      },
      sleep
    })

    expect(exitCode).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(writes.join('')).toContain('"approved"')
  })

  test('maps stale dispatch failures to exit code 5', async () => {
    const module = await import('./index')
    const stderr: string[] = []
    const fetchImpl = vi.fn(async () => createResponse({
      ok: false,
      status: 409,
      body: '{"ok":false,"data":null,"error":{"code":"stale_proposal","message":"Proposal is stale.","details":{}}}'
    }))

    const exitCode = await module.run(['dispatch', 'proposal', 'proposal_1'], {
      fetch: fetchImpl,
      env: {
        STOA_CTL_BASE_URL: 'http://127.0.0.1:43129',
        STOA_CTL_TOKEN: 'secret-1',
        STOA_HERMES_SESSION_ID: 'hermes_1'
      },
      stdout: {
        write() {}
      },
      stderr: {
        write(chunk: string) {
          stderr.push(chunk)
        }
      },
      sleep: async () => {}
    })

    expect(exitCode).toBe(5)
    expect(stderr.join('')).toContain('Proposal is stale.')
  })
})
