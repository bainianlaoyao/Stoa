# stoa-ctl Send Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tmux-style `stoa-ctl work-sessions send-keys` command that can send named terminal keys and literal text directly into a target work session through the existing session input pipeline.

**Architecture:** Keep tmux-style parsing inside `tools/stoa-ctl`, then POST the resolved terminal input string to a new control-plane route. The main process dispatches that payload through the existing `SessionInputRouter`, so interrupt handling and PTY delivery continue to work without a parallel input path.

**Tech Stack:** TypeScript, Vitest, Express control server, existing session input router / PTY host stack

---

### Task 1: Add Failing Tests For CLI Send Keys Parsing And Route Usage

**Files:**
- Create: `tools/stoa-ctl/send-keys.test.ts`
- Create: `tools/stoa-ctl/send-keys.ts`
- Modify: `tools/stoa-ctl/index.test.ts`
- Test: `tools/stoa-ctl/send-keys.test.ts`
- Test: `tools/stoa-ctl/index.test.ts`

- [ ] **Step 1: Write the failing parser tests**

Add tests that expect:

```ts
expect(parseSendKeysTokens(['1', 'Enter'])).toBe('1\r')
expect(parseSendKeysTokens(['Up', 'C-c'])).toBe('\u001b[A\u0003')
expect(parseSendKeysTokens(['C-foo'])).toBe('C-foo')
expect(parseSendKeysTokens(['Enter'], { literal: true })).toBe('Enter')
```

- [ ] **Step 2: Run parser tests to verify they fail**

Run: `npx vitest run tools/stoa-ctl/send-keys.test.ts`
Expected: FAIL because `tools/stoa-ctl/send-keys.ts` and `parseSendKeysTokens` do not exist yet.

- [ ] **Step 3: Extend the CLI surface tests**

Add tests that expect:

```ts
expect(module.USAGE_TEXT).toContain('work-sessions send-keys <id> [--literal] [key ...]')
```

and:

```ts
await module.run(['work-sessions', 'send-keys', 'session_1', '1', 'Enter', 'C-c'], ...)
expect(init?.body).toBe('{"data":"1\\r\\u0003"}')
```

- [ ] **Step 4: Run CLI tests to verify they fail**

Run: `npx vitest run tools/stoa-ctl/index.test.ts`
Expected: FAIL because the CLI command is not implemented.

### Task 2: Add Failing Tests For Dispatcher And Control-Plane Route

**Files:**
- Modify: `src/core/meta-session-command-dispatcher.test.ts`
- Modify: `src/core/meta-session-control-server.test.ts`
- Modify: `src/core/meta-session-command-dispatcher.ts`
- Modify: `src/core/meta-session-control-server.ts`

- [ ] **Step 1: Add dispatcher tests**

Add a test shaped like:

```ts
const result = await dispatcher.sendKeysToWorkSession({
  metaSessionId: 'meta_session_1',
  targetSessionId: 'session_1',
  data: '1\r'
})

expect(result).toEqual({ kind: 'dispatched' })
expect(send).toHaveBeenCalledWith('session_1', '1\r')
```

and a second test asserting unknown sessions throw `unknown_session`.

- [ ] **Step 2: Run dispatcher tests to verify they fail**

Run: `npx vitest run src/core/meta-session-command-dispatcher.test.ts`
Expected: FAIL because `sendKeysToWorkSession()` does not exist yet.

- [ ] **Step 3: Add control-server tests**

Add tests that expect:

```ts
const sendKeys = await post(
  port,
  '/ctl/work-sessions/session_1/send-keys',
  authHeaders,
  '{"data":"1\\r"}'
)

expect(JSON.parse(sendKeys.body)).toMatchObject({
  ok: true,
  data: { kind: 'dispatched' }
})
```

and:

```ts
expect(JSON.parse(capabilities.body)).toMatchObject({
  ok: true,
  data: {
    supports: {
      workSessionSendKeys: true
    }
  }
})
```

- [ ] **Step 4: Run control-server tests to verify they fail**

Run: `npx vitest run src/core/meta-session-control-server.test.ts`
Expected: FAIL because the route and capability flag do not exist yet.

### Task 3: Implement Parser, CLI Command, Dispatcher, And Control Route

**Files:**
- Create: `tools/stoa-ctl/send-keys.ts`
- Modify: `tools/stoa-ctl/index.ts`
- Modify: `src/core/meta-session-command-dispatcher.ts`
- Modify: `src/core/meta-session-control-server.ts`

- [ ] **Step 1: Implement the parser**

Implement a focused parser that:

```ts
parseSendKeysTokens(tokens: string[], options?: { literal?: boolean }): string
```

Rules:

- `literal` mode returns `tokens.join('')`
- known key names map to terminal sequences
- `C-<printable>` maps to control characters when possible
- `M-<token>` prefixes `ESC` to a recursively parsed base token
- unknown tokens fall back to literal text

- [ ] **Step 2: Implement the CLI command**

In `tools/stoa-ctl/index.ts`, add:

```ts
if (group === 'work-sessions' && action === 'send-keys') {
  // parse session id, optional --literal, remaining tokens
  // resolve payload with parseSendKeysTokens()
  // POST /ctl/work-sessions/:sessionId/send-keys
}
```

- [ ] **Step 3: Implement dispatcher and route**

Add to `MetaSessionCommandDispatcher`:

```ts
async sendKeysToWorkSession(input: {
  metaSessionId: string
  targetSessionId: string
  data: string
}): Promise<{ kind: 'dispatched' }>
```

and wire `POST /ctl/work-sessions/:sessionId/send-keys` to it.

- [ ] **Step 4: Re-run the focused tests**

Run:

```bash
npx vitest run tools/stoa-ctl/send-keys.test.ts tools/stoa-ctl/index.test.ts src/core/meta-session-command-dispatcher.test.ts src/core/meta-session-control-server.test.ts
```

Expected: PASS.

### Task 4: Run Repository Verification Gate

**Files:**
- Modify if required by failures: `tests/e2e/main-config-guard.test.ts`
- Modify if required by failures: any source or test file surfaced by the gate

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 2: Run deterministic generation**

Run: `npm run test:generate`
Expected: PASS

- [ ] **Step 3: Run Vitest suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Run Electron E2E suite**

Run: `npm run test:e2e`
Expected: PASS

- [ ] **Step 5: Run behavior coverage gate**

Run: `npm run test:behavior-coverage`
Expected: PASS
