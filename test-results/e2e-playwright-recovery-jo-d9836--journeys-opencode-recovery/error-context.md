# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e-playwright\recovery-journey.test.ts >> Electron recovery journeys >> opencode recovery
- Location: tests\e2e-playwright\recovery-journey.test.ts:86:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: 'Terminal surface' })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByRole('region', { name: 'Terminal surface' })

```

# Test source

```ts
  27  |   const debugState = await getMainE2EDebugState(app.electronApp)
  28  |   const session = debugState?.snapshot?.sessions.find((candidate) => candidate.title === title)
  29  |   if (!session) {
  30  |     throw new Error(`Unable to find session with title ${title}`)
  31  |   }
  32  |   return session
  33  | }
  34  | 
  35  | test.describe('Electron recovery journeys', () => {
  36  |   test('shell recovery', async () => {
  37  |     let app = await launchElectronApp()
  38  | 
  39  |     try {
  40  |       const projectRow = await createProject(app, {
  41  |         name: 'recovery-shell-project',
  42  |         path: join(app.stateDir, 'recovery-shell-project')
  43  |       })
  44  |       const session = await createSession(app.page, projectRow, {
  45  |         type: 'shell'
  46  |       })
  47  | 
  48  |       await expect(session.row).toHaveAttribute('aria-current', 'true')
  49  |       await waitForSessionStatus(app, session.title, 'running')
  50  | 
  51  |       const sessionBeforeRestart = await waitForSessionByTitle(app, session.title)
  52  |       expect(sessionBeforeRestart.recoveryMode).toBe('fresh-shell')
  53  | 
  54  |       app = await app.killAndRelaunch()
  55  | 
  56  |       const recoveredProjectRow = app.page.locator('.route-item--parent').filter({ hasText: 'recovery-shell-project' }).first()
  57  |       const recoveredSessionRow = app.page.locator('.route-item.child').filter({ hasText: session.title }).first()
  58  | 
  59  |       await expect(recoveredProjectRow).toBeVisible()
  60  |       await expect(recoveredSessionRow).toBeVisible()
  61  |       await expect(recoveredSessionRow).toHaveAttribute('aria-current', 'true')
  62  | 
  63  |       const recoveredSession = await waitForSessionByTitle(app, session.title)
  64  |       expect(recoveredSession.id).toBe(sessionBeforeRestart.id)
  65  |       expect(recoveredSession.recoveryMode).toBe('fresh-shell')
  66  |       await waitForSessionStatus(app, session.title, 'running')
  67  | 
  68  |       const terminalSurface = app.page.getByRole('region', { name: 'Terminal surface' })
  69  |       await expect(terminalSurface).toBeVisible()
  70  |       await expect(app.page.getByRole('region', { name: 'Terminal empty state' })).toHaveCount(0)
  71  |       await expect(app.page.locator('.terminal-viewport')).toContainText(session.title)
  72  |       await expect(app.page.locator('.terminal-viewport')).toContainText('会话运行中')
  73  |       await expect(app.page.locator('.terminal-viewport')).not.toContainText('会话已恢复')
  74  | 
  75  |       await app.page.getByRole('button', { name: 'Settings' }).click()
  76  |       await expect(app.page.locator('[data-surface="settings"][aria-label="Settings surface"]')).toBeVisible()
  77  |       await app.page.getByRole('button', { name: 'Command panel' }).click()
  78  |       await expect(terminalSurface).toBeVisible()
  79  |       await recoveredSessionRow.click()
  80  |       await expect(recoveredSessionRow).toHaveAttribute('aria-current', 'true')
  81  |     } finally {
  82  |       await app.close()
  83  |     }
  84  |   })
  85  | 
  86  |   test('opencode recovery', async () => {
  87  |     let app = await launchElectronApp()
  88  | 
  89  |     try {
  90  |       const projectRow = await createProject(app, {
  91  |         name: 'recovery-opencode-project',
  92  |         path: join(app.stateDir, 'recovery-opencode-project')
  93  |       })
  94  |       const session = await createSession(app.page, projectRow, {
  95  |         type: 'opencode'
  96  |       })
  97  | 
  98  |       await expect(session.row).toHaveAttribute('aria-current', 'true')
  99  |       const sessionBeforeRestart = await waitForSessionByTitle(app, session.title)
  100 |       expect(sessionBeforeRestart.recoveryMode).toBe('resume-external')
  101 | 
  102 |       app = await app.relaunch()
  103 | 
  104 |       const recoveredProjectRow = app.page.locator('.route-item--parent').filter({ hasText: 'recovery-opencode-project' }).first()
  105 |       const recoveredSessionRow = app.page.locator('.route-item.child').filter({ hasText: session.title }).first()
  106 | 
  107 |       await expect(recoveredProjectRow).toBeVisible()
  108 |       await expect(recoveredSessionRow).toBeVisible()
  109 |       await expect(recoveredSessionRow).toHaveAttribute('aria-current', 'true')
  110 | 
  111 |       const recoveredSession = await waitForSessionByTitle(app, session.title)
  112 |       expect(recoveredSession.id).toBe(sessionBeforeRestart.id)
  113 |       expect(recoveredSession.recoveryMode).toBe('resume-external')
  114 |       expect(recoveredSession.externalSessionId).toBe(sessionBeforeRestart.externalSessionId)
  115 | 
  116 |       await expect(recoveredSessionRow).toContainText(session.title)
  117 |       await expect(recoveredSessionRow).toContainText('opencode')
  118 | 
  119 |       const details = app.page.getByRole('region', { name: 'Session details' })
  120 |       const terminalSurface = app.page.getByRole('region', { name: 'Terminal surface' })
  121 | 
  122 |       if (await details.count()) {
  123 |         await expect(details).toContainText('resume-external')
  124 |         await expect(details).toContainText(session.title)
  125 |         await expect(details).toContainText('opencode')
  126 |       } else {
> 127 |         await expect(terminalSurface).toBeVisible()
      |                                       ^ Error: expect(locator).toBeVisible() failed
  128 |         await expect(app.page.locator('.terminal-viewport')).toContainText('会话运行中')
  129 |       }
  130 | 
  131 |       await app.page.getByRole('button', { name: 'Settings' }).click()
  132 |       await expect(app.page.locator('[data-surface="settings"][aria-label="Settings surface"]')).toBeVisible()
  133 |       await app.page.getByRole('button', { name: 'Command panel' }).click()
  134 |       await expect(recoveredSessionRow).toHaveAttribute('aria-current', 'true')
  135 |     } finally {
  136 |       await app.close()
  137 |     }
  138 |   })
  139 | })
  140 | 
```