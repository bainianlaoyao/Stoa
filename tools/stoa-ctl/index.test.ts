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

const sessionEnv = {
  STOA_CTL_BASE_URL: 'http://127.0.0.1:43129',
  STOA_SESSION_ID: 'session_root_1',
  STOA_CTL_SESSION_TOKEN: 'tok_root_1'
}

describe('stoa-ctl command surface', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('declares unified session commands in the usage text', async () => {
    const module = await import('./index')

    expect(module.USAGE_TEXT).toContain('health')
    expect(module.USAGE_TEXT).toContain('whoami')
    expect(module.USAGE_TEXT).toContain('capabilities')
    expect(module.USAGE_TEXT).toContain('session list [--include-archived]')
    expect(module.USAGE_TEXT).toContain('session create --type <shell|opencode|codex|claude-code>')
    expect(module.USAGE_TEXT).toContain('session inspect <sessionId>')
    expect(module.USAGE_TEXT).toContain('session prompt <sessionId> --text "..."')
    expect(module.USAGE_TEXT).toContain('session destroy <sessionId>')
    expect(module.USAGE_TEXT).not.toContain('meta-sessions')
    expect(module.USAGE_TEXT).not.toContain('proposals')
    expect(module.USAGE_TEXT).not.toContain('dispatch preset')
  })

  test('reads whoami through the control plane as a session caller', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/whoami')
      expect(init?.headers).toMatchObject({
        'x-stoa-session-id': 'session_root_1',
        'x-stoa-session-token': 'tok_root_1'
      })
      return createResponse({
        body: '{"ok":true,"data":{"caller":"session","sessionId":"session_root_1"},"error":null}'
      })
    })

    const exitCode = await module.run(['whoami'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"session_root_1"')
  })

  test('reads whoami through the control plane as a local-user caller', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(String(_input)).toBe('http://127.0.0.1:54321/ctl/whoami')
      expect(init?.headers).toMatchObject({
        'x-stoa-secret': 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      })
      expect(init?.headers).not.toMatchObject({
        'x-stoa-session-id': expect.anything(),
        'x-stoa-session-token': expect.anything()
      })
      return createResponse({
        body: '{"ok":true,"data":{"caller":"local-user"},"error":null}'
      })
    })

    const exitCode = await module.run(['whoami'], {
      fetch: fetchImpl,
      env: {},
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {},
      readPortFile: async () => ({
        port: 54321,
        pid: process.pid,
        secret: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        startedAt: new Date().toISOString()
      })
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"local-user"')
  })

  test('lists sessions through the unified session endpoint', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/session/list')
      return createResponse({
        body: '{"ok":true,"data":{"nodes":[{"session":{"id":"session_root_1"},"tree":{"rootSessionId":"session_root_1","depth":0,"childCount":1,"descendantCount":1}}]},"error":null}'
      })
    })

    const exitCode = await module.run(['session', 'list'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"nodes"')
  })

  test('includes archived sessions when requested', async () => {
    const module = await import('./index')
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/session/list?includeArchived=1')
      return createResponse({
        body: '{"ok":true,"data":{"nodes":[]},"error":null}'
      })
    })

    const exitCode = await module.run(['session', 'list', '--include-archived'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write() {} },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
  })

  test('creates a root session for local-user with explicit project', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:54321/ctl/session/create')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({
        projectId: 'project_1',
        type: 'codex',
        title: 'root title'
      })
      return createResponse({
        body: '{"ok":true,"data":{"session":{"id":"session_new_1"}},"error":null}'
      })
    })

    const exitCode = await module.run(['session', 'create', '--project', 'project_1', '--type', 'codex', '--title', 'root title'], {
      fetch: fetchImpl,
      env: {},
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {},
      readPortFile: async () => ({
        port: 54321,
        pid: process.pid,
        secret: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        startedAt: new Date().toISOString()
      })
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"session_new_1"')
  })

  test('creates a direct child session for session caller without project or parent flags', async () => {
    const module = await import('./index')
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/session/create')
      expect(init?.method).toBe('POST')
      expect(init?.body).toBe('{"type":"claude-code","title":"child title"}')
      return createResponse({
        body: '{"ok":true,"data":{"session":{"id":"session_child_1"}},"error":null}'
      })
    })

    const exitCode = await module.run(['session', 'create', '--type', 'claude-code', '--title', 'child title'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write() {} },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
  })

  test('rejects session caller create when --project is provided', async () => {
    const module = await import('./index')
    const stderr: string[] = []

    const exitCode = await module.run(['session', 'create', '--project', 'project_1', '--type', 'codex'], {
      fetch: async () => { throw new Error('should not be called') },
      env: sessionEnv,
      stdout: { write() {} },
      stderr: { write(chunk: string) { stderr.push(chunk) } },
      sleep: async () => {}
    })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Usage')
  })

  test('rejects session caller create when --parent is provided', async () => {
    const module = await import('./index')
    const stderr: string[] = []

    const exitCode = await module.run(['session', 'create', '--parent', 'session_x', '--type', 'codex'], {
      fetch: async () => { throw new Error('should not be called') },
      env: sessionEnv,
      stdout: { write() {} },
      stderr: { write(chunk: string) { stderr.push(chunk) } },
      sleep: async () => {}
    })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Usage')
  })

  test('rejects local-user create when --project is missing', async () => {
    const module = await import('./index')
    const stderr: string[] = []

    const exitCode = await module.run(['session', 'create', '--type', 'codex'], {
      fetch: async () => { throw new Error('should not be called') },
      env: {},
      stdout: { write() {} },
      stderr: { write(chunk: string) { stderr.push(chunk) } },
      sleep: async () => {},
      readPortFile: async () => ({
        port: 54321,
        pid: process.pid,
        secret: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        startedAt: new Date().toISOString()
      })
    })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Usage')
  })

  test('inspects a session through the unified session endpoint', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/session/session_child_1/inspect')
      return createResponse({
        body: '{"ok":true,"data":{"node":{"session":{"id":"session_child_1"},"tree":{"rootSessionId":"session_root_1","depth":1,"childCount":0,"descendantCount":0}}},"error":null}'
      })
    })

    const exitCode = await module.run(['session', 'inspect', 'session_child_1'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"session_child_1"')
  })

  test('prompts a session through the unified session endpoint', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/session/session_child_1/prompt')
      expect(init?.method).toBe('POST')
      expect(init?.body).toBe('{"text":"hello"}')
      return createResponse({
        body: '{"ok":true,"data":{"kind":"dispatched"},"error":null}'
      })
    })

    const exitCode = await module.run(['session', 'prompt', 'session_child_1', '--text', 'hello'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"dispatched"')
  })

  test('destroys a session through the unified session endpoint', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/session/session_child_1/destroy')
      expect(init?.method).toBe('POST')
      return createResponse({
        body: '{"ok":true,"data":{"kind":"destroyed"},"error":null}'
      })
    })

    const exitCode = await module.run(['session', 'destroy', 'session_child_1'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"destroyed"')
  })

  test('maps unknown_session failures to exit code 6', async () => {
    const module = await import('./index')
    const stderr: string[] = []
    const fetchImpl = vi.fn(async () => createResponse({
      ok: false,
      status: 404,
      body: '{"ok":false,"data":null,"error":{"code":"unknown_session","message":"unknown_session"}}'
    }))

    const exitCode = await module.run(['session', 'inspect', 'missing'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write() {} },
      stderr: { write(chunk: string) { stderr.push(chunk) } },
      sleep: async () => {}
    })

    expect(exitCode).toBe(6)
    expect(stderr.join('')).toContain('unknown_session')
  })

  test('discovers base URL from port file when STOA_CTL_BASE_URL is unset', async () => {
    const module = await import('./index')
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://127.0.0.1:54321/ctl/health')
      return createResponse({ body: '{"ok":true,"data":{"ok":true},"error":null}' })
    })

    const exitCode = await module.run(['health'], {
      fetch: fetchImpl,
      env: {},
      stdout: { write() {} },
      stderr: { write() {} },
      sleep: async () => {},
      readPortFile: async () => ({
        port: 54321,
        pid: process.pid,
        secret: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        startedAt: new Date().toISOString()
      })
    })

    expect(exitCode).toBe(0)
  })

  test('ignores legacy activeMetaSessionId in the port file and still authenticates as local-user', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(String(_input)).toBe('http://127.0.0.1:54321/ctl/whoami')
      expect(init?.headers).toMatchObject({
        'x-stoa-secret': 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      })
      expect(init?.headers).not.toMatchObject({
        'x-stoa-session-id': expect.anything(),
        'x-stoa-session-token': expect.anything()
      })
      return createResponse({
        body: '{"ok":true,"data":{"caller":"local-user"},"error":null}'
      })
    })

    const exitCode = await module.run(['whoami'], {
      fetch: fetchImpl,
      env: {},
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {},
      readPortFile: async () => ({
        port: 54321,
        pid: process.pid,
        activeMetaSessionId: 'meta_from_port_file',
        secret: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        startedAt: new Date().toISOString()
      } as any)
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"local-user"')
  })

  test('ignores the port file when STOA_CTL_BASE_URL is set', async () => {
    const module = await import('./index')
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/health')
      return createResponse({ body: '{"ok":true,"data":{"ok":true},"error":null}' })
    })
    const readPortFile = vi.fn(async () => ({ port: 99999, pid: 1, secret: 'x'.repeat(64), startedAt: '2026-01-01' }))

    const exitCode = await module.run(['health'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write() {} },
      stderr: { write() {} },
      sleep: async () => {},
      readPortFile
    })

    expect(exitCode).toBe(0)
    expect(readPortFile).not.toHaveBeenCalled()
  })

  test('exits with code 3 when no control credentials are available', async () => {
    const module = await import('./index')
    const stderr: string[] = []

    const exitCode = await module.run(['whoami'], {
      fetch: async () => { throw new Error('should not be called') },
      env: {},
      stdout: { write() {} },
      stderr: { write(chunk: string) { stderr.push(chunk) } },
      sleep: async () => {},
      readPortFile: async () => null
    })

    expect(exitCode).toBe(3)
    expect(stderr.join('')).toContain('Stoa is not running')
  })

  test('detects direct entry when tsx passes its cli path as argv[1]', async () => {
    const module = await import('./index')

    expect(
      module.isDirectCliEntry(
        'file:///D:/Data/DEV/ultra_simple_panel/tools/stoa-ctl/index.ts',
        'D:/Data/DEV/ultra_simple_panel/node_modules/tsx/dist/cli.mjs'
      )
    ).toBe(false)
    expect(
      module.isDirectCliEntry(
        'file:///D:/Data/DEV/ultra_simple_panel/tools/stoa-ctl/index.ts',
        'D:/Data/DEV/ultra_simple_panel/tools/stoa-ctl/index.ts'
      )
    ).toBe(true)
    expect(
      module.isDirectCliEntry(
        'file:///D:/Data/DEV/ultra_simple_panel/tools/stoa-ctl/index.ts',
        'file:/D:/Data/DEV/ultra_simple_panel/tools/stoa-ctl/index.ts'
      )
    ).toBe(true)
  })
})
