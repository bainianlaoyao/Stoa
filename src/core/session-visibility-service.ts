import type { SessionNodeSnapshot } from '@shared/project-session'

export type AuthorityAction = 'inspect' | 'prompt' | 'create' | 'destroy'

export interface AuthorityResult {
  allowed: boolean
  reason?: string
}

export interface SessionVisibilityReader {
  visibleSessionIds(sessionId: string): string[]
  isVisible(viewerId: string, targetId: string): boolean
  checkAuthority(viewerId: string, targetId: string, action: AuthorityAction): AuthorityResult
}

export class SessionVisibilityService implements SessionVisibilityReader {
  private readonly nodes: SessionNodeSnapshot[]
  private readonly byId: Map<string, SessionNodeSnapshot>

  constructor(nodes: SessionNodeSnapshot[]) {
    this.nodes = nodes
    this.byId = new Map(nodes.map((n) => [n.session.id, n]))
  }

  visibleSessionIds(sessionId: string): string[] {
    const node = this.byId.get(sessionId)
    if (!node) {
      return []
    }

    const targetDepth = node.tree.depth
    const rootSessionId = node.tree.rootSessionId
    const visible: string[] = []

    for (const candidate of this.nodes) {
      if (candidate.tree.rootSessionId !== rootSessionId) {
        continue
      }
      if (candidate.tree.depth === targetDepth || candidate.tree.depth > targetDepth) {
        if (candidate.tree.depth === targetDepth || this.isDescendantOf(candidate, sessionId)) {
          visible.push(candidate.session.id)
        }
      }
    }

    return visible
  }

  isVisible(viewerId: string, targetId: string): boolean {
    const visible = this.visibleSessionIds(viewerId)
    return visible.includes(targetId)
  }

  checkAuthority(viewerId: string, targetId: string, action: AuthorityAction): AuthorityResult {
    const targetNode = this.byId.get(targetId)
    if (!targetNode) {
      return { allowed: false, reason: 'unknown_session' }
    }

    const viewerNode = this.byId.get(viewerId)
    if (!viewerNode) {
      return { allowed: false, reason: 'unknown_session' }
    }

    const visible = this.visibleSessionIds(viewerId)
    if (!visible.includes(targetId)) {
      return { allowed: false, reason: 'unknown_session' }
    }

    if (action === 'inspect' || action === 'prompt') {
      return { allowed: true }
    }

    if (action === 'create') {
      if (targetId === viewerId) {
        return { allowed: true }
      }

      return { allowed: false, reason: 'forbidden_authority_scope' }
    }

    if (targetId === viewerId) {
      return { allowed: true }
    }

    if (this.isDescendantOf(targetNode, viewerId)) {
      return { allowed: true }
    }

    return { allowed: false, reason: 'forbidden_authority_scope' }
  }

  private isDescendantOf(candidate: SessionNodeSnapshot, ancestorId: string): boolean {
    let cursorId: string | null = candidate.session.parentSessionId
    while (cursorId) {
      if (cursorId === ancestorId) {
        return true
      }
      const parent = this.byId.get(cursorId)
      if (!parent) {
        break
      }
      cursorId = parent.session.parentSessionId
    }
    return false
  }
}
