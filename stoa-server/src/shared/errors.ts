/**
 * Unified error types and API response envelope for Stoa Server.
 * See plan section 5.2 (ApiResponse) and 5.3 (Error Code Registry).
 */

/** Error code → HTTP status code mapping from the plan section 5.3. */
export const ERROR_CODES = {
  // General
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation_error: 422,
  internal_error: 500,

  // Session
  session_not_found: 404,
  session_already_exists: 409,
  session_not_alive: 409,
  no_completion_yet: 409,
  wait_timeout: 408,

  // Subagent
  subagent_not_found: 404,
  subagent_stale: 409,
  subagent_not_approved: 409,
  invalid_epoch: 409,

  // Meta-session
  meta_session_not_found: 404,
  proposal_not_found: 404,
  proposal_stale: 409,
  unknown_preset: 422,

  // File system
  path_traversal: 403,
  file_too_large: 413,
  search_timeout: 408,
  entry_not_found: 404,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * Structured application error that maps to a standard API error response.
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: Record<string, unknown>;
  readonly nextSteps: string[] | null;

  constructor(opts: {
    code: ErrorCode | string;
    message: string;
    statusCode?: number;
    details?: Record<string, unknown>;
    nextSteps?: string[] | null;
  }) {
    super(opts.message);
    this.name = 'AppError';
    this.code = opts.code;
    this.statusCode =
      opts.statusCode ??
      (ERROR_CODES[opts.code as ErrorCode] ?? 500);
    this.details = opts.details ?? {};
    this.nextSteps = opts.nextSteps ?? null;
  }
}

/**
 * Standard API response envelope from plan section 5.2.
 */
export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    nextSteps?: string[] | null;
  };
  meta: {
    requestId: string;
    timestamp: string;
    pagination?: {
      cursor: string | null;
      hasMore: boolean;
      totalCount?: number;
    };
  };
}
