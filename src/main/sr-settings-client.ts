import { DEFAULT_SETTINGS, type AppSettings } from '@shared/project-session'

interface ApiEnvelope<T> {
  ok: boolean
  data: T
}

type FetchLike = typeof fetch

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readSettings(value: unknown): AppSettings | null {
  if (!isRecord(value)) {
    return null
  }

  return {
    ...DEFAULT_SETTINGS,
    ...value,
    terminal: isRecord(value.terminal) ? { ...value.terminal } : DEFAULT_SETTINGS.terminal,
    providers: isRecord(value.providers)
      ? Object.fromEntries(
        Object.entries(value.providers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      )
      : DEFAULT_SETTINGS.providers,
    titleGeneration: isRecord(value.titleGeneration)
      ? { ...DEFAULT_SETTINGS.titleGeneration, ...value.titleGeneration }
      : DEFAULT_SETTINGS.titleGeneration,
    workspaceIde: isRecord(value.workspaceIde)
      ? { ...DEFAULT_SETTINGS.workspaceIde, ...value.workspaceIde }
      : DEFAULT_SETTINGS.workspaceIde,
    claudeDangerouslySkipPermissions: value.claudeDangerouslySkipPermissions === true,
    stoaCtlEnabled: value.stoaCtlEnabled === true,
    locale: typeof value.locale === 'string' ? value.locale : DEFAULT_SETTINGS.locale,
    theme: value.theme === 'light' || value.theme === 'dark' || value.theme === 'system'
      ? value.theme
      : DEFAULT_SETTINGS.theme
  }
}

export async function fetchStoaServerSettings(input: {
  port: number
  authToken: string
  fetchImpl?: FetchLike
}): Promise<AppSettings | null> {
  const fetchFn = input.fetchImpl ?? fetch
  const response = await fetchFn(`http://127.0.0.1:${input.port}/api/v1/settings`, {
    headers: {
      Authorization: `Bearer ${input.authToken}`
    }
  })

  if (!response.ok) {
    return null
  }

  const body = await response.json().catch(() => null) as ApiEnvelope<unknown> | null
  return readSettings(body?.data)
}
