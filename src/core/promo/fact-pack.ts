import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { collectBundleAssets } from './asset-bundles'
import { ensurePromoScaffold } from './promo-paths'
import type {
  PromoFactPack,
  PromoPackDefinition,
  PromoPaths,
  PromoPostHistoryEntry,
  PromoRepoFact
} from './types'

export async function buildFactPack(repoRoot: string): Promise<PromoFactPack> {
  const paths = await ensurePromoScaffold(repoRoot)
  const repoFacts = await collectRepoFacts(repoRoot)
  const assets = await collectBundleAssets({
    bundleRootDir: paths.assetsDir
  })
  const packs = await readPackDefinitions(paths)
  const recentPosts = await readRecentPosts(paths.postHistoryPath)

  return {
    generatedAt: new Date().toISOString(),
    project: {
      name: inferProjectName(repoFacts, repoRoot),
      repoRoot
    },
    repoFacts,
    assets,
    packs,
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

async function readRecentPosts(postHistoryPath: string): Promise<PromoPostHistoryEntry[]> {
  if (!existsSync(postHistoryPath)) {
    return []
  }

  const parsed = JSON.parse(await readFile(postHistoryPath, 'utf8')) as PromoPostHistoryEntry[]
  return Array.isArray(parsed) ? parsed.slice(-10) : []
}

async function readPackDefinitions(paths: PromoPaths): Promise<PromoPackDefinition[]> {
  if (!existsSync(paths.packsDir)) {
    return []
  }

  const entries = (await readdir(paths.packsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name))

  const packs: PromoPackDefinition[] = []
  for (const entry of entries) {
    const parsed = JSON.parse(await readFile(join(paths.packsDir, entry.name), 'utf8')) as Partial<PromoPackDefinition>
    if (!parsed.id || !parsed.title || !parsed.goal || !Array.isArray(parsed.pointIds) || !Array.isArray(parsed.platforms)) {
      continue
    }
    packs.push({
      id: parsed.id,
      title: parsed.title,
      goal: parsed.goal,
      pointIds: [...parsed.pointIds],
      platforms: [...parsed.platforms],
      note: typeof parsed.note === 'string' ? parsed.note : null
    })
  }

  return packs
}

function inferProjectName(repoFacts: PromoRepoFact[], repoRoot: string): string {
  const readme = repoFacts.find((entry) => entry.path === 'README.md')?.content
  const heading = readme?.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (heading) {
    return heading
  }

  return basename(repoRoot)
}
