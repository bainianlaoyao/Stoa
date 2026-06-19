// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { createRendererApiMock } from '@shared/test-fixtures'
import App from './App.vue'

vi.mock('@renderer/components/AppShell.vue', () => ({
  default: defineComponent({
    name: 'AppShell',
    setup() {
      return () => h('section', { 'data-testid': 'desktop-shell' }, 'desktop')
    }
  })
}))

vi.mock('@renderer/components/mobile/MobileAppShell.vue', () => ({
  default: defineComponent({
    name: 'MobileAppShell',
    props: {
      healthStatus: { type: String, required: true },
      healthMessage: { default: null }
    },
    emits: ['retryHealth'],
    setup(props, { emit }) {
      return () => h('section', {
        'data-testid': 'mobile-shell',
        'data-health-status': props.healthStatus,
        'data-health-message': props.healthMessage ?? '',
        onClick: () => emit('retryHealth')
      }, 'mobile')
    }
  })
}))

function installMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string): MediaQueryList => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('App mobile shell breakpoint', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.stoa = createRendererApiMock({
      checkBackendHealth: vi.fn().mockResolvedValue({
        healthy: false,
        checkedAt: '2026-06-19T00:00:00.000Z',
        backend: { available: false },
        coreSessionService: { available: false },
        reason: 'backend_unavailable',
        message: 'offline'
      }),
      getBootstrapState: vi.fn().mockResolvedValue({
        activeProjectId: null,
        activeSessionId: null,
        terminalWebhookPort: 0,
        projects: [],
        sessions: []
      }),
      getSettings: vi.fn().mockResolvedValue({
        shellPath: '',
        terminal: {},
        providers: {},
        titleGeneration: {
          enabled: false,
          apiKey: '',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.4-mini'
        },
        workspaceIde: { id: 'vscode', executablePath: '' },
        evolverInferenceProvider: 'claude-code',
        evolverExecutionMode: 'workspace-shell',
        claudeDangerouslySkipPermissions: false,
        locale: 'en'
      })
    })
  })

  it('uses the mobile shell at <=768px', async () => {
    installMatchMedia(true)

    const wrapper = mount(App, {
      global: {
        plugins: [createPinia()]
      }
    })
    await flush()

    expect(wrapper.find('[data-testid="mobile-shell"]').exists()).toBe(true)
    await flush()
    expect(wrapper.find('[data-testid="mobile-shell"]').attributes('data-health-status')).toBe('reconnecting')
    expect(wrapper.find('[data-testid="desktop-shell"]').exists()).toBe(false)
  })

  it('keeps the desktop shell above the mobile breakpoint', async () => {
    installMatchMedia(false)

    const wrapper = mount(App, {
      global: {
        plugins: [createPinia()]
      }
    })
    await flush()

    expect(wrapper.find('[data-testid="desktop-shell"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mobile-shell"]').exists()).toBe(false)
  })
})
