import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createHookDispatchFailureJournal } from './hook-dispatch-failure-journal'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.allSettled(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempRuntimeRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('hook dispatch failure journal', () => {
  test('appends a managed delivery failure record with metadata source', async () => {
    const runtimeRoot = await createTempRuntimeRoot('stoa-hook-failure-journal-')
    const journal = createHookDispatchFailureJournal({ runtimeRoot })

    await journal.append({
      sessionId: 'session-1',
      projectId: 'project-1',
      ownerInstanceId: 'instance-a',
      generation: 2,
      provider: 'claude-code',
      failureClass: 'target_unreachable',
      metadataSource: 'managed-marker',
      recordedAt: '2026-05-10T12:00:00.000Z'
    })

    const journalPath = join(runtimeRoot, 'hook-delivery-failures.ndjson')
    const content = await readFile(journalPath, 'utf8')
    const [firstLine] = content.trim().split('\n')
    expect(firstLine).toBeTruthy()
    expect(JSON.parse(firstLine!)).toMatchObject({
      sessionId: 'session-1',
      projectId: 'project-1',
      ownerInstanceId: 'instance-a',
      generation: 2,
      provider: 'claude-code',
      failureClass: 'target_unreachable',
      metadataSource: 'managed-marker',
      recordedAt: '2026-05-10T12:00:00.000Z'
    })
  })
})
