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

  test('declares proposal and dispatch commands in the usage text', async () => {
    const module = await import('./index')

    expect(module.USAGE_TEXT).toContain('proposals list')
    expect(module.USAGE_TEXT).toContain('proposals get <proposalId>')
    expect(module.USAGE_TEXT).toContain('dispatch proposal <proposalId>')
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
