/**
 * Shared constants for Stoa Server.
 * See plan section 5.5 (rate limiting) and section 2 (stack).
 */

export const SERVER_NAME = 'stoa';
export const SERVER_VERSION = '0.1.0';
export const DEFAULT_PORT = 3270;

/**
 * Rate limit configuration per route group from plan section 5.5.
 * Keyed by path pattern; 'default' applies to unmatched routes.
 */
export const RATE_LIMIT_CONFIG = {
  '/api/v1/fs/*': { windowMs: 60000, max: 100 },
  '/api/v1/git/*': { windowMs: 60000, max: 60 },
  '/hooks/*': { windowMs: 60000, max: 200 },
  '/api/v1/sessions': { windowMs: 60000, max: 30 },
  default: { windowMs: 60000, max: 300 },
} as const;
