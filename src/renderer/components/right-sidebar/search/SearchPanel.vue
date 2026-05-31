<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import { useSearchStore } from '@renderer/stores/search'
import type { SearchFileResult, SearchMatch } from '@shared/sidebar-types'

const SEARCH_DEBOUNCE_MS = 300

const workspaceStore = useWorkspaceStore()
const selectedProjectPath = computed(() => workspaceStore.activeProject?.path ?? null)
const searchStore = useSearchStore()
const { query, caseSensitive, wholeWord, useRegex, results, searching, error } = storeToRefs(searchStore)
const { hasResults } = searchStore
const showFilters = ref(false)
const collapsedFiles = ref<Set<string>>(new Set())

// Debounce timer for auto-search
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const summaryText = computed(() => {
  if (!results.value) return ''
  const { totalMatches, files } = results.value
  return `${totalMatches} result${totalMatches !== 1 ? 's' : ''} in ${files.length} file${files.length !== 1 ? 's' : ''}`
})

// Debounced auto-search: triggers 300ms after query changes
watch(query, (newVal) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!newVal.trim()) {
    searchStore.clearResults()
    return
  }
  debounceTimer = setTimeout(() => {
    if (selectedProjectPath.value) {
      void searchStore.search(selectedProjectPath.value)
    }
  }, SEARCH_DEBOUNCE_MS)
})

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
})

function toggleFileCollapse(filePath: string): void {
  const next = new Set(collapsedFiles.value)
  if (next.has(filePath)) {
    next.delete(filePath)
  } else {
    next.add(filePath)
  }
  collapsedFiles.value = next
}

function executeSearch(): void {
  // Immediate search bypasses debounce (Enter key)
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!selectedProjectPath.value) return
  void searchStore.search(selectedProjectPath.value)
}

function handleQueryKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    executeSearch()
  }
}

function handleMatchClick(fileResult: SearchFileResult, match: SearchMatch): void {
  // Open file at line in the system's default editor
  void window.stoa.fsOpenFile(fileResult.filePath, match.line, match.column)
}

function highlightLine(content: string, match: SearchMatch): Array<{ text: string; highlight: boolean }> {
  const parts: Array<{ text: string; highlight: boolean }> = []
  const before = content.slice(0, match.column)
  const matched = content.slice(match.column, match.column + match.matchLength)
  const after = content.slice(match.column + match.matchLength)
  if (before) parts.push({ text: before, highlight: false })
  parts.push({ text: matched, highlight: true })
  if (after) parts.push({ text: after, highlight: false })
  return parts
}
</script>

<template>
  <div class="flex flex-col h-full" data-testid="search-panel">
    <div class="px-2 py-2 border-b" style="border-color: var(--color-line);">
      <div class="flex items-center gap-1">
        <svg class="w-3.5 h-3.5 shrink-0" style="color: var(--color-muted);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m16.5 16.5 4 4" /><path d="M5.75 11.75a6 6 0 1 1 12 0 6 6 0 0 1-12 0Z" /></svg>
        <input
          v-model="query"
          type="text"
          placeholder="Search"
          class="flex-1 min-w-0 px-1.5 border outline-none"
          style="height: 26px; font-size: var(--text-body-sm); font-family: var(--font-ui); border-color: var(--color-line); border-radius: var(--radius-sm); background: var(--color-surface-solid); color: var(--color-text-strong);"
          data-testid="search-input"
          @keydown="handleQueryKeydown"
        />
        <button
          type="button"
          class="inline-flex items-center justify-center h-6 w-6 border-0 rounded cursor-pointer transition-colors shrink-0"
          style="background: transparent; color: var(--color-muted);"
          data-testid="search-button"
          title="Search"
          @click="executeSearch"
          @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'; (($event.currentTarget) as HTMLElement).style.color = 'var(--color-text-strong)'"
          @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''; (($event.currentTarget) as HTMLElement).style.color = 'var(--color-muted)'"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
        </button>
      </div>

      <div class="flex items-center gap-0.5 mt-1.5">
        <button
          type="button"
          class="inline-flex items-center justify-center h-5 px-1.5 border-0 rounded cursor-pointer transition-colors"
          :style="{ background: caseSensitive ? 'var(--color-active-fill)' : 'transparent', color: caseSensitive ? 'var(--color-accent)' : 'var(--color-muted)', fontSize: 'var(--text-caption)', fontWeight: 600 }"
          data-testid="toggle-case"
          title="Match Case"
          @click="caseSensitive = !caseSensitive"
        >Aa</button>
        <button
          type="button"
          class="inline-flex items-center justify-center h-5 px-1.5 border-0 rounded cursor-pointer transition-colors"
          :style="{ background: wholeWord ? 'var(--color-active-fill)' : 'transparent', color: wholeWord ? 'var(--color-accent)' : 'var(--color-muted)', fontSize: 'var(--text-caption)', fontWeight: 600 }"
          data-testid="toggle-whole-word"
          title="Match Whole Word"
          @click="wholeWord = !wholeWord"
        >Ab|</button>
        <button
          type="button"
          class="inline-flex items-center justify-center h-5 px-1.5 border-0 rounded cursor-pointer transition-colors"
          :style="{ background: useRegex ? 'var(--color-active-fill)' : 'transparent', color: useRegex ? 'var(--color-accent)' : 'var(--color-muted)', fontSize: 'var(--text-caption)', fontWeight: 600 }"
          data-testid="toggle-regex"
          title="Use Regular Expression"
          @click="useRegex = !useRegex"
        >.*</button>
        <button
          type="button"
          class="inline-flex items-center justify-center h-5 w-5 border-0 rounded cursor-pointer transition-colors ml-auto"
          :style="{ background: showFilters ? 'var(--color-active-fill)' : 'transparent', color: showFilters ? 'var(--color-accent)' : 'var(--color-muted)' }"
          title="Filters"
          @click="showFilters = !showFilters"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18" /><path d="m3 12 9-9 9 9" /></svg>
        </button>
      </div>

      <div v-if="showFilters" class="flex flex-col gap-1 mt-1.5">
        <input
          v-model="searchStore.includePattern"
          type="text"
          placeholder="Include: *.ts, *.vue"
          class="w-full px-1.5 border outline-none"
          style="height: 22px; font-size: var(--text-caption); font-family: var(--font-mono); border-color: var(--color-line); border-radius: var(--radius-sm); background: var(--color-surface-solid); color: var(--color-text-strong);"
        />
        <input
          v-model="searchStore.excludePattern"
          type="text"
          placeholder="Exclude: node_modules, *.json"
          class="w-full px-1.5 border outline-none"
          style="height: 22px; font-size: var(--text-caption); font-family: var(--font-mono); border-color: var(--color-line); border-radius: var(--radius-sm); background: var(--color-surface-solid); color: var(--color-text-strong);"
        />
      </div>
    </div>

    <div v-if="searching" class="flex items-center justify-center flex-1" style="color: var(--color-muted); font-size: var(--text-body-sm);">
      Searching...
    </div>

    <div v-else-if="error" class="px-3 py-4" style="color: var(--color-error); font-size: var(--text-body-sm);">
      {{ error }}
    </div>

    <div v-else-if="results && !hasResults" class="flex items-center justify-center flex-1" style="color: var(--color-muted); font-size: var(--text-body-sm);">
      No results found
    </div>

    <div v-else-if="results" class="flex-1 overflow-y-auto min-h-0" style="scrollbar-width: thin;">
      <div class="px-2 py-1.5" style="font-size: var(--text-caption); color: var(--color-muted);">
        {{ summaryText }}
      </div>

      <div v-for="file in results.files" :key="file.filePath">
        <div
          class="flex items-center gap-1.5 px-2 cursor-pointer select-none transition-colors"
          style="height: 28px;"
          :data-testid="`search-file-${file.relativePath}`"
          @click="toggleFileCollapse(file.filePath)"
          @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
          @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
        >
          <svg
            class="w-3 h-3 shrink-0 transition-transform"
            :class="{ 'rotate-90': !collapsedFiles.has(file.filePath) }"
            style="color: var(--color-subtle);"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          ><path d="m9 18 6-6-6-6" /></svg>
          <span class="truncate" style="font-size: var(--text-body-sm); font-family: var(--font-mono); color: var(--color-text);">{{ file.relativePath }}</span>
          <span
            class="ml-auto shrink-0 px-1.5 rounded-full"
            style="font-size: 10px; background: var(--color-black-soft); color: var(--color-muted);"
          >{{ file.matches.length }}</span>
        </div>

        <template v-if="!collapsedFiles.has(file.filePath)">
          <div
            v-for="match in file.matches"
            :key="`${file.filePath}-${match.line}`"
            class="flex items-start gap-2 px-2 transition-colors cursor-pointer"
            style="min-height: 24px;"
            :style="{ paddingLeft: '32px' }"
            :data-testid="`search-match-${file.relativePath}-${match.line}`"
            @click="handleMatchClick(file, match)"
            @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
            @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
          >
            <span class="shrink-0 mt-px" style="font-size: var(--text-caption); font-family: var(--font-mono); color: var(--color-muted); min-width: 24px; text-align: right;">{{ match.line }}</span>
            <span class="truncate" style="font-size: var(--text-body-sm); font-family: var(--font-mono); color: var(--color-text);">
              <template v-for="(part, pi) in highlightLine(match.lineContent, match)" :key="pi">
                <mark v-if="part.highlight" style="background: var(--color-accent); color: var(--color-surface-solid); border-radius: 2px; padding: 0 1px;">{{ part.text }}</mark>
                <span v-else>{{ part.text }}</span>
              </template>
            </span>
          </div>
        </template>
      </div>

      <div v-if="results.truncated" class="px-2 py-2" style="font-size: var(--text-caption); color: var(--color-warning);">
        Results truncated. Narrow your search to see all matches.
      </div>
    </div>

    <div v-else class="flex items-center justify-center flex-1" style="color: var(--color-muted); font-size: var(--text-body-sm);">
      Search across files
    </div>
  </div>
</template>
