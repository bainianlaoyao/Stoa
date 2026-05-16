import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'

type RunCommandInput = {
  command: string
  args: string[]
  cwd: string
  timeoutMs: number
}

type RunCommand = (input: RunCommandInput) => Promise<{
  stdout: string
  stderr: string
}>

interface ClaudeStructuredOutputClient {
  generateObject<T>(input: {
    repoRoot: string
    prompt: string
    schema: Record<string, unknown>
    timeoutMs?: number
  }): Promise<T>
}

const execFileAsync = promisify(nodeExecFile)
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000

export function createClaudeStructuredOutputClient(options: {
  command?: string
  runCommand?: RunCommand
} = {}): ClaudeStructuredOutputClient {
  const command = options.command ?? 'claude'
  const runCommand = options.runCommand ?? defaultRunCommand

  return {
    async generateObject<T>(input: {
      repoRoot: string
      prompt: string
      schema: Record<string, unknown>
      timeoutMs?: number
    }) {
      const result = await runCommand({
        command,
        cwd: input.repoRoot,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        args: [
          '-p',
          input.prompt,
          '--output-format',
          'json',
          '--permission-mode',
          'bypassPermissions',
          '--tools',
          '',
          '--json-schema',
          JSON.stringify(input.schema)
        ]
      })

      try {
        const parsed = JSON.parse(result.stdout.trim()) as {
          structured_output?: T
        } & Record<string, unknown>

        if ('structured_output' in parsed && parsed.structured_output !== undefined) {
          return parsed.structured_output
        }

        return parsed as T
      } catch (error) {
        throw new Error(`Claude returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}

async function defaultRunCommand(input: RunCommandInput): Promise<{
  stdout: string
  stderr: string
}> {
  const result = await execFileAsync(input.command, input.args, {
    cwd: input.cwd,
    timeout: input.timeoutMs,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  })

  return {
    stdout: result.stdout,
    stderr: result.stderr
  }
}
