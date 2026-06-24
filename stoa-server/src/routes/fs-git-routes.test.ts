/**
 * Tests for fs and git route groups — Stoa Server side.
 *
 * Uses Hono's app.request() for HTTP-level testing with mocked
 * filesystem and git operations. Validates:
 *   - Happy-path responses
 *   - Validation error responses (missing params)
 *   - Path traversal guard
 *   - Git operations (status, stage, log, etc.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createErrorHandler } from '../middleware/error-handler'
import { createAuthMiddleware } from '../middleware/auth'
import { createFsRoutes } from './fs'
import { createGitRoutes } from './git'
import { WsHub } from '../ws/hub'

const { execFileAsyncMock, execFileMock } = vi.hoisted(() => {
  const customSymbol = Symbol.for('nodejs.util.promisify.custom')
  const asyncMock = vi.fn()
  return {
    execFileAsyncMock: asyncMock,
    execFileMock: Object.assign(vi.fn(), {
      [customSymbol]: asyncMock,
    }),
  }
})

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    execFile: execFileMock,
  }
})

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const AUTH_TOKEN = 'test-fs-git-token'
const AUTH = { Authorization: `Bearer ${AUTH_TOKEN}` }
const JSON_HEADERS = { ...AUTH, 'Content-Type': 'application/json' }

function createFsApp() {
  const wsHub = new WsHub()
  const app = new Hono()
  app.onError(createErrorHandler())
  app.use('*', createAuthMiddleware(AUTH_TOKEN))
  app.route('/api/v1', createFsRoutes({ wsHub }))
  return { app, wsHub }
}

function createGitApp() {
  const app = new Hono()
  app.onError(createErrorHandler())
  app.use('*', createAuthMiddleware(AUTH_TOKEN))
  app.route('/api/v1', createGitRoutes())
  return app
}

// ---------------------------------------------------------------------------
// FS routes
// ---------------------------------------------------------------------------

describe('FS routes', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset()
    execFileMock.mockReset()
  })

  describe('GET /fs/dir', () => {
    it('returns 422 when projectPath is missing', async () => {
      const { app } = createFsApp()
      const res = await app.request('/api/v1/fs/dir', { headers: AUTH })
      expect(res.status).toBe(422)
      const body = await res.json() as {
        error: { code: string }
      }
      expect(body.error.code).toBe('validation_error')
    })

    it('returns 422 with empty projectPath', async () => {
      const { app } = createFsApp()
      const res = await app.request('/api/v1/fs/dir?projectPath=', { headers: AUTH })
      expect(res.status).toBe(422)
    })

    it('hides repository and app-owned state directories', async () => {
      const projectPath = await mkdtemp(path.join(tmpdir(), 'stoa-fs-dir-'))
      try {
        await mkdir(path.join(projectPath, '.git'))
        await mkdir(path.join(projectPath, '.stoa'))
        await mkdir(path.join(projectPath, 'src'))
        await writeFile(path.join(projectPath, 'README.md'), 'test', 'utf-8')

        const { app } = createFsApp()
        const res = await app.request(
          `/api/v1/fs/dir?projectPath=${encodeURIComponent(projectPath)}`,
          { headers: AUTH },
        )

        expect(res.status).toBe(200)
        const body = await res.json() as {
          ok: boolean
          data: Array<{ name: string }>
        }
        expect(body.ok).toBe(true)
        expect(body.data.map((entry) => entry.name)).toEqual(['src', 'README.md'])
      } finally {
        await rm(projectPath, { recursive: true, force: true })
      }
    })
  })

  describe('GET /fs/file', () => {
    it('returns 422 when projectPath is missing', async () => {
      const { app } = createFsApp()
      const res = await app.request('/api/v1/fs/file?path=test.txt', { headers: AUTH })
      expect(res.status).toBe(422)
    })

    it('returns 422 when path is missing', async () => {
      const { app } = createFsApp()
      const res = await app.request('/api/v1/fs/file?projectPath=/tmp', { headers: AUTH })
      expect(res.status).toBe(422)
    })
  })

  describe('PUT /fs/file', () => {
    it('returns 422 when body is missing', async () => {
      const { app } = createFsApp()
      const res = await app.request('/api/v1/fs/file', {
        method: 'PUT',
        headers: AUTH,
      })
      expect(res.status).toBe(422)
    })

    it('returns 422 when projectPath is missing', async () => {
      const { app } = createFsApp()
      const res = await app.request('/api/v1/fs/file', {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({ relativePath: 'test.txt', content: 'hello' }),
      })
      expect(res.status).toBe(422)
    })
  })

  describe('POST /fs/entry', () => {
    it('returns 422 when body is missing', async () => {
      const { app } = createFsApp()
      const res = await app.request('/api/v1/fs/entry', {
        method: 'POST',
        headers: AUTH,
      })
      expect(res.status).toBe(422)
    })

    it('returns 422 when relativePath is missing', async () => {
      const { app } = createFsApp()
      const res = await app.request('/api/v1/fs/entry', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ projectPath: '/tmp', isDirectory: false }),
      })
      expect(res.status).toBe(422)
    })
  })

  describe('POST /fs/rename', () => {
    it('returns 422 when oldRelativePath is missing', async () => {
      const { app } = createFsApp()
      const res = await app.request('/api/v1/fs/rename', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ projectPath: '/tmp', newRelativePath: 'new.txt' }),
      })
      expect(res.status).toBe(422)
    })
  })

  describe('DELETE /fs/entry', () => {
    it('returns 422 when body is missing', async () => {
      const { app } = createFsApp()
      const res = await app.request('/api/v1/fs/entry', {
        method: 'DELETE',
        headers: AUTH,
      })
      expect(res.status).toBe(422)
    })
  })

  describe('POST /fs/search', () => {
    it('returns 422 when query is missing', async () => {
      const { app } = createFsApp()
      const res = await app.request('/api/v1/fs/search', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ rootPath: '/tmp' }),
      })
      expect(res.status).toBe(422)
    })

    it('returns 422 when rootPath is missing', async () => {
      const { app } = createFsApp()
      const res = await app.request('/api/v1/fs/search', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ query: 'test' }),
      })
      expect(res.status).toBe(422)
    })

    it('returns empty results when the search command exits with no matches', async () => {
      const { app } = createFsApp()
      const noMatches = Object.assign(new Error('Command failed: rg no-such-token'), {
        code: 1,
      })
      execFileAsyncMock.mockRejectedValueOnce(noMatches)

      const res = await app.request('/api/v1/fs/search', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          query: 'no-such-token',
          rootPath: '/tmp/project',
          caseSensitive: false,
          wholeWord: false,
          useRegex: false,
          includePattern: '',
          excludePattern: '',
          maxResults: 100,
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as {
        ok: boolean
        data: {
          files: unknown[]
          totalMatches: number
          truncated: boolean
        }
      }
      expect(body.ok).toBe(true)
      expect(body.data).toEqual({
        files: [],
        totalMatches: 0,
        truncated: false,
      })
    })
  })
})

// ---------------------------------------------------------------------------
// Git routes
// ---------------------------------------------------------------------------

describe('Git routes', () => {
  describe('GET /git/status', () => {
    it('returns 422 when projectPath is missing', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/status', { headers: AUTH })
      expect(res.status).toBe(422)
    })
  })

  describe('POST /git/stage', () => {
    it('returns 422 when projectPath is missing', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/stage', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ paths: ['file.txt'] }),
      })
      expect(res.status).toBe(422)
    })

    it('returns 422 when paths is missing', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/stage', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ projectPath: '/tmp' }),
      })
      expect(res.status).toBe(422)
    })

    it('returns 422 when paths is empty', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/stage', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ projectPath: '/tmp', paths: [] }),
      })
      expect(res.status).toBe(422)
    })
  })

  describe('POST /git/unstage', () => {
    it('returns 422 when projectPath is missing', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/unstage', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ paths: ['file.txt'] }),
      })
      expect(res.status).toBe(422)
    })
  })

  describe('POST /git/discard', () => {
    it('returns 422 when projectPath is missing', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/discard', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ paths: ['file.txt'] }),
      })
      expect(res.status).toBe(422)
    })
  })

  describe('POST /git/commit', () => {
    it('returns 422 when projectPath is missing', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/commit', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ message: 'test commit' }),
      })
      expect(res.status).toBe(422)
    })

    it('returns 422 when message is missing', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/commit', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ projectPath: '/tmp' }),
      })
      expect(res.status).toBe(422)
    })
  })

  describe('POST /git/push', () => {
    it('returns 422 when projectPath is missing', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/push', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(422)
    })
  })

  describe('POST /git/pull', () => {
    it('returns 422 when projectPath is missing', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/pull', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(422)
    })
  })

  describe('POST /git/fetch', () => {
    it('returns 422 when projectPath is missing', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/fetch', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(422)
    })
  })

  describe('POST /git/rebase', () => {
    it('returns 422 when onto is missing', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/rebase', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ projectPath: '/tmp' }),
      })
      expect(res.status).toBe(422)
    })
  })

  describe('POST /git/merge', () => {
    it('returns 422 when branch is missing', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/merge', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ projectPath: '/tmp' }),
      })
      expect(res.status).toBe(422)
    })
  })

  describe('GET /git/branches', () => {
    it('returns 422 when projectPath is missing', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/branches', { headers: AUTH })
      expect(res.status).toBe(422)
    })
  })

  describe('GET /git/log', () => {
    it('returns 422 when projectPath is missing', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/log', { headers: AUTH })
      expect(res.status).toBe(422)
    })
  })

  describe('GET /git/diff', () => {
    it('returns 422 when projectPath is missing', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/diff', { headers: AUTH })
      expect(res.status).toBe(422)
    })
  })

  describe('POST /git/checkout', () => {
    it('returns 422 when branch is missing', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/checkout', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ projectPath: '/tmp' }),
      })
      expect(res.status).toBe(422)
    })
  })

  describe('POST /git/branches (create)', () => {
    it('returns 422 when name is missing', async () => {
      const app = createGitApp()
      const res = await app.request('/api/v1/git/branches', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ projectPath: '/tmp' }),
      })
      expect(res.status).toBe(422)
    })
  })
})
