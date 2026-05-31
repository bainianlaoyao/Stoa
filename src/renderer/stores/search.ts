import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SearchResult, SearchOptions } from '@shared/sidebar-types'

export const useSearchStore = defineStore('search', () => {
  const query = ref('')
  const caseSensitive = ref(false)
  const wholeWord = ref(false)
  const useRegex = ref(false)
  const includePattern = ref('')
  const excludePattern = ref('')
  const results = ref<SearchResult | null>(null)
  const searching = ref(false)
  const error = ref<string | null>(null)

  const hasResults = computed(() => (results.value?.totalMatches ?? 0) > 0)

  // Monotonic counter to cancel stale in-flight searches
  let latestSearchId = 0

  async function search(rootPath: string): Promise<void> {
    if (!query.value.trim()) return

    latestSearchId += 1
    const searchId = latestSearchId

    searching.value = true
    error.value = null

    const options: SearchOptions = {
      query: query.value,
      rootPath,
      caseSensitive: caseSensitive.value,
      wholeWord: wholeWord.value,
      useRegex: useRegex.value,
      includePattern: includePattern.value,
      excludePattern: excludePattern.value,
      maxResults: 1000,
    }

    try {
      const result = await window.stoa.fsSearch(options)
      if (latestSearchId === searchId) {
        results.value = result
      }
    } catch (e) {
      if (latestSearchId === searchId) {
        error.value = e instanceof Error ? e.message : String(e)
      }
    } finally {
      if (latestSearchId === searchId) {
        searching.value = false
      }
    }
  }

  function clearResults(): void {
    results.value = null
    error.value = null
  }

  return {
    query,
    caseSensitive,
    wholeWord,
    useRegex,
    includePattern,
    excludePattern,
    results,
    searching,
    error,
    hasResults,
    search,
    clearResults,
  }
})
