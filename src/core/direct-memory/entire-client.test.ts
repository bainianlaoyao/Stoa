import { describe, expect, test, vi } from 'vitest'
import { EntireClient } from './entire-client'
import type { EntireStoaCheckpointExport, EntireStoaCheckpointRef } from '@shared/direct-memory'

describe('EntireClient', () => {
  test('lists checkpoint refs through patched Entire JSON command', async () => {
    const checkpoints: EntireStoaCheckpointRef[] = [{
      checkpoint_id: 'chk_1',
      checkpoint_format_version: 'v1',
      checkpoint_metadata_commit_sha: 'meta-sha',
      source_worktree_commit_sha: 'source-sha',
      session_ids: ['provider-session-1'],
      latest_session_id: 'provider-session-1',
      agent: 'codex',
      model: 'gpt',
      summary: 'summary',
      created_at: null,
      updated_at: null
    }]
    const runner = vi.fn().mockResolvedValue(checkpoints)
    const client = new EntireClient({ command: 'entire-dev', cwd: 'C:/repo', runJsonCommand: runner })

    await expect(client.listCheckpoints()).resolves.toEqual(checkpoints)
    expect(runner).toHaveBeenCalledWith({
      command: 'entire-dev',
      args: ['stoa', 'checkpoints', '--json'],
      cwd: 'C:/repo'
    })
  })

  test('exports a checkpoint through patched Entire JSON command', async () => {
    const exported: EntireStoaCheckpointExport = {
      checkpoint_id: 'chk_1',
      checkpoint_format_version: 'v1',
      checkpoint_metadata_commit_sha: 'meta-sha',
      source_worktree_commit_sha: 'source-sha',
      root_metadata_ref: 'metadata.json',
      sessions: [],
      token_usage: null,
      combined_attribution: null
    }
    const runner = vi.fn().mockResolvedValue(exported)
    const client = new EntireClient({ command: 'entire', cwd: 'C:/repo', runJsonCommand: runner })

    await expect(client.exportCheckpoint('chk_1')).resolves.toEqual(exported)
    expect(runner).toHaveBeenCalledWith({
      command: 'entire',
      args: ['stoa', 'checkpoint', 'export', 'chk_1', '--json'],
      cwd: 'C:/repo'
    })
  })
})
