/**
 * Tests for static mount order and API route priority.
 *
 * Verifies that the SPA fallback does not swallow:
 *   - /api/v1/* routes (should return JSON, not HTML)
 *   - /ctl/* routes (should return JSON, not HTML)
 *   - /api/v1/discovery (should work without auth)
 */
import { describe, it, expect, vi } from 'vitest'
import { createApp } from '../app'
import { ProjectSessionManager } from '../services/project-session-manager'
import { createStubRuntimeBridge } from '../routes/runtime-bridge'
import { WsHub } from '../ws/hub'
import type { SidebarState } from 'stoa-shared'

const AUTH_TOKEN = 'stoa-dev-token'

function createFullApp() {
  let sidebarData: SidebarState = {
    open: true,
    activeTab: 'explorer',
    width: 260,
    sessionListWidth: 200,
    activeTabByProject: {},
  }

  const manager = ProjectSessionManager.createForTest()
  const wsHub = new WsHub()

  const deps = {
    projects: { manager },
    sessions: { manager, runtimeBridge: createStubRuntimeBridge() },
    settings: { manager },
    observability: {
      manager,
      getSessionPresence: () => null,
      getProjectObservability: () => null,
      getAppObservability: () => ({
        blockedProjectCount: 0,
        failedProjectCount: 0,
        totalUnreadTurns: 0,
        projectsNeedingAttention: [],
        providerHealthSummary: {},
        lastGlobalEventAt: null,
        sourceSequence: 0,
        updatedAt: new Date().toISOString(),
      }),
      listSessionEvents: () => ({ events: [], nextCursor: null, hasMore: false }),
    },
    metaSessions: {
      manager: {
        on: vi.fn(),
        emit: vi.fn(),
        listMetaSessions: vi.fn().mockReturnValue([]),
      } as unknown,
      proposalStore: {
        listProposals: vi.fn().mockReturnValue([]),
        getProposal: vi.fn().mockReturnValue(null),
      } as unknown,
    },
    sidebar: {
      getSidebarState: () => sidebarData,
      setSidebarState: (s: SidebarState) => { sidebarData = s },
    },
    fs: { wsHub },
    webhooks: {},
  }

  // Use webClient: true to mount the static routes
  return createApp(deps as never, {
    cors: true,
    webClient: true,
  })
}

describe('Static mount order', () => {
  const app = createFullApp()
  const AUTH = { Authorization: `Bearer ${AUTH_TOKEN}` }

  it('/api/v1/discovery returns JSON, not HTML', async () => {
    const res = await app.request('/api/v1/discovery')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data).toBeDefined()
  })

  it('/ serves SPA HTML without Authorization header', async () => {
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('<title>Stoa</title>')
  })

  it('/ctl/health returns JSON when authenticated', async () => {
    const res = await app.request('/ctl/health', { headers: AUTH })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('/api/v1/settings returns JSON when authenticated', async () => {
    const res = await app.request('/api/v1/settings', { headers: AUTH })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('/api/v1/sidebar returns JSON when authenticated', async () => {
    const res = await app.request('/api/v1/sidebar', { headers: AUTH })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('/api/v1/bootstrap returns JSON when authenticated', async () => {
    const res = await app.request('/api/v1/bootstrap', { headers: AUTH })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('/api/v1 returns 404 JSON (not SPA HTML) for unknown sub-path', async () => {
    const res = await app.request('/api/v1/nonexistent', { headers: AUTH })
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')?.includes('text/html') ?? false).toBe(false)
  })

  it('/events reaches webhook validation without Authorization header', async () => {
    const res = await app.request('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: true }),
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json()
    expect(body.reason).toBe('invalid_event')
  })

  it('/hooks/claude-code reaches webhook validation without Authorization header', async () => {
    const res = await app.request('/hooks/claude-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json()
    expect(body.reason).toBe('invalid_hook_context')
  })
})
