import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { AppSettings, WorkspaceIdeSettings } from '@shared/project-session'
import { BUILTIN_FONT_FAMILIES } from '@shared/project-session'
import i18n, { SUPPORTED_LOCALES } from '@renderer/i18n'
import type { SupportedLocale } from '@renderer/i18n'

export const useSettingsStore = defineStore('settings', () => {
  const shellPath = ref('')
  const terminalFontSize = ref(14)
  const terminalFontFamily = ref('JetBrains Mono')
  const providers = ref<Record<string, string>>({})
  const workspaceIde = ref<WorkspaceIdeSettings>({ id: 'vscode', executablePath: '' })
  const claudeDangerouslySkipPermissions = ref(false)
  const locale = ref<string>(i18n.global.locale.value as string)
  const loaded = ref(false)

  async function loadSettings(): Promise<void> {
    const settings = await window.stoa.getSettings()
    if (settings) {
      shellPath.value = settings.shellPath
      terminalFontSize.value = settings.terminalFontSize
      if (settings.terminalFontFamily) {
        terminalFontFamily.value = settings.terminalFontFamily
      }
      providers.value = { ...settings.providers }
      workspaceIde.value = { ...settings.workspaceIde }
      claudeDangerouslySkipPermissions.value = settings.claudeDangerouslySkipPermissions === true
      if (settings.locale && SUPPORTED_LOCALES.includes(settings.locale as SupportedLocale)) {
        locale.value = settings.locale
      } else {
        locale.value = i18n.global.locale.value as SupportedLocale
      }
    }
    loaded.value = true
    void applyLocale(locale.value)
  }

  async function updateSetting(key: string, value: unknown): Promise<void> {
    await window.stoa.setSetting(key, value)
    if (key === 'shellPath' && typeof value === 'string') {
      shellPath.value = value
    } else if (key === 'terminalFontSize' && typeof value === 'number') {
      terminalFontSize.value = Math.max(12, Math.min(24, value))
    } else if (key === 'terminalFontFamily' && typeof value === 'string') {
      terminalFontFamily.value = BUILTIN_FONT_FAMILIES.includes(value as any) ? value : 'JetBrains Mono'
    } else if (key === 'providers' && typeof value === 'object' && value !== null) {
      providers.value = { ...(value as Record<string, string>) }
    } else if (key === 'workspaceIde' && isWorkspaceIdeSettings(value)) {
      workspaceIde.value = { ...value }
    } else if (key === 'claudeDangerouslySkipPermissions' && typeof value === 'boolean') {
      claudeDangerouslySkipPermissions.value = value
    } else if (key === 'locale' && typeof value === 'string') {
      locale.value = value
    }
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

  return {
    shellPath, terminalFontSize, terminalFontFamily, providers, workspaceIde, claudeDangerouslySkipPermissions, locale, loaded,
    loadSettings, updateSetting, detectAndSetShell, detectAndSetProvider, detectAndSetVscode,
    pickFolder, pickFile, applyLocale
  }
})
