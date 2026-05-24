import type {
  PromoAsset,
  PromoFactPack,
  PromoPackDefinition,
  PromoPostCandidate,
  PromoWeekPlanDay
} from './types'

const X_MAX_MEDIA_ATTACHMENTS = 4

export function expandWeekPlanDayPacks(days: PromoWeekPlanDay[], factPack: PromoFactPack): PromoWeekPlanDay[] {
  return days.map((day) => ({
    ...day,
    assetPaths: expandPackAssetPaths(day.packId ?? null, day.assetPaths, factPack)
  }))
}

export function expandPostCandidatePacks(posts: PromoPostCandidate[], factPack: PromoFactPack): PromoPostCandidate[] {
  return posts.map((post) => ({
    ...post,
    assetPaths: expandPackAssetPaths(post.packId ?? null, post.assetPaths, factPack)
  }))
}

function expandPackAssetPaths(
  packId: string | null,
  fallbackAssetPaths: string[],
  factPack: PromoFactPack
): string[] {
  if (!packId) {
    return limitAssetPathsForX(fallbackAssetPaths)
  }

  const pack = factPack.packs.find((candidate) => candidate.id === packId)
  if (!pack) {
    return limitAssetPathsForX(fallbackAssetPaths)
  }

  const expanded = pack.pointIds.flatMap((pointId) => resolvePointAssetPaths(pointId, factPack.assets))
  return expanded.length > 0
    ? limitAssetPathsForX(expanded)
    : limitAssetPathsForX(fallbackAssetPaths)
}

function resolvePointAssetPaths(pointId: string, assets: PromoAsset[]): string[] {
  return assets
    .filter((asset) => asset.pointId === pointId)
    .map((asset) => asset.relativePath)
}

function limitAssetPathsForX(assetPaths: string[]): string[] {
  const unique: string[] = []
  const pointIds = new Set<string>()

  for (const assetPath of assetPaths) {
    const normalized = assetPath.replaceAll('\\', '/').trim()
    if (!normalized) {
      continue
    }
    const pointId = inferPointIdFromAssetPath(normalized)
    if (pointId && pointIds.has(pointId)) {
      continue
    }
    if (pointId) {
      pointIds.add(pointId)
    }
    unique.push(normalized)
    if (unique.length >= X_MAX_MEDIA_ATTACHMENTS) {
      break
    }
  }

  return unique
}

function inferPointIdFromAssetPath(assetPath: string): string | null {
  const parts = assetPath.split('/').filter(Boolean)
  if (parts.length < 2) {
    return null
  }

  if (parts[0] === 'generated') {
    return parts[1] ?? null
  }

  return parts[0] ?? null
}

export function summarizePacksForPrompt(packs: PromoPackDefinition[]): Array<{
  id: string
  title: string
  goal: string
  pointIds: string[]
  platforms: string[]
}> {
  return packs.map((pack) => ({
    id: pack.id,
    title: pack.title,
    goal: pack.goal,
    pointIds: [...pack.pointIds],
    platforms: [...pack.platforms]
  }))
}
