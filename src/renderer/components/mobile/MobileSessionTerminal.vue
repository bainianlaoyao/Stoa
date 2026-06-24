<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'
import type { OpenWorkspaceRequest, ProjectSummary, SessionSummary } from '@shared/project-session'
import TerminalViewport from '@renderer/components/TerminalViewport.vue'

const props = defineProps<{
  project: ProjectSummary | null
  session: SessionSummary | null
  healthStatus: 'connected' | 'reconnecting' | 'offline'
}>()

const emit = defineEmits<{
  openWorkspace: [request: OpenWorkspaceRequest]
}>()

const keysOpen = shallowRef(false)
const terminalViewportRef = useTemplateRef<InstanceType<typeof TerminalViewport>>('terminalViewport')
const MOBILE_TERMINAL_WIDE_MIN_WIDTH = 960

const keyActions = [
  { id: 'esc', label: 'Esc', data: '\u001b' },
  { id: 'tab', label: 'Tab', data: '\t' },
  { id: 'up', label: 'Up', data: '\u001b[A' },
  { id: 'down', label: 'Down', data: '\u001b[B' },
  { id: 'slash', label: '/', data: '/' },
  { id: 'dash', label: '-', data: '-' },
  { id: 'copy', label: 'Copy', data: null },
  { id: 'paste', label: 'Paste', data: null },
  { id: 'enter', label: 'Enter', data: '\r' }
] as const

const inputLocked = computed(() => props.healthStatus !== 'connected')

function sendInput(data: string): void {
  if (!props.session || inputLocked.value) {
    return
  }

  window.stoa?.sendSessionInput(props.session.id, data)
}

function copySelection(): void {
  terminalViewportRef.value?.copyTerminalSelection()
}

async function pasteClipboard(): Promise<void> {
  if (!props.session || inputLocked.value) {
    return
  }

  const text = await navigator.clipboard?.readText?.()
  if (text) {
    window.stoa?.sendSessionInput(props.session.id, text)
  }
}

function activateKey(action: typeof keyActions[number]): void {
  if (action.id === 'copy') {
    copySelection()
    return
  }

  if (action.id === 'paste') {
    void pasteClipboard()
    return
  }

  if (action.data) {
    sendInput(action.data)
  }
}
</script>

<template>
  <section
    class="mobile-session-terminal"
    :class="{
      'mobile-session-terminal--locked': inputLocked
    }"
    data-testid="mobile-session-terminal"
    aria-label="Mobile session terminal"
  >
    <div class="mobile-session-terminal__viewport">
      <TerminalViewport
        ref="terminalViewport"
        :project="project"
        :session="session"
        :visible="true"
        :show-quick-actions="false"
        :input-enabled="!inputLocked"
        :min-viewport-width="MOBILE_TERMINAL_WIDE_MIN_WIDTH"
        @open-workspace="emit('openWorkspace', $event)"
      />
      <button
        class="mobile-session-terminal__keys-handle"
        type="button"
        data-testid="mobile-keys-handle"
        :aria-expanded="keysOpen"
        aria-label="Terminal keys"
        @click.stop="keysOpen = !keysOpen"
      >
        Keys
      </button>
      <div
        v-if="keysOpen"
        class="mobile-session-terminal__keys-dismiss"
        data-testid="mobile-keys-dismiss"
        aria-hidden="true"
        @click="keysOpen = false"
      />
      <div
        v-if="keysOpen"
        class="mobile-session-terminal__keys-rail"
        data-testid="mobile-keys-rail"
        role="toolbar"
        aria-label="Terminal keys"
        @click.stop
      >
        <div class="mobile-session-terminal__keys-scroll">
          <button
            v-for="action in keyActions"
            :key="action.id"
            type="button"
            :disabled="inputLocked && action.id !== 'copy'"
            :data-key-action="action.id"
            :data-testid="`mobile-key-${action.id}`"
            @click="activateKey(action)"
          >
            {{ action.label }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mobile-session-terminal {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: var(--color-terminal-bg);
  color: var(--text);
  font-family: var(--font-ui);
}

.mobile-session-terminal__keys-handle,
.mobile-session-terminal__keys-rail button {
  border: 1px solid var(--stroke-control);
  border-radius: var(--radius-sm);
  background: var(--control-fill);
  color: var(--text);
  cursor: pointer;
  font-family: var(--font-ui);
  transition:
    background-color var(--duration-rest) var(--curve-standard),
    color var(--duration-rest) var(--curve-standard),
    box-shadow var(--duration-rest) var(--curve-standard);
}

.mobile-session-terminal__viewport {
  position: relative;
  min-height: 0;
  overflow: hidden;
  overflow-x: auto;
}

.mobile-session-terminal__keys-handle {
  position: absolute;
  top: 50%;
  right: 8px;
  z-index: 4;
  min-width: 44px;
  min-height: 44px;
  transform: translateY(-50%);
  background: var(--acrylic);
  box-shadow: var(--shadow-flyout);
}

.mobile-session-terminal__keys-dismiss {
  position: absolute;
  inset: 0;
  z-index: 3;
}

.mobile-session-terminal__keys-rail {
  position: absolute;
  top: 48px;
  right: 8px;
  bottom: 12px;
  z-index: 5;
  width: 58px;
  overflow: hidden;
  pointer-events: auto;
}

.mobile-session-terminal__keys-scroll {
  display: grid;
  align-content: center;
  gap: 6px;
  max-height: 100%;
  overflow-y: auto;
  scrollbar-width: none;
}

.mobile-session-terminal__keys-scroll::-webkit-scrollbar {
  width: 0;
}

.mobile-session-terminal__keys-rail button {
  min-height: 44px;
  padding: 0 4px;
  background: var(--acrylic);
  box-shadow: var(--shadow-card);
  font-size: var(--text-caption);
}

.mobile-session-terminal__keys-rail button:disabled {
  color: var(--subtle);
  cursor: default;
}

.mobile-session-terminal__keys-handle:hover,
.mobile-session-terminal__keys-rail button:not(:disabled):hover {
  background: var(--control-fill-hover);
  color: var(--text-strong);
}

.mobile-session-terminal__keys-handle:focus-visible,
.mobile-session-terminal__keys-rail button:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus-ring);
}
</style>
