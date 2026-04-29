import { describe, expect, test, vi } from 'vitest'
import { createClaudeCodeInferenceCapability } from './runtime-capabilities'

describe('runtime-capabilities', () => {
  test('wraps Windows claude.cmd invocations through cmd.exe for headless inference', async () => {
    const runCommand = vi.fn(async () => ({
      stdout: 'ok',
      stderr: ''
    }))
    const capability = createClaudeCodeInferenceCapability('C:/tools/claude.cmd', {
      runCommand,
      platform: 'win32',
      comspec: 'C:/Windows/System32/cmd.exe'
    })

    await capability.invoke({
      purpose: 'llm-review',
      prompt: 'review this',
      responseFormat: 'text',
      projectRoot: 'D:/repo'
    })

    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: 'C:/Windows/System32/cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        expect.stringContaining('C:/tools/claude.cmd')
      ],
      cwd: 'D:/repo',
      shell: false
    }))
  })
})
