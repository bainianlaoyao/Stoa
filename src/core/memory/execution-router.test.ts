import { describe, expect, test, vi } from 'vitest'
import type { ExecutionCapability } from '@shared/memory-runtime'
import { ExecutionRouter } from './execution-router'

describe('ExecutionRouter', () => {
  test('returns the configured execution capability', async () => {
    const capability: ExecutionCapability = {
      mode: 'workspace-shell',
      run: vi.fn(async () => ({
        ok: true,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        commandResults: []
      }))
    }

    const router = new ExecutionRouter(
      {
        getExecutionMode: () => 'workspace-shell'
      },
      {
        'workspace-shell': vi.fn(async () => capability)
      }
    )
    await expect(router.resolve()).resolves.toBe(capability)
  })
})
