import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSearchStore } from './search'
import { createRendererApiMock } from '@shared/test-fixtures'

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

describe('useSearchStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.stoa = createRendererApiMock()
    mockClientPost.mockReset()
  })

  it('search prefers StoaClient in client mode', async () => {
    const plugin = await import('@renderer/stores/stoa-store-plugin')
    vi.mocked(plugin.isStoaClientMode).mockReturnValue(true)
    vi.mocked(plugin.getStoaClient).mockReturnValue({
      post: mockClientPost
    } as never)

    mockClientPost.mockResolvedValue({
      data: {
        files: [{ filePath: '/project/index.ts', relativePath: 'index.ts', matches: [] }],
        totalMatches: 1,
        truncated: false
      }
    })

    const store = useSearchStore()
    store.query = 'needle'
    await store.search('/project')

    expect(mockClientPost).toHaveBeenCalledWith('/api/v1/fs/search', expect.objectContaining({
      query: 'needle',
      rootPath: '/project'
    }))
    expect(window.stoa.fsSearch).not.toHaveBeenCalled()
    expect(store.results?.totalMatches).toBe(1)
  })
})
