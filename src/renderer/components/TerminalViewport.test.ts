import { mount } from '@vue/test-utils'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'

vi.mock('@xterm/xterm', () => {
  class Terminal {
    cols = 80
    rows = 24
    private _onDataCallbacks: Array<(data: string) => void> = []

    open() {}
    write(data: string) {
      this._onDataCallbacks.forEach((cb) => cb(data))
    }
    onData(cb: (data: string) => void) {
      this._onDataCallbacks.push(cb)
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

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

function createMockApi() {
  const callbacks = {
    terminalData: [] as Array<(chunk: { sessionId: string; data: string }) => void>,
    sessionEvent: [] as Array<(event: { sessionId: string; status: string; summary: string }) => void>,
  }

  return {
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
}

describe('TerminalViewport', () => {
  let mockApi: ReturnType<typeof createMockApi>

  beforeEach(() => {
    mockApi = createMockApi()
    ;(window as Record<string, unknown>).stoa = mockApi
  })

  afterEach(() => {
    delete (window as Record<string, unknown>).stoa
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

  test('mounts xterm container when session is running', async () => {
    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    const wrapper = mount(TerminalViewport, {
      props: { project: baseProject, session: baseSession },
    })
    await nextTick()
    await nextTick()

    expect(wrapper.find('.terminal-viewport__xterm').exists()).toBe(true)
    expect(wrapper.find('.terminal-viewport__overlay').exists()).toBe(false)
  })

  test('registers onTerminalData listener on mount', async () => {
    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    mount(TerminalViewport, {
      props: { project: baseProject, session: baseSession },
    })
    await nextTick()
    await nextTick()

    expect(mockApi.onTerminalData).toHaveBeenCalled()
    expect(mockApi.onSessionEvent).toHaveBeenCalled()
  })

  test('calls sendSessionResize after fit', async () => {
    const { default: TerminalViewport } = await import('./TerminalViewport.vue')
    mount(TerminalViewport, {
      props: { project: baseProject, session: baseSession },
    })
    await nextTick()
    await nextTick()

    expect(mockApi.sendSessionResize).toHaveBeenCalledWith(
      'session_op_1',
      80,
      24
    )
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
})
