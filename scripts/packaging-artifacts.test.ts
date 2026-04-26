import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const packaging = await import('./packaging-artifacts.mjs')

describe('cross-platform packaging artifacts', () => {
  test('maps Node platforms to electron-builder platform names and update metadata files', () => {
    expect(packaging.resolveBuilderPlatform('win32')).toBe('win')
    expect(packaging.resolveBuilderPlatform('darwin')).toBe('mac')
    expect(packaging.resolveBuilderPlatform('linux')).toBe('linux')

    expect(packaging.resolveReleaseMetadataName('win32')).toBe('latest.yml')
    expect(packaging.resolveReleaseMetadataName('darwin')).toBe('latest-mac.yml')
    expect(packaging.resolveReleaseMetadataName('linux')).toBe('latest-linux.yml')
  })

  test('resolves unpacked executables for Windows macOS and Linux layouts', async () => {
    const releaseDir = await mkdtemp(join(tmpdir(), 'stoa-packaging-layout-'))
    await mkdir(join(releaseDir, 'win-unpacked'), { recursive: true })
    await mkdir(join(releaseDir, 'mac', 'Stoa.app', 'Contents', 'MacOS'), { recursive: true })
    await mkdir(join(releaseDir, 'linux-unpacked'), { recursive: true })

    const winExecutable = join(releaseDir, 'win-unpacked', 'Stoa.exe')
    const macExecutable = join(releaseDir, 'mac', 'Stoa.app', 'Contents', 'MacOS', 'Stoa')
    const linuxExecutable = join(releaseDir, 'linux-unpacked', 'stoa')
    await writeFile(winExecutable, '')
    await writeFile(macExecutable, '')
    await writeFile(linuxExecutable, '')
    await chmod(macExecutable, 0o755)
    await chmod(linuxExecutable, 0o755)

    expect(await packaging.resolvePackagedExecutable({ releaseDir, platform: 'win32', productName: 'Stoa', packageName: 'stoa' })).toBe(winExecutable)
    expect(await packaging.resolvePackagedExecutable({ releaseDir, platform: 'darwin', productName: 'Stoa', packageName: 'stoa' })).toBe(macExecutable)
    expect(await packaging.resolvePackagedExecutable({ releaseDir, platform: 'linux', productName: 'Stoa', packageName: 'stoa' })).toBe(linuxExecutable)
  })

  test('verifies metadata and primary artifacts for each release platform', async () => {
    const releaseDir = await mkdtemp(join(tmpdir(), 'stoa-packaging-verify-'))
    await mkdir(join(releaseDir, 'win-unpacked'), { recursive: true })
    await mkdir(join(releaseDir, 'mac', 'Stoa.app', 'Contents', 'MacOS'), { recursive: true })
    await mkdir(join(releaseDir, 'linux-unpacked'), { recursive: true })

    await writeFile(join(releaseDir, 'win-unpacked', 'Stoa.exe'), '')
    await writeFile(join(releaseDir, 'mac', 'Stoa.app', 'Contents', 'MacOS', 'Stoa'), '')
    await writeFile(join(releaseDir, 'linux-unpacked', 'stoa'), '')
    await writeFile(join(releaseDir, 'Stoa Setup 0.1.0.exe'), '')
    await writeFile(join(releaseDir, 'Stoa Setup 0.1.0.exe.blockmap'), '')
    await writeFile(join(releaseDir, 'Stoa-0.1.0-mac-x64.dmg'), '')
    await writeFile(join(releaseDir, 'Stoa-0.1.0-linux-x64.AppImage'), '')
    await writeFile(join(releaseDir, 'latest.yml'), 'path: Stoa Setup 0.1.0.exe\nfiles:\n  - url: Stoa Setup 0.1.0.exe\n')
    await writeFile(join(releaseDir, 'latest-mac.yml'), 'path: Stoa-0.1.0-mac-x64.dmg\nfiles:\n  - url: Stoa-0.1.0-mac-x64.dmg\n')
    await writeFile(join(releaseDir, 'latest-linux.yml'), 'path: Stoa-0.1.0-linux-x64.AppImage\nfiles:\n  - url: Stoa-0.1.0-linux-x64.AppImage\n')

    await expect(packaging.verifyPackagingBaseline({ releaseDir, platform: 'win32', productName: 'Stoa', packageName: 'stoa' })).resolves.toMatchObject({
      metadataName: 'latest.yml',
      artifactName: 'Stoa Setup 0.1.0.exe'
    })
    await expect(packaging.verifyPackagingBaseline({ releaseDir, platform: 'darwin', productName: 'Stoa', packageName: 'stoa' })).resolves.toMatchObject({
      metadataName: 'latest-mac.yml',
      artifactName: 'Stoa-0.1.0-mac-x64.dmg'
    })
    await expect(packaging.verifyPackagingBaseline({ releaseDir, platform: 'linux', productName: 'Stoa', packageName: 'stoa' })).resolves.toMatchObject({
      metadataName: 'latest-linux.yml',
      artifactName: 'Stoa-0.1.0-linux-x64.AppImage'
    })
  })

  test('rejects release metadata when the artifact size does not match the file on disk', async () => {
    const releaseDir = await mkdtemp(join(tmpdir(), 'stoa-packaging-size-'))
    await mkdir(join(releaseDir, 'linux-unpacked'), { recursive: true })

    await writeFile(join(releaseDir, 'linux-unpacked', 'stoa'), '')
    await writeFile(join(releaseDir, 'Stoa-0.1.0-linux-x64.AppImage'), 'tiny')
    await writeFile(join(releaseDir, 'latest-linux.yml'), 'path: Stoa-0.1.0-linux-x64.AppImage\nfiles:\n  - url: Stoa-0.1.0-linux-x64.AppImage\n    size: 999\n')

    await expect(packaging.verifyPackagingBaseline({ releaseDir, platform: 'linux', productName: 'Stoa', packageName: 'stoa' })).rejects.toThrow('size')
  })
})
