import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { ensurePromoScaffold } from './promo-paths'
import type { PromoAsset, PromoFactPack, PromoPaths, PromoPostHistoryEntry, PromoRepoFact } from './types'

const ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.mov'])

export async function buildFactPack(repoRoot: string): Promise<PromoFactPack> {
  const paths = await ensurePromoScaffold(repoRoot)
  const repoFacts = await collectRepoFacts(repoRoot)
  const assets = await collectAssets(paths.assetsDir)
  const recentPosts = await readRecentPosts(paths.postHistoryPath)

  return {
    generatedAt: new Date().toISOString(),
    project: {
      name: inferProjectName(repoFacts, repoRoot),
      repoRoot
    },
    repoFacts,
    assets,
    recentPosts
  }
}

export async function writeFactPackArtifact(paths: PromoPaths, factPack: PromoFactPack): Promise<void> {
  await writeFile(paths.factPackPath, `${JSON.stringify(factPack, null, 2)}\n`, 'utf8')
}

async function collectRepoFacts(repoRoot: string): Promise<PromoRepoFact[]> {
  const facts: PromoRepoFact[] = []
  const fixedPaths = [
    'README.md',
    'README.zh-CN.md',
    join('docs', 'product', 'promotion-copy.md')
  ]

  for (const relativePath of fixedPaths) {
    const absolutePath = join(repoRoot, relativePath)
    if (!existsSync(absolutePath)) {
      continue
    }
    facts.push({
      path: relativePath.replaceAll('\\', '/'),
      content: await readFile(absolutePath, 'utf8')
    })
  }

  if (existsSync(repoRoot)) {
    const entries = await readdir(repoRoot)
    for (const entry of entries.filter((value) => /^release-notes-.*\.md$/i.test(value)).sort()) {
      facts.push({
        path: entry,
        content: await readFile(join(repoRoot, entry), 'utf8')
      })
    }
  }

  return facts
}

async function collectAssets(assetsDir: string): Promise<PromoAsset[]> {
  if (!existsSync(assetsDir)) {
    return []
  }

  const entries = (await readdir(assetsDir)).sort()
  const assets: PromoAsset[] = []

  for (const entry of entries) {
    const extension = extname(entry).toLowerCase()
    if (!ASSET_EXTENSIONS.has(extension)) {
      continue
    }

    const absolutePath = join(assetsDir, entry)
    const notePath = join(assetsDir, `${basename(entry, extension)}.md`)
    assets.push({
      fileName: entry,
      absolutePath,
      note: existsSync(notePath) ? (await readFile(notePath, 'utf8')).trim() || null : null
    })
  }

  return assets
}

async function readRecentPosts(postHistoryPath: string): Promise<PromoPostHistoryEntry[]> {
  if (!existsSync(postHistoryPath)) {
    return []
  }

  const parsed = JSON.parse(await readFile(postHistoryPath, 'utf8')) as PromoPostHistoryEntry[]
  return Array.isArray(parsed) ? parsed.slice(-10) : []
}

function inferProjectName(repoFacts: PromoRepoFact[], repoRoot: string): string {
  const readme = repoFacts.find((entry) => entry.path === 'README.md')?.content
  const heading = readme?.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (heading) {
    return heading
  }

  return basename(repoRoot)
}
