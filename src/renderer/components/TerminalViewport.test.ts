import { mount } from '@vue/test-utils'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'
import { useSettingsStore } from '@renderer/stores/settings'

vi.mock('@xterm/xterm', () => {
  class Terminal {
    static instances: Terminal[] = []
    options: Record<string, unknown>
    cols = 80
    rows = 24
    writes: string[] = []
    unicode = { activeVersion: '6' }

    constructor(options: Record<string, unknown> = {}) {
      this.options = options
      Terminal.instances.push(this)
    }

    open() {}
    write(data: string, callback?: () => void) {
      this.writes.push(data)
      callback?.()
    }
    onData(cb: (data: string) => void) {
      return { dispose: () => {} }
    }
    loadAddon() {}
    dispose() {}
  }
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  return {
    FitAddon: class {
      fit() {}
      dispose() {}
    },
  }
})

vi.mock('@xterm/addon-unicode11', () => {
  return {
    Unicode11Addon: class {},
  }
})

vi.mock('@xterm/addon-web-links', () => {
  return {
    WebLinksAddon: class {
      constructor(
        _handler: (event: MouseEvent, uri: string) => void
      ) {}
    },
  }
})

vi.mock('@xterm/addon-webgl', () => {
  return {
    WebglAddon: class {
      onContextLoss(_handler: () => void) {}
      dispose() {}
    },
  }
})

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

function createMockApi() {
  const callbacks = {
    terminalData: [] as Array<(chunk: { sessionId: string; data: string }) => void>,
    sessionEvent: [] as Array<(event: { sessionId: string; status: string; summary: string }) => void>,
  }

  return {
    getTerminalReplay: vi.fn().mockResolvedValue(''),
    sendSessionInput: vi.fn(),
    sendSessionResize: vi.fn(),
    onTerminalData: vi.fn((cb: (chunk: { sessionId: string; data: string }) => void) => {
      callbacks.terminalData.push(cb)
      return () => {
        const idx = callbacks.terminalData.indexOf(cb)
        if (idx >= 0) callbacks.terminalData.splice(idx, 1)
      }
    }),
    onSessionEvent: vi.fn((cb: (event: { sessionId: string; status: string; summary: string }) => void) => {
      callbacks.sessionEvent.push(cb)
      return () => {
        const idx = callbacks.sessionEvent.indexOf(cb)
        if (idx >= 0) callbacks.sessionEvent.splice(idx, 1)
      }
    }),
    callbacks,
  }
}

const baseProject: ProjectSummary = {
  id: 'project_alpha',
  name: 'alpha',
  path: 'D:/alpha',
  createdAt: 'a',
  updatedAt: 'a',
}

const baseSession: SessionSummary = {
  id: 'session_op_1',
  projectId: 'project_alpha',
  type: 'opencode',
  status: 'running',
  title: 'Deploy',
  summary: 'ready',
  recoveryMode: 'resume-external',
  externalSessionId: 'ext-123',
  createdAt: 'a',
  updatedAt: 'a',
  lastActivatedAt: 'a',
  archived: false
}

async function flushTerminal(): Promise<void> {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

describe('TerminalViewport', () => {
  let mockApi: ReturnType<typeof createMockApi>
  let pinia: ReturnType<typeof createPinia>

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    mockApi = createMockApi()
    const { Terminal } = await import('@xterm/xterm')
    ;(Terminal as unknown as { instances: unknown[] }).instances.length = 0
    Object.defineProperty(window, 'stoa', {
      value: mockApi,
      configurable: true,
      writable: true
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'stoa')
  })

  test('renders empty state when no session', async () => {
    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    const wrapper = mount(TerminalViewport, {
      props: { project: null, session: null },
    })
    expect(wrapper.find('.terminal-empty-state').exists()).toBe(true)
  })

  test('shows metadata overlay when status is not running', async () => {
    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    const session = { ...baseSession, status: 'exited' as const }
    const wrapper = mount(TerminalViewport, {
      props: { project: baseProject, session },
    })

    expect(wrapper.find('.terminal-viewport__overlay').exists()).toBe(true)
    expect(wrapper.text()).toContain('Deploy')
    expect(wrapper.text()).toContain('alpha')
    expect(wrapper.text()).toContain('exited')
    expect(wrapper.text()).toContain('resume-external')
    expect(wrapper.text()).toContain('ext-123')
    expect(wrapper.find('.terminal-viewport__xterm').exists()).toBe(false)
  })

  test('mounts the running xterm surface inside a visual shell when session is running', async () => {
    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    const wrapper = mount(TerminalViewport, {
      props: { project: baseProject, session: baseSession },
    })
    await flushTerminal()

    expect(wrapper.find('.terminal-viewport__xterm').exists()).toBe(true)
    expect(wrapper.find('.terminal-viewport__shell').exists()).toBe(true)
    expect(wrapper.find('.terminal-viewport__xterm-mount').exists()).toBe(true)
    expect(wrapper.find('.terminal-viewport__xterm-shell').exists()).toBe(false)
    expect(wrapper.find('.terminal-viewport__overlay').exists()).toBe(false)
  })

  test('running terminal structure keeps the xterm mount inside the visual shell wrapper', async () => {
    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    const wrapper = mount(TerminalViewport, {
      props: { project: baseProject, session: baseSession },
    })
    await flushTerminal()

    const xtermSurface = wrapper.find('.terminal-viewport__xterm')
    expect(xtermSurface.exists()).toBe(true)
    const shell = xtermSurface.find('.terminal-viewport__shell')
    expect(shell.exists()).toBe(true)
    expect(shell.find('.terminal-viewport__xterm-mount').exists()).toBe(true)
  })

  test('registers onTerminalData listener on mount', async () => {
    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    mount(TerminalViewport, {
      props: { project: baseProject, session: baseSession },
    })
    await flushTerminal()

    expect(mockApi.onTerminalData).toHaveBeenCalled()
    expect(mockApi.onSessionEvent).toHaveBeenCalled()
  })

  test('replays the latest terminal backlog before consuming live chunks', async () => {
    mockApi.getTerminalReplay.mockResolvedValue('restored frame')

    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    mount(TerminalViewport, {
      props: { project: baseProject, session: baseSession },
    })
    await flushTerminal()

    expect(mockApi.getTerminalReplay).toHaveBeenCalledWith('session_op_1')

    const { Terminal } = await import('@xterm/xterm')
    const instance = (Terminal as unknown as { instances: Array<{ writes: string[] }> }).instances.at(-1)
    expect(instance?.writes).toContain('restored frame')

    mockApi.callbacks.terminalData.forEach((cb) => {
      cb({ sessionId: 'session_op_1', data: 'live chunk' })
    })
    await flushTerminal()

    expect(instance?.writes).toContain('live chunk')
  })

  test('replay/live merge never drops repeated output bytes', async () => {
    let resolveReplay!: (value: string) => void
    mockApi.getTerminalReplay = vi.fn().mockImplementation(() => {
      return new Promise<string>((resolve) => {
        resolveReplay = resolve
      })
    })

    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    mount(TerminalViewport, {
      props: { project: baseProject, session: baseSession },
    })
    await flushTerminal()

    mockApi.callbacks.terminalData.forEach((cb) => {
      cb({ sessionId: 'session_op_1', data: 'AB' })
    })

    resolveReplay('ABAB')
    await flushTerminal()

    const { Terminal } = await import('@xterm/xterm')
    const instance = (Terminal as unknown as { instances: Array<{ writes: string[] }> }).instances.at(-1)
    expect(instance?.writes).toEqual(['ABAB', 'AB'])
  })

  test('exit event buffered before replay resolves is rendered after replay and buffered live output', async () => {
    let resolveReplay!: (value: string) => void
    mockApi.getTerminalReplay = vi.fn().mockImplementation(() => {
      return new Promise<string>((resolve) => {
        resolveReplay = resolve
      })
    })

    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    mount(TerminalViewport, {
      props: { project: baseProject, session: baseSession },
    })
    await flushTerminal()

    mockApi.callbacks.terminalData.forEach((cb) => {
      cb({ sessionId: 'session_op_1', data: 'live-before-replay' })
    })
    mockApi.callbacks.sessionEvent.forEach((cb) => {
      cb({ sessionId: 'session_op_1', status: 'exited', summary: 'done' })
    })

    resolveReplay('restored-frame')
    await flushTerminal()

    const { Terminal } = await import('@xterm/xterm')
    const instance = (Terminal as unknown as { instances: Array<{ writes: string[] }> }).instances.at(-1)
    expect(instance?.writes).toEqual([
      'restored-frame',
      'live-before-replay',
      '\r\n\x1b[90m[session exited]\x1b[0m',
    ])
  })

  test('hung replay request eventually falls back and flushes buffered live and exit output', async () => {
    vi.useFakeTimers()
    try {
      mockApi.getTerminalReplay = vi.fn().mockImplementation(() => {
        return new Promise<string>(() => {})
      })

      const { default: TerminalViewport } = await import('./TerminalViewport.vue')
      mount(TerminalViewport, {
        props: { project: baseProject, session: baseSession },
      })
      await flushTerminal()

      mockApi.callbacks.terminalData.forEach((cb) => {
        cb({ sessionId: 'session_op_1', data: 'live-while-hung' })
      })
      mockApi.callbacks.sessionEvent.forEach((cb) => {
        cb({ sessionId: 'session_op_1', status: 'exited', summary: 'done' })
      })
      await flushTerminal()

      const { Terminal } = await import('@xterm/xterm')
      const instance = (Terminal as unknown as { instances: Array<{ writes: string[] }> }).instances.at(-1)
      expect(instance?.writes).toEqual([])

      await vi.advanceTimersByTimeAsync(1_000)
      await flushTerminal()

      expect(instance?.writes).toEqual([
        'live-while-hung',
        '\r\n\x1b[90m[session exited]\x1b[0m',
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  test('replay fetch failure still flushes buffered and subsequent live data safely', async () => {
    let rejectReplay!: (reason?: unknown) => void
    mockApi.getTerminalReplay = vi.fn().mockImplementation(() => {
      return new Promise<string>((_, reject) => {
        rejectReplay = reject
      })
    })

    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    mount(TerminalViewport, {
      props: { project: baseProject, session: baseSession },
    })
    await flushTerminal()

    mockApi.callbacks.terminalData.forEach((cb) => {
      cb({ sessionId: 'session_op_1', data: 'buffered chunk' })
    })

    rejectReplay(new Error('replay failed'))
    await flushTerminal()

    const { Terminal } = await import('@xterm/xterm')
    const instance = (Terminal as unknown as { instances: Array<{ writes: string[] }> }).instances.at(-1)
    expect(instance?.writes).toContain('buffered chunk')

    mockApi.callbacks.terminalData.forEach((cb) => {
      cb({ sessionId: 'session_op_1', data: 'live after failure' })
    })
    await flushTerminal()

    expect(instance?.writes).toContain('live after failure')
  })

  test('calls sendSessionResize after fit even when the Font Loading API is unavailable', async () => {
    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    mount(TerminalViewport, {
      props: { project: baseProject, session: baseSession },
    })
    await flushTerminal()

    expect(mockApi.sendSessionResize).toHaveBeenCalledWith(
      'session_op_1',
      80,
      24
    )
  })

  test('switching between running sessions rebuilds terminal bindings for the new session', async () => {
    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    const wrapper = mount(TerminalViewport, {
      props: { project: baseProject, session: baseSession },
    })
    await flushTerminal()

    const nextSession: SessionSummary = {
      ...baseSession,
      id: 'session_shell_2',
      type: 'shell',
      title: 'Shell 2',
      recoveryMode: 'fresh-shell',
      externalSessionId: null
    }

    await wrapper.setProps({ session: nextSession })
    await flushTerminal()

    expect(mockApi.sendSessionResize).toHaveBeenCalledWith(
      'session_shell_2',
      80,
      24
    )
  })

  test('only the latest scheduled setup is allowed to instantiate a terminal after a rapid switch', async () => {
    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    const wrapper = mount(TerminalViewport, {
      props: { project: baseProject, session: baseSession },
    })

    await wrapper.setProps({
      session: {
        ...baseSession,
        id: 'session_op_2',
        title: 'OpenCode 2'
      }
    })
    await flushTerminal()

    const { Terminal } = await import('@xterm/xterm')
    const instances = (Terminal as unknown as { instances: unknown[] }).instances
    const resizeCallsForSession2 = mockApi.sendSessionResize.mock.calls.filter(
      ([sessionId]) => sessionId === 'session_op_2'
    )

    expect(instances).toHaveLength(1)
    expect(resizeCallsForSession2).toHaveLength(1)
  })

  test('stale replay from a previous session never writes into the newly mounted terminal', async () => {
    let resolveFirstReplay!: (value: string) => void
    const firstReplay = new Promise<string>((resolve) => {
      resolveFirstReplay = resolve
    })

    mockApi.getTerminalReplay = vi
      .fn()
      .mockReturnValueOnce(firstReplay)
      .mockResolvedValueOnce('session-b-frame')

    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    const wrapper = mount(TerminalViewport, {
      props: { project: baseProject, session: baseSession },
    })
    await flushTerminal()

    await wrapper.setProps({
      session: {
        ...baseSession,
        id: 'session_op_2',
        title: 'OpenCode 2'
      }
    })
    await flushTerminal()

    resolveFirstReplay('session-a-frame')
    await flushTerminal()

    const { Terminal } = await import('@xterm/xterm')
    const instances = (Terminal as unknown as { instances: Array<{ writes: string[] }> }).instances
    expect(instances.at(-1)?.writes).not.toContain('session-a-frame')
    expect(instances.at(-1)?.writes).toContain('session-b-frame')
  })

  test('awaiting_input still renders the live terminal instead of the overlay', async () => {
    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    const wrapper = mount(TerminalViewport, {
      props: {
        project: baseProject,
        session: {
          ...baseSession,
          status: 'awaiting_input'
        }
      },
    })
    await flushTerminal()

    expect(wrapper.find('.terminal-viewport__xterm').exists()).toBe(true)
    expect(wrapper.find('.terminal-viewport__overlay').exists()).toBe(false)
  })

  test('turn_complete still renders the live terminal instead of the overlay', async () => {
    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    const wrapper = mount(TerminalViewport, {
      props: {
        project: baseProject,
        session: {
          ...baseSession,
          status: 'turn_complete'
        }
      },
    })
    await flushTerminal()

    expect(wrapper.find('.terminal-viewport__xterm').exists()).toBe(true)
    expect(wrapper.find('.terminal-viewport__overlay').exists()).toBe(false)
  })

  test('shows overlay for starting status', async () => {
    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    const session = { ...baseSession, status: 'starting' as const }
    const wrapper = mount(TerminalViewport, {
      props: { project: baseProject, session },
    })

    expect(wrapper.find('.terminal-viewport__overlay').exists()).toBe(true)
    expect(wrapper.text()).toContain('starting')
  })

  test('shows overlay for error status', async () => {
    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    const session = { ...baseSession, status: 'error' as const, summary: 'crash' }
    const wrapper = mount(TerminalViewport, {
      props: { project: baseProject, session },
    })

    expect(wrapper.find('.terminal-viewport__overlay').exists()).toBe(true)
    expect(wrapper.text()).toContain('crash')
  })

  test('renders all metadata fields in overlay', async () => {
    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    const session = { ...baseSession, status: 'bootstrapping' as const }
    const wrapper = mount(TerminalViewport, {
      props: { project: baseProject, session },
    })

    const text = wrapper.text()
    expect(text).toContain('Deploy')
    expect(text).toContain('alpha')
    expect(text).toContain('D:/alpha')
    expect(text).toContain('resume-external')
    expect(text).toContain('ext-123')
    expect(text).toContain('bootstrapping')
  })

  test('shows "not bound" when no external session id', async () => {
    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    const session = { ...baseSession, status: 'starting' as const, externalSessionId: null }
    const wrapper = mount(TerminalViewport, {
      props: { project: baseProject, session },
    })

    expect(wrapper.text()).toContain('not bound')
  })

  test('uses terminalFontSize from settings store for the xterm instance', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.terminalFontSize = 18

    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    mount(TerminalViewport, {
      props: { project: baseProject, session: baseSession },
    })
    await flushTerminal()

    const { Terminal } = await import('@xterm/xterm')
    const instance = (Terminal as unknown as { instances: Array<{ options: Record<string, unknown> }> }).instances.at(-1)
    expect(instance?.options.fontSize).toBe(18)
  })
})
