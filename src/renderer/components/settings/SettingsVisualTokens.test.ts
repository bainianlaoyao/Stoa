import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const settingsDir = dirname(fileURLToPath(import.meta.url))
const settingsFiles = [
  'GeneralSettings.vue',
  'TerminalSettings.vue',
  'ProvidersSettings.vue',
  'AdvancedSettings.vue',
  'AboutSettings.vue'
]

function readSettingsSource(filename: string): string {
  return readFileSync(resolve(settingsDir, filename), 'utf8')
}

describe('settings visual token contracts', () => {
  it('does not keep the invalid border-b shorthand in settings headers', () => {
    for (const filename of settingsFiles) {
      expect(readSettingsSource(filename)).not.toContain('border-b:')
    }
  })

  it('does not keep hardcoded card hover accent colors in settings components', () => {
    for (const filename of settingsFiles) {
      expect(readSettingsSource(filename)).not.toContain('rgba(0, 85, 255, 0.15)')
    }
  })

  it('does not keep hardcoded neutral badge and toggle surfaces', () => {
    for (const filename of settingsFiles) {
      const source = readSettingsSource(filename)

      expect(source).not.toContain('background: rgba(0, 0, 0, 0.03);')
      expect(source).not.toContain('background: rgba(0, 0, 0, 0.008);')
      expect(source).not.toContain('border: 1px solid rgba(0, 0, 0, 0.01);')
    }
  })
})
