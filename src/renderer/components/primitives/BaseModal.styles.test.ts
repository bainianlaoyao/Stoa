import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const baseModalPath = resolve(dirname(fileURLToPath(import.meta.url)), 'BaseModal.vue')

describe('BaseModal style contracts', () => {
  it('uses Fluent 2 Smoke and Acrylic tokens for transient modal materials', () => {
    const source = readFileSync(baseModalPath, 'utf8')

    expect(source).toContain('var(--smoke)')
    expect(source).toContain('var(--acrylic)')
    expect(source).toContain('var(--shadow-flyout)')
    expect(source).not.toContain('duration-150')
    expect(source).not.toContain('bg-black/45')
    expect(source).not.toContain('shadow-premium')
  })
})
