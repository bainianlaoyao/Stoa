import { describe, expect, test } from 'vitest'
import {
  createPermissionBlockedPromoHookRequest,
  getWeakPromoCapturePreset
} from './weak-capture-tuning'

describe('weak-capture-tuning', () => {
  test('defines a real claude permission hook request for terminal meta promo captures', () => {
    expect(createPermissionBlockedPromoHookRequest()).toEqual({
      body: {
        hook_event_name: 'PermissionRequest'
      },
      waitForTexts: [
        'Blocked',
        'Provider is waiting for permission.'
      ]
    })
  })

  test('uses wider and more contextual presets for the weak screenshot bundles', () => {
    expect(getWeakPromoCapturePreset('closeup-terminal-meta-bar')).toEqual({
      mode: 'locator'
    })
    expect(getWeakPromoCapturePreset('closeup-terminal-meta-explanation')).toEqual({
      mode: 'clip',
      padding: { x: 18, y: 18 }
    })
    expect(getWeakPromoCapturePreset('closeup-session-status-permission-block')).toEqual({
      mode: 'session-row',
      hover: true
    })
    expect(getWeakPromoCapturePreset('closeup-active-session-indicator')).toEqual({
      mode: 'clip',
      padding: { x: 56, y: 28 }
    })
    expect(getWeakPromoCapturePreset('closeup-project-delete-confirm')).toEqual({
      mode: 'clip',
      padding: { x: 44, y: 28 },
      hover: true
    })
  })
})
