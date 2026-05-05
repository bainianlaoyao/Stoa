import { describe, it, expect, vi } from 'vitest'
import { ShellIntegrationAddon } from './shell-integration-addon'

function createMockTerminal() {
  const handlers = new Map<number, (data: string) => boolean>()
  return {
    parser: {
      registerOscHandler(code: number, handler: (data: string) => boolean) {
        handlers.set(code, handler)
        return { dispose: () => { handlers.delete(code) } }
      },
    },
    fireOsc(code: number, data: string): boolean {
      const handler = handlers.get(code)
      return handler ? handler(data) : false
    },
    hasHandler(code: number): boolean {
      return handlers.has(code)
    },
  }
}

describe('ShellIntegrationAddon', () => {
  it('fires full lifecycle: PromptStart -> CommandStart -> CommandExecuted -> CommandFinished', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    const startEvents: Array<unknown> = []
    let executedCount = 0
    const finishedEvents: Array<unknown> = []

    addon.onCommandStart = (e) => startEvents.push(e)
    addon.onCommandExecuted = () => { executedCount += 1 }
    addon.onCommandFinished = (e) => finishedEvents.push(e)

    mock.fireOsc(633, 'A')
    mock.fireOsc(633, 'B')
    mock.fireOsc(633, 'C')
    mock.fireOsc(633, 'D;0')

    expect(startEvents).toHaveLength(1)
    expect(startEvents[0]).toEqual({
      commandLine: null,
      cwd: null,
      timestamp: expect.any(Number),
    })

    expect(executedCount).toBe(1)
    expect(finishedEvents).toHaveLength(1)
    expect(finishedEvents[0]).toEqual({
      exitCode: 0,
      commandLine: null,
      cwd: null,
      timestamp: expect.any(Number),
      duration: expect.any(Number),
    })
  })

  it('detects CWD via 633;P;Cwd=/home/user/project and fires onCwdChanged', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    const cwdChanges: string[] = []
    addon.onCwdChanged = (cwd) => cwdChanges.push(cwd)

    mock.fireOsc(633, 'P;Cwd=/home/user/project')

    expect(addon.getState().currentCwd).toBe('/home/user/project')
    expect(cwdChanges).toEqual(['/home/user/project'])
  })

  it('detects nonce via 633;P;Nonce=abc123', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    mock.fireOsc(633, 'P;Nonce=abc123')

    expect(addon.getState().nonce).toBe('abc123')
  })

  it('captures command line via 633;E;echo hello world', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    mock.fireOsc(633, 'E;echo hello world')

    expect(addon.getState().currentCommand).toBe('echo hello world')
  })

  it('strips nonce from E; payload (production format E;command;nonce)', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    mock.fireOsc(633, 'E;git status;f47ac10b-58cc-4372-a567-0e02b2c3d479')

    expect(addon.getState().currentCommand).toBe('git status')
  })

  it('handles E; payload with escaped semicolons in command before nonce', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    mock.fireOsc(633, 'E;echo "hello\\x3bworld";nonce-abc')

    expect(addon.getState().currentCommand).toBe('echo "hello;world"')
  })

  it('parses exit code 0 from 633;D;0', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    const finishedEvents: Array<{ exitCode: number | undefined }> = []
    addon.onCommandFinished = (e) => finishedEvents.push(e)

    mock.fireOsc(633, 'B')
    mock.fireOsc(633, 'D;0')

    expect(finishedEvents).toHaveLength(1)
    expect(finishedEvents[0].exitCode).toBe(0)
  })

  it('parses exit code 1 from 633;D;1', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    const finishedEvents: Array<{ exitCode: number | undefined }> = []
    addon.onCommandFinished = (e) => finishedEvents.push(e)

    mock.fireOsc(633, 'B')
    mock.fireOsc(633, 'D;1')

    expect(finishedEvents).toHaveLength(1)
    expect(finishedEvents[0].exitCode).toBe(1)
  })

  it('returns undefined exitCode for 633;D (missing exit code)', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    const finishedEvents: Array<{ exitCode: number | undefined }> = []
    addon.onCommandFinished = (e) => finishedEvents.push(e)

    mock.fireOsc(633, 'B')
    mock.fireOsc(633, 'D')

    expect(finishedEvents).toHaveLength(1)
    expect(finishedEvents[0].exitCode).toBeUndefined()
  })

  it('returns undefined exitCode for 633;D; (empty after semicolon)', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    const finishedEvents: Array<{ exitCode: number | undefined }> = []
    addon.onCommandFinished = (e) => finishedEvents.push(e)

    mock.fireOsc(633, 'B')
    mock.fireOsc(633, 'D;')

    expect(finishedEvents).toHaveLength(1)
    expect(finishedEvents[0].exitCode).toBeUndefined()
  })

  it('maps OSC 133;A to PromptStart behavior', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    expect(mock.fireOsc(133, 'A')).toBe(false)
  })

  it('maps OSC 133;B to CommandStart and fires onCommandStart', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    const startEvents: Array<unknown> = []
    addon.onCommandStart = (e) => startEvents.push(e)

    mock.fireOsc(133, 'B')

    expect(startEvents).toHaveLength(1)
    expect(addon.getState().commandStartTimestamp).not.toBeNull()
  })

  it('maps OSC 133;C to CommandExecuted', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    let executedCount = 0
    addon.onCommandExecuted = () => { executedCount += 1 }

    mock.fireOsc(133, 'C')

    expect(executedCount).toBe(1)
  })

  it('maps OSC 133;D to CommandFinished', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    const finishedEvents: Array<unknown> = []
    addon.onCommandFinished = (e) => finishedEvents.push(e)

    mock.fireOsc(133, 'B')
    mock.fireOsc(133, 'D')

    expect(finishedEvents).toHaveLength(1)
    expect((finishedEvents[0] as { exitCode: number | undefined }).exitCode).toBeUndefined()
  })

  it('detects CWD via OSC 7 with file:// URL', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    const cwdChanges: string[] = []
    addon.onCwdChanged = (cwd) => cwdChanges.push(cwd)

    mock.fireOsc(7, 'file:///home/user')

    expect(addon.getState().currentCwd).toBe('/home/user')
    expect(cwdChanges).toEqual(['/home/user'])
  })

  it('unescapes \\x20 in command line to space', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    mock.fireOsc(633, 'E;hello\\x20world')

    expect(addon.getState().currentCommand).toBe('hello world')
  })

  it('unescapes \\x3b in command line to semicolon', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    mock.fireOsc(633, 'E;hello\\x3bworld')

    expect(addon.getState().currentCommand).toBe('hello;world')
  })

  it('unescapes \\\\ to literal backslash', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    mock.fireOsc(633, 'E;path\\\\to\\\\file')

    expect(addon.getState().currentCommand).toBe('path\\to\\file')
  })

  it('resets commandLine on new CommandStart', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    mock.fireOsc(633, 'B')
    mock.fireOsc(633, 'E;first command')
    expect(addon.getState().currentCommand).toBe('first command')

    mock.fireOsc(633, 'B')
    expect(addon.getState().currentCommand).toBeNull()
  })

  it('calculates duration from commandStartTimestamp', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    const finishedEvents: Array<{ duration: number | null }> = []
    addon.onCommandFinished = (e) => finishedEvents.push(e)

    const before = Date.now()
    mock.fireOsc(633, 'B')
    mock.fireOsc(633, 'D;0')
    const after = Date.now()

    expect(finishedEvents).toHaveLength(1)
    const duration = finishedEvents[0].duration
    expect(duration).not.toBeNull()
    expect(duration!).toBeGreaterThanOrEqual(0)
    expect(duration!).toBeLessThanOrEqual(after - before + 100)
  })

  it('returns null duration when no CommandStart was seen', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    const finishedEvents: Array<{ duration: number | null }> = []
    addon.onCommandFinished = (e) => finishedEvents.push(e)

    mock.fireOsc(633, 'D;0')

    expect(finishedEvents).toHaveLength(1)
    expect(finishedEvents[0].duration).toBeNull()
  })

  it('resets commandStartTimestamp after CommandFinished', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    mock.fireOsc(633, 'B')
    expect(addon.getState().commandStartTimestamp).not.toBeNull()

    mock.fireOsc(633, 'D;0')
    expect(addon.getState().commandStartTimestamp).toBeNull()
  })

  it('dispose removes all OSC handlers', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    expect(mock.hasHandler(633)).toBe(true)
    expect(mock.hasHandler(133)).toBe(true)
    expect(mock.hasHandler(7)).toBe(true)

    addon.dispose()

    expect(mock.hasHandler(633)).toBe(false)
    expect(mock.hasHandler(133)).toBe(false)
    expect(mock.hasHandler(7)).toBe(false)
  })

  it('all OSC handlers return false (pass-through)', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    expect(mock.fireOsc(633, 'A')).toBe(false)
    expect(mock.fireOsc(633, 'B')).toBe(false)
    expect(mock.fireOsc(633, 'C')).toBe(false)
    expect(mock.fireOsc(633, 'D;0')).toBe(false)
    expect(mock.fireOsc(633, 'D')).toBe(false)
    expect(mock.fireOsc(633, 'E;cmd')).toBe(false)
    expect(mock.fireOsc(633, 'F')).toBe(false)
    expect(mock.fireOsc(633, 'G')).toBe(false)
    expect(mock.fireOsc(633, 'P;Cwd=/tmp')).toBe(false)
    expect(mock.fireOsc(133, 'A')).toBe(false)
    expect(mock.fireOsc(133, 'B')).toBe(false)
    expect(mock.fireOsc(133, 'C')).toBe(false)
    expect(mock.fireOsc(133, 'D')).toBe(false)
    expect(mock.fireOsc(7, 'file:///home')).toBe(false)
  })

  it('ignores malformed OSC 7 URL', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    mock.fireOsc(7, 'not-a-url')
    expect(addon.getState().currentCwd).toBeNull()
  })

  it('handles multiple sequential command lifecycles', () => {
    const mock = createMockTerminal()
    const addon = new ShellIntegrationAddon()
    addon.activate(mock as never)

    const finishedEvents: Array<{ exitCode: number | undefined; commandLine: string | null }> = []
    addon.onCommandFinished = (e) => finishedEvents.push(e)

    mock.fireOsc(633, 'B')
    mock.fireOsc(633, 'E;ls -la')
    mock.fireOsc(633, 'C')
    mock.fireOsc(633, 'D;0')

    mock.fireOsc(633, 'B')
    mock.fireOsc(633, 'E;exit 1')
    mock.fireOsc(633, 'C')
    mock.fireOsc(633, 'D;1')

    expect(finishedEvents).toHaveLength(2)
    expect(finishedEvents[0].exitCode).toBe(0)
    expect(finishedEvents[0].commandLine).toBe('ls -la')
    expect(finishedEvents[1].exitCode).toBe(1)
    expect(finishedEvents[1].commandLine).toBe('exit 1')
  })
})
