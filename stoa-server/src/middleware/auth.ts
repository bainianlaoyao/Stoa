/**
 * Auth middleware for Stoa Server.
 *
 * Supports two authentication modes (plan section 9.2):
 * 1. Bearer token via Authorization header — full access
 * 2. Session-scoped via x-stoa-session-id + x-stoa-session-token — visibility-restricted
 *
 * The discovery endpoint (/api/v1/discovery) is unauthenticated (plan section 9.4).
 */
import type { MiddlewareHandler } from 'hono';
import { AppError } from '../shared/errors';

/**
 * Create an auth middleware that validates requests against the provided token.
 *
 * @param token - The server auth token to validate against.
 *                Defaults to STOA_AUTH_TOKEN env var or 'stoa-dev-token' for Phase 1.
 */
export function createAuthMiddleware(
  token: string = process.env.STOA_AUTH_TOKEN ?? 'stoa-dev-token',
): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path

    // Skip auth for public routes and the web SPA shell/assets.
    if (
      path === '/api/v1/discovery'
      || path === '/api/v1/discovery/'
      || path === '/events'
      || path === '/memory-notifications'
      || path.startsWith('/hooks/')
      || path === '/'
      || path.startsWith('/assets/')
    ) {
      return next();
    }

    // Mode 1: Bearer token
    const authorization = c.req.header('Authorization');
    if (authorization) {
      const match = /^Bearer\s+(.+)$/i.exec(authorization);
      if (match && match[1] === token) {
        return next();
      }
    }

    // Mode 2: Session-scoped access via session id + token pair
    const sessionId = c.req.header('x-stoa-session-id');
    const sessionToken = c.req.header('x-stoa-session-token');
    if (sessionId && sessionToken) {
      // Phase 1: accept any non-empty pair — real session token validation
      // will be wired in Phase 2 when session_tokens table exists.
      if (sessionId.length > 0 && sessionToken.length > 0) {
        return next();
      }
    }

    throw new AppError({
      code: 'unauthorized',
      message: 'Authentication required. Provide Authorization: Bearer <token> or x-stoa-session-id + x-stoa-session-token headers.',
      statusCode: 401,
    });
  };
}
