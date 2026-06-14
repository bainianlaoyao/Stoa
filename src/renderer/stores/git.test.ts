import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGitStore } from './git'
import { createRendererApiMock } from '@shared/test-fixtures'

const mockClientGet = vi.fn()
const mockClientPost = vi.fn()

vi.mock('@renderer/stores/stoa-store-plugin', async () => {
  const actual = await vi.importActual<typeof import('@renderer/stores/stoa-store-plugin')>('@renderer/stores/stoa-store-plugin')
  return {
    ...actual,
    isStoaClientMode: vi.fn(() => false),
    getStoaClient: vi.fn(() => null),
    requireRendererApi: vi.fn(() => window.stoa),
  }
})

describe('useGitStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.stoa = createRendererApiMock()
    mockClientGet.mockReset()
    mockClientPost.mockReset()
  })

  it('refreshAll prefers StoaClient in client mode', async () => {
    const plugin = await import('@renderer/stores/stoa-store-plugin')
    vi.mocked(plugin.isStoaClientMode).mockReturnValue(true)
    vi.mocked(plugin.getStoaClient).mockReturnValue({
      get: mockClientGet,
      post: mockClientPost
    } as never)

    mockClientGet
      .mockResolvedValueOnce({
        data: { branch: 'main', ahead: 0, behind: 0, clean: true, entries: [], hasConflicts: false }
      })
      .mockResolvedValueOnce({
        data: { current: 'main', locals: ['main'], remotes: ['origin/main'] }
      })
      .mockResolvedValueOnce({
        data: []
      })

    const store = useGitStore()
    await store.refreshAll('/project')

    expect(mockClientGet).toHaveBeenNthCalledWith(1, '/api/v1/git/status?projectPath=%2Fproject')
    expect(mockClientGet).toHaveBeenNthCalledWith(2, '/api/v1/git/branches?projectPath=%2Fproject')
    expect(mockClientGet).toHaveBeenNthCalledWith(3, '/api/v1/git/log?projectPath=%2Fproject&limit=50')
    expect(window.stoa.gitStatus).not.toHaveBeenCalled()
  })
})
