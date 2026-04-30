import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { StoaEvolverBridge } from './stoa-evolver-bridge'

const testDir = dirname(fileURLToPath(import.meta.url))
const evolverRepoRoot = resolve(testDir, '../../../research/upstreams/evolver')
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.allSettled(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })))
})

describe('StoaEvolverBridge processTurn bootstrap', () => {
  test('stays available even when the CLI delegate would fail for unrelated host-bridge work', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'stoa-host-bridge-cli-'))
    tempDirs.push(projectRoot)

    const bridge = new StoaEvolverBridge({
      repoRoot: evolverRepoRoot,
      delegate: {
        warmStart: vi.fn(async () => {
          throw new Error('delegate should not be used')
        }),
        recall: vi.fn(async () => {
          throw new Error('delegate should not be used')
        }),
        observeWrite: vi.fn(async () => {
          throw new Error('delegate should not be used')
        }),
        getStateSummary: vi.fn(async () => {
          throw new Error('delegate should not be used')
        }),
        explainRecall: vi.fn(async () => {
          throw new Error('delegate should not be used')
        }),
        getAsset: vi.fn(async () => {
          throw new Error('delegate should not be used')
        })
      }
    })

    await expect(bridge.processTurn({
      projectRoot,
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1',
      evidenceRefs: []
    })).resolves.toMatchObject({
      jobId: expect.stringMatching(/^job_turn_1_/)
    })
  })
})
