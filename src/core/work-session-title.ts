import type { ProjectSummary, SessionSummary, SessionType } from '@shared/project-session'
import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'

export function resolveDefaultWorkSessionTitle(input: {
  project: Pick<ProjectSummary, 'id' | 'name'>
  sessions: SessionSummary[]
  projectId: string
  type: SessionType
}): string {
  if (input.type === 'shell') {
    const shellCount = input.sessions.filter((session) =>
      session.projectId === input.projectId && session.type === 'shell' && !session.archived
    ).length
    return `shell-${shellCount + 1}`
  }

  const descriptor = getProviderDescriptorBySessionType(input.type)
  return `${descriptor.titlePrefix}-${input.project.name}`
}
