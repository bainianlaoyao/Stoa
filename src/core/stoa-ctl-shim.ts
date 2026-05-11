import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

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

function resolveDevelopmentAppRoot(appRootPath: string): string {
  const normalized = appRootPath.replaceAll('\\', '/')
  return normalized.endsWith('/out/main')
    ? resolve(appRootPath, '..', '..')
    : appRootPath
}

function quoteCmdArg(value: string): string {
  if (!/[\s"]/u.test(value)) {
    return value
  }

  return `"${value.replaceAll('"', '""')}"`
}

function toPosixPath(value: string): string {
  return value.replaceAll('\\', '/')
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

  const devAppRootPath = resolveDevelopmentAppRoot(options.appRootPath)

  return {
    executablePath: options.appExecutablePath,
    args: [
      join(devAppRootPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      '--tsconfig',
      join(devAppRootPath, 'tsconfig.node.json'),
      join(devAppRootPath, 'tools', 'stoa-ctl', 'index.ts')
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

function renderPosixShim(plan: StoaCtlInvocationPlan): string {
  const envLines = Object.entries(plan.env)
    .map(([key, value]) => `export ${key}=${JSON.stringify(value)}`)
    .join('\n')
  const args = plan.args.map((value) => JSON.stringify(toPosixPath(value))).join(' ')

  return [
    '#!/usr/bin/env bash',
    envLines,
    `exec ${JSON.stringify(toPosixPath(plan.executablePath))} ${args} "$@"`
  ].join('\n')
}

export async function ensureStoaCtlShim(options: EnsureStoaCtlShimOptions): Promise<StoaCtlShim> {
  const plan = resolveStoaCtlInvocationPlan(options)
  const platform = options.platform ?? process.platform
  const commandPath = platform === 'win32'
    ? join(options.binDir, 'stoa-ctl.cmd')
    : join(options.binDir, 'stoa-ctl')

  await mkdir(options.binDir, { recursive: true })

  if (platform === 'win32') {
    await Promise.all([
      writeFile(commandPath, renderWindowsShim(plan), 'utf8'),
      writeFile(join(options.binDir, 'stoa-ctl'), renderPosixShim(plan), 'utf8')
    ])
  } else {
    await writeFile(commandPath, `${renderPosixShim(plan)}\n`, 'utf8')
  }

  return {
    commandPath,
    binDir: options.binDir
  }
}
