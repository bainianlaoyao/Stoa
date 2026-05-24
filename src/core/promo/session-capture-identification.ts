export interface PromoDebugSessionIdentity {
  id: string
  title: string
}

export function resolveNewSessionDebugSnapshot(input: {
  beforeIds: Set<string>
  title: string
  sessions: PromoDebugSessionIdentity[]
}): PromoDebugSessionIdentity | null {
  const newlyIntroduced = input.sessions.find((session) => (
    session.title === input.title && !input.beforeIds.has(session.id)
  ))

  if (newlyIntroduced) {
    return newlyIntroduced
  }

  return input.sessions.find((session) => session.title === input.title) ?? null
}
