import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type {
  PromoAsset,
  PromoAssetCategory,
  PromoAssetKind,
  PromoAssetSource
} from './types'

const MEDIA_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.mov'])
const CATEGORY_PREFIXES: PromoAssetCategory[] = ['overview', 'workflow', 'closeup', 'meta', 'trust', 'pack']

export async function collectBundleAssets(input: {
  bundleRootDir: string
  relativePrefix?: string
  excludeBundleNames?: string[]
}): Promise<PromoAsset[]> {
  if (!existsSync(input.bundleRootDir)) {
    return []
  }

  return await collectBundleAssetsFromDirectory({
    currentDir: input.bundleRootDir,
    currentRelativePath: input.relativePrefix ?? '',
    excludedBundleNames: new Set(input.excludeBundleNames ?? [])
  })
}

export function inferBundleCategory(bundleName: string): PromoAssetCategory {
  for (const prefix of CATEGORY_PREFIXES) {
    if (bundleName === prefix || bundleName.startsWith(`${prefix}-`)) {
      return prefix
    }
  }
  return 'overview'
}

export function inferBundleKind(bundleName: string, extension: string): PromoAssetKind {
  const category = inferBundleCategory(bundleName)
  if (category === 'trust') {
    return 'fact-card'
  }

  const base = stripBundlePrefix(bundleName)
  const lowerExtension = extension.toLowerCase()
  if (base.includes('social-preview')) {
    return 'social-preview'
  }
  if (lowerExtension === '.gif') {
    return 'gif'
  }
  if (lowerExtension === '.mp4' || lowerExtension === '.mov') {
    return 'video'
  }
  return 'screenshot'
}

export function inferBundleSource(relativeBundlePath: string, bundleName: string): PromoAssetSource {
  const category = inferBundleCategory(bundleName)
  if (!relativeBundlePath.startsWith('generated/')) {
    return category === 'closeup' ? 'manual-capture' : 'readme-sync'
  }
  if (category === 'trust') {
    return 'fact-card-generator'
  }
  if (category === 'pack') {
    return 'derived-pack'
  }
  if (stripBundlePrefix(bundleName).startsWith('readme-')) {
    return 'readme-sync'
  }
  return 'electron-capture'
}

export function inferBundleScene(bundleName: string, index: number, totalFiles: number): string {
  const category = inferBundleCategory(bundleName)
  const base = stripBundlePrefix(bundleName)
  if (category === 'pack' && totalFiles <= 1 && !/-\d+$/.test(base)) {
    return bundleName
  }
  if (totalFiles <= 1 || /-\d+$/.test(base)) {
    return base
  }
  return `${base}-${index + 1}`
}

export function inferBundleTags(bundleName: string): string[] {
  const category = inferBundleCategory(bundleName)
  const tokens = [category, ...stripBundlePrefix(bundleName).split('-')]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  return [...new Set(tokens)]
}

export function isPromoMediaFile(fileName: string): boolean {
  return MEDIA_EXTENSIONS.has(extname(fileName).toLowerCase())
}

async function readBundleAssets(bundleDir: string, relativeBundlePath: string): Promise<PromoAsset[]> {
  const bundleName = basename(bundleDir)
  const note = await readBundleNote(bundleDir)
  const entries = (await readdir(bundleDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && isPromoMediaFile(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))

  const category = inferBundleCategory(bundleName)
  const source = inferBundleSource(relativeBundlePath, bundleName)

  return entries.map((entry, index) => {
    const absolutePath = join(bundleDir, entry.name)
    const relativePath = `${relativeBundlePath}/${entry.name}`.replaceAll('\\', '/')
    return {
      fileName: entry.name,
      relativePath,
      absolutePath,
      pointId: bundleName,
      note,
      alt: null,
      category,
      scene: inferBundleScene(bundleName, index, entries.length),
      kind: inferBundleKind(bundleName, extname(entry.name)),
      tags: inferBundleTags(bundleName),
      source,
      derivesFrom: []
    }
  })
}

async function collectBundleAssetsFromDirectory(input: {
  currentDir: string
  currentRelativePath: string
  excludedBundleNames: Set<string>
}): Promise<PromoAsset[]> {
  const entries = (await readdir(input.currentDir, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))
  const mediaEntries = entries.filter((entry) => entry.isFile() && isPromoMediaFile(entry.name))

  if (mediaEntries.length > 0 && input.currentRelativePath) {
    return await readBundleAssets(input.currentDir, input.currentRelativePath)
  }

  const assets: PromoAsset[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || input.excludedBundleNames.has(entry.name)) {
      continue
    }

    const nextRelativePath = input.currentRelativePath
      ? `${input.currentRelativePath}/${entry.name}`
      : entry.name
    assets.push(...await collectBundleAssetsFromDirectory({
      currentDir: join(input.currentDir, entry.name),
      currentRelativePath: nextRelativePath,
      excludedBundleNames: input.excludedBundleNames
    }))
  }

  return assets
}

async function readBundleNote(bundleDir: string): Promise<string | null> {
  const notePath = join(bundleDir, 'index.md')
  if (!existsSync(notePath)) {
    return null
  }
  const trimmed = (await readFile(notePath, 'utf8')).trim()
  return trimmed || null
}

function stripBundlePrefix(bundleName: string): string {
  const category = inferBundleCategory(bundleName)
  if (bundleName === category) {
    return bundleName
  }
  if (bundleName.startsWith(`${category}-`)) {
    return bundleName.slice(category.length + 1)
  }
  return bundleName
}
