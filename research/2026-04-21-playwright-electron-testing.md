# Research Report: Playwright Electron E2E Testing — Terminal/Canvas-Heavy UIs

## Summary

Playwright has **experimental** first-class Electron support via `_electron` namespace (v1.9+, Electron v12.2.0+). It can launch Electron apps, access the main process via `evaluate()`, and interact with renderer windows using standard Playwright page APIs. However, xterm.js canvas content is opaque to DOM-based selectors — you cannot use `getByText()` on terminal output. Two complementary strategies emerge: **(A)** Playwright screenshot assertions on the Electron window for visual regression, and **(B)** a dedicated terminal testing library like **Termless** for structured xterm.js buffer assertions. Crash/restart recovery testing is partially supported but has documented edge cases.

---

## 1. Electron Launch Fixture

### Official API (`_electron`)

Source: [Playwright Docs — Electron class](https://playwright.dev/docs/api/class-electron)

```ts
import { test, expect, _electron as electron } from '@playwright/test';

let electronApp;
let page;

test.beforeAll(async () => {
  electronApp = await electron.launch({ args: ['./dist/main.js'] });
  page = await electronApp.firstWindow();
  page.on('console', console.log);
});

test.afterAll(async () => {
  await electronApp.close();
});
```

Key launch options:
- `args: string[]` — passed to the Electron binary. Supply `['path/to/main.js']` or `['.']` for `package.json`-based entry.
- `executablePath: string` — launch a **packaged** Electron build (e.g., `out/app.exe`). Use `electron-playwright-helpers`'s `findLatestBuild()` + `parseElectronApp()` to locate the built binary.
- `env: Record<string, string>` — override environment variables.
- `cwd: string` — working directory.

### ElectronApplication API

Source: [Playwright Docs — ElectronApplication](https://playwright.dev/docs/api/class-electronapplication)

| Method | Purpose |
|--------|---------|
| `electronApp.evaluate(fn)` | Run code in **main process** context. Receives `require('electron')` result. |
| `electronApp.firstWindow()` | Get first BrowserWindow as a Playwright `Page`. |
| `electronApp.windows()` | All open windows as `Page[]`. |
| `electronApp.browserWindow(page)` | Get the native `BrowserWindow` handle for a Playwright page. |
| `electronApp.process()` | Get the main process `ChildProcess`. |
| `electronApp.on('window', cb)` | Listen for new windows being created. |
| `electronApp.on('close', cb)` | Listen for app process termination. |
| `electronApp.on('console', cb)` | Main process console messages. |

### Recommended Fixture Pattern

```ts
// playwright.config.ts — disable browser projects, Electron only
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  // No browser projects needed for Electron
  retries: process.env.CI ? 2 : 0,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
```

Helper libraries:
- **`electron-playwright-helpers`** (npm) — `findLatestBuild()`, `parseElectronApp()`, `clickMenuItemById()`, `ipcRendererSend()`, `stubDialog()`. Simplifies packaged-app testing.
- **`electron-agent-tools`** (npm) — CDP-based approach, unified logs across main/renderer/preload, `evalInPreload()`.

---

## 2. Preload/IPC Testing Constraints

### Mocking Preload APIs

Source: [Playwright Issue #15578](https://github.com/microsoft/playwright/issues/15578)

Preload scripts run before page JS. To mock `window.*` APIs exposed via `contextBridge`:

```ts
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Runs before any page script, including preload
    window.myApi = {
      getConnection: async () => mockConnection,
    };
  });
});
```

**Important:** `addInitScript` runs before `contextBridge.exposeInMainWorld`. The preload must check if the API is already defined (`window.myApi ??= realApi`) or the mock will be overwritten.

### IPC Verification

- Use `electronApp.evaluate()` to inspect main process state.
- Use `page.evaluate()` to inspect renderer process state.
- `electron-playwright-helpers` provides `ipcMainInvoke()`, `ipcRendererSend()`, `ipcRendererInvoke()` for direct IPC channel testing.
- For full IPC round-trip testing, combine `page.evaluate()` (renderer side) with `electronApp.evaluate()` (main side) to verify both ends.

### Key Constraint

Playwright's Electron support is **experimental**. The preload script runs in an isolated world. You cannot directly intercept `ipcRenderer.send()` from Playwright — you must either:
1. Mock at the preload boundary via `addInitScript`.
2. Use `electronApp.evaluate()` to stub `ipcMain.handle()` on the main process side.
3. Use `page.evaluate()` to verify renderer-visible effects of IPC calls.

---

## 3. Terminal/Canvas Testing (xterm.js)

### The Core Problem

xterm.js renders to `<canvas>` elements. The canvas bitmap is opaque — Playwright's DOM-based locators (`getByText`, `getByRole`) **cannot see terminal content**. Standard approaches:

### Strategy A: Screenshot Visual Regression

Source: [Playwright Docs — Visual comparisons](https://playwright.dev/docs/test-snapshots)

```ts
// Screenshot the terminal area specifically
const terminalElement = page.locator('.xterm');
await expect(terminalElement).toHaveScreenshot('terminal-output.png', {
  maxDiffPixelRatio: 0.01, // 1% tolerance
  animations: 'disabled',
});
```

**Pros:**
- Catches visual regressions in layout, colors, fonts.
- Works with any canvas-based content.
- Built-in retry mechanism: waits for two consecutive identical screenshots before comparing.

**Cons:**
- **Platform-dependent**: screenshots differ across OS, GPU, display scaling, font rendering. Must maintain per-platform golden images.
- **Brittle**: minor renderer changes cause false positives.
- **No semantic content**: can't assert "contains text X", only "looks identical to baseline".
- **xterm.js canvas re-renders** are async — must wait for render stability before capturing.

**Best practice:** Use `animations: 'disabled'` and `caret: 'hide'` options to eliminate cursor blinking noise. Add explicit waits for xterm.js render completion.

### Strategy B: xterm.js Buffer Access via page.evaluate()

```ts
// Access xterm.js internal buffer from Playwright
const terminalText = await page.evaluate(() => {
  // @ts-ignore — accessing the xterm instance
  const term = window.term; // or however the instance is exposed
  const buffer = term.buffer.active;
  const lines = [];
  for (let i = 0; i < buffer.length; i++) {
    lines.push(buffer.getLine(i).translateToString(true));
  }
  return lines.join('\n');
});
expect(terminalText).toContain('expected output');
```

**Pros:**
- Semantic content assertion, not pixel-based.
- Fast and deterministic.
- Can check specific rows, cursor position, scrollback.

**Cons:**
- Requires exposing the xterm.js instance on `window` (dev/test-only).
- Doesn't verify visual rendering — only logical content.
- Couples tests to xterm.js internal API.

### Strategy C: Termless (Dedicated Terminal Testing Library)

Source: [Termless documentation](https://termless.dev/)

**Termless** is a purpose-built terminal testing library ("Like Playwright, but for terminal apps") with native xterm.js backend support:

```ts
import { createTestTerminal } from "@termless/test";

test("terminal shows build output", () => {
  const term = createTestTerminal({ cols: 80, rows: 24 });
  term.feed("Step 1: install\r\nStep 2: build\r\n");

  expect(term.screen).toContainText("build");
  expect(term.scrollback).toContainText("install");
  expect(term.cell(0, 8)).toHaveFg("#00ff00"); // color assertion
  expect(term).not.toBeInMode("altScreen");

  // SVG/PNG screenshots — deterministic, no Chromium needed
  const svg = term.screenshotSvg();
});
```

**Pros:**
- 21+ Vitest matchers: text, cell style, cursor, mode, scrollback, snapshots.
- In-process emulation — no browser needed, sub-1ms tests.
- SVG/PNG screenshots are deterministic (no GPU/font variance).
- Region selectors: `term.screen`, `term.scrollback`, `term.cell(r, c)`, `term.row(n)`.

**Cons:**
- Tests the terminal emulator in isolation, **not the full Electron app**.
- Cannot test Electron-specific features (IPC, native menus, BrowserWindow behavior).
- Best used as a **complement** to Playwright, not a replacement.

### Recommended Approach: Hybrid

| What to test | Tool |
|---|---|
| Full app lifecycle, IPC, multi-window | Playwright `_electron` |
| Terminal visual regression | Playwright `toHaveScreenshot()` on `.xterm` locator |
| Terminal content (semantic) | `page.evaluate()` accessing xterm.js buffer |
| Terminal content (unit-level) | Termless with `@termless/test` |

---

## 4. Crash/Restart Recovery Testing

### Current State

Source: [Playwright Issue #27917](https://github.com/microsoft/playwright/issues/27917)

Playwright has **limited** support for renderer crash recovery testing. A feature request was closed as out-of-scope for experimental Electron support.

```ts
it("recovers from crash", async () => {
  const electronApp = await electron.launch({ ... });
  const page = await electronApp.firstWindow();

  // Trigger renderer crash
  await page.evaluate(() => process.crash());

  // Wait for crash event — THIS WORKS
  await page.waitForEvent('crash');

  // BUT: page becomes unusable after crash
  // Cannot use waitForSelector after recovery — page reference is stale
  // Must re-acquire window reference
});
```

**Workaround:** After crash, listen for new window creation and re-acquire the page:

```ts
const newWindowPromise = electronApp.waitForEvent('window');
// trigger crash...
const recoveredPage = await newWindowPromise;
// Now interact with recovered page
```

### Process Kill/Restart

Source: [Playwright Issue #39248](https://github.com/microsoft/playwright/issues/39248), [PR #29431](https://github.com/microsoft/playwright/pull/29431)

Key findings:
- `electronApp.close()` can stall if the app has long-running child processes (PTY subprocesses are a prime example).
- `electronApp.process().kill()` is available for force-killing.
- On Windows, may need `taskkill /f /t /im <app>.exe` for cleanup.
- Playwright v1.42+ fixed a 30-second stall bug in `ElectronApplication.close()`.

**For crash/restart testing:**
```ts
test('app recovers from process termination', async () => {
  const app1 = await electron.launch({ args: ['./dist/main.js'] });
  const pid = app1.process().pid;

  // Force kill the process
  process.kill(pid, 'SIGKILL'); // or .kill() on Windows

  // Relaunch
  const app2 = await electron.launch({ args: ['./dist/main.js'] });
  const page = await app2.firstWindow();

  // Verify state recovery
  await expect(page.locator('#some-indicator')).toBeVisible();
  await app2.close();
});
```

---

## 5. Common Pitfalls

| Pitfall | Mitigation |
|---------|------------|
| **Experimental status** — Playwright's Electron support may change between versions. Pin Playwright version. |
| **xterm.js async rendering** — Canvas re-renders are batched/debounced. Wait for render stability before screenshots. | Use `await page.waitForTimeout(100)` or poll for content via `page.evaluate()`. |
| **Platform-dependent screenshots** — Golden images differ across OS/GPU/scaling. | Maintain per-platform snapshots or use `maxDiffPixelRatio` with generous tolerance. |
| **Preload mock ordering** — `addInitScript` runs before preload, but `contextBridge.exposeInMainWorld` may overwrite mocks. | Mock at main-process level via `electronApp.evaluate()`, or ensure preload checks for existing values. |
| **Leaky child processes** — PTY subprocesses prevent clean `electronApp.close()`. | Use `electronApp.process().kill()` in afterAll, add timeout guards. |
| **Stale page references after crash** — Page object becomes invalid after renderer crash. | Re-acquire via `electronApp.waitForEvent('window')` or `electronApp.firstWindow()`. |
| **`nodeCliInspect` fuse** — If set to `false`, Electron launch may timeout. | Ensure `FuseV1Options.EnableNodeCliInspectArguments` is not disabled. |
| **Single-worker constraint** — Electron apps are stateful; parallel workers may conflict on filesystem/state. | Use `workers: 1` in Playwright config for Electron tests, or use separate temp directories per worker. |
| **No `webServer` config** — Electron tests launch the app directly, not via URL. Don't use `webServer` in Playwright config. | Use `_electron.launch()` instead. |

---

## 6. Semantic Locators & Accessibility

For the non-terminal parts of the UI (sidebars, panels, toolbars):

```ts
// Good — use semantic roles
await page.getByRole('button', { name: 'New Session' }).click();
await page.getByRole('tab', { name: 'Terminal' }).click();

// Good — use test IDs for xterm container
await page.getByTestId('terminal-panel').screenshot({ path: 'term.png' });

// Bad — xterm canvas content is not accessible
await page.getByText('npm install'); // WON'T WORK on canvas
```

For terminal content, always use `page.evaluate()` to access the xterm.js buffer, or use screenshot comparison.

---

## 7. Recommended Implementation Shape

### Test Structure

```
e2e/
├── fixtures/
│   └── electron-fixture.ts    # Shared launch/teardown fixture
├── app-lifecycle.spec.ts      # Launch, window creation, close
├── ipc-bridge.spec.ts         # Main ↔ renderer IPC
├── terminal-content.spec.ts   # xterm.js buffer assertions
├── terminal-visual.spec.ts    # Screenshot regression
└── crash-recovery.spec.ts     # Process kill/restart
```

### Fixture Template

```ts
// fixtures/electron-fixture.ts
import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test';

type ElectronFixtures = {
  electronApp: ElectronApplication;
  page: Page;
};

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    const app = await electron.launch({
      args: ['./dist/main.js'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    await use(app);
    // Force cleanup for leaky processes
    try {
      await app.close();
    } catch {
      app.process().kill();
    }
  },
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await use(page);
  },
});
```

### Terminal Content Helper

```ts
// helpers/terminal.ts
import { Page } from '@playwright/test';

export async function getTerminalText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const term = (window as any).term; // Exposed in dev mode
    const buffer = term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    return lines.join('\n').trimEnd();
  });
}

export async function waitForTerminalContent(page: Page, text: string, timeout = 5000) {
  await page.waitForFunction(
    (expected) => {
      const term = (window as any).term;
      const buffer = term.buffer.active;
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i);
        if (line && line.translateToString(true).includes(expected)) return true;
      }
      return false;
    },
    text,
    { timeout }
  );
}
```

---

## Evidence Chain

| Finding | Source |
|---------|--------|
| `_electron` API is experimental, supports Electron v12.2.0+ | [Playwright Docs — Electron](https://playwright.dev/docs/api/class-electron) |
| `electronApp.evaluate()` runs in main process | [Playwright Docs — ElectronApplication](https://playwright.dev/docs/api/class-electronapplication) |
| Screenshot visual regression with `toHaveScreenshot()` | [Playwright Docs — Visual comparisons](https://playwright.dev/docs/test-snapshots) |
| Renderer crash recovery is out-of-scope (closed) | [Playwright Issue #27917](https://github.com/microsoft/playwright/issues/27917) |
| Leaky IPC handlers cause test hangs | [Playwright Issue #39248](https://github.com/microsoft/playwright/issues/39248) |
| `electronApp.close()` stall fix (v1.42) | [Playwright PR #29431](https://github.com/microsoft/playwright/pull/29431) |
| Mocking preload APIs with `addInitScript` | [Playwright Issue #15578](https://github.com/microsoft/playwright/issues/15578) |
| Termless: terminal testing library with xterm.js backend | [Termless documentation](https://termless.dev/) |
| `electron-playwright-helpers` for packaged apps | [npm — electron-playwright-helpers](https://www.npmjs.com/package/electron-playwright-helpers) |
| `electron-agent-tools` for CDP-based testing | [GitHub — svvysh/electron-agent-tools](https://github.com/svvysh/electron-agent-tools) |
| Playwright canvas testing proof-of-concept | [GitHub — satelllte/playwright-canvas](https://github.com/satelllte/playwright-canvas) |

---

## Risk Points

- [!] **Experimental API** — Playwright's `_electron` namespace may break on major updates. Pin versions.
- [!] **xterm.js canvas opacity** — No built-in Playwright support for canvas content inspection. Must use `page.evaluate()` bridge.
- [!] **Platform-dependent screenshots** — Golden images must be maintained per OS/scaling configuration.
- [?] **Termless maturity** — Released March 2026, relatively new. Check stability before relying on it for CI.
- [!] **PTY subprocess leaks** — Long-running PTY processes can prevent clean Electron shutdown. Always add `process.kill()` fallback.
- [!] **Parallel worker conflicts** — Electron tests with shared filesystem state should run single-worker or with isolated temp directories.

---

## Recommendations

1. **Use Playwright `_electron` for full-app E2E** — launch, window management, IPC, menus. It's the most mature option despite "experimental" label.
2. **Use `page.evaluate()` + xterm.js buffer for terminal content** — Expose xterm instance on `window` in test mode. Create helper functions (`getTerminalText`, `waitForTerminalContent`).
3. **Use screenshot assertions sparingly** — Only for visual regression of key states. Use `maxDiffPixelRatio` and `animations: 'disabled'`. Expect to maintain per-platform baselines.
4. **Consider Termless for isolated terminal unit tests** — Best for testing terminal output patterns without the Electron overhead. Complements Playwright E2E.
5. **Single-worker for Electron E2E** — Avoid filesystem/PTY state conflicts between parallel workers.
6. **Force-kill fallback** — Always wrap `electronApp.close()` in try/catch with `process.kill()` fallback.

---

## Open Questions

- How to best expose the xterm.js instance in production builds without a code change? (May need a test-only `--expose-terminal` flag.)
- Whether Termless can be integrated inside a running Electron app for in-context terminal assertions (vs. isolated emulation).
- How to handle DPI scaling variance in screenshot golden images across developer machines.
