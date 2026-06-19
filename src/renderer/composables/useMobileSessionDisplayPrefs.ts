import { computed, shallowRef, watch } from 'vue'

export type MobileSessionTextSize = 'small' | 'normal' | 'large'

export interface MobileSessionDisplayPrefs {
  wrapMode: 'wrap' | 'scroll'
  textSize: MobileSessionTextSize
}

const DEFAULT_PREFS: MobileSessionDisplayPrefs = {
  wrapMode: 'wrap',
  textSize: 'normal'
}

function storageKey(sessionId: string): string {
  return `stoa.mobile.session-display.${sessionId}`
}

function readPrefs(sessionId: string | null): MobileSessionDisplayPrefs {
  if (!sessionId || typeof window === 'undefined') {
    return { ...DEFAULT_PREFS }
  }

  try {
    const raw = window.localStorage.getItem(storageKey(sessionId))
    if (!raw) {
      return { ...DEFAULT_PREFS }
    }

    const parsed = JSON.parse(raw) as Partial<MobileSessionDisplayPrefs>
    return {
      wrapMode: parsed.wrapMode === 'scroll' ? 'scroll' : 'wrap',
      textSize: parsed.textSize === 'small' || parsed.textSize === 'large' ? parsed.textSize : 'normal'
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function useMobileSessionDisplayPrefs(sessionId: () => string | null | undefined) {
  const prefs = shallowRef<MobileSessionDisplayPrefs>(readPrefs(sessionId() ?? null))

  watch(
    () => sessionId() ?? null,
    (nextSessionId) => {
      prefs.value = readPrefs(nextSessionId)
    }
  )

  watch(
    prefs,
    (nextPrefs) => {
      const currentSessionId = sessionId() ?? null
      if (!currentSessionId || typeof window === 'undefined') {
        return
      }

      window.localStorage.setItem(storageKey(currentSessionId), JSON.stringify(nextPrefs))
    },
    { deep: false }
  )

  const fontSizeDelta = computed(() => {
    if (prefs.value.textSize === 'small') {
      return -2
    }

    if (prefs.value.textSize === 'large') {
      return 2
    }

    return 0
  })

  function setWrapMode(wrapMode: MobileSessionDisplayPrefs['wrapMode']): void {
    prefs.value = {
      ...prefs.value,
      wrapMode
    }
  }

  function setTextSize(textSize: MobileSessionTextSize): void {
    prefs.value = {
      ...prefs.value,
      textSize
    }
  }

  return {
    prefs,
    fontSizeDelta,
    setWrapMode,
    setTextSize
  }
}
