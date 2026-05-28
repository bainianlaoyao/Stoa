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

  async function search(rootPath: string): Promise<void> {
    if (!query.value.trim()) return

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
      results.value = await window.stoa.fsSearch(options)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      searching.value = false
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
