import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { AppSettings } from '@shared/project-session'

export const useSettingsStore = defineStore('settings', () => {
  const shellPath = ref('')
  const terminalFontSize = ref(14)
  const providers = ref<Record<string, string>>({})
  const loaded = ref(false)

  async function loadSettings(): Promise<void> {
    const settings = await window.stoa.getSettings()
    if (settings) {
      shellPath.value = settings.shellPath
      terminalFontSize.value = settings.terminalFontSize
      providers.value = { ...settings.providers }
    }
    loaded.value = true
  }

  async function updateSetting(key: string, value: unknown): Promise<void> {
    await window.stoa.setSetting(key, value)
    if (key === 'shellPath' && typeof value === 'string') {
      shellPath.value = value
    } else if (key === 'terminalFontSize' && typeof value === 'number') {
      terminalFontSize.value = Math.max(12, Math.min(24, value))
    } else if (key === 'providers' && typeof value === 'object' && value !== null) {
      providers.value = { ...(value as Record<string, string>) }
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

  async function pickFolder(title?: string): Promise<string | null> {
    return window.stoa.pickFolder(title ? { title } : undefined)
  }

  async function pickFile(options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null> {
    return window.stoa.pickFile(options)
  }

  return {
    shellPath, terminalFontSize, providers, loaded,
    loadSettings, updateSetting, detectAndSetShell, detectAndSetProvider,
    pickFolder, pickFile
  }
})
