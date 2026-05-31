<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { SessionType } from '@shared/project-session'
import MetaSessionInspectorPanel from './MetaSessionInspectorPanel.vue'
import MetaSessionSessionList from './MetaSessionSessionList.vue'
import MetaSessionTerminalDeck from './MetaSessionTerminalDeck.vue'
import { useSidebarStore } from '@renderer/stores/sidebar'
import { usePanelResize } from '@renderer/composables/useSidebarResize'

const emit = defineEmits<{
  createWorkspaceSession: [payload: { projectId: string; type: SessionType; title: string }]
}>()

const sidebarStore = useSidebarStore()
const { sessionListWidth } = storeToRefs(sidebarStore)
const sessionListRef = ref<HTMLElement | null>(null)

const { onResizeStart } = usePanelResize({
  containerRef: sessionListRef,
  currentWidth: sessionListWidth,
  minWidth: 160,
  maxWidth: 480,
  direction: 'grow-right',
  onWidthChange: (w) => sidebarStore.setSessionListWidth(w),
  onWidthCommit: () => sidebarStore.commitSessionListWidth(),
})
</script>

<template>
  <section class="meta-session-surface" data-surface="meta-session" data-testid="surface.meta-session" aria-label="Meta session surface">
    <div class="meta-session-surface__layout" :style="{ gridTemplateColumns: sessionListWidth + 'px minmax(0, 1fr) 320px' }">
      <div ref="sessionListRef" class="relative min-h-0">
        <MetaSessionSessionList @create-workspace-session="emit('createWorkspaceSession', $event)" />

        <div
          class="absolute top-0 right-0 w-1 h-full cursor-col-resize z-10 hover:bg-[var(--color-accent)]/10 active:bg-[var(--color-accent)]/20 transition-colors"
          @mousedown="onResizeStart"
          data-testid="session-list-resize-handle"
        />
      </div>
      <MetaSessionTerminalDeck />
      <MetaSessionInspectorPanel />
    </div>
  </section>
</template>

<style scoped>
.meta-session-surface {
  height: 100%;
  min-height: 0;
  padding: 20px;
}

.meta-session-surface__layout {
  height: 100%;
  min-height: 0;
  display: grid;
  gap: 12px;
}
</style>
