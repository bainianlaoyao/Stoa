import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const baseModalPath = resolve(dirname(fileURLToPath(import.meta.url)), 'BaseModal.vue')

describe('BaseModal style contracts', () => {
  it('does not keep non-baseline leave timings or raw overlay utility colors', () => {
    const source = readFileSync(baseModalPath, 'utf8')

    expect(source).not.toContain('duration-150')
    expect(source).not.toContain('bg-black/45')
  })
})
