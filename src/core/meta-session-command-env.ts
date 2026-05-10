import { delimiter } from 'node:path'

interface BuildMetaSessionCommandEnvOptions {
  sessionId: string
  sessionSecret: string
  webhookPort: number
  stoaCtlBinDir: string
  basePath?: string | null
}

export function buildMetaSessionCommandEnv(options: BuildMetaSessionCommandEnvOptions): Record<string, string> {
  const pathParts = [
    options.stoaCtlBinDir,
    options.basePath ?? process.env.PATH ?? process.env.Path ?? ''
  ].filter((value) => value.length > 0)

  return {
    STOA_META_SESSION: '1',
    STOA_META_SESSION_ID: options.sessionId,
    STOA_SESSION_ID: options.sessionId,
    STOA_CTL_BASE_URL: `http://127.0.0.1:${options.webhookPort}`,
    STOA_CTL_TOKEN: options.sessionSecret,
    STOA_CTL_COMMAND: 'stoa-ctl',
    PATH: pathParts.join(delimiter)
  }
}
