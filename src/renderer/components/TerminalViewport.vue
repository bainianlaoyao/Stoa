<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { WorkspaceSummary } from '@shared/workspace'

const props = defineProps<{
  workspace: WorkspaceSummary | null
}>()

const mountElement = ref<HTMLDivElement | null>(null)

const terminals = new Map<string, Terminal>()
const fitAddons = new Map<string, FitAddon>()
let disposeTerminalData: (() => void) | undefined
let resizeObserver: ResizeObserver | null = null

const workspaceId = computed(() => props.workspace?.workspaceId ?? null)

function getActiveTerminal(): Terminal | null {
  const id = workspaceId.value
  return id ? terminals.get(id) ?? null : null
}

function attachTerminal(workspaceKey: string): void {
  if (!mountElement.value || terminals.has(workspaceKey)) {
    return
  }

  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    theme: {
      background: '#0a1226',
      foreground: '#e8edf8'
    }
  })
  const fitAddon = new FitAddon()
  terminals.set(workspaceKey, terminal)
  fitAddons.set(workspaceKey, fitAddon)
  terminal.loadAddon(fitAddon)
  terminal.open(mountElement.value)
  fitAddon.fit()

  terminal.onData((data) => {
    const id = workspaceId.value
    if (!id) {
      return
    }

    void window.vibecoding.writeTerminalInput(id, data)
  })

  terminal.onResize(({ cols, rows }) => {
    const id = workspaceId.value
    if (!id) {
      return
    }

    void window.vibecoding.resizeTerminal(id, cols, rows)
  })

  disposeTerminalData = window.vibecoding.onTerminalData((chunk) => {
    const targetTerminal = terminals.get(chunk.workspaceId)
    if (!targetTerminal) {
      return
    }

    targetTerminal.write(chunk.data)
  })

  resizeObserver = new ResizeObserver(() => {
    fitAddons.get(workspaceKey)?.fit()
  })
  resizeObserver.observe(mountElement.value)
}

onMounted(() => {
  if (workspaceId.value) {
    attachTerminal(workspaceId.value)
  }
})

watch(
  () => props.workspace?.workspaceId,
  (nextWorkspaceId) => {
    if (!nextWorkspaceId) {
      return
    }

    if (!terminals.has(nextWorkspaceId)) {
      attachTerminal(nextWorkspaceId)
      return
    }

    fitAddons.get(nextWorkspaceId)?.fit()
  }
)

onUnmounted(() => {
  resizeObserver?.disconnect()
  disposeTerminalData?.()
  terminals.forEach((terminal) => terminal.dispose())
  terminals.clear()
  fitAddons.clear()
})
</script>

<template>
  <section class="terminal-viewport">
    <template v-if="workspace">
      <header class="terminal-viewport__header">
        <div>
          <p class="terminal-viewport__eyebrow">Main terminal view</p>
          <h2>{{ workspace.name }}</h2>
        </div>
        <div class="terminal-viewport__meta">
          <span>{{ workspace.providerId }}</span>
          <span>{{ workspace.status }}</span>
        </div>
      </header>

      <div class="terminal-surface">
        <div ref="mountElement" class="terminal-surface__mount" />
        <div class="terminal-surface__footer">
          <p>provider port: {{ workspace.providerPort ?? 'runtime-bound' }}</p>
          <code>{{ workspace.path }}</code>
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
