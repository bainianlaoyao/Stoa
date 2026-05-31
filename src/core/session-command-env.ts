import { delimiter } from 'node:path'

interface BuildSessionCommandEnvOptions {
  sessionId: string
  sessionToken: string
  webhookPort: number
  stoaCtlBinDir: string
  basePath?: string | null
}

export function buildSessionCommandEnv(options: BuildSessionCommandEnvOptions): Record<string, string> {
  const pathParts = [
    options.stoaCtlBinDir,
    options.basePath ?? process.env.PATH ?? process.env.Path ?? ''
  ].filter((value) => value.length > 0)

  return {
    STOA_SESSION_ID: options.sessionId,
    STOA_CTL_SESSION_TOKEN: options.sessionToken,
    STOA_CTL_BASE_URL: `http://127.0.0.1:${options.webhookPort}`,
    STOA_CTL_COMMAND: 'stoa-ctl',
    PATH: pathParts.join(delimiter)
  }
}
