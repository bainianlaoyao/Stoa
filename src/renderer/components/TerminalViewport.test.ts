// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TerminalViewport from './TerminalViewport.vue'
import type { WorkspaceSummary } from '@shared/workspace'

const terminalInstances: Array<{
  onDataHandler?: (data: string) => void
  onResizeHandler?: (event: { cols: number; rows: number }) => void
  write: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  loadAddon: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}> = []

vi.mock('@xterm/xterm', () => ({
  Terminal: class MockTerminal {
    onDataHandler?: (data: string) => void
    onResizeHandler?: (event: { cols: number; rows: number }) => void
    write = vi.fn()
    open = vi.fn()
    loadAddon = vi.fn()
    dispose = vi.fn()
    constructor() {
      terminalInstances.push(this)
    }
    onData(handler: (data: string) => void) {
      this.onDataHandler = handler
      return { dispose: vi.fn() }
    }
    onResize(handler: (event: { cols: number; rows: number }) => void) {
      this.onResizeHandler = handler
      return { dispose: vi.fn() }
    }
  }
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class MockFitAddon {
    fit = vi.fn()
  }
}))

const resizeObserverObserve = vi.fn()
const resizeObserverDisconnect = vi.fn()

class MockResizeObserver {
  observe = resizeObserverObserve
  disconnect = resizeObserverDisconnect
}

vi.stubGlobal('ResizeObserver', MockResizeObserver)

function createWorkspace(workspaceId: string): WorkspaceSummary {
  return {
    workspaceId,
    name: workspaceId,
    path: `D:/${workspaceId}`,
    providerId: 'opencode',
    status: 'running',
    summary: 'running',
    cliSessionId: `${workspaceId}-session`,
    isProvisional: false,
    workspaceSecret: 'secret',
    providerPort: 43128
  }
}

describe('TerminalViewport', () => {
  beforeEach(() => {
    terminalInstances.length = 0
    resizeObserverObserve.mockReset()
    resizeObserverDisconnect.mockReset()
    window.vibecoding = {
      getBootstrapState: vi.fn(),
      createWorkspace: vi.fn(),
      onWorkspaceEvent: vi.fn(() => vi.fn()),
      onTerminalData: vi.fn(() => vi.fn()),
      writeTerminalInput: vi.fn(),
      resizeTerminal: vi.fn(),
      setActiveWorkspace: vi.fn()
    }
  })

  test('subscribes to terminal data only once across workspace switches', async () => {
    const wrapper = mount(TerminalViewport, {
      props: {
        workspace: createWorkspace('ws_a')
      }
    })

    await wrapper.setProps({ workspace: createWorkspace('ws_b') })

    expect(window.vibecoding.onTerminalData).toHaveBeenCalledTimes(1)
  })

test('routes terminal input using the terminal owning workspace instead of current active workspace', async () => {
    const wrapper = mount(TerminalViewport, {
      props: {
        workspace: createWorkspace('ws_a')
      }
    })

    await wrapper.setProps({ workspace: createWorkspace('ws_b') })

    terminalInstances[0]?.onDataHandler?.('ls')

    expect(window.vibecoding.writeTerminalInput).toHaveBeenCalledWith('ws_a', 'ls')
  })

test('keeps separate terminal mounts per workspace after switching', async () => {
  const wrapper = mount(TerminalViewport, {
      props: {
        workspace: createWorkspace('ws_a')
      }
    })

    await wrapper.setProps({ workspace: createWorkspace('ws_b') })

  expect(wrapper.find('[data-terminal-owner="ws_a"]').exists()).toBe(true)
  expect(wrapper.find('[data-terminal-owner="ws_b"]').exists()).toBe(true)
})

test('renders the style-h terminal stream region for an active workspace', () => {
  const wrapper = mount(TerminalViewport, {
    props: {
      workspace: createWorkspace('ws_a')
    }
  })

  expect(wrapper.find('.terminal-stream').exists()).toBe(true)
  expect(wrapper.find('.terminal-stream__viewport').exists()).toBe(true)
  expect(wrapper.find('.terminal-stream__viewport').attributes('data-terminal-frame')).toBe('true')
  expect(wrapper.find('.terminal-surface__mount-stack').exists()).toBe(true)
  expect(wrapper.find('.terminal-surface__footer').exists()).toBe(false)
})
})
