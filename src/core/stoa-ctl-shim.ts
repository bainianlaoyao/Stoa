import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'

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

export async function ensureStoaCtlSystemShim(options: ResolveStoaCtlInvocationPlanOptions): Promise<void> {
  const binDir = join(homedir(), '.stoa', 'bin')
  await ensureStoaCtlShim({ ...options, binDir })
  await registerPath(binDir)
}

function registerPath(binDir: string): Promise<void> {
  const platform = process.platform
  if (platform === 'win32') {
    return registerWindowsPath(binDir)
  }
  return registerPosixPath(binDir)
}

function registerWindowsPath(binDir: string): Promise<void> {
  return new Promise((resolve) => {
    const script = `
$binDir = '${binDir.replace(/'/g, "''")}'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$binDir*") {
  $newPath = if ($userPath.EndsWith(';')) { $userPath + $binDir } else { $userPath + ';' + $binDir }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
}
`.trim()
    execFile('powershell.exe', ['-NoProfile', '-Command', script], (error) => {
      if (error) {
        console.warn('Failed to register stoa-ctl in user PATH:', error.message)
      }
      resolve()
    })
  })
}

function registerPosixPath(binDir: string): Promise<void> {
  return new Promise((resolve) => {
    const line = `\nexport PATH="$HOME/.stoa/bin:$PATH" # stoa-ctl`
    const checked = new Set<string>()
    for (const rcFile of ['.bashrc', '.zshrc', '.profile']) {
      const rcPath = join(homedir(), rcFile)
      import('node:fs').then(({ readFileSync, appendFileSync, existsSync }) => {
        if (existsSync(rcPath) && !checked.has(rcFile)) {
          checked.add(rcFile)
          const content = readFileSync(rcPath, 'utf8')
          if (!content.includes('.stoa/bin')) {
            appendFileSync(rcPath, line, 'utf8')
          }
        }
        resolve()
      }).catch(resolve)
    }
    resolve()
  })
}
