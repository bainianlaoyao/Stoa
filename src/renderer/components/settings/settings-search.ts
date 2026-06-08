export function normalizeSettingsQuery(query: string): string {
  return query.trim().toLowerCase()
}

export function matchesSettingsQuery(query: string, terms: string[]): boolean {
  const normalizedQuery = normalizeSettingsQuery(query)
  if (!normalizedQuery) {
    return true
  }

  return terms.some((term) => term.toLowerCase().includes(normalizedQuery))
}

export function resolveVisibleSettingsSections<T extends string>(
  query: string,
  sectionTerms: Record<T, string[]>
): Set<T> {
  const sectionIds = Object.keys(sectionTerms) as T[]
  const normalizedQuery = normalizeSettingsQuery(query)

  if (!normalizedQuery) {
    return new Set(sectionIds)
  }

  const matchingSectionIds = sectionIds.filter((sectionId) =>
    matchesSettingsQuery(normalizedQuery, sectionTerms[sectionId])
  )

  return new Set(matchingSectionIds.length > 0 ? matchingSectionIds : sectionIds)
}
