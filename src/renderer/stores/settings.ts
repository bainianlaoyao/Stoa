import { ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  EvolverExecutionMode,
  EvolverInferenceProvider,
  TitleGenerationSettings,
  WorkspaceIdeSettings
} from '@shared/project-session'
import { normalizeTerminalSettings, type TerminalSettings } from '@shared/terminal-settings'
import i18n, { SUPPORTED_LOCALES } from '@renderer/i18n'
import type { SupportedLocale } from '@renderer/i18n'

export const useSettingsStore = defineStore('settings', () => {
  const shellPath = ref('')
  const terminal = ref<Partial<TerminalSettings>>({})
  const providers = ref<Record<string, string>>({})
  const titleGeneration = ref<TitleGenerationSettings>({
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini'
  })
  const workspaceIde = ref<WorkspaceIdeSettings>({ id: 'vscode', executablePath: '' })
  const evolverInferenceProvider = ref<EvolverInferenceProvider>('claude-code')
  const evolverExecutionMode = ref<EvolverExecutionMode>('workspace-shell')
  const claudeDangerouslySkipPermissions = ref(false)
  const stoaCtlEnabled = ref(false)
  const locale = ref<string>(i18n.global.locale.value as string)
  const theme = ref<'light' | 'dark' | 'system'>('system')
  const loaded = ref(false)

  async function loadSettings(): Promise<void> {
    const settings = await window.stoa.getSettings()
    if (settings) {
      shellPath.value = settings.shellPath
      terminal.value = { ...settings.terminal ?? {} }
      providers.value = { ...settings.providers }
      titleGeneration.value = { ...settings.titleGeneration }
      workspaceIde.value = { ...settings.workspaceIde }
      if (settings.evolverInferenceProvider === 'claude-code') {
        evolverInferenceProvider.value = settings.evolverInferenceProvider
      }
      if (settings.evolverExecutionMode === 'workspace-shell') {
        evolverExecutionMode.value = settings.evolverExecutionMode
      }
      claudeDangerouslySkipPermissions.value = settings.claudeDangerouslySkipPermissions === true
      stoaCtlEnabled.value = settings.stoaCtlEnabled === true
      if (settings.locale && SUPPORTED_LOCALES.includes(settings.locale as SupportedLocale)) {
        locale.value = settings.locale
      } else {
        locale.value = i18n.global.locale.value as SupportedLocale
      }
      if (settings.theme === 'light' || settings.theme === 'dark' || settings.theme === 'system') {
        theme.value = settings.theme
      } else {
        theme.value = 'system'
      }
    }
    loaded.value = true
    void applyLocale(locale.value)
    applyTheme(theme.value)
  }

  async function updateSetting(key: string, value: unknown): Promise<void> {
    await window.stoa.setSetting(key, value)
    if (key === 'shellPath' && typeof value === 'string') {
      shellPath.value = value
    } else if (key === 'terminal' && typeof value === 'object' && value !== null) {
      terminal.value = { ...(value as Partial<TerminalSettings>) }
    } else if (key === 'providers' && typeof value === 'object' && value !== null) {
      providers.value = { ...(value as Record<string, string>) }
    } else if (key === 'titleGeneration' && isTitleGenerationSettings(value)) {
      titleGeneration.value = { ...value }
    } else if (key === 'workspaceIde' && isWorkspaceIdeSettings(value)) {
      workspaceIde.value = { ...value }
    } else if (
      key === 'evolverInferenceProvider'
      && value === 'claude-code'
    ) {
      evolverInferenceProvider.value = value
    } else if (key === 'evolverExecutionMode' && value === 'workspace-shell') {
      evolverExecutionMode.value = value
    } else if (key === 'claudeDangerouslySkipPermissions' && typeof value === 'boolean') {
      claudeDangerouslySkipPermissions.value = value
    } else if (key === 'locale' && typeof value === 'string') {
      locale.value = value
    } else if (key === 'theme' && (value === 'light' || value === 'dark' || value === 'system')) {
      theme.value = value
      applyTheme(value)
    } else if (key === 'stoaCtlEnabled' && typeof value === 'boolean') {
      stoaCtlEnabled.value = value
    }
  }

  function resolvedTerminalSettings(): TerminalSettings {
    return normalizeTerminalSettings(terminal.value)
  }

  async function detectAndSetShell(): Promise<string | null> {
    const detected = await window.stoa.detectShell()
    if (detected && !shellPath.value) {
      await updateSetting('shellPath', detected)
    }
    return detected
  }

  async function detectAndSetProvider(providerId: string): Promise<string | null> {
    const detected = await window.stoa.detectProvider(providerId)
    if (detected && !providers.value[providerId]) {
      const updated = { ...providers.value, [providerId]: detected }
      await updateSetting('providers', updated)
    }
    return detected
  }

  async function detectAndSetVscode(force?: boolean): Promise<string | null> {
    const detected = await window.stoa.detectVscode()
    if (detected && (force || !workspaceIde.value.executablePath)) {
      await updateSetting('workspaceIde', { id: workspaceIde.value.id, executablePath: detected })
    }
    return detected
  }

  async function pickFolder(title?: string): Promise<string | null> {
    return window.stoa.pickFolder(title ? { title } : undefined)
  }

  async function pickFile(options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null> {
    return window.stoa.pickFile(options)
  }

  async function applyLocale(newLocale: string): Promise<void> {
    i18n.global.locale.value = newLocale as 'en' | 'zh-CN'
  }

  function isWorkspaceIdeSettings(value: unknown): value is WorkspaceIdeSettings {
    return typeof value === 'object'
      && value !== null
      && 'id' in value
      && 'executablePath' in value
      && value.id === 'vscode'
      && typeof value.executablePath === 'string'
  }

  function isTitleGenerationSettings(value: unknown): value is TitleGenerationSettings {
    return typeof value === 'object'
      && value !== null
      && 'enabled' in value
      && 'apiKey' in value
      && 'baseUrl' in value
      && 'model' in value
      && typeof value.enabled === 'boolean'
      && typeof value.apiKey === 'string'
      && typeof value.baseUrl === 'string'
      && typeof value.model === 'string'
  }

  let mediaQuery: MediaQueryList | null = null
  function applyTheme(newTheme: 'light' | 'dark' | 'system'): void {
    if (typeof window === 'undefined') return
    const isDark = newTheme === 'dark' || (newTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    if (isDark) {
      document.documentElement.classList.add('theme-dark')
      document.documentElement.classList.remove('theme-light')
    } else {
      document.documentElement.classList.add('theme-light')
      document.documentElement.classList.remove('theme-dark')
    }
  }

  function handleSystemThemeChange(): void {
    if (theme.value === 'system') {
      applyTheme('system')
    }
  }

  if (typeof window !== 'undefined') {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', handleSystemThemeChange)
  }

  return {
    shellPath,
    terminal,
    providers,
    titleGeneration,
    workspaceIde,
    evolverInferenceProvider,
    evolverExecutionMode,
    claudeDangerouslySkipPermissions,
    stoaCtlEnabled,
    locale,
    theme,
    loaded,
    resolvedTerminalSettings,
    loadSettings, updateSetting, detectAndSetShell, detectAndSetProvider, detectAndSetVscode,
    pickFolder, pickFile, applyLocale, applyTheme
  }
})
