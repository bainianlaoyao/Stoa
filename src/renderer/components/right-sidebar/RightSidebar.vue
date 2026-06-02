<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useSidebarStore } from '@renderer/stores/sidebar'
import { usePanelResize } from '@renderer/composables/useSidebarResize'
import { useSidebarPanels } from '@renderer/composables/useSidebarPanels'
import TabBar from './TabBar.vue'
import type { SidebarTab } from '@shared/sidebar-types'

const sidebarStore = useSidebarStore()
const { open, activeTab, width } = storeToRefs(sidebarStore)
const { visiblePanels } = useSidebarPanels()
const containerRef = useTemplateRef<HTMLDivElement>('container')

const { onResizeStart } = usePanelResize({
  containerRef: containerRef as unknown as import('vue').Ref<HTMLElement | null>,
  currentWidth: width,
  minWidth: 220,
  maxWidth: 800,
  dynamicMaxWidth: true,
  onWidthChange: (w) => sidebarStore.setWidth(w),
  onWidthCommit: () => sidebarStore.commitWidth(),
})

const sidebarTabIds = new Set<string>(['explorer', 'search', 'git'])

function selectSidebarTab(tab: string): void {
  if (sidebarTabIds.has(tab)) {
    sidebarStore.setActiveTab(tab as SidebarTab)
  }
}
</script>

<template>
  <!--
    Why: always mounted (no v-if). CSS hides the sidebar when closed so child
    panels keep their state (watchers, tree expansion, search results, etc.).
  -->
  <div
    ref="container"
    class="relative flex-shrink-0 flex right-sidebar-transition"
    :class="{ 'right-sidebar-closed': !open }"
    :style="{ width: width + 'px' }"
    data-testid="right-sidebar"
  >
    <div
      class="absolute top-0 left-0 w-1 h-full cursor-col-resize z-10 hover:bg-[var(--color-accent)]/10 active:bg-[var(--color-accent)]/20 transition-colors"
      @mousedown="onResizeStart"
      data-testid="sidebar-resize-handle"
    />

    <div class="flex flex-col flex-1 min-w-0 h-full bg-mica border-l border-[var(--color-line)]">
      <!-- Header row: tab bar + close button -->
      <div class="flex items-center">
        <TabBar class="flex-1 min-w-0" :active-tab="activeTab" @select="selectSidebarTab" />
        <button
          type="button"
          class="flex items-center justify-center w-7 h-7 mr-1 transition-all duration-200 cursor-pointer"
          style="color: var(--color-muted); border-radius: var(--radius-sm);"
          @mouseenter="($event.currentTarget as HTMLElement).style.color = 'var(--color-text-strong)'; ($event.currentTarget as HTMLElement).style.background = 'var(--color-black-soft)'"
          @mouseleave="($event.currentTarget as HTMLElement).style.color = 'var(--color-muted)'; ($event.currentTarget as HTMLElement).style.background = ''"
          @click="sidebarStore.setOpen(false)"
          title="Close (Ctrl+B)"
          data-testid="sidebar-close-btn"
          :aria-label="'Close sidebar'"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18" />
            <path d="M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="flex-1 min-h-0 overflow-hidden">
        <template v-for="panel in visiblePanels" :key="panel.id">
          <component :is="panel.component" v-show="activeTab === panel.id" />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.right-sidebar-transition {
  transition: width 0.2s ease, opacity 0.2s ease;
}

.right-sidebar-closed {
  width: 0 !important;
  overflow: hidden;
  border: none;
  padding: 0;
  opacity: 0;
  pointer-events: none;
}
</style>
