---
date: 2026-06-15
topic: web vs electron e2e coverage
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Web vs Electron E2E Coverage

### Why This Was Gathered
To determine whether the latest web frontend already passes all frontend E2E tests originally defined for the Electron frontend, and whether any tests are skipped.

### Summary
No. The latest web frontend passes its own web Playwright suite completely, but it does not cover all frontend E2E tests that exist in the Electron Playwright suite. The web project currently runs 34 tests with no skip markers, while the Electron Playwright side defines a much larger set of frontend journeys and still contains skipped cases.

### Key Findings
- Playwright is split into two separate projects: `electron` and `web`.
- The web project only runs `tests/e2e-web/**/*.test.ts`.
- The Electron project runs `tests/e2e-playwright/**/*.test.ts` plus generated Playwright journeys.
- The current web suite passed 34/34 tests in a real run.
- The web suite has no `skip/only/todo` markers.
- Several Electron frontend E2E areas are not migrated to web at all, including terminal, recovery, session event, project/session journey, generated journey specs, debug-devtools, and git panel coverage.
- Legacy Electron frontend E2E still contains explicit skips in search, file explorer, and the entire git panel suite.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Playwright has separate `electron` and `web` projects | `playwright.config.ts` | `playwright.config.ts:18-29` |
| Electron project matches Electron/frontend and generated journey tests | `playwright.config.ts` | `playwright.config.ts:20-21` |
| Web project matches only `e2e-web` tests | `playwright.config.ts` | `playwright.config.ts:24-28` |
| Default E2E script runs all Playwright projects | `package.json` | `package.json:36-39` |
| Full test pipeline includes both generated and E2E phases | `package.json` | `package.json:35-41` |
| Web settings tests exist and are active | `tests/e2e-web/settings.test.ts` | `tests/e2e-web/settings.test.ts:11,31,43,56,69,92,105,123,144,159,174,189,204` |
| Web sidebar tests exist and are active | `tests/e2e-web/sidebar.test.ts` | `tests/e2e-web/sidebar.test.ts:24,54,91,132,168,205` |
| Web file explorer tests exist and are active | `tests/e2e-web/file-explorer.test.ts` | `tests/e2e-web/file-explorer.test.ts:40,60,79,103,123,149,165,185` |
| Web search tests exist and are active | `tests/e2e-web/search-panel.test.ts` | `tests/e2e-web/search-panel.test.ts:37,60,88,110` |
| Web smoke tests exist and are active | `tests/e2e-web/smoke.test.ts` | `tests/e2e-web/smoke.test.ts:5,22,35` |
| Electron search tests contain 3 explicit skips | `tests/e2e-playwright/search-panel.test.ts` | `tests/e2e-playwright/search-panel.test.ts:37,91,109` |
| Electron file explorer tests contain 3 explicit skips | `tests/e2e-playwright/file-explorer.test.ts` | `tests/e2e-playwright/file-explorer.test.ts:103,146,175` |
| Electron git panel suite is skipped at describe level | `tests/e2e-playwright/git-panel.test.ts` | `tests/e2e-playwright/git-panel.test.ts:22` |

### Risks / Unknowns
- [!] A green `npm run test:e2e:web` result can be misread as full migration parity, but the configured Playwright projects prove it is only web-project parity.
- [!] Generated journey specs still target Electron fixtures, so behavior-level journey coverage is not migrated to web.
- [?] Some skipped Electron tests may be intentionally desktop-only rather than candidates for web parity.

## Context Handoff: Web vs Electron E2E Coverage

Start here: `research/2026-06-15-web-vs-electron-e2e-coverage.md`

Context only. Use the saved report as the source of truth.
