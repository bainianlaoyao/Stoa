import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensureStoaCtlShim,
  unregisterStoaCtlShim,
  unregisterStoaCtlSystemShim,
  unregisterPosixPath
} from '@core/stoa-ctl-shim'
import { isStoaCtlEnabled, createStoaCtlGate } from '@core/stoa-ctl-feature'
import { buildSessionCommandEnv } from '@core/session-command-env'
import { DEFAULT_SETTINGS } from '@shared/project-session'

describe('stoa-ctl settings toggle (e2e composition)', () => {
  let tempHome: string
  let tempBin: string
  let tempUserData: string

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'stoactl-e2e-home-'))
    tempBin = mkdtempSync(join(tmpdir(), 'stoactl-e2e-bin-'))
    tempUserData = mkdtempSync(join(tmpdir(), 'stoactl-e2e-ud-'))
  })

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true })
    rmSync(tempBin, { recursive: true, force: true })
    rmSync(tempUserData, { recursive: true, force: true })
  })

  test('default settings: shim absent, env stripped, gate.isEnabled() === false', async () => {
    const settings = DEFAULT_SETTINGS
    expect(isStoaCtlEnabled(settings)).toBe(false)
    expect(existsSync(join(tempUserData, 'bin', 'stoa-ctl.cmd'))).toBe(false)

    const env = buildSessionCommandEnv({
      sessionId: 's-1',
      sessionToken: 'tok',
      webhookPort: 12345,
      stoaCtlBinDir: tempBin,
      stoaCtlEnabled: isStoaCtlEnabled(settings)
    })
    expect(env.STOA_CTL_COMMAND).toBeUndefined()
  })

  test('enabled: shim created, env populated, gate.isEnabled() === true', async () => {
    const settings = { ...DEFAULT_SETTINGS, stoaCtlEnabled: true }
    await ensureStoaCtlShim({
      binDir: join(tempUserData, 'bin'),
      appRootPath: tempUserData,
      appExecutablePath: process.execPath,
      isPackaged: false
    })
    expect(existsSync(join(tempUserData, 'bin', 'stoa-ctl.cmd'))).toBe(true)

    const env = buildSessionCommandEnv({
      sessionId: 's-1',
      sessionToken: 'tok',
      webhookPort: 12345,
      stoaCtlBinDir: tempBin,
      stoaCtlEnabled: isStoaCtlEnabled(settings)
    })
    expect(env.STOA_CTL_COMMAND).toBe('stoa-ctl')
  })

  test('disabled cleanup: shim removed, env stripped', async () => {
    await ensureStoaCtlShim({
      binDir: join(tempUserData, 'bin'),
      appRootPath: tempUserData,
      appExecutablePath: process.execPath,
      isPackaged: false
    })
    expect(existsSync(join(tempUserData, 'bin', 'stoa-ctl.cmd'))).toBe(true)
    await unregisterStoaCtlShim(join(tempUserData, 'bin'))
    expect(existsSync(join(tempUserData, 'bin', 'stoa-ctl.cmd'))).toBe(false)
  })

  test('gate toggles and emits enabledChanged', async () => {
    const gate = createStoaCtlGate(false)
    const events: boolean[] = []
    gate.on('enabledChanged', (v) => { events.push(v) })
    await gate.setEnabled(true)
    expect(gate.isEnabled()).toBe(true)
    await gate.setEnabled(false)
    expect(gate.isEnabled()).toBe(false)
    expect(events).toEqual([true, false])
  })

  test('POSIX rc file line removed by unregisterPosixPath', async () => {
    if (process.platform === 'win32') return
    const rcFile = join(tempHome, '.bashrc')
    const original = 'export PATH="$HOME/.local/bin:$PATH"\nexport PATH="$HOME/.stoa/bin:$PATH" # stoa-ctl\nexport FOO=bar\n'
    writeFileSync(rcFile, original, 'utf8')
    await unregisterPosixPath(join(tempHome, '.stoa', 'bin'))
    const after = readFileSync(rcFile, 'utf8')
    expect(after).not.toContain('# stoa-ctl')
    expect(after).toContain('export FOO=bar')
  })
})
