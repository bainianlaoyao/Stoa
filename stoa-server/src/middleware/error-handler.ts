/**
 * Global error handler middleware for Hono.
 * Converts AppError instances into structured ApiResponse envelopes.
 * Unknown errors are wrapped as 500 internal_error.
 */
import type { ErrorHandler } from 'hono';
import { nanoid } from 'nanoid';
import type { ApiResponse } from '../shared/errors';
import { AppError } from '../shared/errors';
import { RuntimeBridgeError } from '../ws/runtime-bridge-handler';

export function createErrorHandler(): ErrorHandler {
  return (err, c) => {
    const requestId = nanoid();
    const timestamp = new Date().toISOString();

    if (err instanceof AppError) {
      const body: ApiResponse = {
        ok: false,
        error: {
          code: err.code,
          message: err.message,
          details: Object.keys(err.details).length > 0 ? err.details : undefined,
          nextSteps: err.nextSteps,
        },
        meta: { requestId, timestamp },
      };
      return c.json(body, err.statusCode as 400);
    }

    if (err instanceof RuntimeBridgeError) {
      const body: ApiResponse = {
        ok: false,
        error: {
          code: 'runtime_unavailable',
          message: err.message,
          details: {
            reason: err.code,
            command: err.command,
            sessionId: err.sessionId,
          },
        },
        meta: { requestId, timestamp },
      };
      return c.json(body, 503);
    }

    // Unknown error — treat as internal server error
    const body: ApiResponse = {
      ok: false,
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred',
      },
      meta: { requestId, timestamp },
    };
    return c.json(body, 500);
  };
}
