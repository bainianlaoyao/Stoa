import { rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createTestTempDir, getTestTempRoot } from './test-temp'

describe('test temp directories', () => {
  test('creates temp directories under the repo-local test temp root', async () => {
    const dir = await createTestTempDir('stoa-test-root-')

    try {
      const relativePath = relative(resolve(getTestTempRoot()), resolve(dir))
      expect(relativePath.startsWith('..')).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
