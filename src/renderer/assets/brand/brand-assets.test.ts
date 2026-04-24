import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import stoaSymbol from './stoa-symbol.svg'
import stoaWordmarkHorizontal from './stoa-wordmark-horizontal.svg'

const brandDir = dirname(fileURLToPath(import.meta.url))

describe('renderer brand assets', () => {
  it('resolve through the Vite asset pipeline', () => {
    expect(stoaSymbol).toMatch(/^data:image\/svg\+xml,/)
    expect(stoaWordmarkHorizontal).toMatch(/^data:image\/svg\+xml,/)
  })

  it('keep the symbol SVG within the approved renderer contract', () => {
    const source = readFileSync(resolve(brandDir, 'stoa-symbol.svg'), 'utf8')

    expect(source).toContain('viewBox="0 0 64 64"')
    expect(source).not.toContain('<image')
    expect(source).not.toContain('data:image')
    expect(source).not.toContain('<text')
    expect(source).not.toContain('currentColor')
  })

  it('keeps the horizontal wordmark self-contained and font-independent', () => {
    const source = readFileSync(resolve(brandDir, 'stoa-wordmark-horizontal.svg'), 'utf8')

    expect(source).not.toContain('<image')
    expect(source).not.toContain('data:image')
    expect(source).not.toContain('<text')
    expect(source).not.toContain('font-family')
  })
})
