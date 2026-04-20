<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { WorkspaceSummary } from '@shared/workspace'

const props = defineProps<{
  workspace: WorkspaceSummary | null
}>()

const mountElements = new Map<string, HTMLDivElement>()
const renderedWorkspaceIds = ref<string[]>([])

const terminals = new Map<string, Terminal>()
const fitAddons = new Map<string, FitAddon>()
const resizeObservers = new Map<string, ResizeObserver>()
let disposeTerminalData: (() => void) | undefined

const workspaceId = computed(() => props.workspace?.workspaceId ?? null)

function getActiveTerminal(): Terminal | null {
  const id = workspaceId.value
  return id ? terminals.get(id) ?? null : null
}

function ensureRenderedWorkspace(workspaceKey: string): void {
  if (!renderedWorkspaceIds.value.includes(workspaceKey)) {
    renderedWorkspaceIds.value = [...renderedWorkspaceIds.value, workspaceKey]
  }
}

function resolveTerminalTheme(): { background: string; foreground: string } {
  const rootStyles = getComputedStyle(document.documentElement)
  return {
    background: rootStyles.getPropertyValue('--terminal-bg').trim() || '#0a0b0d',
    foreground: rootStyles.getPropertyValue('--terminal-text').trim() || '#e2e8f0'
  }
}

function setMountElement(workspaceKey: string, element: Element | { $el?: Element } | null): void {
  const resolvedElement = element instanceof Element ? element : element?.$el ?? null

  if (!(resolvedElement instanceof HTMLDivElement)) {
    mountElements.delete(workspaceKey)
    return
  }

  mountElements.set(workspaceKey, resolvedElement)
  if (terminals.has(workspaceKey)) {
    return
  }

  attachTerminal(workspaceKey)
}

function attachTerminal(workspaceKey: string): void {
  const mountElement = mountElements.get(workspaceKey)

  if (!mountElement || terminals.has(workspaceKey)) {
    return
  }

  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    theme: resolveTerminalTheme()
  })
  const fitAddon = new FitAddon()
  terminals.set(workspaceKey, terminal)
  fitAddons.set(workspaceKey, fitAddon)
  terminal.loadAddon(fitAddon)
  terminal.open(mountElement)
  fitAddon.fit()

  terminal.onData((data) => {
    void window.vibecoding.writeTerminalInput(workspaceKey, data)
  })

  terminal.onResize(({ cols, rows }) => {
    void window.vibecoding.resizeTerminal(workspaceKey, cols, rows)
  })

  const resizeObserver = new ResizeObserver(() => {
    fitAddons.get(workspaceKey)?.fit()
  })
  resizeObserver.observe(mountElement)
  resizeObservers.set(workspaceKey, resizeObserver)
}

onMounted(() => {
  disposeTerminalData = window.vibecoding.onTerminalData((chunk) => {
    const targetTerminal = terminals.get(chunk.workspaceId)
    if (!targetTerminal) {
      return
    }

    targetTerminal.write(chunk.data)
  })

  if (workspaceId.value) {
    ensureRenderedWorkspace(workspaceId.value)
  }
})

watch(
  () => props.workspace?.workspaceId,
  async (nextWorkspaceId) => {
    if (!nextWorkspaceId) {
      return
    }

    ensureRenderedWorkspace(nextWorkspaceId)

    await nextTick()

    if (!terminals.has(nextWorkspaceId)) {
      attachTerminal(nextWorkspaceId)
      return
    }

    fitAddons.get(nextWorkspaceId)?.fit()
  },
  { immediate: true }
)

onUnmounted(() => {
  resizeObservers.forEach((observer) => observer.disconnect())
  disposeTerminalData?.()
  terminals.forEach((terminal) => terminal.dispose())
  terminals.clear()
  fitAddons.clear()
  resizeObservers.clear()
  mountElements.clear()
})
</script>

<template>
  <section class="terminal-viewport" :data-workspace-id="workspace?.workspaceId ?? 'none'">
    <template v-if="workspace">
      <div class="terminal-stream">
        <div class="terminal-stream__viewport" data-terminal-frame="true">
          <div class="terminal-surface__mount-stack">
            <div
              v-for="renderedWorkspaceId in renderedWorkspaceIds"
              :key="renderedWorkspaceId"
              :ref="(element) => setMountElement(renderedWorkspaceId, element)"
              class="terminal-surface__mount"
              :class="{ 'terminal-surface__mount--active': renderedWorkspaceId === workspace.workspaceId }"
              :data-terminal-owner="renderedWorkspaceId"
            />
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <section class="terminal-empty-state">
        <h2>没有可显示的工作区</h2>
        <p>等待 bootstrap state 或状态通道事件。</p>
      </section>
    </template>
  </section>
</template>
