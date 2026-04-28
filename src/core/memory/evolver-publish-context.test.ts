import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const require = createRequire(import.meta.url)
const testDir = dirname(fileURLToPath(import.meta.url))
const publishContextModulePath = resolve(testDir, '../../../research/upstreams/evolver/src/stoa/publishContext.js')
const artifactRefsModulePath = resolve(testDir, '../../../research/upstreams/evolver/src/stoa/artifactRefs.js')
const pathsModulePath = resolve(testDir, '../../../research/upstreams/evolver/src/gep/paths.js')

describe('bundled Evolver publishContext', () => {
  let repoRoot: string
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(async () => {
    originalEnv = { ...process.env }
    repoRoot = await mkdtemp(join(tmpdir(), 'stoa-evolver-publish-context-'))
  })

  afterEach(async () => {
    process.env = originalEnv
    clearPublishContextModules()
    await rm(repoRoot, { recursive: true, force: true })
  })

  test('builds hook-consumable claude-code context from raw memory graph evidence when no outcome note exists', async () => {
    const evolutionBaseDir = join(repoRoot, 'evolution')
    const scopeDir = join(evolutionBaseDir, 'scopes', 'provider-session-1')
    const gepAssetsDir = join(repoRoot, 'gep-assets')
    await mkdir(scopeDir, { recursive: true })
    await mkdir(gepAssetsDir, { recursive: true })

    await writeFile(join(scopeDir, 'evolution_solidify_state.json'), JSON.stringify({
      last_run: {
        run_id: 'run_1',
        created_at: '2026-04-28T10:00:00.000Z',
        selected_gene_id: 'gene_uv',
        signals: ['protocol_drift']
      },
      last_solidify: {
        run_id: 'run_1',
        at: '2026-04-28T10:01:00.000Z',
        outcome: {
          status: 'failed',
          score: 0.48
        }
      }
    }, null, 2), 'utf8')

    await writeFile(join(scopeDir, 'memory_graph.jsonl'), [
      JSON.stringify({
        type: 'MemoryGraphEvent',
        kind: 'signal',
        id: 'mge_1',
        ts: '2026-04-28T10:00:30.000Z',
        signal: {
          key: 'protocol_drift',
          signals: ['protocol_drift'],
          error_signature: null
        },
        observed: {
          evidence: {
            recent_session_tail: [
              '--- SESSION (claude-code-provider-session-1-session_1.jsonl) ---',
              '**USER**: Install a Python environment for this project.',
              '**ASSISTANT**: I will create a virtual environment with pip.',
              '**USER**: Do not use pip-managed virtualenvs here. Use uv.',
              '**ASSISTANT**: Understood. I will use uv for Python environments and package installation in this repository.'
            ].join('\n'),
            today_log_tail: [
              '# 2026-04-28',
              '',
              'Evidence groups: 1',
              '',
              '- provider-session-1: Use uv instead of pip for Python package management in this repository.',
              'Lesson: Prefer uv for environments and package installation in this project.'
            ].join('\n')
          }
        }
      })
    ].join('\n') + '\n', 'utf8')

    process.env.EVOLVER_REPO_ROOT = repoRoot
    process.env.MEMORY_DIR = join(repoRoot, 'memory')
    process.env.EVOLUTION_DIR = evolutionBaseDir
    process.env.GEP_ASSETS_DIR = gepAssetsDir
    process.env.EVOLVER_SESSION_SCOPE = 'provider-session-1'
    process.env.STOA_PROJECT_ID = 'project-1'
    process.env.STOA_SESSION_ID = 'session-2'
    process.env.STOA_PROVIDER_SESSION_ID = 'provider-session-2'

    const { publishContext } = loadPublishContextFresh()
    const published = publishContext('claude-code') as {
      ok: boolean
      target: string
      content: string
      metadata: {
        selection_policy: string
      }
    }

    const lines = published.content
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as {
        timestamp?: string
        signals?: string[]
        outcome?: {
          status?: string
          score?: number | null
          note?: string
        }
      })

    expect(published.ok).toBe(true)
    expect(published.target).toBe('claude-code')
    expect(published.metadata.selection_policy).toBe('claude-code-durable-memory-v2')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      timestamp: '2026-04-28T10:00:30.000Z',
      signals: ['protocol_drift'],
      outcome: {
        status: 'unknown',
        note: expect.stringContaining('Use uv instead of pip')
      }
    })
    expect(lines[0]?.outcome?.note).toContain('Prefer uv for environments and package installation')
  })
})

function loadPublishContextFresh(): {
  publishContext: (target: string) => unknown
} {
  clearPublishContextModules()
  return require(publishContextModulePath) as {
    publishContext: (target: string) => unknown
  }
}

function clearPublishContextModules(): void {
  delete require.cache[publishContextModulePath]
  delete require.cache[artifactRefsModulePath]
  delete require.cache[pathsModulePath]
}
