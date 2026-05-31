<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import { useGitStore } from '@renderer/stores/git'
import { useGitStatusPolling } from '@renderer/composables/useGitStatusPolling'
import type { GitFileStatus } from '@shared/sidebar-types'

const workspaceStore = useWorkspaceStore()
const selectedProjectPath = computed(() => workspaceStore.activeProject?.path ?? null)
const gitStore = useGitStore()
const {
  status, branches, log, loading, commitMessage, operationInProgress, operationError,
} = storeToRefs(gitStore)

const { staged, unstaged, untracked, hasChanges, currentBranch } = gitStore

const { refreshing, refreshGitStatus } = useGitStatusPolling(selectedProjectPath)

// Load git data immediately when project changes or panel first renders
watch(selectedProjectPath, (path) => {
  if (path) void gitStore.refreshAll(path)
}, { immediate: true })

const sectionCollapsed = ref<Record<string, boolean>>({})
const showBranchDropdown = ref(false)
const showMoreMenu = ref(false)
const showRebaseDialog = ref(false)
const showMergeDialog = ref(false)
const showNewBranchDialog = ref(false)
const selectedRebaseBranch = ref('')
const selectedMergeBranch = ref('')
const newBranchName = ref('')

const localBranches = computed(() => branches.value?.locals ?? [])

const aheadBehind = computed(() => {
  if (!status.value) return null
  const { ahead, behind } = status.value
  if (ahead === 0 && behind === 0) return null
  return { ahead, behind }
})

function statusBadge(status: GitFileStatus): { label: string; color: string } {
  const map: Record<GitFileStatus, { label: string; color: string }> = {
    modified: { label: 'M', color: 'var(--color-warning)' },
    added: { label: 'A', color: 'var(--color-accent)' },
    deleted: { label: 'D', color: 'var(--color-error)' },
    renamed: { label: 'R', color: 'var(--color-muted)' },
    untracked: { label: 'U', color: 'var(--color-muted)' },
    copied: { label: 'C', color: 'var(--color-muted)' },
  }
  return map[status]
}

function toggleSection(key: string): void {
  sectionCollapsed.value = { ...sectionCollapsed.value, [key]: !sectionCollapsed.value[key] }
}

function handleCommit(): void {
  if (!selectedProjectPath.value || !commitMessage.value.trim()) return
  void gitStore.commit(selectedProjectPath.value, commitMessage.value)
}

function handlePush(): void {
  if (!selectedProjectPath.value) return
  void gitStore.push(selectedProjectPath.value)
}

function handlePull(): void {
  if (!selectedProjectPath.value) return
  void gitStore.pull(selectedProjectPath.value)
}

function handleFetch(): void {
  if (!selectedProjectPath.value) return
  void gitStore.fetch(selectedProjectPath.value)
}

function handleCheckout(branch: string): void {
  if (!selectedProjectPath.value) return
  showBranchDropdown.value = false
  void gitStore.checkoutBranch(selectedProjectPath.value, branch)
}

function handleCreateBranch(): void {
  if (!selectedProjectPath.value || !newBranchName.value.trim()) return
  void gitStore.createBranch(selectedProjectPath.value, newBranchName.value)
  newBranchName.value = ''
  showNewBranchDialog.value = false
}

function handleRebase(): void {
  if (!selectedProjectPath.value || !selectedRebaseBranch.value) return
  void gitStore.rebase(selectedProjectPath.value, selectedRebaseBranch.value)
  showRebaseDialog.value = false
}

function handleMerge(): void {
  if (!selectedProjectPath.value || !selectedMergeBranch.value) return
  void gitStore.merge(selectedProjectPath.value, selectedMergeBranch.value)
  showMergeDialog.value = false
}

// Close branch dropdown when clicking outside
function handleDocumentClick(e: MouseEvent): void {
  const target = e.target as HTMLElement
  if (!target.closest('[data-testid="git-branch-selector"]') && !target.closest('.branch-dropdown')) {
    showBranchDropdown.value = false
  }
  if (!target.closest('.more-menu-container')) {
    showMoreMenu.value = false
  }
}

// Auto-dismiss errors after 8 seconds
let errorTimer: ReturnType<typeof setTimeout> | null = null
watch(operationError, (err) => {
  if (errorTimer) clearTimeout(errorTimer)
  if (err) {
    errorTimer = setTimeout(() => gitStore.clearError(), 8000)
  }
})

onMounted(() => document.addEventListener('click', handleDocumentClick))
onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
  if (errorTimer) clearTimeout(errorTimer)
})
</script>

<template>
  <div class="flex flex-col h-full" data-testid="source-control-panel">
    <div class="px-2 py-1.5 border-b" style="border-color: var(--color-line);">
      <div class="flex items-center gap-1">
        <div class="relative flex-1 min-w-0">
          <button
            type="button"
            class="flex items-center gap-1 w-full px-2 py-1 border-0 rounded cursor-pointer transition-colors text-left"
            style="background: var(--color-surface-solid); color: var(--color-text); font-size: var(--text-body-sm); font-family: var(--font-mono);"
            data-testid="git-branch-selector"
            @click="showBranchDropdown = !showBranchDropdown"
          >
            <svg class="w-3.5 h-3.5 shrink-0" style="color: var(--color-accent);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v12" /><path d="M18 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" /><path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M15 12a3 3 0 0 0-2.83-2.83L8.83 4.17" /></svg>
            <span class="truncate">{{ currentBranch || 'No branch' }}</span>
            <svg class="w-3 h-3 shrink-0 ml-auto" style="color: var(--color-subtle);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <div
            v-if="showBranchDropdown"
            class="branch-dropdown absolute left-0 right-0 top-full mt-1 py-1 z-40 max-h-48 overflow-y-auto"
            style="background: var(--color-surface-solid); border: 1px solid var(--color-line); border-radius: var(--radius-sm); box-shadow: var(--shadow-soft);"
          >
            <button
              v-for="branch in localBranches"
              :key="branch"
              type="button"
              class="block w-full text-left px-3 py-1.5 cursor-pointer transition-colors"
              :style="{ fontSize: 'var(--text-body-sm)', fontFamily: 'var(--font-mono)', color: branch === currentBranch ? 'var(--color-accent)' : 'var(--color-text)', background: branch === currentBranch ? 'var(--color-active-fill)' : 'transparent', border: 'none' }"
              @click="handleCheckout(branch)"
              @mouseenter="branch !== currentBranch && ((($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)')"
              @mouseleave="branch !== currentBranch && ((($event.currentTarget) as HTMLElement).style.background = '')"
            >{{ branch }}</button>
            <div class="my-1" style="border-top: 1px solid var(--color-line);" />
            <button
              type="button"
              class="block w-full text-left px-3 py-1.5 cursor-pointer transition-colors"
              style="font-size: var(--text-body-sm); color: var(--color-accent); background: transparent; border: none;"
              @click="showNewBranchDialog = true; showBranchDropdown = false"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >Create Branch...</button>
          </div>
        </div>

        <button
          type="button"
          class="inline-flex items-center justify-center h-6 w-6 border-0 rounded cursor-pointer transition-colors shrink-0"
          style="background: transparent; color: var(--color-muted);"
          title="Fetch"
          @click="handleFetch"
          @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
          @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /></svg>
        </button>
        <button
          type="button"
          class="inline-flex items-center justify-center h-6 w-6 border-0 rounded cursor-pointer transition-colors shrink-0"
          style="background: transparent; color: var(--color-muted);"
          title="Pull"
          @click="handlePull"
          @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
          @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
        </button>
        <button
          type="button"
          class="inline-flex items-center justify-center h-6 w-6 border-0 rounded cursor-pointer transition-colors shrink-0"
          style="background: transparent; color: var(--color-muted);"
          title="Push"
          @click="handlePush"
          @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
          @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
        </button>

        <button
          type="button"
          class="inline-flex items-center justify-center h-6 w-6 border-0 rounded cursor-pointer transition-colors shrink-0"
          :style="{ background: 'transparent', color: refreshing ? 'var(--color-accent)' : 'var(--color-muted)' }"
          title="Refresh"
          @click="void refreshGitStatus()"
          @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
          @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
        >
          <svg class="w-3.5 h-3.5" :class="{ 'animate-spin': refreshing }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
        </button>

        <div class="relative more-menu-container">
          <button
            type="button"
            class="inline-flex items-center justify-center h-6 w-6 border-0 rounded cursor-pointer transition-colors shrink-0"
            style="background: transparent; color: var(--color-muted);"
            @click="showMoreMenu = !showMoreMenu"
            @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
            @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></svg>
          </button>
          <div
            v-if="showMoreMenu"
            class="absolute right-0 top-full mt-1 py-1 min-w-[140px] z-40"
            style="background: var(--color-surface-solid); border: 1px solid var(--color-line); border-radius: var(--radius-sm); box-shadow: var(--shadow-soft);"
          >
            <button
              type="button"
              class="block w-full text-left px-3 py-1.5 cursor-pointer transition-colors"
              style="font-size: var(--text-body-sm); color: var(--color-text); background: transparent; border: none;"
              @click="showNewBranchDialog = true; showMoreMenu = false"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >Create Branch...</button>
            <button
              type="button"
              class="block w-full text-left px-3 py-1.5 cursor-pointer transition-colors"
              style="font-size: var(--text-body-sm); color: var(--color-text); background: transparent; border: none;"
              @click="showRebaseDialog = true; showMoreMenu = false"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >Rebase...</button>
            <button
              type="button"
              class="block w-full text-left px-3 py-1.5 cursor-pointer transition-colors"
              style="font-size: var(--text-body-sm); color: var(--color-text); background: transparent; border: none;"
              @click="showMergeDialog = true; showMoreMenu = false"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >Merge...</button>
          </div>
        </div>
      </div>

      <div v-if="aheadBehind" class="flex items-center gap-2 mt-1" style="font-size: var(--text-caption); color: var(--color-muted);">
        <span v-if="aheadBehind.ahead > 0">↑{{ aheadBehind.ahead }}</span>
        <span v-if="aheadBehind.behind > 0">↓{{ aheadBehind.behind }}</span>
      </div>
    </div>

    <div v-if="operationError" class="flex items-center gap-1 px-2 py-1.5 border-b" style="border-color: var(--color-line); background: var(--color-black-soft);" @click="gitStore.clearError()">
      <span class="flex-1 truncate" style="font-size: var(--text-caption); color: var(--color-error);">{{ operationError }}</span>
      <button
        type="button"
        class="shrink-0 border-0 cursor-pointer"
        style="background: transparent; color: var(--color-muted); font-size: var(--text-caption);"
        @click="gitStore.clearError()"
      >✕</button>
    </div>

    <div class="px-2 py-1.5 border-b" style="border-color: var(--color-line);">
      <textarea
        v-model="commitMessage"
        placeholder="Commit message"
        class="w-full px-2 py-1 border outline-none resize-none"
        style="height: 56px; font-size: var(--text-body-sm); font-family: var(--font-ui); border-color: var(--color-line); border-radius: var(--radius-sm); background: var(--color-surface-solid); color: var(--color-text-strong);"
        data-testid="git-commit-input"
      />
      <button
        type="button"
        class="w-full mt-1 py-1 rounded cursor-pointer transition-colors border-0"
        :style="{
          background: commitMessage.trim() && staged.length > 0 ? 'var(--color-accent)' : 'var(--color-black-soft)',
          color: commitMessage.trim() && staged.length > 0 ? 'var(--color-surface-solid)' : 'var(--color-muted)',
          fontSize: 'var(--text-body-sm)',
          fontWeight: 500,
          opacity: operationInProgress ? 0.6 : 1,
        }"
        :disabled="!commitMessage.trim() || staged.length === 0 || operationInProgress"
        data-testid="git-commit-button"
        @click="handleCommit"
      >{{ operationInProgress ? 'Committing...' : 'Commit' }}</button>
    </div>

    <div class="flex-1 overflow-y-auto min-h-0" style="scrollbar-width: thin;">
      <div v-if="!selectedProjectPath" class="flex items-center justify-center py-8" style="color: var(--color-muted); font-size: var(--text-body-sm);">
        No active project
      </div>

      <div v-else-if="loading && !status" class="flex items-center justify-center py-8" style="color: var(--color-muted); font-size: var(--text-body-sm);">
        Loading...
      </div>

      <template v-if="status">
        <template v-if="staged.length > 0">
          <div
            class="flex items-center gap-1 px-2 cursor-pointer select-none transition-colors"
            style="height: 28px; font-size: var(--text-caption); color: var(--color-text);"
            data-testid="git-staged-section"
            @click="toggleSection('staged')"
            @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
            @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
          >
            <svg class="w-3 h-3 transition-transform" :class="{ 'rotate-90': !sectionCollapsed.staged }" style="color: var(--color-subtle);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6" /></svg>
            Staged Changes ({{ staged.length }})
          </div>
          <template v-if="!sectionCollapsed.staged">
            <div
              v-for="entry in staged"
              :key="'staged-' + entry.path"
              class="flex items-center gap-1 px-2 transition-colors"
              style="height: 24px;"
              :style="{ paddingLeft: '24px' }"
              :data-testid="`git-file-${entry.path}`"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >
              <span
                class="shrink-0 w-4 text-center"
                :style="{ fontSize: '11px', fontWeight: 600, color: statusBadge(entry.status).color, fontFamily: 'var(--font-mono)' }"
              >{{ statusBadge(entry.status).label }}</span>
              <span class="truncate flex-1" style="font-size: var(--text-caption); font-family: var(--font-mono); color: var(--color-text);">{{ entry.path }}</span>
              <button
                type="button"
                class="shrink-0 inline-flex items-center justify-center h-4 w-4 border-0 rounded cursor-pointer"
                style="background: transparent; color: var(--color-muted);"
                title="Unstage"
                @click="selectedProjectPath && gitStore.unstageFile(selectedProjectPath, entry.path)"
                @mouseenter="(($event.currentTarget) as HTMLElement).style.color = 'var(--color-text-strong)'"
                @mouseleave="(($event.currentTarget) as HTMLElement).style.color = 'var(--color-muted)'"
              >
                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /></svg>
              </button>
            </div>
          </template>
        </template>

        <template v-if="unstaged.length > 0">
          <div
            class="flex items-center gap-1 px-2 cursor-pointer select-none transition-colors"
            style="height: 28px; font-size: var(--text-caption); color: var(--color-text);"
            data-testid="git-changes-section"
            @click="toggleSection('unstaged')"
            @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
            @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
          >
            <svg class="w-3 h-3 transition-transform" :class="{ 'rotate-90': !sectionCollapsed.unstaged }" style="color: var(--color-subtle);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6" /></svg>
            Changes ({{ unstaged.length }})
          </div>
          <template v-if="!sectionCollapsed.unstaged">
            <div
              v-for="entry in unstaged"
              :key="'unstaged-' + entry.path"
              class="flex items-center gap-1 px-2 transition-colors"
              style="height: 24px;"
              :style="{ paddingLeft: '24px' }"
              :data-testid="`git-file-${entry.path}`"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >
              <span
                class="shrink-0 w-4 text-center"
                :style="{ fontSize: '11px', fontWeight: 600, color: statusBadge(entry.status).color, fontFamily: 'var(--font-mono)' }"
              >{{ statusBadge(entry.status).label }}</span>
              <span class="truncate flex-1" style="font-size: var(--text-caption); font-family: var(--font-mono); color: var(--color-text);">{{ entry.path }}</span>
              <button
                type="button"
                class="shrink-0 inline-flex items-center justify-center h-4 w-4 border-0 rounded cursor-pointer"
                style="background: transparent; color: var(--color-muted);"
                title="Stage"
                @click="selectedProjectPath && gitStore.stageFile(selectedProjectPath, entry.path)"
                @mouseenter="(($event.currentTarget) as HTMLElement).style.color = 'var(--color-text-strong)'"
                @mouseleave="(($event.currentTarget) as HTMLElement).style.color = 'var(--color-muted)'"
              >
                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
              </button>
              <button
                type="button"
                class="shrink-0 inline-flex items-center justify-center h-4 w-4 border-0 rounded cursor-pointer"
                style="background: transparent; color: var(--color-muted);"
                title="Discard"
                @click="selectedProjectPath && gitStore.discardFile(selectedProjectPath, entry.path)"
                @mouseenter="(($event.currentTarget) as HTMLElement).style.color = 'var(--color-error)'"
                @mouseleave="(($event.currentTarget) as HTMLElement).style.color = 'var(--color-muted)'"
              >
                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
              </button>
            </div>
          </template>
        </template>

        <template v-if="untracked.length > 0">
          <div
            class="flex items-center gap-1 px-2 cursor-pointer select-none transition-colors"
            style="height: 28px; font-size: var(--text-caption); color: var(--color-text);"
            data-testid="git-untracked-section"
            @click="toggleSection('untracked')"
            @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
            @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
          >
            <svg class="w-3 h-3 transition-transform" :class="{ 'rotate-90': !sectionCollapsed.untracked }" style="color: var(--color-subtle);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6" /></svg>
            Untracked ({{ untracked.length }})
          </div>
          <template v-if="!sectionCollapsed.untracked">
            <div
              v-for="entry in untracked"
              :key="'untracked-' + entry.path"
              class="flex items-center gap-1 px-2 transition-colors"
              style="height: 24px;"
              :style="{ paddingLeft: '24px' }"
              :data-testid="`git-file-${entry.path}`"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >
              <span class="shrink-0 w-4 text-center" style="font-size: 11px; font-weight: 600; color: var(--color-muted); font-family: var(--font-mono);">U</span>
              <span class="truncate flex-1" style="font-size: var(--text-caption); font-family: var(--font-mono); color: var(--color-text);">{{ entry.path }}</span>
              <button
                type="button"
                class="shrink-0 inline-flex items-center justify-center h-4 w-4 border-0 rounded cursor-pointer"
                style="background: transparent; color: var(--color-muted);"
                title="Stage"
                @click="selectedProjectPath && gitStore.stageFile(selectedProjectPath, entry.path)"
                @mouseenter="(($event.currentTarget) as HTMLElement).style.color = 'var(--color-text-strong)'"
                @mouseleave="(($event.currentTarget) as HTMLElement).style.color = 'var(--color-muted)'"
              >
                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
              </button>
            </div>
          </template>
        </template>

        <div v-if="!hasChanges" class="flex items-center justify-center py-8" style="color: var(--color-muted); font-size: var(--text-body-sm);">
          No changes detected
        </div>

        <template v-if="log.length > 0">
          <div
            class="flex items-center gap-1 px-2 cursor-pointer select-none transition-colors"
            style="height: 28px; font-size: var(--text-caption); color: var(--color-text);"
            @click="toggleSection('log')"
            @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
            @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
          >
            <svg class="w-3 h-3 transition-transform" :class="{ 'rotate-90': !sectionCollapsed.log }" style="color: var(--color-subtle);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6" /></svg>
            Recent Commits
          </div>
          <template v-if="!sectionCollapsed.log">
            <div
              v-for="entry in log"
              :key="entry.hash"
              class="flex items-start gap-2 px-2 transition-colors"
              style="min-height: 24px; padding-left: 24px;"
              @mouseenter="(($event.currentTarget) as HTMLElement).style.background = 'var(--color-black-soft)'"
              @mouseleave="(($event.currentTarget) as HTMLElement).style.background = ''"
            >
              <span class="shrink-0 mt-px" style="font-size: 10px; font-family: var(--font-mono); color: var(--color-accent);">{{ entry.hashAbbrev }}</span>
              <div class="flex-1 min-w-0">
                <div class="truncate" style="font-size: var(--text-caption); color: var(--color-text);">{{ entry.message.split('\n')[0] }}</div>
                <div class="truncate" style="font-size: 10px; color: var(--color-muted);">{{ entry.author }} · {{ entry.date }}</div>
              </div>
            </div>
          </template>
        </template>
      </template>
    </div>

    <Teleport to="body">
      <div v-if="showNewBranchDialog" class="fixed inset-0 z-50 flex items-center justify-center" style="background: rgba(0,0,0,0.3);" @click.self="showNewBranchDialog = false" @keydown.escape="showNewBranchDialog = false">
        <div class="w-72 p-4" style="background: var(--color-surface-solid); border: 1px solid var(--color-line); border-radius: var(--radius-md); box-shadow: var(--shadow-premium);">
          <div style="font-size: var(--text-body-sm); font-weight: 600; color: var(--color-text-strong); margin-bottom: 12px;">Create Branch</div>
          <input
            v-model="newBranchName"
            type="text"
            placeholder="Branch name"
            class="w-full px-2 py-1.5 border outline-none mb-3"
            style="font-size: var(--text-body-sm); font-family: var(--font-mono); border-color: var(--color-line); border-radius: var(--radius-sm); background: var(--color-surface-solid); color: var(--color-text-strong);"
            autofocus
            @keydown.enter="handleCreateBranch"
          />
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="px-3 py-1 rounded cursor-pointer border-0 transition-colors"
              style="background: var(--color-black-soft); color: var(--color-text); font-size: var(--text-body-sm);"
              @click="showNewBranchDialog = false"
            >Cancel</button>
            <button
              type="button"
              class="px-3 py-1 rounded cursor-pointer border-0 transition-colors"
              :style="{ background: newBranchName.trim() ? 'var(--color-accent)' : 'var(--color-black-soft)', color: newBranchName.trim() ? 'var(--color-surface-solid)' : 'var(--color-muted)', fontSize: 'var(--text-body-sm)' }"
              :disabled="!newBranchName.trim()"
              @click="handleCreateBranch"
            >Create</button>
          </div>
        </div>
      </div>

      <div v-if="showRebaseDialog" class="fixed inset-0 z-50 flex items-center justify-center" style="background: rgba(0,0,0,0.3);" @click.self="showRebaseDialog = false" @keydown.escape="showRebaseDialog = false">
        <div class="w-72 p-4" style="background: var(--color-surface-solid); border: 1px solid var(--color-line); border-radius: var(--radius-md); box-shadow: var(--shadow-premium);">
          <div style="font-size: var(--text-body-sm); font-weight: 600; color: var(--color-text-strong); margin-bottom: 12px;">Rebase onto</div>
          <select
            v-model="selectedRebaseBranch"
            class="w-full px-2 py-1.5 border outline-none mb-3"
            style="font-size: var(--text-body-sm); font-family: var(--font-mono); border-color: var(--color-line); border-radius: var(--radius-sm); background: var(--color-surface-solid); color: var(--color-text-strong);"
          >
            <option value="" disabled>Select branch</option>
            <option v-for="b in localBranches.filter(br => br !== currentBranch)" :key="b" :value="b">{{ b }}</option>
          </select>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="px-3 py-1 rounded cursor-pointer border-0 transition-colors"
              style="background: var(--color-black-soft); color: var(--color-text); font-size: var(--text-body-sm);"
              @click="showRebaseDialog = false"
            >Cancel</button>
            <button
              type="button"
              class="px-3 py-1 rounded cursor-pointer border-0 transition-colors"
              :style="{ background: selectedRebaseBranch ? 'var(--color-accent)' : 'var(--color-black-soft)', color: selectedRebaseBranch ? 'var(--color-surface-solid)' : 'var(--color-muted)', fontSize: 'var(--text-body-sm)' }"
              :disabled="!selectedRebaseBranch"
              @click="handleRebase"
            >Rebase</button>
          </div>
        </div>
      </div>

      <div v-if="showMergeDialog" class="fixed inset-0 z-50 flex items-center justify-center" style="background: rgba(0,0,0,0.3);" @click.self="showMergeDialog = false" @keydown.escape="showMergeDialog = false">
        <div class="w-72 p-4" style="background: var(--color-surface-solid); border: 1px solid var(--color-line); border-radius: var(--radius-md); box-shadow: var(--shadow-premium);">
          <div style="font-size: var(--text-body-sm); font-weight: 600; color: var(--color-text-strong); margin-bottom: 12px;">Merge branch</div>
          <select
            v-model="selectedMergeBranch"
            class="w-full px-2 py-1.5 border outline-none mb-3"
            style="font-size: var(--text-body-sm); font-family: var(--font-mono); border-color: var(--color-line); border-radius: var(--radius-sm); background: var(--color-surface-solid); color: var(--color-text-strong);"
          >
            <option value="" disabled>Select branch</option>
            <option v-for="b in localBranches.filter(br => br !== currentBranch)" :key="b" :value="b">{{ b }}</option>
          </select>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="px-3 py-1 rounded cursor-pointer border-0 transition-colors"
              style="background: var(--color-black-soft); color: var(--color-text); font-size: var(--text-body-sm);"
              @click="showMergeDialog = false"
            >Cancel</button>
            <button
              type="button"
              class="px-3 py-1 rounded cursor-pointer border-0 transition-colors"
              :style="{ background: selectedMergeBranch ? 'var(--color-accent)' : 'var(--color-black-soft)', color: selectedMergeBranch ? 'var(--color-surface-solid)' : 'var(--color-muted)', fontSize: 'var(--text-body-sm)' }"
              :disabled="!selectedMergeBranch"
              @click="handleMerge"
            >Merge</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
