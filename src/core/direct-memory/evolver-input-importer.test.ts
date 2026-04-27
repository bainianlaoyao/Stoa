import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { EntireStoaCheckpointExport } from '@shared/direct-memory'
import { importCheckpointIntoEvolverInputs } from './evolver-input-importer'

describe('importCheckpointIntoEvolverInputs', () => {
  let rootDir: string
  let worktreeRepoRoot: string
  let memoryDir: string

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'stoa-evolver-input-importer-'))
    worktreeRepoRoot = join(rootDir, 'worktree')
    memoryDir = join(rootDir, 'memory')
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  test('materializes repo-root memory files, dated memory notes, and isolated OpenClaw session logs for Evolver', async () => {
    const checkpoint: EntireStoaCheckpointExport = {
      checkpoint_id: 'chk_uv',
      checkpoint_format_version: 'v1',
      checkpoint_metadata_commit_sha: 'meta-sha',
      source_worktree_commit_sha: 'source-sha',
      root_metadata_ref: 'aa/chk_uv/metadata.json',
      sessions: [
        {
          session_id: 'provider-session-1',
          agent: 'claude-code',
          model: 'claude-sonnet',
          turn_id: 'turn-1',
          metadata_ref: 'aa/chk_uv/0/metadata.json',
          transcript_ref: 'aa/chk_uv/0/full.jsonl',
          transcript_text: [
            JSON.stringify({
              type: 'user',
              message: {
                role: 'user',
                content: [{ type: 'text', text: 'install the project dependencies' }]
              }
            }),
            JSON.stringify({
              type: 'assistant',
              message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'I will use pip to install them.' }]
              }
            }),
            JSON.stringify({
              type: 'user',
              message: {
                role: 'user',
                content: [{ type: 'text', text: 'use uv instead of pip for Python environments' }]
              }
            })
          ].join('\n'),
          prompt_ref: 'aa/chk_uv/0/prompt.txt',
          prompt_text: 'install the project dependencies',
          summary: 'User corrected the workflow to use uv instead of pip.',
          initial_attribution: null
        }
      ],
      token_usage: null,
      combined_attribution: null
    }

    const imported = await importCheckpointIntoEvolverInputs({
      checkpoint,
      worktreeRepoRoot,
      memoryDir,
      now: () => new Date('2026-04-27T12:00:00.000Z')
    })

    await expect(readFile(join(worktreeRepoRoot, 'MEMORY.md'), 'utf-8')).resolves.toContain(
      'User corrected the workflow to use uv instead of pip.'
    )
    await expect(readFile(join(worktreeRepoRoot, 'USER.md'), 'utf-8')).resolves.toContain(
      'install the project dependencies'
    )
    await expect(readFile(join(memoryDir, '2026-04-27.md'), 'utf-8')).resolves.toContain(
      'provider-session-1'
    )

    const sessionDir = join(imported.runtimeHomeDir, '.openclaw', 'agents', imported.agentName, 'sessions')
    const sessionFiles = await readdir(sessionDir)
    expect(sessionFiles).toEqual(['provider-session-1.jsonl'])

    const sessionLog = await readFile(join(sessionDir, 'provider-session-1.jsonl'), 'utf-8')
    const [headerLine, ...transcriptLines] = sessionLog.trim().split('\n')
    expect(JSON.parse(headerLine ?? '{}')).toMatchObject({
      cwd: worktreeRepoRoot,
      source: 'stoa-direct-memory'
    })
    expect(transcriptLines.join('\n')).toContain('use uv instead of pip')
  })
})
