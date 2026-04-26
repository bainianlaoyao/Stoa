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
  const stdout = await new Promise<string>((resolve, reject) => {
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
          reject(new JsonCommandError(`Command failed: ${options.command}`, {
            command: options.command,
            args: options.args,
            exitCode: getExitCode(error),
            stdout: commandStdout,
            stderr: commandStderr
          }))
          return
        }

        resolve(commandStdout)
      }
    )
  })

  try {
    return JSON.parse(stdout) as TOutput
  } catch {
    throw new JsonCommandError(`Command did not emit valid JSON: ${options.command}`, {
      command: options.command,
      args: options.args,
      exitCode: 0,
      stdout,
      stderr: ''
    })
  }
}
