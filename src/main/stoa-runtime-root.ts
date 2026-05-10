import { posix } from 'node:path'

interface RuntimeRootInput {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
}

function normalizeSeparators(value: string): string {
  return value.replaceAll('\\', '/')
}

function requireEnvValue(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }

  return value
}

export function resolveStoaRuntimeRoot(input: RuntimeRootInput): string {
  switch (input.platform) {
    case 'win32':
      return normalizeSeparators(posix.join(
        normalizeSeparators(requireEnvValue(input.env, 'LOCALAPPDATA')),
        'Stoa',
        'runtime'
      ))
    case 'darwin':
      return normalizeSeparators(posix.join(
        normalizeSeparators(requireEnvValue(input.env, 'HOME')),
        'Library',
        'Application Support',
        'Stoa',
        'runtime'
      ))
    default: {
      const xdgStateHome = input.env.XDG_STATE_HOME?.trim()
      const stateRoot = xdgStateHome && xdgStateHome.length > 0
        ? normalizeSeparators(xdgStateHome)
        : normalizeSeparators(posix.join(requireEnvValue(input.env, 'HOME'), '.local', 'state'))

      return normalizeSeparators(posix.join(stateRoot, 'stoa', 'runtime'))
    }
  }
}

export function resolveDefaultStoaRuntimeRoot(): string {
  return resolveStoaRuntimeRoot({
    platform: process.platform,
    env: process.env
  })
}
