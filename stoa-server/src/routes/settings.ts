/**
 * Settings route group — plan section 5.6.
 *
 * Mounts at `/api/v1`. Endpoints:
 *   GET  /settings                          — get all settings
 *   PUT  /settings/:key                     — update a setting
 *   POST /settings/detect/shell             — detect shell (stub)
 *   POST /settings/detect/provider          — detect provider (stub)
 *   POST /settings/detect/vscode            — detect VS Code (stub)
 *   GET  /settings/title-generation/models  — title gen models (stub)
 */
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppSettings } from 'stoa-shared';
import { AppError, type ApiResponse } from '../shared/errors';
import { ProjectSessionManager } from '../services/project-session-manager';

export interface SettingsRouteDeps {
  manager: ProjectSessionManager;
}

const KNOWN_SETTINGS_KEYS: readonly (keyof AppSettings)[] = [
  'shellPath',
  'terminal',
  'providers',
  'evolverInferenceProvider',
  'evolverExecutionMode',
  'titleGeneration',
  'workspaceIde',
  'claudeDangerouslySkipPermissions',
  'stoaCtlEnabled',
  'locale',
  'theme',
];

function envelope<T>(data: T, pagination?: ApiResponse['meta']['pagination']): ApiResponse<T> {
  return {
    ok: true,
    data,
    meta: {
      requestId: nanoid(),
      timestamp: new Date().toISOString(),
      pagination,
    },
  };
}

export function createSettingsRoutes(deps: SettingsRouteDeps): Hono {
  const routes = new Hono();
  const { manager } = deps;

  routes.get('/settings', (c) => {
    const settings = manager.getSettings();
    return c.json(envelope(settings));
  });

  routes.put('/settings/:key', async (c) => {
    const key = c.req.param('key');
    if (!(KNOWN_SETTINGS_KEYS as readonly string[]).includes(key)) {
      throw new AppError({
        code: 'validation_error',
        message: `Unknown setting key: ${key}`,
        statusCode: 422,
        details: { key, validKeys: KNOWN_SETTINGS_KEYS },
      });
    }
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || body.value === undefined) {
      throw new AppError({
        code: 'validation_error',
        message: 'Request body must include a "value" field',
        statusCode: 422,
        details: { key },
      });
    }
    await manager.setSetting(key, body.value);
    return c.json(envelope({ key, updated: true }));
  });

  // Detection endpoints — these require Electron-native APIs and are
  // unavailable in standalone Stoa Server. Return 503 until Phase 3
  // when runtime bridge can proxy them.

  routes.post('/settings/detect/shell', () => {
    throw new AppError({
      code: 'internal_error',
      message: 'Shell detection requires the Electron runtime',
      statusCode: 503,
      nextSteps: ['Use the Electron client for shell detection'],
    });
  });

  routes.post('/settings/detect/provider', () => {
    throw new AppError({
      code: 'internal_error',
      message: 'Provider detection requires the Electron runtime',
      statusCode: 503,
      nextSteps: ['Use the Electron client for provider detection'],
    });
  });

  routes.post('/settings/detect/vscode', () => {
    throw new AppError({
      code: 'internal_error',
      message: 'VS Code detection requires the Electron runtime',
      statusCode: 503,
      nextSteps: ['Use the Electron client for VS Code detection'],
    });
  });

  routes.get('/settings/title-generation/models', (c) => {
    // Title generation model listing requires an external API call.
    // Return empty list as stub until wired.
    return c.json(envelope([]));
  });

  return routes;
}