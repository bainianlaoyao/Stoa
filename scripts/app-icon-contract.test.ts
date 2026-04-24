import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readFile(relativePath: string): Buffer {
  return readFileSync(resolve(process.cwd(), relativePath))
}

describe('packaged app icon contract', () => {
  it('uses the selected flat Stoa visual system for generated icon assets', () => {
    const iconSource = readFile('build/icons/icon-source.svg').toString('utf8')

    expect(iconSource).toContain('data-icon-style="flat-stoa"')
    expect(iconSource).toContain('fill="#0055FF"')
    expect(iconSource.match(/<rect /g)).toHaveLength(6)
    expect(iconSource).not.toContain('linearGradient')
    expect(iconSource).not.toContain('filter')
    expect(iconSource).not.toContain('<text')
    expect(iconSource).not.toContain('<image')
  })

  it('ships large raster and Windows ICO assets from the selected icon', () => {
    expect(readFile('build/icons/icon.png').length).toBeGreaterThan(10_000)
    expect(readFile('build/icons/icon-256.png').length).toBeGreaterThan(2_000)
    expect(readFile('build/icons/icon.ico').length).toBeGreaterThan(6_000)
  })
})
