import { describe, expect, test, vi } from 'vitest'
import { JsonCommandError, runJsonCommand } from './command-runner'

describe('runJsonCommand', () => {
  test('parses JSON stdout from a successful command', async () => {
    const execFile = vi.fn((_command, _args, _options, callback) => {
      callback(null, '{"ok":true,"value":42}', '')
    })

    await expect(runJsonCommand<{ ok: boolean; value: number }>({
      command: 'evolver',
      args: ['run', '--json'],
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
      args: ['review', '--json'],
      cwd: 'C:/repo',
      execFile
    })).rejects.toMatchObject({
      name: 'JsonCommandError',
      command: 'evolver',
      args: ['review', '--json'],
      exitCode: 2,
      stdout: 'human output',
      stderr: 'bad command'
    })
  })

  test('parses machine JSON output even when the process exits non-zero', async () => {
    const execFile = vi.fn((_command, _args, _options, callback) => {
      const error = new Error('failed') as Error & { code: number }
      error.code = 2
      callback(error, '{"ok":false,"error":"run_failed"}', 'bad command')
    })

    await expect(runJsonCommand<{ ok: boolean; error: string }>({
      command: 'evolver',
      args: ['run', '--json'],
      cwd: 'C:/repo',
      execFile
    })).resolves.toEqual({ ok: false, error: 'run_failed' })
  })

  test('parses JSON after banner lines emitted before the machine payload', async () => {
    const execFile = vi.fn((_command, _args, _options, callback) => {
      callback(
        null,
        '[evolver] Using host git repository at: C:/repo\n{"ok":true,"value":42}',
        ''
      )
    })

    await expect(runJsonCommand<{ ok: boolean; value: number }>({
      command: 'evolver',
      args: ['publish-context', '--target=claude-code', '--json'],
      cwd: 'C:/repo',
      execFile
    })).resolves.toEqual({ ok: true, value: 42 })
  })

  test('throws command error when stdout is not valid JSON', async () => {
    const execFile = vi.fn((_command, _args, _options, callback) => {
      callback(null, '[Review] pending', '')
    })

    await expect(runJsonCommand({
      command: 'evolver',
      args: ['publish-context', '--target=claude-code', '--json'],
      cwd: 'C:/repo',
      execFile
    })).rejects.toBeInstanceOf(JsonCommandError)
  })
})
