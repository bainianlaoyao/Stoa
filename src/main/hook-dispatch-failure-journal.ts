import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { HookLeaseProvider } from './hook-lease-registry'

type MetadataSource = 'lease' | 'managed-marker'

export interface HookDispatchFailureRecord {
  sessionId: string
  projectId: string
  ownerInstanceId: string
  generation: number
  provider: HookLeaseProvider
  failureClass: string
  metadataSource: MetadataSource
  recordedAt: string
}

interface HookDispatchFailureJournalOptions {
  runtimeRoot: string
}

export function createHookDispatchFailureJournal(options: HookDispatchFailureJournalOptions) {
  const journalPath = join(options.runtimeRoot, 'hook-delivery-failures.ndjson')
  const lockPath = join(options.runtimeRoot, 'hook-delivery-failures.lock')

  return {
    journalPath,
    async append(record: HookDispatchFailureRecord): Promise<void> {
      await mkdir(dirname(journalPath), { recursive: true })
      await withExclusiveJournalLock(lockPath, async () => {
        await appendFile(journalPath, `${JSON.stringify(record)}\n`, 'utf8')
      })
    }
  }
}

async function withExclusiveJournalLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      await writeFile(lockPath, process.pid.toString(), { flag: 'wx' })
      break
    } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')) {
        throw error
      }

      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  try {
    return await operation()
  } finally {
    await rm(lockPath, { force: true })
  }
}
