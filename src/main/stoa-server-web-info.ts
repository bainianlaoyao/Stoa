import { buildStoaWebLaunchUrl } from '@shared/stoa-web-launch-url'

const DISCOVERY_TIMEOUT_MS = 2_000

export interface StoaServerInfo {
  available: boolean
  port: number
  url: string
  token: string
}

export interface StoaServerInfoSource {
  getPort(): number
  getAuthToken(): string
}

interface DiscoveryResponse {
  ok?: boolean
  data?: {
    webClient?: boolean
  }
}

function unavailableServerInfo(): StoaServerInfo {
  return {
    available: false,
    port: 0,
    url: '',
    token: ''
  }
}

export async function getStoaServerWebInfo(
  source: StoaServerInfoSource | null
): Promise<StoaServerInfo> {
  if (!source) {
    return unavailableServerInfo()
  }

  const port = source.getPort()
  const token = source.getAuthToken()

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/discovery`, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
    })
    if (!response.ok) {
      return unavailableServerInfo()
    }

    const body = await response.json() as DiscoveryResponse
    if (body.ok !== true || body.data?.webClient !== true) {
      return unavailableServerInfo()
    }

    return {
      available: true,
      port,
      url: buildStoaWebLaunchUrl(`http://127.0.0.1:${port}`, token),
      token
    }
  } catch {
    return unavailableServerInfo()
  }
}
