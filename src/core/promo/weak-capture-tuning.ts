export interface PromoCaptureWaitableHookRequest {
  body: Record<string, unknown>
  waitForTexts: string[]
}

export interface PromoWeakCapturePreset {
  mode: 'locator' | 'clip' | 'session-row'
  padding?: { x: number; y: number }
  hover?: boolean
}

const PERMISSION_BLOCKED_PROMO_HOOK_REQUEST: PromoCaptureWaitableHookRequest = {
  body: {
    hook_event_name: 'PermissionRequest'
  },
  waitForTexts: [
    'Blocked',
    'Provider is waiting for permission.'
  ]
}

const WEAK_CAPTURE_PRESETS: Record<string, PromoWeakCapturePreset> = {
  'closeup-terminal-meta-bar': {
    mode: 'locator'
  },
  'closeup-terminal-meta-explanation': {
    mode: 'clip',
    padding: { x: 18, y: 18 }
  },
  'closeup-session-status-permission-block': {
    mode: 'session-row',
    hover: true
  },
  'closeup-active-session-indicator': {
    mode: 'clip',
    padding: { x: 56, y: 28 }
  },
  'closeup-project-delete-confirm': {
    mode: 'clip',
    padding: { x: 44, y: 28 },
    hover: true
  }
}

export function createPermissionBlockedPromoHookRequest(): PromoCaptureWaitableHookRequest {
  return {
    body: {
      ...PERMISSION_BLOCKED_PROMO_HOOK_REQUEST.body
    },
    waitForTexts: [...PERMISSION_BLOCKED_PROMO_HOOK_REQUEST.waitForTexts]
  }
}

export function getWeakPromoCapturePreset(bundleName: keyof typeof WEAK_CAPTURE_PRESETS): PromoWeakCapturePreset {
  const preset = WEAK_CAPTURE_PRESETS[bundleName]
  return {
    ...preset,
    padding: preset.padding ? { ...preset.padding } : undefined
  }
}
