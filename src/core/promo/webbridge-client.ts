import { execFile as nodeExecFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { WebbridgeClient, WebbridgeStatus } from './types'

type ExecFileLike = (input: {
  command: string
  args: string[]
}) => Promise<{
  stdout: string
  stderr: string
}>

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const execFileAsync = promisify(nodeExecFile)
const DEFAULT_COMMAND_ENDPOINT = 'http://127.0.0.1:10086/command'

export function createWebbridgeClient(options: {
  commandPath?: string
  execFile?: ExecFileLike
  fetch?: FetchLike
}): WebbridgeClient {
  const commandPath = options.commandPath ?? resolveDefaultWebbridgeBinaryPath()
  const execFile = options.execFile ?? defaultExecFile
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis)

  return {
    async readStatus(): Promise<WebbridgeStatus> {
      const result = await execFile({
        command: commandPath,
        args: ['status']
      })
      return JSON.parse(result.stdout.trim()) as WebbridgeStatus
    },

    async command<T = unknown>(session: string, action: string, args: Record<string, unknown> = {}): Promise<T> {
      const response = await fetch(DEFAULT_COMMAND_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          action,
          args,
          session
        })
      })

      const payload = await response.json() as {
        ok: boolean
        data?: T
        error?: {
          message?: string
        }
      }

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? `Webbridge command failed: ${action}`)
      }

      return payload.data as T
    },

    async closeSession(session: string): Promise<void> {
      try {
        await this.command(session, 'close_session', {})
      } catch {
        // Best effort cleanup only.
      }
    }
  }
}

async function defaultExecFile(input: {
  command: string
  args: string[]
}): Promise<{
  stdout: string
  stderr: string
}> {
  const result = await execFileAsync(input.command, input.args, {
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  })

  return {
    stdout: result.stdout,
    stderr: result.stderr
  }
}

function resolveDefaultWebbridgeBinaryPath(): string {
  if (process.env.KIMI_WEBBRIDGE_BIN?.trim()) {
    return process.env.KIMI_WEBBRIDGE_BIN.trim()
  }

  if (process.platform === 'win32') {
    return join(homedir(), '.kimi-webbridge', 'bin', 'kimi-webbridge.exe')
  }

  return join(homedir(), '.kimi-webbridge', 'bin', 'kimi-webbridge')
}

