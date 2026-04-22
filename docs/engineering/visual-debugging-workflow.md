# Visual Debugging Workflow

## Prerequisites

- `npx electron-vite dev` — renderer at `http://localhost:5173`
- Playwright MCP enabled (`/playwright` skill)
- `MiniMax_understand_image` for screenshot analysis

## Critical Rule: Test Transitions, Not States

**DO NOT** inject mock data with a final state (e.g., `status: 'running'`) and declare victory. That only verifies rendering, not the data flow.

**ALWAYS** start from an initial state and simulate the transitions that happen in production. Verify each transition visually.

For session lifecycle, the full chain is:
```
bootstrapping → [session:event] → starting → [session:event] → running → [terminal:data] → content visible → [session:event] → exited
```

Every arrow is a potential bug. Test each one.

## Workflow

### Step 1: Start Dev Server

```bash
tmux new-session -d -s dev
tmux send-keys -t dev "cd D:/Data/DEV/ultra_simple_panel" Enter
tmux send-keys -t dev "npx electron-vite dev 2>&1" Enter
sleep 15
tmux capture-pane -p -t dev -S -50
```

### Step 2: Inject Mock with INITIAL State (Not Final)

Inject mock with sessions in `bootstrapping` status. **CRITICAL**: Use arrays for callbacks, not single assignment. Both App.vue and TerminalViewport subscribe to `onSessionEvent` — single assignment silently drops App.vue's subscription, breaking store updates on status transitions.

```
skill_mcp(mcp_name="playwright", tool_name="browser_run_code", arguments={
  "code": "async (page) => {
    await page.addInitScript(() => {
      window.__sessionEventCbs = [];
      window.__terminalDataCbs = [];
      window.stoa = {
        getBootstrapState: async () => ({
          activeProjectId: 'project_test',
          activeSessionId: 'session_test',
          terminalWebhookPort: null,
          projects: [{ id: 'project_test', name: 'test', path: 'D:/test', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
          sessions: [{ id: 'session_test', projectId: 'project_test', type: 'shell', status: 'bootstrapping', title: 'Test Shell', summary: '等待会话启动', recoveryMode: 'fresh-shell', externalSessionId: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', lastActivatedAt: '2026-01-01T00:00:00Z' }]
        }),
        createProject: async () => null,
        createSession: async () => null,
        setActiveProject: async () => {},
        setActiveSession: async () => {},
        sendSessionInput: async () => {},
        sendSessionResize: async () => {},
        onTerminalData: (cb) => { window.__terminalDataCbs.push(cb); return () => { const i = window.__terminalDataCbs.indexOf(cb); if (i>=0) window.__terminalDataCbs.splice(i,1); }; },
        onSessionEvent: (cb) => { window.__sessionEventCbs.push(cb); return () => { const i = window.__sessionEventCbs.indexOf(cb); if (i>=0) window.__sessionEventCbs.splice(i,1); }; }
      };
    });
    return 'OK';
  }"
})
```

### Step 3: Verify Initial State

```
skill_mcp(mcp_name="playwright", tool_name="browser_navigate", arguments={ url: "http://localhost:5173/" })

# Screenshot — should show metadata overlay, NOT terminal
skill_mcp(mcp_name="playwright", tool_name="browser_take_screenshot", arguments={ type: "png", filename: "step3-initial.png" })

# Verify: check for metadata overlay text, absence of xterm
MiniMax_understand_image(prompt="Is there an xterm terminal visible, or a metadata overlay showing bootstrapping status? Describe what you see in the main content area.", image_source="step3-initial.png")
```

**Expected**: Metadata overlay with "等待会话启动" or bootstrapping status. No xterm terminal.

### Step 4: Fire Session Transition → Running

```
skill_mcp(mcp_name="playwright", tool_name="browser_evaluate", arguments={
  "function": "() => { window.__sessionEventCbs.forEach(cb => cb({ sessionId: 'session_test', status: 'running', summary: '会话运行中' })); return 'fired'; }"
})

# Wait for Vue reactivity
skill_mcp(mcp_name="playwright", tool_name="browser_wait_for", arguments={ time: 1 })

# Screenshot — should NOW show xterm terminal
skill_mcp(mcp_name="playwright", tool_name="browser_take_screenshot", arguments={ type: "png", filename: "step4-running.png" })

MiniMax_understand_image(prompt="Is there now an xterm terminal visible instead of the metadata overlay? Is the black terminal area showing?", image_source="step4-running.png")
```

**Expected**: Metadata overlay gone, xterm terminal mounted (black area, possibly with scrollbar).

### Step 5: Fire Terminal Data

```
skill_mcp(mcp_name="playwright", tool_name="browser_evaluate", arguments={
  "function": "() => { window.__terminalDataCbs.forEach(cb => cb({ sessionId: 'session_test', data: '\\x1b[32muser@host\\x1b[0m:\\x1b[34m~\\x1b[0m$ ' })); return 'fired'; }"
})

skill_mcp(mcp_name="playwright", tool_name="browser_wait_for", arguments={ time: 1 })

skill_mcp(mcp_name="playwright", tool_name="browser_take_screenshot", arguments={ type: "png", filename: "step5-content.png" })

MiniMax_understand_image(prompt="Is there colored text visible in the terminal? Can you see a command prompt like 'user@host:~$'?", image_source="step5-content.png")
```

**Expected**: Colored prompt text in the terminal.

### Step 6: Fire Session Exit

```
skill_mcp(mcp_name="playwright", tool_name="browser_evaluate", arguments={
  "function": "() => { window.__sessionEventCbs.forEach(cb => cb({ sessionId: 'session_test', status: 'exited', summary: 'shell 已退出 (0)' })); return 'fired'; }"
})

skill_mcp(mcp_name="playwright", tool_name="browser_wait_for", arguments={ time: 1 })

skill_mcp(mcp_name="playwright", tool_name="browser_take_screenshot", arguments={ type: "png", filename: "step6-exited.png" })

MiniMax_understand_image(prompt="Has the terminal been replaced by a metadata overlay? Does it show 'exited' status?", image_source="step6-exited.png")
```

**Expected**: Terminal disposed, metadata overlay returns with exited status.

### Step 7: Verify Session Type Coverage

Repeat Steps 2-6 for EACH session type:

| Type | Initial Status | Mock State Key Differences |
|------|---------------|---------------------------|
| `shell` | `bootstrapping` | `recoveryMode: 'fresh-shell'`, `externalSessionId: null` |
| `opencode` | `bootstrapping` | `recoveryMode: 'resume-external'`, `externalSessionId: null` |
| `opencode` (resume) | `bootstrapping` | `recoveryMode: 'resume-external'`, `externalSessionId: 'ext-123'` |

Each type triggers a different code path in `startSessionRuntime()`.

### Step 8: Verify Console Clean

```
skill_mcp(mcp_name="playwright", tool_name="browser_console_messages", arguments={ level: "error", all: true })
```

Only `favicon.ico` 404 is acceptable. Any other errors = bug.

### Step 9: Check Main Process Logs

```bash
tmux capture-pane -p -t dev -S -100
```

Look for `[session-runtime]`, `[bootstrap-recovery]` error messages.

### Step 10: Cleanup

```bash
tmux send-keys -t dev C-c
tmux kill-session -t dev
skill_mcp(mcp_name="playwright", tool_name="browser_close")
```

## Data Flow Trace Template

For ANY cross-process feature, fill out this trace BEFORE implementing and verify each link after:

```
Feature: [name]

Link 1: [event happens] → [producer]
Link 2: [producer] → [IPC channel]
Link 3: [IPC channel] → [preload listener]
Link 4: [preload listener] → [renderer subscription]
Link 5: [renderer subscription] → [store mutation]
Link 6: [store mutation] → [Vue reactivity]
Link 7: [Vue reactivity] → [DOM update / component mount]

Verify:
- [ ] Link 1: unit test
- [ ] Link 2: config-guard static test
- [ ] Link 3: config-guard static test
- [ ] Link 4: App.vue integration
- [ ] Link 5: store method exists
- [ ] Link 6-7: visual verification (this workflow)
```

## Why This Matters

The `opencode shell` bug happened because links 4-5 were missing. The main process correctly pushed session events, the preload correctly registered listeners, but App.vue never subscribed to `onSessionEvent` and the store had no `updateSession` method. Static screenshots with `status: 'running'` masked the gap because they skipped the transition entirely.

## Quick Reference: Tools

| Step | Tool | Purpose |
|------|------|---------|
| Start server | `tmux` + `bash` | Background dev server |
| Mock bridge | `skill_mcp(playwright, browser_run_code)` | `page.addInitScript()` |
| View page | `skill_mcp(playwright, browser_navigate)` | Load renderer |
| Fire transition | `skill_mcp(playwright, browser_evaluate)` | Call stored callbacks |
| Screenshot | `skill_mcp(playwright, browser_take_screenshot)` | PNG capture |
| Analyze | `MiniMax_understand_image` | Screenshot interpretation |
| DOM structure | `skill_mcp(playwright, browser_snapshot)` | Accessibility tree |
| Console errors | `skill_mcp(playwright, browser_console_messages)` | Console log |
| Main logs | `tmux capture-pane` | Main process stdout/stderr |
| Interact | `skill_mcp(playwright, browser_click/type)` | UI interaction |
