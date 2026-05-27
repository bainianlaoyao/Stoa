<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import stoaLogo from '@renderer/assets/icons/gemini-svg.svg'

const { t } = useI18n()
const workspaceStore = useWorkspaceStore()

const isMaximized = ref(false)

const activeProjectName = computed(() => workspaceStore.activeProject?.name || '')
const activeSessionTitle = computed(() => workspaceStore.activeSession?.title || '')
const hasActiveMetadata = computed(() => !!activeProjectName.value)

function minimize(): void {
  void window.stoa.minimizeWindow()
}

function toggleMaximize(): void {
  void window.stoa.maximizeWindow()
}

function close(): void {
  void window.stoa.closeWindow()
}

let unsubscribe: (() => void) | null = null

onMounted(async () => {
  isMaximized.value = await window.stoa.isWindowMaximized()
  unsubscribe = window.stoa.onWindowMaximizeChange((maximized: boolean) => {
    isMaximized.value = maximized
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
})
</script>

<template>
  <div class="relative flex items-center h-[46px] shrink-0 select-none border-b border-line bg-surface/40 backdrop-blur-md" style="-webkit-app-region: drag;">
    <!-- Brand -->
    <div class="flex items-center pl-3.5 animate-fade-in" style="-webkit-app-region: no-drag;">
      <img :src="stoaLogo" alt="" class="h-6" style="width: auto;" aria-hidden="true">
    </div>

    <!-- Centered metadata (draggable) -->
    <div v-if="hasActiveMetadata" class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 text-[11px] font-semibold text-muted tracking-[0.08em] uppercase select-none pointer-events-none">
      <span class="text-text-strong font-bold">{{ activeProjectName }}</span>
      <span class="text-subtle font-light">/</span>
      <span v-if="activeSessionTitle" class="text-muted/90 font-medium">{{ activeSessionTitle }}</span>
      <span v-else class="text-subtle font-normal italic">No Session</span>
    </div>

    <!-- Spacer (draggable) -->

    <!-- Window controls -->
    <div class="ml-auto flex h-full" style="-webkit-app-region: no-drag;">
      <button
        class="win-btn"
        :aria-label="t('windowControls.minimize')"
        type="button"
        @click="minimize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0" y="5" width="10" height="1" fill="currentColor" /></svg>
      </button>
      <button
        class="win-btn"
        :aria-label="isMaximized ? t('windowControls.restore') : t('windowControls.maximize')"
        type="button"
        @click="toggleMaximize"
      >
        <!-- Maximize icon: sharp single rectangle -->
        <svg v-if="!isMaximized" width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" stroke-width="1" /></svg>
        <!-- Restore icon: two overlapping sharp rectangles -->
        <svg v-else width="10" height="10" viewBox="0 0 10 10" fill="none">
          <rect x="2.5" y="0.5" width="7" height="7" stroke="currentColor" stroke-width="1" />
          <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" stroke-width="1" fill="var(--color-canvas)" />
        </svg>
      </button>
      <button
        class="win-btn win-btn-close"
        :aria-label="t('windowControls.close')"
        type="button"
        @click="close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" stroke="currentColor" stroke-width="1" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.win-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  border-radius: 0px;
  color: var(--color-subtle);
  background-color: transparent;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.win-btn:hover {
  background-color: var(--color-line-strong);
  color: var(--color-text-strong);
}

.win-btn-close:hover {
  background-color: #e81123 !important;
  color: #ffffff !important;
}
</style>
