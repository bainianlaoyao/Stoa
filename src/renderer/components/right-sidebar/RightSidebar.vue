<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useSidebarStore } from '@renderer/stores/sidebar'
import { useSidebarResize } from '@renderer/composables/useSidebarResize'
import WorktreeSelector from './WorktreeSelector.vue'
import TabBar from './TabBar.vue'
import FileExplorer from './explorer/FileExplorer.vue'
import SearchPanel from './search/SearchPanel.vue'
import SourceControlPanel from './git/SourceControlPanel.vue'

const sidebarStore = useSidebarStore()
const { open, activeTab, width } = storeToRefs(sidebarStore)
const containerRef = useTemplateRef<HTMLDivElement>('container')

const { onResizeStart } = useSidebarResize(
  containerRef as unknown as import('vue').Ref<HTMLElement | null>,
  width,
  (w) => sidebarStore.setWidth(w),
  () => sidebarStore.commitWidth(),
)
</script>

<template>
  <div
    v-if="open"
    ref="container"
    class="relative flex-shrink-0 flex"
    :style="{ width: width + 'px' }"
    data-testid="right-sidebar"
  >
    <div
      class="absolute top-0 left-0 w-1 h-full cursor-col-resize z-10 hover:bg-[var(--color-accent)]/10 active:bg-[var(--color-accent)]/20 transition-colors"
      @mousedown="onResizeStart"
      data-testid="sidebar-resize-handle"
    />

    <div class="flex flex-col flex-1 min-w-0 h-full bg-[var(--color-surface-solid)] border-l border-[var(--color-line)]">
      <WorktreeSelector />
      <TabBar :active-tab="activeTab" @select="sidebarStore.setActiveTab" />
      <div class="flex-1 min-h-0 overflow-hidden">
        <FileExplorer v-show="activeTab === 'explorer'" />
        <SearchPanel v-show="activeTab === 'search'" />
        <SourceControlPanel v-show="activeTab === 'git'" />
      </div>
    </div>
  </div>
</template>
