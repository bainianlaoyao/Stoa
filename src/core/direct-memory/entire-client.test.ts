import { describe, expect, test, vi } from 'vitest'
import { EntireClient, resolveDefaultEntireBridgeCommand } from './entire-client'
import type { EntireStoaCheckpointExport, EntireStoaCheckpointRef } from '@shared/direct-memory'

describe('EntireClient', () => {
  test('resolves the Stoa-owned Entire bridge binary by platform', () => {
    expect(resolveDefaultEntireBridgeCommand({
      appRoot: 'C:/stoa',
      platform: 'win32'
    }).replace(/\\/g, '/')).toBe('C:/stoa/out/tools/entire-bridge/entire-bridge.exe')

    expect(resolveDefaultEntireBridgeCommand({
      appRoot: '/opt/stoa',
      platform: 'linux'
    })).toBe('/opt/stoa/out/tools/entire-bridge/entire-bridge')
  })

  test('uses the Stoa-owned Entire bridge when no command is injected', async () => {
    const checkpoints: EntireStoaCheckpointRef[] = []
    const runner = vi.fn().mockResolvedValue(checkpoints)
    const client = new EntireClient({
      cwd: 'C:/repo',
      appRoot: 'C:/stoa',
      platform: 'win32',
      runJsonCommand: runner
    })

    await expect(client.listCheckpoints()).resolves.toEqual(checkpoints)
    expect(runner).toHaveBeenCalledWith({
      command: 'C:/stoa/out/tools/entire-bridge/entire-bridge.exe',
      args: ['checkpoints', '--repo', 'C:/repo', '--json'],
      cwd: 'C:/repo'
    })
  })

  test('lists checkpoint refs through the Stoa-owned Entire bridge contract', async () => {
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
    const client = new EntireClient({ command: 'entire-bridge-dev', cwd: 'C:/repo', runJsonCommand: runner })

    await expect(client.listCheckpoints()).resolves.toEqual(checkpoints)
    expect(runner).toHaveBeenCalledWith({
      command: 'entire-bridge-dev',
      args: ['checkpoints', '--repo', 'C:/repo', '--json'],
      cwd: 'C:/repo'
    })
  })

  test('exports a checkpoint through the Stoa-owned Entire bridge contract', async () => {
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
      args: ['checkpoint', 'export', 'chk_1', '--repo', 'C:/repo', '--json'],
      cwd: 'C:/repo'
    })
  })
})
