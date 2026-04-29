import { spawn } from 'node:child_process'
import type { ExecutionCapability, InferenceCapability } from '@shared/memory-runtime'
import type { ProviderCommand } from '@shared/project-session'
import { wrapCommandForShell } from '@core/shell-command'

const DEFAULT_INFERENCE_TIMEOUT_MS = 15 * 60 * 1000
const DEFAULT_EXECUTION_TIMEOUT_MS = 120_000

type HeadlessCommandRunner = (input: {
  command: string
  args: string[]
  cwd: string
  timeoutMs: number
  shell: boolean
}) => Promise<{
  stdout: string
  stderr: string
}>

export function createClaudeCodeInferenceCapability(
  providerPath?: string,
  options: {
    runCommand?: HeadlessCommandRunner
    platform?: NodeJS.Platform
    comspec?: string | null
  } = {}
): InferenceCapability {
  const command = providerPath?.trim() || 'claude'
  const runCommand = options.runCommand ?? runCheckedCommand
  const platform = options.platform ?? process.platform
  const comspec = options.comspec ?? process.env.COMSPEC ?? 'cmd.exe'

  return {
    provider: 'claude-code',
    invoke: async (input) => {
      const args = [
        '-p',
        input.prompt,
        '--output-format',
        'text',
        '--permission-mode',
        'bypassPermissions',
        '--tools',
        ''
      ]

      if (input.responseFormat === 'json') {
        args.push(
          '--json-schema',
          JSON.stringify({
            type: 'object',
            properties: {
              approved: { type: 'boolean' },
              summary: { type: 'string' },
              concerns: {
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: ['approved']
          })
        )
      }

      const invocation = resolveHeadlessInvocation({
        command,
        args,
        cwd: input.projectRoot,
        env: process.env as Record<string, string>
      }, {
        platform,
        comspec
      })

      const result = await runCommand({
        command: invocation.command,
        args: invocation.args,
        cwd: invocation.cwd,
        timeoutMs: input.timeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS,
        shell: false
      })

      return {
        content: result.stdout.trim(),
        provider: 'claude-code'
      }
    }
  }
}

export function createWorkspaceShellExecutionCapability(options: {
  shellPath?: string | null
} = {}): ExecutionCapability {
  return {
    mode: 'workspace-shell',
    run: async (input) => {
      const commandResults: Array<{
        command: string
        exitCode: number
        stdout: string
        stderr: string
      }> = []

      let stdout = ''
      let stderr = ''
      let lastExitCode = 0

      for (const command of input.commands) {
        const result = await runShellCommandAllowFailure(command, input.projectRoot, {
          shellPath: options.shellPath,
          timeoutMs: input.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS
        })
        commandResults.push(result)
        stdout += result.stdout
        stderr += result.stderr
        lastExitCode = result.exitCode

        if (result.exitCode !== 0) {
          return {
            ok: false,
            exitCode: result.exitCode,
            stdout,
            stderr,
            commandResults
          }
        }
      }

      return {
        ok: true,
        exitCode: lastExitCode,
        stdout,
        stderr,
        commandResults
      }
    }
  }
}

async function runCheckedCommand(
  input: {
    command: string
    args: string[]
    cwd: string
    timeoutMs: number
    shell: boolean
  }
): Promise<{
  stdout: string
  stderr: string
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      shell: input.shell,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      child.kill()
      reject(new Error(`Command timed out: ${input.command}`))
    }, input.timeoutMs)

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)

      if ((code ?? 1) !== 0) {
        reject(new Error(`Command failed: ${input.command}\n${stderr || stdout}`))
        return
      }

      resolve({ stdout, stderr })
    })
  })
}

function resolveHeadlessInvocation(
  command: ProviderCommand,
  options: {
    platform: NodeJS.Platform
    comspec: string
  }
): ProviderCommand {
  if (
    options.platform === 'win32'
    && requiresWindowsShellWrap(command.command)
  ) {
    return wrapCommandForShell(options.comspec, command)
  }

  return command
}

function requiresWindowsShellWrap(commandPath: string): boolean {
  const normalized = commandPath.trim().toLowerCase()
  return normalized.endsWith('.cmd')
    || normalized.endsWith('.bat')
    || normalized.endsWith('.ps1')
}

async function runShellCommandAllowFailure(
  command: string,
  cwd: string,
  options: {
    shellPath?: string | null
    timeoutMs: number
  }
): Promise<{
  command: string
  exitCode: number
  stdout: string
  stderr: string
}> {
  const invocation = resolveShellInvocation(options.shellPath, command)

  return await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      child.kill()
      reject(new Error(`Command timed out: ${command}`))
    }, options.timeoutMs)

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      resolve({
        command,
        exitCode: code ?? 1,
        stdout,
        stderr
      })
    })
  })
}

function resolveShellInvocation(shellPath: string | null | undefined, command: string): {
  command: string
  args: string[]
} {
  const shellFamily = classifyShellFamily(shellPath)
  if (shellPath && shellFamily === 'powershell') {
    return {
      command: shellPath,
      args: ['-NoLogo', '-NoProfile', '-Command', command]
    }
  }

  if (shellPath && shellFamily === 'posix') {
    return {
      command: shellPath,
      args: ['-lc', command]
    }
  }

  if (process.platform === 'win32') {
    return {
      command: shellPath?.trim() || 'cmd.exe',
      args: ['/d', '/s', '/c', command]
    }
  }

  return {
    command: shellPath?.trim() || 'bash',
    args: ['-lc', command]
  }
}

function classifyShellFamily(shellPath?: string | null): 'powershell' | 'posix' | 'unknown' {
  if (!shellPath) {
    return 'unknown'
  }

  const normalized = shellPath.replaceAll('\\', '/').toLowerCase()
  if (normalized.includes('powershell') || normalized.endsWith('/pwsh') || normalized.endsWith('/pwsh.exe')) {
    return 'powershell'
  }

  if (
    normalized.endsWith('/bash')
    || normalized.endsWith('/bash.exe')
    || normalized.endsWith('/zsh')
    || normalized.endsWith('/zsh.exe')
    || normalized.endsWith('/sh')
    || normalized.endsWith('/sh.exe')
    || normalized.endsWith('/fish')
    || normalized.endsWith('/fish.exe')
  ) {
    return 'posix'
  }

  return 'unknown'
}
