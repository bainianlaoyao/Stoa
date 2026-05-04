import { afterEach, describe, expect, test } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveEvolverProjectPaths } from '@shared/evolver-project-paths'
import { createEvolverEngineAdapter, createNoOpEngineAdapter } from './evolver-engine-adapter'

const tempDirs: string[] = []

afterEach(async () => {
  delete process.env.TEST_SOLIDIFY_FAIL
  delete process.env.TEST_DISTILL_MODE
  delete process.env.TEST_COMPLETE_DISTILL_FAIL
  delete process.env.TEST_FAILURE_DISTILL
  delete process.env.TEST_FAILURE_DISTILL_OK

  await Promise.allSettled(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })))
})

async function createFakeEvolverRepoRoot(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), 'stoa-evolver-adapter-repo-'))
  tempDirs.push(repoRoot)

  await mkdir(join(repoRoot, 'src', 'gep'), { recursive: true })
  await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ name: 'evolver' }, null, 2) + '\n', 'utf8')
  await writeFile(join(repoRoot, 'src', 'gep', 'solidify.js'), `
const fs = require('fs')
const path = require('path')

function statePath() {
  const base = process.env.EVOLUTION_DIR || process.cwd()
  fs.mkdirSync(base, { recursive: true })
  return path.join(base, 'solidify-state.json')
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'))
  } catch {
    return { solidify_count: 0 }
  }
}

function writeState(nextState) {
  fs.writeFileSync(statePath(), JSON.stringify(nextState, null, 2), 'utf8')
}

function writeStateForSolidify(state) {
  const current = readState()
  writeState({ ...current, ...state })
}

function readStateForSolidify() {
  return readState()
}

function solidify() {
  const current = readState()
  writeState({
    ...current,
    solidify_count: (current.solidify_count || 0) + 1,
    last_solidified_project_root: process.cwd()
  })
  if (process.env.TEST_SOLIDIFY_FAIL === '1') {
    return { ok: false, reason: 'boom', hubReviewPromise: Promise.resolve() }
  }
  return { ok: true, hubReviewPromise: Promise.resolve('reviewed') }
}

module.exports = {
  solidify,
  writeStateForSolidify,
  readStateForSolidify
}
`, 'utf8')
  await writeFile(join(repoRoot, 'src', 'gep', 'skillDistiller.js'), `
const fs = require('fs')
const path = require('path')

function evolutionDir() {
  const base = process.env.EVOLUTION_DIR || process.cwd()
  fs.mkdirSync(base, { recursive: true })
  return base
}

function promptPath() {
  return path.join(evolutionDir(), 'distill-prompt.txt')
}

function responsePath() {
  return path.join(evolutionDir(), 'distill-response.txt')
}

function shouldDistill() {
  return process.env.TEST_DISTILL_MODE === 'llm' || process.env.TEST_DISTILL_MODE === 'auto'
}

function prepareDistillation() {
  const filePath = promptPath()
  fs.writeFileSync(filePath, 'distill prompt from upstream', 'utf8')
  return { ok: true, promptPath: filePath }
}

function completeDistillation(response) {
  fs.writeFileSync(responsePath(), response, 'utf8')
  if (process.env.TEST_COMPLETE_DISTILL_FAIL === '1') {
    return { ok: false, reason: 'bad response' }
  }
  return { ok: true, gene: { id: 'gene_complete' } }
}

function autoDistill() {
  if (process.env.TEST_DISTILL_MODE === 'auto') {
    return { ok: true, gene: { id: 'gene_auto' } }
  }
  return { ok: false, reason: 'needs_llm' }
}

function shouldDistillFromFailures() {
  return process.env.TEST_FAILURE_DISTILL === '1'
}

function autoDistillFromFailures() {
  if (process.env.TEST_FAILURE_DISTILL_OK === '1') {
    return { ok: true, gene: { id: 'gene_failure' } }
  }
  return { ok: false, reason: 'no_failure_distill' }
}

module.exports = {
  shouldDistill,
  prepareDistillation,
  completeDistillation,
  autoDistill,
  shouldDistillFromFailures,
  autoDistillFromFailures
}
`, 'utf8')

  return repoRoot
}

async function createProjectRoot(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'stoa-evolver-adapter-project-'))
  tempDirs.push(projectRoot)
  return projectRoot
}

describe('evolver-engine-adapter', () => {
  test('stageTurn writes solidify state inside the project-scoped evolution directory', async () => {
    const repoRoot = await createFakeEvolverRepoRoot()
    const projectRoot = await createProjectRoot()
    const adapter = await createEvolverEngineAdapter({
      resolveBundledEvolverRepoRoot: async () => repoRoot
    })
    const projectPaths = resolveEvolverProjectPaths(projectRoot, repoRoot)
    const initialCwd = process.cwd()

    const result = await adapter.stageTurn({
      projectRoot,
      stoaSessionId: 'session-1',
      providerSessionId: 'provider-1',
      turnId: 'turn-1',
      evidenceRefs: [
        {
          evidenceId: 'evidence-1',
          projectId: 'project-1',
          stoaSessionId: 'session-1',
          providerSessionId: 'provider-1',
          turnId: 'turn-1',
          eventId: 'event-1',
          eventType: 'claude-code.Stop',
          evidenceKey: 'claude-code:provider-1:turn-1',
          kind: 'turn-slice',
          metadataPath: '/tmp/metadata.json',
          path: '/tmp/turn-slice.json',
          createdAt: '2026-05-01T00:00:00.000Z',
          toolName: null
        }
      ]
    })

    const solidifyState = JSON.parse(await readFile(join(projectPaths.evolutionDir, 'solidify-state.json'), 'utf8')) as {
      project_root: string
      stoa_session_id: string
      provider_session_id: string
      turn_id: string
      evidence_refs: Array<{ evidenceId: string }>
    }

    expect(result).toEqual({ jobId: 'job_turn-1' })
    expect(solidifyState).toMatchObject({
      project_root: projectRoot,
      stoa_session_id: 'session-1',
      provider_session_id: 'provider-1',
      turn_id: 'turn-1',
      evidence_refs: [
        { evidenceId: 'evidence-1' }
      ]
    })
    expect(process.cwd()).toBe(initialCwd)
    expect(process.env.MEMORY_DIR).toBeUndefined()
    expect(process.env.EVOLUTION_DIR).toBeUndefined()
  })

  test('solidify succeeds and llm distill reads and writes project-scoped artifacts', async () => {
    const repoRoot = await createFakeEvolverRepoRoot()
    const projectRoot = await createProjectRoot()
    const adapter = await createEvolverEngineAdapter({
      resolveBundledEvolverRepoRoot: async () => repoRoot
    })
    const projectPaths = resolveEvolverProjectPaths(projectRoot, repoRoot)

    process.env.TEST_DISTILL_MODE = 'llm'

    await adapter.stageTurn({
      projectRoot,
      stoaSessionId: 'session-1',
      providerSessionId: 'provider-1',
      turnId: 'turn-1',
      evidenceRefs: []
    })
    await adapter.solidify({
      projectRoot,
      stoaSessionId: 'session-1',
      providerSessionId: 'provider-1',
      turnId: 'turn-1'
    })
    const plan = await adapter.prepareDistill({
      projectRoot,
      stoaSessionId: 'session-1',
      providerSessionId: 'provider-1',
      turnId: 'turn-1'
    })

    expect(plan).toEqual({
      kind: 'llm',
      prompt: 'distill prompt from upstream',
      responseFormat: 'text'
    })

    await adapter.completeDistill({
      projectRoot,
      stoaSessionId: 'session-1',
      providerSessionId: 'provider-1',
      turnId: 'turn-1',
      response: 'distilled response'
    })

    expect(await readFile(join(projectPaths.evolutionDir, 'distill-response.txt'), 'utf8')).toBe('distilled response')
  })

  test('prepareDistill reports auto when upstream auto-distill succeeds', async () => {
    const repoRoot = await createFakeEvolverRepoRoot()
    const projectRoot = await createProjectRoot()
    const adapter = await createEvolverEngineAdapter({
      resolveBundledEvolverRepoRoot: async () => repoRoot
    })

    process.env.TEST_DISTILL_MODE = 'auto'

    const plan = await adapter.prepareDistill({
      projectRoot,
      stoaSessionId: 'session-1',
      providerSessionId: 'provider-1',
      turnId: 'turn-1'
    })

    expect(plan).toEqual({ kind: 'auto' })
  })

  test('surfaces upstream solidify failures and keeps the no-op adapter inert', async () => {
    const repoRoot = await createFakeEvolverRepoRoot()
    const projectRoot = await createProjectRoot()
    const adapter = await createEvolverEngineAdapter({
      resolveBundledEvolverRepoRoot: async () => repoRoot
    })
    process.env.TEST_SOLIDIFY_FAIL = '1'

    await expect(adapter.solidify({
      projectRoot,
      stoaSessionId: 'session-1',
      providerSessionId: 'provider-1',
      turnId: 'turn-1'
    })).rejects.toThrow('Evolver solidify failed: boom')

    const noOp = createNoOpEngineAdapter()
    await expect(noOp.solidify({
      projectRoot,
      stoaSessionId: 'session-1',
      providerSessionId: 'provider-1',
      turnId: 'turn-1'
    })).resolves.toBeUndefined()
    await expect(noOp.prepareDistill({
      projectRoot,
      stoaSessionId: 'session-1',
      providerSessionId: 'provider-1',
      turnId: 'turn-1'
    })).resolves.toEqual({ kind: 'none' })
  })
})
