import type { SessionNodeSnapshot, SessionSummary, SessionType } from '@shared/project-session'
import type { SessionVisibilityReader } from './session-visibility-service'

export type CallerIdentity =
  | { type: 'local-user' }
  | { type: 'session'; sessionId: string }

export interface SessionInputLike {
  send(sessionId: string, data: string): Promise<void>
}

export interface CreateChildSessionRequest {
  parentId: string
  projectId: string
  type: SessionType
  title: string
}

export interface SessionSupervisorDeps {
  getSnapshot(): SessionNodeSnapshot[]
  visibilityService: SessionVisibilityReader
  sessionInput: SessionInputLike
  createChildSession(request: CreateChildSessionRequest): Promise<SessionSummary>
  destroySession(sessionId: string): Promise<void>
}

export class SessionControlError extends Error {
  constructor(
    readonly code: 'unknown_session' | 'forbidden_authority_scope',
    message: string
  ) {
    super(message)
    this.name = 'SessionControlError'
  }
}

export class SessionSupervisor {
  constructor(private readonly deps: SessionSupervisorDeps) {}

  listSessions(caller: CallerIdentity): SessionNodeSnapshot[] {
    const all = this.deps.getSnapshot()
    if (caller.type === 'local-user') {
      return all
    }
    const visibleIds = this.deps.visibilityService.visibleSessionIds(caller.sessionId)
    return all.filter((n) => visibleIds.includes(n.session.id))
  }

  inspectSession(caller: CallerIdentity, targetId: string): SessionNodeSnapshot | null {
    const all = this.deps.getSnapshot()
    const target = all.find((n) => n.session.id === targetId)
    if (!target) {
      return null
    }
    if (caller.type === 'local-user') {
      return target
    }
    const visibleIds = this.deps.visibilityService.visibleSessionIds(caller.sessionId)
    if (!visibleIds.includes(targetId)) {
      return null
    }
    return target
  }

  async promptSession(caller: CallerIdentity, targetId: string, text: string): Promise<{ kind: 'dispatched' }> {
    this.requireKnownSession(targetId)
    if (caller.type === 'session') {
      this.assertAuthority(caller.sessionId, targetId, 'prompt')
    }
    await this.deps.sessionInput.send(targetId, `${text}\r`)
    return { kind: 'dispatched' }
  }

  async createChildSession(caller: CallerIdentity, request: CreateChildSessionRequest): Promise<SessionSummary> {
    if (caller.type === 'session') {
      this.requireKnownSession(caller.sessionId)
      this.assertAuthority(caller.sessionId, caller.sessionId, 'create')
      return this.deps.createChildSession({
        ...request,
        parentId: caller.sessionId
      })
    }
    if (request.parentId) {
      this.requireKnownSession(request.parentId)
    }
    return this.deps.createChildSession(request)
  }

  async destroySession(caller: CallerIdentity, targetId: string): Promise<void> {
    this.requireKnownSession(targetId)
    if (caller.type === 'session') {
      this.assertAuthority(caller.sessionId, targetId, 'destroy')
    }
    return this.deps.destroySession(targetId)
  }

  private assertAuthority(viewerId: string, targetId: string, action: 'inspect' | 'prompt' | 'create' | 'destroy'): void {
    const result = this.deps.visibilityService.checkAuthority(viewerId, targetId, action)
    if (!result.allowed) {
      throw new SessionControlError(
        this.normalizeDeniedReason(result.reason),
        result.reason ?? 'forbidden_authority_scope'
      )
    }
  }

  private requireKnownSession(sessionId: string): SessionNodeSnapshot {
    const session = this.deps.getSnapshot().find((node) => node.session.id === sessionId)
    if (!session) {
      throw new SessionControlError('unknown_session', 'unknown_session')
    }
    return session
  }

  private normalizeDeniedReason(reason: string | undefined): 'unknown_session' | 'forbidden_authority_scope' {
    if (reason === 'unknown_session') {
      return 'unknown_session'
    }
    return 'forbidden_authority_scope'
  }
}
