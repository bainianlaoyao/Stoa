import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const titleBarPath = resolve(dirname(fileURLToPath(import.meta.url)), 'TitleBar.vue')

describe('TitleBar style contracts', () => {
  it('does not keep hardcoded close-button colors or non-baseline timing classes', () => {
    const source = readFileSync(titleBarPath, 'utf8')

    expect(source).not.toContain('hover:bg-[#e81123]')
    expect(source).not.toContain('duration-150')
  })
})
