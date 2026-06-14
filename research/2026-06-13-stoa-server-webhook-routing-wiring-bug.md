---
date: 2026-06-13
topic: stoa-server webhook routing wiring bug
status: completed
mode: context-gathering
sources: 8
---

## Context Report: stoa-server Webhook Routing Wiring Bug

### Why This Was Gathered
The `createApp()` factory in `app.ts` never imports or mounts webhook routes, despite the comment at line 78 acknowledging `/hooks` as a first-class route path. This means all webhook endpoints (`/events`, `/hooks/claude-code`, `/hooks/codex`, `/hooks/opencode`, `/memory-notifications`) are unreachable when the app is created through the canonical `createApp(deps, options)` path.

### Summary
`createApp()` in `app.ts` mounts 8 route groups but **omits webhook routes entirely**. The `webhooks.ts` module exports both `createWebhookRoutes(deps)` and a default `webhookRoutes` instance — neither is imported in `app.ts`. `AppDeps` has no `webhooks` field, so there is no type-level contract for injecting webhook dependencies. The fix requires: (1) adding a `WebhookRouteDeps` field to `AppDeps`, (2) importing and mounting `createWebhookRoutes` in `createApp`, (3) wiring real webhook deps in `index.ts`.

### Key Findings

1. **Missing import and mount** — `app.ts` imports from 8 route modules but never imports `webhooks.ts`. No line calls `createWebhookRoutes()` or mounts `webhookRoutes`.

2. **`AppDeps` has no webhook field** — The interface (`app.ts:31-39`) lists `projects`, `sessions`, `settings`, `observability`, `metaSessions`, `sidebar`, `fs` — no `webhooks`.

3. **Comment acknowledges `/hooks` should exist** — `app.ts:78` says: `"/api/v1, /ctl, /hooks"` should take priority over static serving, confirming the intent to mount hooks.

4. **`index.ts` does not wire webhook deps** — The deps object built at `index.ts:151-168` has no `webhooks` field, and no `WebhookRouteDeps`-typed callbacks (e.g. `onEvent`, `getSessionSecret`) are wired there.

5. **`WebhookRouteDeps` is well-defined** — `webhooks.ts:51-68` defines the interface with `onEvent`, `onMemoryNotification`, `getSessionSecret`, `authorizeHookRequest`. The factory `createWebhookRoutes(deps)` is production-ready.

6. **`SessionEventProcessor` exists but is not wired** — `session-event-processor.ts` processes `CanonicalSessionEvent`s and would be the natural `onEvent` handler, but it is not imported or instantiated in `index.ts`.

7. **No integration test covers webhook mounting through `createApp()`** — `webhook-routes.test.ts` tests routes in isolation by creating a standalone Hono app and mounting `createWebhookRoutes` directly. No test exercises webhook endpoints through the full `createApp()` path.

8. **Default exported `webhookRoutes` is dead code** — `webhooks.ts:457` exports `const webhookRoutes = createWebhookRoutes()` (no deps). This is imported nowhere.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| No webhook import in app.ts | `stoa-server/src/app.ts` | lines 9-29 (imports), lines 49-84 (createApp body) |
| AppDeps missing webhooks field | `stoa-server/src/app.ts` | lines 31-39 |
| Comment referencing /hooks | `stoa-server/src/app.ts` | line 78 |
| WebhookRouteDeps interface | `stoa-server/src/routes/webhooks.ts` | lines 51-68 |
| createWebhookRoutes factory | `stoa-server/src/routes/webhooks.ts` | lines 312-454 |
| Default webhookRoutes export (dead code) | `stoa-server/src/routes/webhooks.ts` | line 457 |
| index.ts deps object (no webhooks) | `stoa-server/src/index.ts` | lines 151-168 |
| SessionEventProcessor exists | `stoa-server/src/services/session-event-processor.ts` | lines 1-50+ |
| webhook-routes.test.ts tests in isolation | `stoa-server/src/routes/webhook-routes.test.ts` | entire file (444 lines) |
| No createApp-level webhook test | all `stoa-server/**/*.test.ts` files | verified via glob + grep |

### Required Fix (what a downstream agent needs to do)

1. **Add `webhooks` to `AppDeps`**: Add `webhooks: WebhookRouteDeps` to the interface in `app.ts:31-39`. Import `WebhookRouteDeps` from `./routes/webhooks`.

2. **Mount webhook routes in `createApp`**: Add `app.route('/', createWebhookRoutes(deps.webhooks))` before the static serving block (line 79). Import `createWebhookRoutes` from `./routes/webhooks`.

3. **Wire webhook deps in `index.ts`**: Build a `WebhookRouteDeps` object with:
   - `onEvent` → wire to `SessionEventProcessor` or inline handler
   - `getSessionSecret` → wire to `manager.getSessionSecret()` or equivalent
   - `authorizeHookRequest` → wire if hook auth logic exists
   - `onMemoryNotification` → wire to notification handler or no-op

4. **Add integration test**: Create a test that calls `createApp(deps, opts)` and verifies webhook endpoints (e.g. `POST /events`, `POST /hooks/claude-code`) are reachable.

5. **Remove dead `webhookRoutes` export** if the factory pattern (`createWebhookRoutes`) is the only intended usage.

### Risks / Unknowns

- [!] **`onEvent` wiring complexity** — `SessionEventProcessor` requires a `StoaDb` instance and `WsHubLike`. The `index.ts` entry point has both available (`db` and `wsHub`), but the processor needs to be instantiated and its `processEvent` method wired. This may require creating the processor instance before deps assembly.
- [!] **`getSessionSecret` source** — `ProjectSessionManager` has a `webhookPort` option (line 393) but it's not clear if it exposes a `getSessionSecret(sessionId)` method. The agent will need to verify.
- [?] **Auth middleware interaction** — The global auth middleware (`createAuthMiddleware`) at `app.ts:61` may intercept webhook requests. Webhook routes carry their own auth (`x-stoa-secret`, `x-stoa-session-id`). The auth middleware needs to either skip `/events` and `/hooks/*` paths, or webhook auth needs to coexist with it. The current auth middleware already skips `/api/v1/discovery` internally — webhook paths may need similar treatment.
- [?] **Route path prefix** — The webhook routes define paths like `/events` and `/hooks/claude-code`. If mounted at `'/'`, they'll be at `/events` and `/hooks/claude-code`. If mounted at `'/hooks'`, they'd be at `/hooks/events` and `/hooks/hooks/claude-code` (wrong). The mount point must be `'/'` for the current route definitions to work correctly.
