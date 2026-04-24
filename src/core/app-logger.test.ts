import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { writeAppLog, writeUpdateLog } from './app-logger'
import { createTestTempDir } from '../../testing/test-temp'

const tempDirs: string[] = []

async function createTempLogPath(): Promise<string> {
  const dir = await createTestTempDir('stoa-app-logger-')
  tempDirs.push(dir)
  return join(dir, 'app.log')
}

describe('app logger', () => {
  afterEach(async () => {
    await Promise.allSettled(tempDirs.splice(0).map(async (dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))))
  })

  test('writes timestamped log entries to disk', async () => {
    const filePath = await createTempLogPath()
    await writeAppLog('runtime started', filePath)

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('runtime started')
    expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('writes update log entries to disk', async () => {
    const filePath = await createTempLogPath()
    await writeUpdateLog('update available', filePath)

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('update available')
    expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
