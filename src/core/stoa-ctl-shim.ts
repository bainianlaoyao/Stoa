import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface StoaCtlInvocationPlan {
  executablePath: string
  args: string[]
  env: Record<string, string>
}

interface ResolveStoaCtlInvocationPlanOptions {
  appRootPath: string
  appExecutablePath: string
  isPackaged: boolean
}

interface EnsureStoaCtlShimOptions extends ResolveStoaCtlInvocationPlanOptions {
  binDir: string
  platform?: NodeJS.Platform
}

export interface StoaCtlShim {
  commandPath: string
  binDir: string
}

function quoteCmdArg(value: string): string {
  if (!/[\s"]/u.test(value)) {
    return value
  }

  return `"${value.replaceAll('"', '""')}"`
}

export function resolveStoaCtlInvocationPlan(options: ResolveStoaCtlInvocationPlanOptions): StoaCtlInvocationPlan {
  if (options.isPackaged) {
    return {
      executablePath: options.appExecutablePath,
      args: [
        join(dirname(options.appRootPath), 'app.asar.unpacked', 'out', 'tools', 'stoa-ctl', 'index.mjs')
      ],
      env: {
        ELECTRON_RUN_AS_NODE: '1'
      }
    }
  }

  return {
    executablePath: options.appExecutablePath,
    args: [
      join(options.appRootPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      '--tsconfig',
      join(options.appRootPath, 'tsconfig.node.json'),
      join(options.appRootPath, 'tools', 'stoa-ctl', 'index.ts')
    ],
    env: {
      ELECTRON_RUN_AS_NODE: '1'
    }
  }
}

function renderWindowsShim(plan: StoaCtlInvocationPlan): string {
  const executable = quoteCmdArg(plan.executablePath)
  const args = plan.args.map(quoteCmdArg).join(' ')
  const envLines = Object.entries(plan.env)
    .map(([key, value]) => `set "${key}=${value}"`)
    .join('\r\n')

  return [
    '@echo off',
    'setlocal',
    envLines,
    `${executable} ${args} %*`,
    'endlocal'
  ].join('\r\n')
}

export async function ensureStoaCtlShim(options: EnsureStoaCtlShimOptions): Promise<StoaCtlShim> {
  const plan = resolveStoaCtlInvocationPlan(options)
  const platform = options.platform ?? process.platform
  const commandPath = platform === 'win32'
    ? join(options.binDir, 'stoa-ctl.cmd')
    : join(options.binDir, 'stoa-ctl')

  await mkdir(options.binDir, { recursive: true })

  if (platform === 'win32') {
    await writeFile(commandPath, renderWindowsShim(plan), 'utf8')
  } else {
    const envLines = Object.entries(plan.env)
      .map(([key, value]) => `${key}=${JSON.stringify(value)} \\`)
      .join('\n')
    const args = plan.args.map((value) => JSON.stringify(value)).join(' ')
    await writeFile(
      commandPath,
      `#!/usr/bin/env bash\n${envLines}\n${JSON.stringify(plan.executablePath)} ${args} "$@"\n`,
      'utf8'
    )
  }

  return {
    commandPath,
    binDir: options.binDir
  }
}
