import type { SessionNodeSnapshot } from '@shared/project-session'

export type AuthorityAction = 'inspect' | 'status' | 'report' | 'prompt' | 'create' | 'destroy' | 'wait' | 'read-output'

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
  private readonly nodeSource: SessionNodeSnapshot[] | (() => SessionNodeSnapshot[])

  constructor(nodeSource: SessionNodeSnapshot[] | (() => SessionNodeSnapshot[])) {
    this.nodeSource = nodeSource
  }

  visibleSessionIds(sessionId: string): string[] {
    const { nodes, byId } = this.readState()
    const node = byId.get(sessionId)
    if (!node) {
      return []
    }

    const targetDepth = node.tree.depth
    const rootSessionId = node.tree.rootSessionId
    const visible: string[] = []

    for (const candidate of nodes) {
      if (candidate.tree.rootSessionId !== rootSessionId) {
        continue
      }
      if (candidate.tree.depth === targetDepth || candidate.tree.depth > targetDepth) {
        if (candidate.tree.depth === targetDepth || this.isDescendantOf(candidate, sessionId, byId)) {
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
    const { byId } = this.readState()
    const targetNode = byId.get(targetId)
    if (!targetNode) {
      return { allowed: false, reason: 'unknown_session' }
    }

    const viewerNode = byId.get(viewerId)
    if (!viewerNode) {
      return { allowed: false, reason: 'unknown_session' }
    }

    const visible = this.visibleSessionIds(viewerId)
    if (!visible.includes(targetId)) {
      return { allowed: false, reason: 'unknown_session' }
    }

    if (
      action === 'inspect'
      || action === 'status'
      || action === 'report'
      || action === 'prompt'
      || action === 'wait'
      || action === 'read-output'
    ) {
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

    if (this.isDescendantOf(targetNode, viewerId, byId)) {
      return { allowed: true }
    }

    return { allowed: false, reason: 'forbidden_authority_scope' }
  }

  private readState(): { nodes: SessionNodeSnapshot[]; byId: Map<string, SessionNodeSnapshot> } {
    const nodes = typeof this.nodeSource === 'function'
      ? this.nodeSource()
      : this.nodeSource

    return {
      nodes,
      byId: new Map(nodes.map((node) => [node.session.id, node]))
    }
  }

  private isDescendantOf(
    candidate: SessionNodeSnapshot,
    ancestorId: string,
    byId: Map<string, SessionNodeSnapshot>
  ): boolean {
    let cursorId: string | null = candidate.session.parentSessionId
    while (cursorId) {
      if (cursorId === ancestorId) {
        return true
      }
      const parent = byId.get(cursorId)
      if (!parent) {
        break
      }
      cursorId = parent.session.parentSessionId
    }
    return false
  }
}
