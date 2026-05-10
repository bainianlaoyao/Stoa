import { delimiter } from 'node:path'

interface BuildHermesCommandEnvOptions {
  sessionId: string
  sessionSecret: string
  webhookPort: number
  stoaCtlBinDir: string
  basePath?: string | null
}

export function buildHermesCommandEnv(options: BuildHermesCommandEnvOptions): Record<string, string> {
  const pathParts = [
    options.stoaCtlBinDir,
    options.basePath ?? process.env.PATH ?? process.env.Path ?? ''
  ].filter((value) => value.length > 0)

  return {
    STOA_HERMES: '1',
    STOA_HERMES_SESSION_ID: options.sessionId,
    STOA_SESSION_ID: options.sessionId,
    STOA_CTL_BASE_URL: `http://127.0.0.1:${options.webhookPort}`,
    STOA_CTL_TOKEN: options.sessionSecret,
    STOA_CTL_COMMAND: 'stoa-ctl',
    PATH: pathParts.join(delimiter)
  }
}
