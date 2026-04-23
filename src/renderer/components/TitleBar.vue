<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

const isMaximized = ref(false)

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
  <div class="flex items-center h-9 shrink-0 select-none border-b border-line" style="-webkit-app-region: drag;">
    <!-- Brand -->
    <div class="w-14 flex items-center justify-center" style="-webkit-app-region: no-drag;">
      <div class="w-6 h-6 grid place-items-center rounded-lg bg-text-strong text-surface-solid text-xs font-bold tracking-wide shadow-soft">S</div>
    </div>
    <span class="text-[13px] font-semibold tracking-tight text-text-strong">stoa</span>

    <!-- Spacer (draggable) -->

    <!-- Window controls -->
    <div class="ml-auto flex h-full" style="-webkit-app-region: no-drag;">
      <button
        class="inline-flex items-center justify-center w-[46px] h-full text-subtle hover:text-text hover:bg-black-soft transition-colors duration-150"
        aria-label="Minimize"
        type="button"
        @click="minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" fill="none"><rect width="10" height="1" fill="currentColor" /></svg>
      </button>
      <button
        class="inline-flex items-center justify-center w-[46px] h-full text-subtle hover:text-text hover:bg-black-soft transition-colors duration-150"
        :aria-label="isMaximized ? 'Restore' : 'Maximize'"
        type="button"
        @click="toggleMaximize"
      >
        <!-- Maximize icon: single rectangle -->
        <svg v-if="!isMaximized" width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1" /></svg>
        <!-- Restore icon: two overlapping rectangles -->
        <svg v-else width="10" height="10" viewBox="0 0 10 10" fill="none">
          <rect x="2.5" y="0.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1" />
          <rect x="0.5" y="2.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1" fill="var(--color-canvas)" />
        </svg>
      </button>
      <button
        class="inline-flex items-center justify-center w-[46px] h-full text-subtle hover:bg-[#e81123] hover:text-surface-solid transition-colors duration-150"
        aria-label="Close"
        type="button"
        @click="close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>
      </button>
    </div>
  </div>
</template>
