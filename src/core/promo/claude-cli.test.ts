import { describe, expect, test, vi } from 'vitest'
import { createClaudeStructuredOutputClient } from './claude-cli'

describe('claude-cli', () => {
  test('invokes claude with print mode and a JSON schema', async () => {
    const runCommand = vi.fn(async (input: {
      command: string
      args: string[]
      cwd: string
      timeoutMs: number
    }) => ({
      stdout: '{"structured_output":{"posts":[{"id":"post_1","topic":"context loss","text":"I kept losing context.","publishToday":true,"assetFileNames":[]}],"replies":[]}}',
      stderr: ''
    }))

    const client = createClaudeStructuredOutputClient({
      runCommand,
      command: 'claude'
    })

    const result = await client.generateObject({
      repoRoot: 'D:/repo',
      prompt: 'Generate today output.',
      schema: {
        type: 'object',
        properties: {
          posts: { type: 'array' },
          replies: { type: 'array' }
        },
        required: ['posts', 'replies']
      }
    })

    expect(runCommand).toHaveBeenCalledOnce()
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: 'claude',
      cwd: 'D:/repo'
    }))

    const invocation = (runCommand.mock.calls as Array<Array<{
      command: string
      args: string[]
      cwd: string
      timeoutMs: number
    }>>)[0]?.[0]
    expect(invocation).toBeDefined()
    expect(invocation?.args).toContain('-p')
    expect(invocation?.args).toContain('--json-schema')
    expect(invocation?.args).toContain('--output-format')
    expect(invocation?.args).toContain('json')
    expect(result).toMatchObject({
      posts: [{ id: 'post_1' }],
      replies: []
    })
  })

  test('reads structured_output from claude json mode envelopes', async () => {
    const client = createClaudeStructuredOutputClient({
      command: 'claude',
      runCommand: vi.fn(async () => ({
        stdout: '{"type":"result","structured_output":{"ok":true,"notes":["builder voice"]}}',
        stderr: ''
      }))
    })

    await expect(client.generateObject<{
      ok: boolean
      notes: string[]
    }>({
      repoRoot: 'D:/repo',
      prompt: 'Return ok.',
      schema: { type: 'object' }
    })).resolves.toEqual({
      ok: true,
      notes: ['builder voice']
    })
  })

  test('throws when claude returns invalid JSON', async () => {
    const client = createClaudeStructuredOutputClient({
      command: 'claude',
      runCommand: vi.fn(async () => ({
        stdout: 'not json',
        stderr: ''
      }))
    })

    await expect(client.generateObject({
      repoRoot: 'D:/repo',
      prompt: 'Generate today output.',
      schema: { type: 'object' }
    })).rejects.toThrow('Claude returned invalid JSON')
  })
})
