import { delimiter } from 'node:path'

interface BuildSessionCommandEnvOptions {
  sessionId: string
  sessionToken: string
  webhookPort: number
  stoaCtlBinDir: string
  stoaCtlEnabled: boolean
  basePath?: string | null
}

export function buildSessionCommandEnv(options: BuildSessionCommandEnvOptions): Record<string, string> {
  const base: Record<string, string> = {
    STOA_SESSION_ID: options.sessionId,
    STOA_CTL_BASE_URL: `http://127.0.0.1:${options.webhookPort}`
  }

  if (options.stoaCtlEnabled) {
    base.STOA_CTL_SESSION_TOKEN = options.sessionToken
    base.STOA_CTL_COMMAND = 'stoa-ctl'
    const pathParts = [
      options.stoaCtlBinDir,
      options.basePath ?? process.env.PATH ?? process.env.Path ?? ''
    ].filter((value) => value.length > 0)
    base.PATH = pathParts.join(delimiter)
  } else {
    base.PATH = options.basePath ?? process.env.PATH ?? process.env.Path ?? ''
  }

  return base
}
