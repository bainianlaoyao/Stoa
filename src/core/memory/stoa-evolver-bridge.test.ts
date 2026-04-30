import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import type { EvidenceRef } from '@shared/memory-runtime'
import { EvolverClient } from './evolver-client'
import { StoaEvolverBridge } from './stoa-evolver-bridge'

const testDir = dirname(fileURLToPath(import.meta.url))
const evolverRepoRoot = resolve(testDir, '../../../research/upstreams/evolver')
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.allSettled(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })))
})

describe('StoaEvolverBridge', () => {
  test('processTurn delegates to upstream host-bridge and materializes a uv preference capsule', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'stoa-memory-project-'))
    tempDirs.push(projectRoot)

    const evidenceRef = await writeEvidence(projectRoot, {
      evidenceId: 'evt_uv_preference',
      promptText: 'Do not use pip here. Use uv for Python environments and package installation.',
      lastAssistantMessage: 'Switching to uv instead of pip for this repository.'
    })

    const bridge = createBridge()

    await expect(bridge.processTurn({
      projectRoot,
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1',
      evidenceRefs: [evidenceRef]
    })).resolves.toMatchObject({
      jobId: expect.stringMatching(/^job_turn_1_/)
    })

    const recall = await bridge.recall({
      projectRoot,
      consumer: 'codex',
      stoaSessionId: 'session_2',
      providerSessionId: 'provider-session-2',
      taskText: 'Install the Python dependencies for this repository.'
    })

    expect(recall).not.toBeNull()
    expect(recall?.content).toContain('capsule_repo_python_prefers_uv_over_pip')

    const trace = await bridge.traceTurn({
      projectRoot,
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      turnId: 'turn_1'
    })

    expect(trace).toMatchObject({
      turnId: 'turn_1',
      evidenceCount: 1,
      evidenceIds: ['evt_uv_preference'],
      toolNames: [],
      distilledCapsules: [
        {
          id: 'capsule_repo_python_prefers_uv_over_pip'
        }
      ]
    })
    expect(String(trace.textPreview)).toContain('Use uv for Python environments')
    expect(Array.isArray(trace.signals)).toBe(true)
    expect((trace.signals as string[]).length).toBeGreaterThan(0)

    const capsulesPath = join(projectRoot, '.stoa', 'evolver', 'assets', 'gep', 'capsules.json')
    const capsulesText = await readFile(capsulesPath, 'utf8')
    expect(capsulesText).toContain('capsule_repo_python_prefers_uv_over_pip')
  })
})

function createBridge(): StoaEvolverBridge {
  const delegate = new EvolverClient({
    command: process.execPath,
    cwd: evolverRepoRoot,
    argsPrefix: [join(evolverRepoRoot, 'index.js')]
  })

  return new StoaEvolverBridge({
    repoRoot: evolverRepoRoot,
    delegate
  })
}

async function writeEvidence(
  projectRoot: string,
  overrides: {
    evidenceId: string
    promptText: string
    lastAssistantMessage: string
  }
): Promise<EvidenceRef> {
  const sessionId = 'session_1'
  const turnId = 'turn_1'
  const eventDir = join(projectRoot, '.stoa', 'memory', 'evidence', sessionId, overrides.evidenceId)
  await mkdir(eventDir, { recursive: true })

  const metadataPath = join(eventDir, 'metadata.json')
  const path = join(eventDir, 'turn-slice.json')
  await writeFile(metadataPath, `${JSON.stringify({
    eventType: 'claude-code.Stop',
    summary: 'Turn completed',
    payload: {
      summary: 'Turn completed'
    },
    evidence: {
      promptText: overrides.promptText,
      lastAssistantMessage: overrides.lastAssistantMessage
    }
  }, null, 2)}\n`, 'utf8')
  await writeFile(path, `${JSON.stringify({
    summary: 'Do not use pip here. Use uv.'
  }, null, 2)}\n`, 'utf8')

  return {
    evidenceId: overrides.evidenceId,
    projectId: 'project_1',
    stoaSessionId: sessionId,
    providerSessionId: 'provider-session-1',
    turnId,
    eventId: overrides.evidenceId,
    eventType: 'claude-code.Stop',
    evidenceKey: `claude-code:provider-session-1:${turnId}`,
    kind: 'turn-slice',
    metadataPath,
    path,
    createdAt: '2026-04-29T00:00:00.000Z',
    toolName: null
  }
}
