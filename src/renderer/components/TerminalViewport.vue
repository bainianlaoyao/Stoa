<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { ProjectSummary, SessionSummary, TerminalDataChunk } from '@shared/project-session'

const props = defineProps<{
  project: ProjectSummary | null
  session: SessionSummary | null
}>()

const terminalContainer = ref<HTMLDivElement>()
const isRunning = computed(() => props.session?.status === 'running')

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
let unsubscribeData: (() => void) | null = null
let unsubscribeEvents: (() => void) | null = null
let dataDisposable: { dispose(): void } | null = null

function disposeTerminal() {
  dataDisposable?.dispose()
  dataDisposable = null
  unsubscribeData?.()
  unsubscribeData = null
  unsubscribeEvents?.()
  unsubscribeEvents = null
  resizeObserver?.disconnect()
  resizeObserver = null
  fitAddon?.dispose()
  fitAddon = null
  terminal?.dispose()
  terminal = null
}

function setupTerminal() {
  if (!terminalContainer.value || !props.session) return

  terminal = new Terminal({
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    lineHeight: 1.5,
    theme: {
      background: 'var(--terminal-bg)',
      foreground: 'var(--terminal-text)',
      cursor: 'var(--terminal-text)',
      cursorAccent: 'var(--terminal-bg)',
      selectionBackground: 'rgba(226, 232, 240, 0.2)',
      black: '#0a0b0d',
      red: '#ef4444',
      green: '#10b981',
      yellow: '#f59e0b',
      blue: '#3b82f6',
      magenta: '#8b5cf6',
      cyan: '#06b6d4',
      white: '#e2e8f0',
      brightBlack: '#64748b',
      brightRed: '#f87171',
      brightGreen: '#34d399',
      brightYellow: '#fbbf24',
      brightBlue: '#60a5fa',
      brightMagenta: '#a78bfa',
      brightCyan: '#22d3ee',
      brightWhite: '#f8fafc',
    },
    allowProposedApi: true,
    scrollback: 10_000,
    convertEol: true,
  })

  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(terminalContainer.value)

  nextTick(() => {
    fitAddon?.fit()
    const cols = terminal?.cols
    const rows = terminal?.rows
    if (cols && rows && props.session && window.vibecoding?.sendSessionResize) {
      window.vibecoding.sendSessionResize(props.session.id, cols, rows)
    }
  })

  dataDisposable = terminal.onData((data) => {
    if (props.session && window.vibecoding?.sendSessionInput) {
      window.vibecoding.sendSessionInput(props.session.id, data)
    }
  })

  resizeObserver = new ResizeObserver(() => {
    if (!fitAddon || !terminal) return
    fitAddon.fit()
    const { cols, rows } = terminal
    if (props.session && window.vibecoding?.sendSessionResize) {
      window.vibecoding.sendSessionResize(props.session.id, cols, rows)
    }
  })
  resizeObserver.observe(terminalContainer.value)

  unsubscribeData = window.vibecoding?.onTerminalData?.((chunk: TerminalDataChunk) => {
    if (chunk.sessionId === props.session?.id) {
      terminal?.write(chunk.data)
    }
  }) ?? null

  unsubscribeEvents = window.vibecoding?.onSessionEvent?.((event) => {
    if (event.sessionId === props.session?.id && event.status === 'exited') {
      terminal?.write('\r\n\x1b[90m[session exited]\x1b[0m')
    }
  }) ?? null
}

watch(
  isRunning,
  (running) => {
    disposeTerminal()
    nextTick(() => {
      if (running) {
        setupTerminal()
      }
    })
  }
)

onMounted(() => {
  if (isRunning.value) {
    nextTick(setupTerminal)
  }
})

onBeforeUnmount(disposeTerminal)
</script>

<template>
  <section class="terminal-viewport">
    <template v-if="project && session">
      <div v-if="isRunning" class="terminal-viewport__xterm" ref="terminalContainer" />

      <div v-else class="terminal-viewport__overlay">
        <header class="terminal-viewport__header">
          <div>
            <p class="terminal-viewport__eyebrow">Session details</p>
            <h2>{{ session.title }}</h2>
          </div>
          <div class="terminal-viewport__meta">
            <span>{{ session.type }}</span>
            <span class="terminal-viewport__status">{{ session.status }}</span>
          </div>
        </header>

        <div class="terminal-viewport__details">
          <p>{{ session.summary }}</p>
          <dl class="terminal-viewport__field-list">
            <div>
              <dt>Project</dt>
              <dd>{{ project.name }}</dd>
            </div>
            <div>
              <dt>Path</dt>
              <dd><code>{{ project.path }}</code></dd>
            </div>
            <div>
              <dt>Recovery</dt>
              <dd>{{ session.recoveryMode }}</dd>
            </div>
            <div>
              <dt>External Session</dt>
              <dd><code>{{ session.externalSessionId ?? 'not bound' }}</code></dd>
            </div>
          </dl>
        </div>
      </div>
    </template>

    <template v-else>
      <section class="terminal-empty-state">
        <h2>没有可显示的会话</h2>
        <p>先创建项目，再在项目下创建会话。</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.terminal-viewport {
  height: 100%;
  display: grid;
  min-height: 0;
}

.terminal-viewport__xterm {
  height: 100%;
  width: 100%;
  border-radius: var(--radius-sm);
  background: var(--terminal-bg);
  overflow: hidden;
}

.terminal-viewport__xterm :deep(.xterm) {
  height: 100%;
  padding: 4px;
}

.terminal-viewport__overlay {
  display: grid;
  gap: 16px;
  padding: 20px 24px;
  border: 1px solid var(--terminal-border);
  border-radius: var(--radius-md);
  background: var(--terminal-bg);
  color: var(--terminal-text);
  min-height: 0;
  overflow: auto;
}

.terminal-viewport__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.terminal-viewport__header h2 {
  color: var(--terminal-text);
  font-size: 14px;
  font-weight: 600;
}

.terminal-viewport__eyebrow {
  margin: 0 0 6px;
  color: rgba(226, 232, 240, 0.45);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 10px;
  font-weight: 600;
}

.terminal-viewport__meta {
  display: flex;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: rgba(226, 232, 240, 0.5);
}

.terminal-viewport__status {
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(226, 232, 240, 0.08);
}

.terminal-viewport__details p {
  margin: 0 0 12px;
  color: rgba(226, 232, 240, 0.6);
  font-size: 12px;
}

.terminal-viewport__field-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px 24px;
  margin: 0;
}

.terminal-viewport__field-list div {
  display: grid;
  gap: 2px;
}

.terminal-viewport__field-list dt {
  font-size: 10px;
  color: rgba(226, 232, 240, 0.35);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.terminal-viewport__field-list dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--terminal-text);
}

.terminal-viewport__field-list code {
  font-family: var(--font-mono);
  font-size: 11px;
  background: rgba(226, 232, 240, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
}
</style>
