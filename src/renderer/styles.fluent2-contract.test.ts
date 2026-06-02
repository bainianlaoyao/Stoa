import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('official Fluent 2 visual system contract', () => {
  test('design language names standard Fluent 2 as the visual authority', () => {
    const designLanguage = readRepoFile('docs/engineering/design-language.md')

    expect(designLanguage).toContain('Fluent 2')
    expect(designLanguage).toContain('Mica')
    expect(designLanguage).toContain('Acrylic')
    expect(designLanguage).toContain('Smoke')
    expect(designLanguage).toContain('design tokens')
    expect(designLanguage).not.toContain('Modern Minimalist Glassmorphism')
    expect(designLanguage).not.toContain('visionOS')
    expect(designLanguage).not.toContain('backdrop-filter: blur(40px)')
  })

  test('token layer exposes Fluent 2 material and control tokens', () => {
    const styles = readRepoFile('src/renderer/styles/tailwind.css')

    const requiredTokens = [
      '--mica',
      '--mica-alt',
      '--acrylic',
      '--smoke',
      '--control-fill',
      '--control-fill-hover',
      '--stroke-control',
      '--shadow-flyout-val',
      '--duration-rest',
      '--duration-emphasized',
      '--curve-standard',
      '--curve-decelerate'
    ]

    for (const token of requiredTokens) {
      expect(styles).toContain(token)
    }
  })

  test('token layer removes old glass authority names', () => {
    const styles = readRepoFile('src/renderer/styles/tailwind.css')

    expect(styles).not.toContain('--shadow-glass')
    expect(styles).not.toContain('--shadow-premium')
    expect(styles).not.toContain('--canvas-gradient')
    expect(styles).not.toContain('glassmorphism')
  })

  test('terminal tokens remain solid and readability-first', () => {
    const styles = readRepoFile('src/renderer/styles/tailwind.css')

    expect(styles).toContain('--color-terminal-bg: #0a0b0d;')
    expect(styles).toContain('--color-terminal-text: #e2e8f0;')
    expect(styles).not.toMatch(/--color-terminal-bg:\s*var\(--(?:mica|acrylic)\)/)
  })
})
