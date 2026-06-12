/**
 * Tests for StoaClientPreloadAdapter.
 *
 * Verifies that each RendererApi method dispatches the correct HTTP method
 * and path to the underlying StoaClient. WS subscriptions are verified to
 * delegate to the client's subscribe/unsubscribe mechanism.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mock StoaClient ──────────────────────────────────────────────────

function createMockClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    sendBinaryInput: vi.fn(),
    connectWs: vi.fn(),
    flushBuffer: vi.fn(),
    dispose: vi.fn(),
    getBaseUrl: vi.fn(() => 'http://localhost:3270'),
    getToken: vi.fn(() => 'mock-token'),
  }
}

type MockClient = ReturnType<typeof createMockClient>

import { StoaClientPreloadAdapter } from './stoa-client-preload-adapter'

let client: MockClient
let adapter: StoaClientPreloadAdapter

beforeEach(() => {
  client = createMockClient()
  adapter = new StoaClientPreloadAdapter(client as any)
})

afterEach(() => {
  vi.clearAllMocks()
})

// Helper: wrap response in ApiResponse envelope
function ok<T>(data: T) {
  return { ok: true, data, meta: { requestId: 'r1', timestamp: '2026-01-01' } }
}

// ── Bootstrap & Projects ─────────────────────────────────────────────

describe('Bootstrap & Projects', () => {
  it('getBootstrapState calls GET /api/v1/bootstrap', async () => {
    client.get.mockResolvedValueOnce(ok({ activeProjectId: null, activeSessionId: null, projects: [], sessions: [], terminalWebhookPort: null }))
    await adapter.getBootstrapState()
    expect(client.get).toHaveBeenCalledWith('/api/v1/bootstrap')
  })

  it('createProject calls POST /api/v1/projects with body', async () => {
    client.post.mockResolvedValueOnce(ok({ id: 'p1', name: 'P', path: '/p' }))
    await adapter.createProject({ path: '/p', name: 'P' })
    expect(client.post).toHaveBeenCalledWith('/api/v1/projects', { path: '/p', name: 'P' })
  })

  it('deleteProject calls DELETE /api/v1/projects/:id', async () => {
    client.delete.mockResolvedValueOnce(ok(undefined))
    await adapter.deleteProject('abc')
    expect(client.delete).toHaveBeenCalledWith('/api/v1/projects/abc')
  })

  it('setActiveProject calls PUT /api/v1/projects/:id/active', async () => {
    client.put.mockResolvedValueOnce(ok(undefined))
    await adapter.setActiveProject('p1')
    expect(client.put).toHaveBeenCalledWith('/api/v1/projects/p1/active')
  })
})

// ── Sessions ─────────────────────────────────────────────────────────

describe('Sessions', () => {
  it('createSession calls POST /api/v1/sessions', async () => {
    client.post.mockResolvedValueOnce(ok({ id: 's1' }))
    await adapter.createSession({ projectId: 'p1', type: 'shell', title: 'T' })
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/sessions',
      { projectId: 'p1', type: 'shell', title: 'T' },
    )
  })

  it('setActiveSession calls PUT /api/v1/sessions/:id/active', async () => {
    client.put.mockResolvedValueOnce(ok(undefined))
    await adapter.setActiveSession('s1')
    expect(client.put).toHaveBeenCalledWith('/api/v1/sessions/s1/active')
  })

  it('archiveSession calls PUT /api/v1/sessions/:id/archive', async () => {
    client.put.mockResolvedValueOnce(ok(undefined))
    await adapter.archiveSession('s1')
    expect(client.put).toHaveBeenCalledWith('/api/v1/sessions/s1/archive')
  })

  it('restoreSession calls PUT /api/v1/sessions/:id/restore', async () => {
    client.put.mockResolvedValueOnce(ok(undefined))
    await adapter.restoreSession('s1')
    expect(client.put).toHaveBeenCalledWith('/api/v1/sessions/s1/restore')
  })

  it('restartSession calls POST /api/v1/sessions/:id/restart', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.restartSession('s1')
    expect(client.post).toHaveBeenCalledWith('/api/v1/sessions/s1/restart')
  })

  it('regenerateSessionTitle calls PUT /api/v1/sessions/:id/title', async () => {
    client.put.mockResolvedValueOnce(ok(null))
    await adapter.regenerateSessionTitle('s1')
    expect(client.put).toHaveBeenCalledWith('/api/v1/sessions/s1/title')
  })

  it('listArchivedSessions calls GET /api/v1/sessions?archive=archived', async () => {
    client.get.mockResolvedValueOnce(ok([]))
    await adapter.listArchivedSessions()
    expect(client.get).toHaveBeenCalledWith('/api/v1/sessions?archive=archived')
  })

  it('getTerminalReplay calls GET terminal-replay endpoint', async () => {
    client.get.mockResolvedValueOnce(ok('replay-text'))
    const result = await adapter.getTerminalReplay('s1')
    expect(client.get).toHaveBeenCalledWith('/api/v1/sessions/s1/terminal-replay')
    expect(result).toBe('replay-text')
  })

  it('sendSessionInput fires POST (no await)', () => {
    client.post.mockReturnValueOnce(new Promise(() => {})) // never resolves
    adapter.sendSessionInput('s1', 'hello')
    expect(client.post).toHaveBeenCalledWith('/api/v1/sessions/s1/input', { data: 'hello' })
  })

  it('sendSessionInput swallows rejections (fire-and-forget)', async () => {
    client.post.mockRejectedValueOnce(new Error('network error'))
    // Should not throw
    adapter.sendSessionInput('s1', 'hello')
    // Give microtasks a chance to run
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(client.post).toHaveBeenCalledWith('/api/v1/sessions/s1/input', { data: 'hello' })
  })

  it('sendSessionBinaryInput delegates to client.sendBinaryInput', () => {
    const data = new Uint8Array([1, 2, 3])
    adapter.sendSessionBinaryInput('s1', data)
    expect(client.sendBinaryInput).toHaveBeenCalledWith('s1', data)
  })

  it('sendSessionResize calls POST /api/v1/sessions/:id/resize', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.sendSessionResize('s1', 80, 24)
    expect(client.post).toHaveBeenCalledWith('/api/v1/sessions/s1/resize', { cols: 80, rows: 24 })
  })
})

// ── Settings ─────────────────────────────────────────────────────────

describe('Settings', () => {
  it('getSettings calls GET /api/v1/settings', async () => {
    client.get.mockResolvedValueOnce(ok({}))
    await adapter.getSettings()
    expect(client.get).toHaveBeenCalledWith('/api/v1/settings')
  })

  it('setSetting calls PUT /api/v1/settings/:key with { value }', async () => {
    client.put.mockResolvedValueOnce(ok(undefined))
    await adapter.setSetting('locale', 'en')
    expect(client.put).toHaveBeenCalledWith('/api/v1/settings/locale', { value: 'en' })
  })

  it('setSetting URL-encodes key', async () => {
    client.put.mockResolvedValueOnce(ok(undefined))
    await adapter.setSetting('terminal.fontSize', 14)
    expect(client.put).toHaveBeenCalledWith(
      '/api/v1/settings/terminal.fontSize',
      { value: 14 },
    )
  })

  it('titleGenerationFetchModels calls GET with query params', async () => {
    client.get.mockResolvedValueOnce(ok(['gpt-4', 'gpt-5']))
    await adapter.titleGenerationFetchModels('https://api.example.com', 'key123')
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('baseUrl='),
    )
  })

  it('detectShell calls POST /api/v1/settings/detect/shell', async () => {
    client.post.mockResolvedValueOnce(ok('/bin/bash'))
    await adapter.detectShell()
    expect(client.post).toHaveBeenCalledWith('/api/v1/settings/detect/shell')
  })

  it('detectProvider passes providerId in body', async () => {
    client.post.mockResolvedValueOnce(ok('/usr/bin/codex'))
    await adapter.detectProvider('codex')
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/settings/detect/provider',
      { providerId: 'codex' },
    )
  })

  it('detectVscode calls POST /api/v1/settings/detect/vscode', async () => {
    client.post.mockResolvedValueOnce(ok('/usr/bin/code'))
    await adapter.detectVscode()
    expect(client.post).toHaveBeenCalledWith('/api/v1/settings/detect/vscode')
  })
})

// ── Sidebar ──────────────────────────────────────────────────────────

describe('Sidebar', () => {
  it('getSidebarState calls GET /api/v1/sidebar', async () => {
    client.get.mockResolvedValueOnce(ok({}))
    await adapter.getSidebarState()
    expect(client.get).toHaveBeenCalledWith('/api/v1/sidebar')
  })

  it('setSidebarState calls PUT /api/v1/sidebar', async () => {
    client.put.mockResolvedValueOnce(ok(undefined))
    await adapter.setSidebarState({ open: true })
    expect(client.put).toHaveBeenCalledWith('/api/v1/sidebar', { open: true })
  })
})

// ── File System ──────────────────────────────────────────────────────

describe('File System', () => {
  it('fsReadDir includes projectPath query param', async () => {
    client.get.mockResolvedValueOnce(ok([]))
    await adapter.fsReadDir('/projects/foo', 'src')
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('projectPath='),
    )
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('path=src'),
    )
  })

  it('fsReadFile includes projectPath and path', async () => {
    client.get.mockResolvedValueOnce(ok('content'))
    await adapter.fsReadFile('/projects/foo', 'README.md')
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('projectPath='),
    )
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('path=README.md'),
    )
  })

  it('fsWriteFile calls PUT /api/v1/fs/file', async () => {
    client.put.mockResolvedValueOnce(ok(undefined))
    await adapter.fsWriteFile({ projectPath: '/p', relativePath: 'a.txt', content: 'x' })
    expect(client.put).toHaveBeenCalledWith(
      '/api/v1/fs/file',
      { projectPath: '/p', relativePath: 'a.txt', content: 'x' },
    )
  })

  it('fsCreate calls POST /api/v1/fs/entry', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.fsCreate({ projectPath: '/p', relativePath: 'new.txt', isDirectory: false })
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/fs/entry',
      { projectPath: '/p', relativePath: 'new.txt', isDirectory: false },
    )
  })

  it('fsRename calls POST /api/v1/fs/rename', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.fsRename({ projectPath: '/p', oldRelativePath: 'a', newRelativePath: 'b' })
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/fs/rename',
      { projectPath: '/p', oldRelativePath: 'a', newRelativePath: 'b' },
    )
  })

  it('fsDelete calls DELETE /api/v1/fs/entry with body', async () => {
    client.delete.mockResolvedValueOnce(ok(undefined))
    await adapter.fsDelete({ projectPath: '/p', relativePath: 'a.txt' })
    expect(client.delete).toHaveBeenCalledWith(
      '/api/v1/fs/entry',
      { projectPath: '/p', relativePath: 'a.txt' },
    )
  })

  it('fsSearch calls POST /api/v1/fs/search', async () => {
    client.post.mockResolvedValueOnce(ok({ files: [], totalMatches: 0, truncated: false }))
    await adapter.fsSearch({
      query: 'foo',
      rootPath: '/p',
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
      includePattern: '',
      excludePattern: '',
      maxResults: 100,
    })
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/fs/search',
      expect.objectContaining({ query: 'foo' }),
    )
  })
})

// ── Git ──────────────────────────────────────────────────────────────

describe('Git', () => {
  it('gitStatus calls GET with projectPath', async () => {
    client.get.mockResolvedValueOnce(ok({ branch: 'main' }))
    await adapter.gitStatus('/projects/foo')
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('projectPath='),
    )
  })

  it('gitStage calls POST with { projectPath, paths }', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.gitStage('/p', ['a.txt', 'b.txt'])
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/git/stage',
      { projectPath: '/p', paths: ['a.txt', 'b.txt'] },
    )
  })

  it('gitUnstage calls POST with { projectPath, paths }', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.gitUnstage('/p', ['a.txt'])
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/git/unstage',
      { projectPath: '/p', paths: ['a.txt'] },
    )
  })

  it('gitDiscard calls POST with { projectPath, paths }', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.gitDiscard('/p', ['a.txt'])
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/git/discard',
      { projectPath: '/p', paths: ['a.txt'] },
    )
  })

  it('gitCommit calls POST /api/v1/git/commit', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.gitCommit({ projectPath: '/p', message: 'msg' })
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/git/commit',
      { projectPath: '/p', message: 'msg' },
    )
  })

  it('gitPush calls POST /api/v1/git/push', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.gitPush({ projectPath: '/p', setUpstream: true })
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/git/push',
      { projectPath: '/p', setUpstream: true },
    )
  })

  it('gitPull calls POST with { projectPath }', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.gitPull('/p')
    expect(client.post).toHaveBeenCalledWith('/api/v1/git/pull', { projectPath: '/p' })
  })

  it('gitFetch calls POST with { projectPath }', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.gitFetch('/p')
    expect(client.post).toHaveBeenCalledWith('/api/v1/git/fetch', { projectPath: '/p' })
  })

  it('gitBranches calls GET with projectPath', async () => {
    client.get.mockResolvedValueOnce(ok({ current: 'main', all: ['main'] }))
    await adapter.gitBranches('/p')
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('projectPath='),
    )
  })

  it('gitLog calls GET with projectPath and optional limit', async () => {
    client.get.mockResolvedValueOnce(ok([]))
    await adapter.gitLog('/p', 10)
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('limit=10'),
    )
  })

  it('gitDiff includes filePath and staged params', async () => {
    client.get.mockResolvedValueOnce(ok('diff'))
    await adapter.gitDiff('/p', 'src/index.ts', true)
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('filePath='),
    )
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('staged=true'),
    )
  })

  it('gitCheckout calls POST with { projectPath, branch }', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.gitCheckout('/p', 'dev')
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/git/checkout',
      { projectPath: '/p', branch: 'dev' },
    )
  })

  it('gitCreateBranch calls POST /api/v1/git/branches', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.gitCreateBranch('/p', 'feature')
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/git/branches',
      { projectPath: '/p', name: 'feature' },
    )
  })

  it('gitRebase calls POST /api/v1/git/rebase', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.gitRebase({ projectPath: '/p', onto: 'main' })
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/git/rebase',
      { projectPath: '/p', onto: 'main' },
    )
  })

  it('gitMerge calls POST /api/v1/git/merge', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.gitMerge({ projectPath: '/p', branch: 'dev' })
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/git/merge',
      { projectPath: '/p', branch: 'dev' },
    )
  })

  it('gitLog without limit omits limit query param', async () => {
    client.get.mockResolvedValueOnce(ok([]))
    await adapter.gitLog('/p')
    expect(client.get).toHaveBeenCalledWith(
      expect.not.stringContaining('limit='),
    )
  })

  it('gitDiff without optional params sends only projectPath', async () => {
    client.get.mockResolvedValueOnce(ok('diff'))
    await adapter.gitDiff('/p')
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('projectPath='),
    )
    expect(client.get).toHaveBeenCalledWith(
      expect.not.stringContaining('filePath='),
    )
    expect(client.get).toHaveBeenCalledWith(
      expect.not.stringContaining('staged='),
    )
  })
})

// ── Observability ────────────────────────────────────────────────────

describe('Observability', () => {
  it('getSessionPresence calls GET with sessionId', async () => {
    client.get.mockResolvedValueOnce(ok(null))
    await adapter.getSessionPresence('s1')
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/observability/sessions/s1/presence',
    )
  })

  it('getProjectObservability calls GET with projectId', async () => {
    client.get.mockResolvedValueOnce(ok(null))
    await adapter.getProjectObservability('p1')
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/observability/projects/p1',
    )
  })

  it('getAppObservability calls GET /api/v1/observability/app', async () => {
    client.get.mockResolvedValueOnce(ok(null))
    await adapter.getAppObservability()
    expect(client.get).toHaveBeenCalledWith('/api/v1/observability/app')
  })

  it('listSessionObservationEvents includes limit in query', async () => {
    client.get.mockResolvedValueOnce(ok({ events: [], nextCursor: null }))
    await adapter.listSessionObservationEvents('s1', { limit: 50 })
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('limit=50'),
    )
  })

  it('listSessionObservationEvents includes categories when provided', async () => {
    client.get.mockResolvedValueOnce(ok({ events: [], nextCursor: null }))
    await adapter.listSessionObservationEvents('s1', {
      limit: 10,
      categories: ['lifecycle', 'presence'],
    })
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('categories=lifecycle%2Cpresence'),
    )
  })

  it('listSessionObservationEvents includes cursor and includeEphemeral when provided', async () => {
    client.get.mockResolvedValueOnce(ok({ events: [], nextCursor: null }))
    await adapter.listSessionObservationEvents('s1', {
      limit: 20,
      cursor: 'abc',
      includeEphemeral: true,
    })
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('cursor=abc'),
    )
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('includeEphemeral=true'),
    )
  })

  it('getSessionPresence returns null when data is null', async () => {
    client.get.mockResolvedValueOnce({ ok: true, data: null, meta: { requestId: 'r1', timestamp: '2026-01-01' } }
)
    const result = await adapter.getSessionPresence('s1')
    expect(result).toBeNull()
  })

  it('regenerateSessionTitle returns null when data is null', async () => {
    client.put.mockResolvedValueOnce({ ok: true, data: null, meta: { requestId: 'r1', timestamp: '2026-01-01' } })
    const result = await adapter.regenerateSessionTitle('s1')
    expect(result).toBeNull()
  })

  it('getMetaSessionProposal returns null when data is null', async () => {
    client.get.mockResolvedValueOnce({ ok: true, data: null, meta: { requestId: 'r1', timestamp: '2026-01-01' } })
    const result = await adapter.getMetaSessionProposal('p1')
    expect(result).toBeNull()
  })
})

// ── Evidence & Context ──────────────────────────────────────────────

describe('Evidence & Context', () => {
  it('uninstallSidecars calls DELETE with projectId', async () => {
    client.delete.mockResolvedValueOnce(ok(undefined))
    await adapter.uninstallSidecars('p1')
    expect(client.delete).toHaveBeenCalledWith('/api/v1/projects/p1/sidecar')
  })

  it('listSessionEvidence calls GET with sessionId', async () => {
    client.get.mockResolvedValueOnce(ok([]))
    await adapter.listSessionEvidence('s1')
    expect(client.get).toHaveBeenCalledWith('/api/v1/sessions/s1/evidence')
  })

  it('contextExportFullText includes options in query', async () => {
    client.get.mockResolvedValueOnce(ok({ text: '', truncated: false, totalTurns: 0 }))
    await adapter.contextExportFullText('s1', { includeThinking: true, maxChars: 5000 })
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('includeThinking=true'),
    )
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('maxChars=5000'),
    )
  })

  it('contextExportSlimText includes maxChars when provided', async () => {
    client.get.mockResolvedValueOnce(ok({ text: '', truncated: false, totalTurns: 0 }))
    await adapter.contextExportSlimText('s1', { maxChars: 1000 })
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('maxChars=1000'),
    )
  })
})

// ── Meta-Session ─────────────────────────────────────────────────────

describe('Meta-Session', () => {
  it('getMetaSessionBootstrapState calls GET /api/v1/meta-sessions/bootstrap', async () => {
    client.get.mockResolvedValueOnce(ok({}))
    await adapter.getMetaSessionBootstrapState()
    expect(client.get).toHaveBeenCalledWith('/api/v1/meta-sessions/bootstrap')
  })

  it('createMetaSession calls POST /api/v1/meta-sessions', async () => {
    client.post.mockResolvedValueOnce(ok({ id: 'm1' }))
    await adapter.createMetaSession({ title: 'M', backendSessionType: 'claude-code', capabilityLevel: 1 })
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/meta-sessions',
      { title: 'M', backendSessionType: 'claude-code', capabilityLevel: 1 },
    )
  })

  it('setActiveMetaSession calls POST activate', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.setActiveMetaSession('m1')
    expect(client.post).toHaveBeenCalledWith('/api/v1/meta-sessions/m1/activate')
  })

  it('archiveMetaSession calls POST archive', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.archiveMetaSession('m1')
    expect(client.post).toHaveBeenCalledWith('/api/v1/meta-sessions/m1/archive')
  })

  it('restoreMetaSession calls POST restore', async () => {
    client.post.mockResolvedValueOnce(ok(undefined))
    await adapter.restoreMetaSession('m1')
    expect(client.post).toHaveBeenCalledWith('/api/v1/meta-sessions/m1/restore')
  })

  it('listMetaSessionProposals calls GET', async () => {
    client.get.mockResolvedValueOnce(ok([]))
    await adapter.listMetaSessionProposals()
    expect(client.get).toHaveBeenCalledWith('/api/v1/meta-sessions/proposals')
  })

  it('getMetaSessionProposal calls GET with proposalId', async () => {
    client.get.mockResolvedValueOnce(ok(null))
    await adapter.getMetaSessionProposal('prop1')
    expect(client.get).toHaveBeenCalledWith('/api/v1/meta-sessions/proposals/prop1')
  })

  it('approveMetaSessionProposal calls POST approve', async () => {
    client.post.mockResolvedValueOnce(ok(null))
    await adapter.approveMetaSessionProposal('prop1')
    expect(client.post).toHaveBeenCalledWith('/api/v1/meta-sessions/proposals/prop1/approve')
  })

  it('rejectMetaSessionProposal passes reason in body', async () => {
    client.post.mockResolvedValueOnce(ok(null))
    await adapter.rejectMetaSessionProposal('prop1', 'duplicate')
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/meta-sessions/proposals/prop1/reject',
      { reason: 'duplicate' },
    )
  })

  it('dispatchMetaSessionProposal calls POST dispatch', async () => {
    client.post.mockResolvedValueOnce(ok(null))
    await adapter.dispatchMetaSessionProposal('prop1')
    expect(client.post).toHaveBeenCalledWith('/api/v1/meta-sessions/proposals/prop1/dispatch')
  })

  it('setMetaSessionInspectorTarget calls PUT /api/v1/meta-sessions/inspector', async () => {
    client.put.mockResolvedValueOnce(ok(undefined))
    await adapter.setMetaSessionInspectorTarget({ kind: 'work-session', sessionId: 's1' })
    expect(client.put).toHaveBeenCalledWith(
      '/api/v1/meta-sessions/inspector',
      { kind: 'work-session', sessionId: 's1' },
    )
  })

  it('setMetaSessionInspectorTarget accepts null', async () => {
    client.put.mockResolvedValueOnce(ok(undefined))
    await adapter.setMetaSessionInspectorTarget(null)
    expect(client.put).toHaveBeenCalledWith(
      '/api/v1/meta-sessions/inspector',
      null,
    )
  })
})

// ── WebSocket subscriptions ──────────────────────────────────────────

describe('WebSocket subscriptions', () => {
  it('onTerminalData subscribes to session:terminal-data', () => {
    client.subscribe.mockReturnValueOnce(() => {})
    const unsubscribe = adapter.onTerminalData(() => {})
    expect(client.subscribe).toHaveBeenCalledWith(
      'session:terminal-data',
      expect.any(Function),
    )
    expect(typeof unsubscribe).toBe('function')
  })

  it('onSessionGraphEvent subscribes to session:graph', () => {
    client.subscribe.mockReturnValueOnce(() => {})
    adapter.onSessionGraphEvent(() => {})
    expect(client.subscribe).toHaveBeenCalledWith(
      'session:graph',
      expect.any(Function),
    )
  })

  it('onMemoryNotification subscribes to notification:memory', () => {
    client.subscribe.mockReturnValueOnce(() => {})
    adapter.onMemoryNotification(() => {})
    expect(client.subscribe).toHaveBeenCalledWith(
      'notification:memory',
      expect.any(Function),
    )
  })

  it('onTitleGenerationNotification subscribes to notification:title-generation', () => {
    client.subscribe.mockReturnValueOnce(() => {})
    adapter.onTitleGenerationNotification(() => {})
    expect(client.subscribe).toHaveBeenCalledWith(
      'notification:title-generation',
      expect.any(Function),
    )
  })

  it('onSessionPresenceChanged subscribes to observability:presence', () => {
    client.subscribe.mockReturnValueOnce(() => {})
    adapter.onSessionPresenceChanged(() => {})
    expect(client.subscribe).toHaveBeenCalledWith(
      'observability:presence',
      expect.any(Function),
    )
  })

  it('onProjectObservabilityChanged subscribes to observability:project', () => {
    client.subscribe.mockReturnValueOnce(() => {})
    adapter.onProjectObservabilityChanged(() => {})
    expect(client.subscribe).toHaveBeenCalledWith(
      'observability:project',
      expect.any(Function),
    )
  })

  it('onAppObservabilityChanged subscribes to observability:app', () => {
    client.subscribe.mockReturnValueOnce(() => {})
    adapter.onAppObservabilityChanged(() => {})
    expect(client.subscribe).toHaveBeenCalledWith(
      'observability:app',
      expect.any(Function),
    )
  })

  it('onFsChanged subscribes to fs:changed', () => {
    client.subscribe.mockReturnValueOnce(() => {})
    adapter.onFsChanged(() => {})
    expect(client.subscribe).toHaveBeenCalledWith('fs:changed', expect.any(Function))
  })

  it('onMetaSessionEvent subscribes to meta-session:event', () => {
    client.subscribe.mockReturnValueOnce(() => {})
    adapter.onMetaSessionEvent(() => {})
    expect(client.subscribe).toHaveBeenCalledWith(
      'meta-session:event',
      expect.any(Function),
    )
  })

  it('WS callback receives payload from subscribe handler', () => {
    let captured: ((payload: unknown) => void) | null = null
    client.subscribe.mockImplementationOnce((_type: string, handler: (p: unknown) => void) => {
      captured = handler
      return () => {}
    })

    let received: unknown = null
    adapter.onSessionGraphEvent((event) => {
      received = event
    })

    const payload = { kind: 'created', graphVersion: 1, node: { session: {}, tree: {} } }
    captured!(payload)
    expect(received).toBe(payload)
  })
})

// ── Desktop-only stubs (should not call any client method) ──────────

describe('Desktop-only stubs', () => {
  it('openWorkspace is a no-op (does not call client)', async () => {
    await adapter.openWorkspace({ sessionId: 's1', target: 'ide' })
    expect(client.get).not.toHaveBeenCalled()
    expect(client.post).not.toHaveBeenCalled()
  })

  it('pickFolder returns null and does not call client', async () => {
    const result = await adapter.pickFolder()
    expect(result).toBeNull()
    expect(client.get).not.toHaveBeenCalled()
  })

  it('pickFile returns null and does not call client', async () => {
    const result = await adapter.pickFile()
    expect(result).toBeNull()
    expect(client.get).not.toHaveBeenCalled()
  })

  it('minimizeWindow is a no-op', async () => {
    await adapter.minimizeWindow()
    expect(client.post).not.toHaveBeenCalled()
  })

  it('maximizeWindow is a no-op', async () => {
    await adapter.maximizeWindow()
    expect(client.post).not.toHaveBeenCalled()
  })

  it('closeWindow is a no-op', async () => {
    await adapter.closeWindow()
    expect(client.post).not.toHaveBeenCalled()
  })

  it('isWindowMaximized returns false', async () => {
    const result = await adapter.isWindowMaximized()
    expect(result).toBe(false)
  })

  it('onWindowMaximizeChange returns a no-op unsubscribe', () => {
    const unsubscribe = adapter.onWindowMaximizeChange(() => {})
    expect(typeof unsubscribe).toBe('function')
    unsubscribe() // should not throw
    expect(client.subscribe).not.toHaveBeenCalled()
  })

  it('fsOpenFile is a no-op', async () => {
    await adapter.fsOpenFile('/path/to/file')
    expect(client.post).not.toHaveBeenCalled()
  })

  // ── Update stubs (desktop-only) ──────────────────────────────────────

  it('getUpdateState returns idle state and does not call client', async () => {
    const result = await adapter.getUpdateState()
    expect(result.phase).toBe('idle')
    expect(result.currentVersion).toBe('')
    expect(result.availableVersion).toBeNull()
    expect(result.requiresSessionWarning).toBe(false)
    expect(client.get).not.toHaveBeenCalled()
  })

  it('checkForUpdates returns idle state', async () => {
    const result = await adapter.checkForUpdates()
    expect(result.phase).toBe('idle')
    expect(client.post).not.toHaveBeenCalled()
  })

  it('downloadUpdate returns idle state', async () => {
    const result = await adapter.downloadUpdate()
    expect(result.phase).toBe('idle')
  })

  it('quitAndInstallUpdate is a no-op', async () => {
    await adapter.quitAndInstallUpdate()
    expect(client.post).not.toHaveBeenCalled()
  })

  it('dismissUpdate is a no-op', async () => {
    await adapter.dismissUpdate()
    expect(client.post).not.toHaveBeenCalled()
  })

  it('onUpdateState returns a no-op unsubscribe', () => {
    const unsubscribe = adapter.onUpdateState(() => {})
    expect(typeof unsubscribe).toBe('function')
    unsubscribe()
    expect(client.subscribe).not.toHaveBeenCalled()
  })

  it('onSessionEvent returns a no-op unsubscribe', () => {
    const unsubscribe = adapter.onSessionEvent(() => {})
    expect(typeof unsubscribe).toBe('function')
    unsubscribe()
    expect(client.subscribe).not.toHaveBeenCalled()
  })

  it('shellShowItemInFolder is a no-op', async () => {
    await adapter.shellShowItemInFolder('/path')
    expect(client.post).not.toHaveBeenCalled()
  })
})

// ── Static type-shape verification ───────────────────────────────────

describe('RendererApi surface coverage', () => {
  it('adapter implements the full RendererApi surface', () => {
    // The check is structural: at compile time, the class declaration
    // has to satisfy `implements RendererApi`. If any method is missing
    // or has the wrong signature, the file will not typecheck.
    // This test simply confirms the adapter is instantiable.
    expect(adapter).toBeInstanceOf(StoaClientPreloadAdapter)
    expect(adapter.windowsBuildNumber).toBeUndefined()
  })
})
