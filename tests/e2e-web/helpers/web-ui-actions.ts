import { mkdir } from 'node:fs/promises'
import type { ProjectSummary, SessionSummary, SessionType } from '@shared/project-session'

interface ApiResponse<T> {
  ok: boolean
  data?: T
  error?: {
    code?: string
    message?: string
  }
}

interface RequestOptions {
  baseUrl: string
  token: string
}

async function requestJson<T>(
  options: RequestOptions,
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${options.baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null
  if (!response.ok || !payload?.ok || payload.data === undefined) {
    const message = payload?.error?.message ?? `Request failed with status ${response.status}`
    throw new Error(message)
  }

  return payload.data
}

export async function createProjectViaApi(
  options: RequestOptions,
  request: {
    name: string
    path: string
    defaultSessionType?: SessionType
  }
): Promise<ProjectSummary> {
  await mkdir(request.path, { recursive: true })
  return await requestJson<ProjectSummary>(options, '/api/v1/projects', request)
}

export async function createSessionViaApi(
  options: RequestOptions,
  request: {
    projectId: string
    type: SessionType
    title?: string
  }
): Promise<SessionSummary> {
  return await requestJson<SessionSummary>(options, '/api/v1/sessions', {
    projectId: request.projectId,
    type: request.type,
    title: request.title ?? '',
  })
}
