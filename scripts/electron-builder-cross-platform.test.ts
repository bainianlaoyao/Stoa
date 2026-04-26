import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

function readBuilderConfig(): string {
  return readFileSync('electron-builder.yml', 'utf8')
}

describe('electron-builder cross-platform contract', () => {
  test('declares explicit Windows macOS and Linux packaging targets', () => {
    const config = readBuilderConfig()

    expect(config).toMatch(/^win:/m)
    expect(config).toMatch(/^mac:/m)
    expect(config).toMatch(/^linux:/m)
    expect(config).toContain('dmg')
    expect(config).toContain('AppImage')
    expect(config).toContain('deb')
    expect(config).toContain('artifactName: "${productName}-Setup-${version}-${os}-${arch}.${ext}"')
    expect(config).toContain('artifactName: "${productName}-Portable-${version}-${os}-${arch}.${ext}"')
  })

  test('keeps node-pty outside asar without forcing local native rebuilds during packaging', () => {
    const config = readBuilderConfig()

    expect(config).toContain('asarUnpack:')
    expect(config).toContain('node_modules/node-pty/**')
    expect(config).toMatch(/^npmRebuild: false$/m)
  })

  test('exposes explicit package scripts for each desktop platform', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts.package).toContain('scripts/run-electron-builder.mjs')
    expect(packageJson.scripts['package:win']).toContain('scripts/run-electron-builder.mjs --win')
    expect(packageJson.scripts['package:mac']).toContain('scripts/run-electron-builder.mjs --mac')
    expect(packageJson.scripts['package:linux']).toContain('scripts/run-electron-builder.mjs --linux')
  })
})
