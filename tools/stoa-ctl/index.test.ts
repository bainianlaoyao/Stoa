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
    expect(module.USAGE_TEXT).toContain('--external-session-id <id>')
    expect(module.USAGE_TEXT).toContain('--cols <n>')
    expect(module.USAGE_TEXT).toContain('--rows <n>')
    expect(module.USAGE_TEXT).toContain('session inspect <sessionId>')
    expect(module.USAGE_TEXT).toContain('session status <sessionId>')
    expect(module.USAGE_TEXT).toContain('session output <sessionId>')
    expect(module.USAGE_TEXT).toContain('session wait <sessionId> [--timeout <seconds>]')
    expect(module.USAGE_TEXT).not.toContain('--timeout-ms')
    expect(module.USAGE_TEXT).toContain('session report <sessionId>')
    expect(module.USAGE_TEXT).toContain('session input <sessionId> --text <text>|--file <path>|--stdin')
    expect(module.USAGE_TEXT).not.toContain('session prompt')
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

  test('passes optional create fields through to the control plane', async () => {
    const module = await import('./index')
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:54321/ctl/session/create')
      expect(JSON.parse(String(init?.body))).toEqual({
        projectId: 'project_1',
        type: 'codex',
        title: 'root title',
        externalSessionId: 'codex-external-1',
        initialCols: 132,
        initialRows: 44
      })
      return createResponse({
        body: '{"ok":true,"data":{"session":{"id":"session_new_1"}},"error":null}'
      })
    })

    const exitCode = await module.run([
      'session', 'create',
      '--project', 'project_1',
      '--type', 'codex',
      '--title', 'root title',
      '--external-session-id', 'codex-external-1',
      '--cols', '132',
      '--rows', '44'
    ], {
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

  test('rejects invalid create dimensions before sending the request', async () => {
    const module = await import('./index')
    const stderr: string[] = []

    const exitCode = await module.run([
      'session', 'create',
      '--project', 'project_1',
      '--type', 'codex',
      '--cols', 'wide'
    ], {
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

  test('reads session status through the unified session endpoint', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/session/session_child_1/status')
      return createResponse({
        body: '{"ok":true,"data":{"status":{"sessionId":"session_child_1","phase":"running"}},"error":null}'
      })
    })

    const exitCode = await module.run(['session', 'status', 'session_child_1'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"phase":"running"')
  })

  test('reads session output through the unified session endpoint', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/session/session_child_1/output')
      return createResponse({
        body: '{"ok":true,"data":{"output":{"sessionId":"session_child_1","text":"terminal replay"}},"error":null}'
      })
    })

    const exitCode = await module.run(['session', 'output', 'session_child_1'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('terminal replay')
  })

  test('waits for session completion with a timeout in seconds', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/session/session_child_1/wait?timeoutMs=120000')
      return createResponse({
        body: '{"ok":true,"data":{"result":{"session":{"session":{"id":"session_child_1"}},"status":{"phase":"completed"},"report":{"outcome":"completed"},"output":{"text":"done"}}},"error":null}'
      })
    })

    const exitCode = await module.run(['session', 'wait', 'session_child_1', '--timeout', '120'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"phase":"completed"')
    expect(writes.join('')).toContain('"outcome":"completed"')
  })

  test('rejects invalid wait timeout seconds before sending the request', async () => {
    const module = await import('./index')
    const stderr: string[] = []

    const exitCode = await module.run(['session', 'wait', 'session_child_1', '--timeout', '1.5'], {
      fetch: async () => { throw new Error('should not be called') },
      env: sessionEnv,
      stdout: { write() {} },
      stderr: { write(chunk: string) { stderr.push(chunk) } },
      sleep: async () => {}
    })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Usage')
  })

  test('rejects empty wait timeout seconds before sending the request', async () => {
    const module = await import('./index')
    const stderr: string[] = []

    const exitCode = await module.run(['session', 'wait', 'session_child_1', '--timeout', ''], {
      fetch: async () => { throw new Error('should not be called') },
      env: sessionEnv,
      stdout: { write() {} },
      stderr: { write(chunk: string) { stderr.push(chunk) } },
      sleep: async () => {}
    })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Usage')
  })

  test('rejects legacy wait timeout milliseconds flag before sending the request', async () => {
    const module = await import('./index')
    const stderr: string[] = []

    const exitCode = await module.run(['session', 'wait', 'session_child_1', '--timeout-ms', '1000'], {
      fetch: async () => { throw new Error('should not be called') },
      env: sessionEnv,
      stdout: { write() {} },
      stderr: { write(chunk: string) { stderr.push(chunk) } },
      sleep: async () => {}
    })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Usage')
  })

  test('rejects legacy wait timeout milliseconds equals flag before sending the request', async () => {
    const module = await import('./index')
    const stderr: string[] = []

    const exitCode = await module.run(['session', 'wait', 'session_child_1', '--timeout-ms=1000'], {
      fetch: async () => { throw new Error('should not be called') },
      env: sessionEnv,
      stdout: { write() {} },
      stderr: { write(chunk: string) { stderr.push(chunk) } },
      sleep: async () => {}
    })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Usage')
  })

  test('reads session completion report through the unified session endpoint', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/session/session_child_1/completion-report')
      return createResponse({
        body: '{"ok":true,"data":{"report":{"sessionId":"session_child_1","outcome":"completed"}},"error":null}'
      })
    })

    const exitCode = await module.run(['session', 'report', 'session_child_1'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('"session_child_1"')
  })

  test('sends input to a session through the session input endpoint', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/session/session_child_1/input')
      expect(init?.method).toBe('POST')
      expect(init?.body).toBe('{"text":"hello"}')
      return createResponse({
        body: '{"ok":true,"data":{"kind":"dispatched"},"error":null}'
      })
    })

    const exitCode = await module.run(['session', 'input', 'session_child_1', '--text', 'hello'], {
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

  test('rejects legacy session prompt command with usage error', async () => {
    const module = await import('./index')
    const stderr: string[] = []

    const exitCode = await module.run(['session', 'prompt', 'session_child_1', '--text', 'hello'], {
      fetch: async () => { throw new Error('should not be called') },
      env: sessionEnv,
      stdout: { write() {} },
      stderr: { write(chunk: string) { stderr.push(chunk) } },
      sleep: async () => {}
    })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Usage')
    expect(stderr.join('')).toContain('session input')
  })

  test('usage text does not contain --artifact', async () => {
    const module = await import('./index')
    expect(module.USAGE_TEXT).not.toContain('--artifact')
  })

  test('usage text contains subagent command group', async () => {
    const module = await import('./index')
    expect(module.USAGE_TEXT).toContain('subagent list')
    expect(module.USAGE_TEXT).toContain('subagent dispatch')
    expect(module.USAGE_TEXT).toContain('subagent wait')
    expect(module.USAGE_TEXT).toContain('subagent input')
    expect(module.USAGE_TEXT).toContain('subagent stop')
    expect(module.USAGE_TEXT).toContain('subagent result')
  })

  // ── parseInputSource tests ──

  test('parseInputSource rejects when no input source is provided', async () => {
    const module = await import('./index')
    await expect(
      module.parseInputSource([], { readFileUtf8: async () => '', readStdin: async () => '' })
    ).rejects.toThrow('Missing input source')
  })

  test('parseInputSource rejects when multiple input sources are provided', async () => {
    const module = await import('./index')
    await expect(
      module.parseInputSource(['--text', 'hello', '--file', 'foo.txt'], { readFileUtf8: async () => '', readStdin: async () => '' })
    ).rejects.toThrow('Multiple input sources')
  })

  test('parseInputSource returns text content for --text', async () => {
    const module = await import('./index')
    const result = await module.parseInputSource(['--text', 'hello world'], { readFileUtf8: async () => '', readStdin: async () => '' })
    expect(result).toBe('hello world')
  })

  test('parseInputSource returns file content for --file', async () => {
    const module = await import('./index')
    const result = await module.parseInputSource(['--file', '/some/path.md'], { readFileUtf8: async () => 'file content', readStdin: async () => '' })
    expect(result).toBe('file content')
  })

  test('parseInputSource returns stdin content for --stdin', async () => {
    const module = await import('./index')
    const result = await module.parseInputSource(['--stdin'], { readFileUtf8: async () => '', readStdin: async () => 'stdin content' })
    expect(result).toBe('stdin content')
  })

  test('parseInputSource rejects whitespace-only content', async () => {
    const module = await import('./index')
    await expect(
      module.parseInputSource(['--text', '   '], { readFileUtf8: async () => '', readStdin: async () => '' })
    ).rejects.toThrow('blank')
  })

  // ── subagent list tests ──

  test('subagent list shows subagents with short names and formal IDs', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/subagent/list')
      return createResponse({
        body: '{"ok":true,"data":{"subagents":[{"name":"ryu","id":"session_child_1","parentSessionId":"session_root_1","type":"claude-code","title":"Worker 1","phase":"running","resultStatus":null,"updatedAt":"2026-06-10T12:00:00Z"}]},"error":null}'
      })
    })

    const exitCode = await module.run(['subagent', 'list'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    const output = writes.join('')
    expect(output).toContain('ryu')
    expect(output).toContain('session_child_1')
  })

  test('subagent list shows no subagents message when empty', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async () => createResponse({
      body: '{"ok":true,"data":{"subagents":[]},"error":null}'
    }))

    const exitCode = await module.run(['subagent', 'list'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('No visible subagents')
  })

  // ── subagent dispatch tests ──

  test('subagent dispatch creates a child and delivers initial input', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/subagent/dispatch')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({
        type: 'claude-code',
        text: 'do the thing'
      })
      return createResponse({
        body: '{"ok":true,"data":{"subagent":{"name":"ryu","id":"session_child_2","title":"Worker","phase":"running"}},"error":null}'
      })
    })

    const exitCode = await module.run(['subagent', 'dispatch', '--type', 'claude-code', '--text', 'do the thing'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    const output = writes.join('')
    expect(output).toContain('Subagent dispatched')
    expect(output).toContain('Name: ryu')
    expect(output).toContain('ID: session_child_2')
  })

  test('subagent dispatch rejects session caller passing --parent', async () => {
    const module = await import('./index')
    const stderr: string[] = []

    const exitCode = await module.run(['subagent', 'dispatch', '--type', 'claude-code', '--text', 'hi', '--parent', 'session_x'], {
      fetch: async () => { throw new Error('should not be called') },
      env: sessionEnv,
      stdout: { write() {} },
      stderr: { write(chunk: string) { stderr.push(chunk) } },
      sleep: async () => {}
    })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Usage')
  })

  test('subagent dispatch rejects local-user without --parent', async () => {
    const module = await import('./index')
    const stderr: string[] = []

    const exitCode = await module.run(['subagent', 'dispatch', '--type', 'claude-code', '--text', 'hi'], {
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

  // ── subagent wait tests ──

  test('subagent wait sends multiple targets with mode and timeout', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/subagent/wait')
      expect(init?.method).toBe('POST')
      const body = JSON.parse(String(init?.body))
      expect(body).toEqual({
        targets: ['ryu', 'mai'],
        mode: 'all',
        timeoutMs: 60000
      })
      return createResponse({
        body: JSON.stringify({
          ok: true,
          data: {
            result: {
              mode: 'all',
              conditionMet: true,
              overallStatus: 'complete',
              timeoutMs: 60000,
              elapsedMs: 5000,
              targets: [
                { target: 'ryu', name: 'ryu', id: 's1', state: 'completed', status: 'completed', source: 'explicit', title: null, body: 'done', updatedAt: '2026-06-10T12:00:00Z' },
                { target: 'mai', name: 'mai', id: 's2', state: 'completed', status: 'completed', source: 'explicit', title: null, body: 'also done', updatedAt: '2026-06-10T12:00:00Z' }
              ]
            }
          },
          error: null
        })
      })
    })

    const exitCode = await module.run(['subagent', 'wait', 'ryu', 'mai', '--mode', 'all', '--timeout', '60'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    const output = writes.join('')
    expect(output).toContain('Wait completed')
    expect(output).toContain('ryu')
    expect(output).toContain('mai')
  })

  test('subagent wait exits 0 iff conditionMet is true', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async () => createResponse({
      body: JSON.stringify({
        ok: true,
        data: {
          result: {
            mode: 'all',
            conditionMet: false,
            overallStatus: 'timeout',
            timeoutMs: 1000,
            elapsedMs: 1000,
            targets: [
              { target: 'ryu', name: 'ryu', id: 's1', state: 'pending', phase: 'running' }
            ]
          }
        },
        error: null
      })
    }))

    const exitCode = await module.run(['subagent', 'wait', 'ryu', '--timeout', '1'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(7)
    expect(writes.join('')).toContain('Condition met: false')
  })

  test('subagent wait defaults to mode all', async () => {
    const module = await import('./index')
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.mode).toBe('all')
      return createResponse({
        body: JSON.stringify({
          ok: true,
          data: {
            result: {
              mode: 'all',
              conditionMet: true,
              overallStatus: 'complete',
              timeoutMs: null,
              elapsedMs: 100,
              targets: [
                { target: 'ryu', name: 'ryu', id: 's1', state: 'completed', status: 'completed', source: 'explicit', title: null, body: 'done', updatedAt: '2026-06-10T12:00:00Z' }
              ]
            }
          },
          error: null
        })
      })
    })

    const exitCode = await module.run(['subagent', 'wait', 'ryu'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write() {} },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
  })

  // ── subagent input tests ──

  test('subagent input sends follow-up input to a subagent', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/subagent/input')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({
        target: 'ryu',
        text: 'continue'
      })
      return createResponse({
        body: '{"ok":true,"data":{"delivered":true,"subagent":{"name":"ryu","id":"session_child_1"},"updatedAt":"2026-06-10T12:00:00Z"},"error":null}'
      })
    })

    const exitCode = await module.run(['subagent', 'input', 'ryu', '--text', 'continue'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('Input delivered')
    expect(writes.join('')).toContain('ryu')
  })

  // ── subagent stop tests ──

  test('subagent stop sends stop request for multiple targets', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/subagent/stop')
      expect(init?.method).toBe('POST')
      const body = JSON.parse(String(init?.body))
      expect(body).toEqual({
        targets: ['ryu', 'mai'],
        mode: 'interrupt'
      })
      return createResponse({
        body: JSON.stringify({
          ok: true,
          data: {
            result: {
              mode: 'interrupt',
              overallStatus: 'complete',
              targets: [
                { target: 'ryu', name: 'ryu', id: 's1', state: 'interrupt_requested', updatedAt: '2026-06-10T12:00:00Z' },
                { target: 'mai', name: 'mai', id: 's2', state: 'interrupt_requested', updatedAt: '2026-06-10T12:00:00Z' }
              ]
            }
          },
          error: null
        })
      })
    })

    const exitCode = await module.run(['subagent', 'stop', 'ryu', 'mai'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    expect(writes.join('')).toContain('Stop completed')
  })

  test('subagent stop exits 0 iff overallStatus is complete', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async () => createResponse({
      body: JSON.stringify({
        ok: true,
        data: {
          result: {
            mode: 'interrupt',
            overallStatus: 'partial',
            targets: [
              { target: 'ryu', name: 'ryu', id: 's1', state: 'interrupt_requested', updatedAt: '2026-06-10T12:00:00Z' },
              { target: 'mai', mode: 'interrupt', state: 'error', error: { code: 'unknown_subagent', message: 'not found' } }
            ]
          }
        },
        error: null
      })
    }))

    const exitCode = await module.run(['subagent', 'stop', 'ryu', 'mai'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(7)
    expect(writes.join('')).toContain('Overall status: partial')
  })

  test('subagent stop rejects invalid mode', async () => {
    const module = await import('./index')
    const stderr: string[] = []

    const exitCode = await module.run(['subagent', 'stop', 'ryu', '--mode', 'terminate'], {
      fetch: async () => { throw new Error('should not be called') },
      env: sessionEnv,
      stdout: { write() {} },
      stderr: { write(chunk: string) { stderr.push(chunk) } },
      sleep: async () => {}
    })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Usage')
  })

  // ── subagent result tests ──

  test('subagent result submits result with status and text', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:43129/ctl/subagent/result')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({
        status: 'completed',
        text: 'task finished'
      })
      return createResponse({
        body: '{"ok":true,"data":{"result":{"status":"completed","title":null,"createdAt":"2026-06-10T12:00:00Z","updatedAt":"2026-06-10T12:00:00Z","hasBody":true}},"error":null}'
      })
    })

    const exitCode = await module.run(['subagent', 'result', '--status', 'completed', '--text', 'task finished'], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    const output = writes.join('')
    expect(output).toContain('Subagent result recorded.')
    expect(output).toContain('Status: completed')
    expect(output).toContain('Content: included')
    expect(output).toContain('Updated: 2026-06-10T12:00:00Z')
    expect(output).not.toContain('"ok":true')
    expect(output).not.toContain('"status":"completed"')
  })

  test('subagent result includes title in stdout when present', async () => {
    const module = await import('./index')
    const writes: string[] = []
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        status: 'blocked',
        text: 'need clarification',
        title: 'Blocked on upstream'
      })
      return createResponse({
        body: '{"ok":true,"data":{"result":{"status":"blocked","title":"Blocked on upstream","createdAt":"2026-06-10T12:00:00Z","updatedAt":"2026-06-10T12:05:00Z","hasBody":true}},"error":null}'
      })
    })

    const exitCode = await module.run([
      'subagent', 'result',
      '--status', 'blocked',
      '--title', 'Blocked on upstream',
      '--text', 'need clarification'
    ], {
      fetch: fetchImpl,
      env: sessionEnv,
      stdout: { write(chunk: string) { writes.push(chunk) } },
      stderr: { write() {} },
      sleep: async () => {}
    })

    expect(exitCode).toBe(0)
    const output = writes.join('')
    expect(output).toContain('Status: blocked')
    expect(output).toContain('Title: Blocked on upstream')
    expect(output).toContain('Updated: 2026-06-10T12:05:00Z')
  })

  test('subagent result rejects invalid status', async () => {
    const module = await import('./index')
    const stderr: string[] = []

    const exitCode = await module.run(['subagent', 'result', '--status', 'interrupted', '--text', 'hi'], {
      fetch: async () => { throw new Error('should not be called') },
      env: sessionEnv,
      stdout: { write() {} },
      stderr: { write(chunk: string) { stderr.push(chunk) } },
      sleep: async () => {}
    })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Usage')
  })
})
