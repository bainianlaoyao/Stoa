import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

function readRendererFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('renderer typography baseline', () => {
  test('shared renderer styles do not keep tiny 10px text or ultra-light 300 weight', () => {
    const styles = readRendererFile('src/renderer/styles/tailwind.css')

    expect(styles).not.toMatch(/font-size:\s*10px;/)
    expect(styles).not.toMatch(/font:\s*10px\b/)
    expect(styles).not.toMatch(/font-weight:\s*300;/)
  })

  test('archive and terminal detail surfaces do not keep 10px typography', () => {
    const archiveSurface = readRendererFile('src/renderer/components/archive/ArchiveSurface.vue')
    const terminalViewport = readRendererFile('src/renderer/components/TerminalViewport.vue')

    expect(archiveSurface).not.toMatch(/font-size:\s*10px;/)
    expect(archiveSurface).not.toMatch(/font:\s*10px\b/)
    expect(terminalViewport).not.toMatch(/font-size:\s*10px;/)
  })
})
