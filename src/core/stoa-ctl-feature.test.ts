import { describe, expect, test, vi } from 'vitest'
import { createStoaCtlGate, isStoaCtlEnabled } from './stoa-ctl-feature'
import { DEFAULT_SETTINGS } from '@shared/project-session'

describe('stoaCtlGate', () => {
  test('initial value comes from settings', () => {
    const gate = createStoaCtlGate(false)
    expect(gate.isEnabled()).toBe(false)
  })

  test('initial value true works', () => {
    const gate = createStoaCtlGate(true)
    expect(gate.isEnabled()).toBe(true)
  })

  test('setEnabled toggles state and fires enabledChanged', async () => {
    const gate = createStoaCtlGate(false)
    const listener = vi.fn()
    gate.on('enabledChanged', listener)
    await gate.setEnabled(true)
    expect(gate.isEnabled()).toBe(true)
    expect(listener).toHaveBeenCalledWith(true)
    await gate.setEnabled(false)
    expect(gate.isEnabled()).toBe(false)
    expect(listener).toHaveBeenLastCalledWith(false)
  })

  test('off() unsubscribes listener', async () => {
    const gate = createStoaCtlGate(false)
    const listener = vi.fn()
    const off = gate.on('enabledChanged', listener)
    off()
    await gate.setEnabled(true)
    expect(listener).not.toHaveBeenCalled()
  })

  test('multiple listeners all fire', async () => {
    const gate = createStoaCtlGate(false)
    const l1 = vi.fn()
    const l2 = vi.fn()
    gate.on('enabledChanged', l1)
    gate.on('enabledChanged', l2)
    await gate.setEnabled(true)
    expect(l1).toHaveBeenCalledWith(true)
    expect(l2).toHaveBeenCalledWith(true)
  })
})

describe('isStoaCtlEnabled helper', () => {
  test('returns settings.stoaCtlEnabled', () => {
    expect(isStoaCtlEnabled(DEFAULT_SETTINGS)).toBe(false)
    expect(isStoaCtlEnabled({ ...DEFAULT_SETTINGS, stoaCtlEnabled: true })).toBe(true)
  })
})
