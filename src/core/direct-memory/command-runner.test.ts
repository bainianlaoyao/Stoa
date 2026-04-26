import { describe, expect, test, vi } from 'vitest'
import { runJsonCommand, JsonCommandError } from './command-runner'

describe('runJsonCommand', () => {
  test('parses JSON stdout from a successful command', async () => {
    const execFile = vi.fn((_command, _args, _options, callback) => {
      callback(null, '{"ok":true,"value":42}', '')
    })

    await expect(runJsonCommand<{ ok: boolean; value: number }>({
      command: 'entire',
      args: ['stoa', 'checkpoints', '--json'],
      cwd: 'C:/repo',
      execFile
    })).resolves.toEqual({ ok: true, value: 42 })
  })

  test('throws command error with stderr when process exits non-zero', async () => {
    const execFile = vi.fn((_command, _args, _options, callback) => {
      const error = new Error('failed') as Error & { code: number }
      error.code = 2
      callback(error, 'human output', 'bad command')
    })

    await expect(runJsonCommand({
      command: 'evolver',
      args: ['run', '--json'],
      cwd: 'C:/repo',
      execFile
    })).rejects.toMatchObject({
      name: 'JsonCommandError',
      command: 'evolver',
      args: ['run', '--json'],
      exitCode: 2,
      stdout: 'human output',
      stderr: 'bad command'
    })
  })

  test('throws command error when stdout is not valid JSON', async () => {
    const execFile = vi.fn((_command, _args, _options, callback) => {
      callback(null, '[Review] pending', '')
    })

    await expect(runJsonCommand({
      command: 'evolver',
      args: ['review', '--json'],
      cwd: 'C:/repo',
      execFile
    })).rejects.toBeInstanceOf(JsonCommandError)
  })
})
