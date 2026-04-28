import { execFile as nodeExecFile } from 'node:child_process'

export type ExecFileLike = (
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; windowsHide: boolean; timeout: number; maxBuffer: number },
  callback: (error: Error | null, stdout: string, stderr: string) => void
) => void

export interface JsonCommandOptions {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  execFile?: ExecFileLike
}

export class JsonCommandError extends Error {
  readonly command: string
  readonly args: string[]
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string

  constructor(message: string, options: {
    command: string
    args: string[]
    exitCode: number | null
    stdout: string
    stderr: string
  }) {
    super(message)
    this.name = 'JsonCommandError'
    this.command = options.command
    this.args = options.args
    this.exitCode = options.exitCode
    this.stdout = options.stdout
    this.stderr = options.stderr
  }
}

function getExitCode(error: Error): number | null {
  if ('code' in error && typeof error.code === 'number') {
    return error.code
  }

  return null
}

export async function runJsonCommand<TOutput>(options: JsonCommandOptions): Promise<TOutput> {
  const execFile = options.execFile ?? nodeExecFile
  const { stdout, stderr, exitCode } = await new Promise<{
    stdout: string
    stderr: string
    exitCode: number | null
  }>((resolve, reject) => {
    execFile(
      options.command,
      options.args,
      {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: 10 * 1024 * 1024
      },
      (error, commandStdout, commandStderr) => {
        if (error) {
          const parsedJson = tryParseJsonOutput(commandStdout)
          if (parsedJson.parsed) {
            resolve({
              stdout: commandStdout,
              stderr: commandStderr,
              exitCode: getExitCode(error)
            })
            return
          }

          reject(new JsonCommandError(`Command failed: ${options.command}`, {
            command: options.command,
            args: options.args,
            exitCode: getExitCode(error),
            stdout: commandStdout,
            stderr: commandStderr
          }))
          return
        }

        resolve({
          stdout: commandStdout,
          stderr: commandStderr,
          exitCode: 0
        })
      }
    )
  })

  const parsedJson = tryParseJsonOutput(stdout)
  if (!parsedJson.parsed) {
    throw new JsonCommandError(`Command did not emit valid JSON: ${options.command}`, {
      command: options.command,
      args: options.args,
      exitCode,
      stdout,
      stderr
    })
  }

  return parsedJson.value as TOutput
}

function tryParseJsonOutput(stdout: string): { parsed: true; value: unknown } | { parsed: false } {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return { parsed: false }
  }

  try {
    return {
      parsed: true,
      value: JSON.parse(trimmed) as unknown
    }
  } catch {
    const lines = trimmed.split(/\r?\n/)
    for (let startIndex = 1; startIndex < lines.length; startIndex += 1) {
      const candidate = lines.slice(startIndex).join('\n').trim()
      if (!candidate) {
        continue
      }

      try {
        return {
          parsed: true,
          value: JSON.parse(candidate) as unknown
        }
      } catch {
        // Keep scanning until a valid JSON tail is found.
      }
    }
  }

  return { parsed: false }
}
