<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount, nextTick, useTemplateRef } from 'vue'
import '@xterm/xterm/css/xterm.css'
import { createTerminalRuntime } from '@renderer/terminal/xterm-runtime'
import { useSettingsStore } from '@renderer/stores/settings'
import { useI18n } from 'vue-i18n'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { ProjectSummary, SessionSummary, TerminalDataChunk } from '@shared/project-session'

const props = defineProps<{
  project: ProjectSummary | null
  session: SessionSummary | null
}>()

const terminalContainer = useTemplateRef<HTMLDivElement>('terminalContainer')
const settingsStore = useSettingsStore()
const { t } = useI18n()

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
let unsubscribeData: (() => void) | null = null
let unsubscribeEvents: (() => void) | null = null
let dataDisposable: { dispose(): void } | null = null
let mountVersion = 0
let setupScheduleVersion = 0
const REPLAY_FALLBACK_TIMEOUT_MS = 1_000

function disposeTerminal() {
  setupScheduleVersion += 1
  mountVersion += 1
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

function writeChunk(targetTerminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => {
    targetTerminal.write(data, () => resolve())
  })
}

function scheduleTerminalSetup() {
  const localScheduleVersion = ++setupScheduleVersion

  nextTick(() => {
    if (localScheduleVersion !== setupScheduleVersion) {
      return
    }

    if (props.session) {
      setupTerminal()
    }
  })
}

function setupTerminal() {
  if (!terminalContainer.value || !props.session) return
  const sessionId = props.session.id
  const stoa = window.stoa
  if (!stoa) return

  const localMountVersion = ++mountVersion
  let replayResolved = false
  const pendingOutput: string[] = []
  let writeChain = Promise.resolve()
  let replayFallbackTimer: ReturnType<typeof setTimeout> | null = null

  const { terminal: localTerminal, fitAddon: localFitAddon } = createTerminalRuntime(
    undefined,
    undefined,
    undefined,
    settingsStore.terminalFontSize,
    settingsStore.terminalFontFamily
  )
  terminal = localTerminal
  fitAddon = localFitAddon
  localTerminal.open(terminalContainer.value)

  const isActiveMount = () => mountVersion === localMountVersion && terminal === localTerminal
  const enqueueWrite = (data: string) => {
    if (!data) return

    writeChain = writeChain.then(async () => {
      if (!isActiveMount()) {
        return
      }

      await writeChunk(localTerminal, data)
    })
  }
  const clearReplayFallbackTimer = () => {
    if (replayFallbackTimer === null) {
      return
    }

    clearTimeout(replayFallbackTimer)
    replayFallbackTimer = null
  }
  const resolveReplayGate = () => {
    if (replayResolved) {
      return
    }

    replayResolved = true
    clearReplayFallbackTimer()
    for (const pendingChunk of pendingOutput) {
      enqueueWrite(pendingChunk)
    }
    pendingOutput.length = 0
  }
  const queueOrWrite = (data: string) => {
    if (!data) {
      return
    }

    if (replayResolved) {
      enqueueWrite(data)
      return
    }

    pendingOutput.push(data)
  }

  nextTick(async () => {
    if (!isActiveMount()) {
      return
    }

    await (document.fonts?.ready ?? Promise.resolve())
    localFitAddon.fit()
    const cols = localTerminal.cols
    const rows = localTerminal.rows
    if (cols && rows) {
      stoa.sendSessionResize(sessionId, cols, rows)
    }
  })

  dataDisposable = localTerminal.onData((data) => {
    stoa.sendSessionInput(sessionId, data)
  })

  resizeObserver = new ResizeObserver(() => {
    if (!isActiveMount()) return
    localFitAddon.fit()
    const { cols, rows } = localTerminal
    stoa.sendSessionResize(sessionId, cols, rows)
  })
  resizeObserver.observe(terminalContainer.value)

  unsubscribeData = stoa.onTerminalData((chunk: TerminalDataChunk) => {
    if (chunk.sessionId === sessionId) {
      queueOrWrite(chunk.data)
    }
  })

  unsubscribeEvents = stoa.onSessionEvent((event) => {
    if (event.sessionId === sessionId && event.status === 'exited') {
      queueOrWrite('\r\n\x1b[90m[session exited]\x1b[0m')
    }
  })

  replayFallbackTimer = setTimeout(() => {
    if (!isActiveMount()) {
      clearReplayFallbackTimer()
      return
    }

    resolveReplayGate()
  }, REPLAY_FALLBACK_TIMEOUT_MS)

  void stoa.getTerminalReplay(sessionId)
    .then((replay) => {
      if (!isActiveMount() || replayResolved) {
        return
      }

      if (replay) {
        enqueueWrite(replay)
      }
    })
    .catch(() => {
      // Keep terminal usable if replay retrieval fails; buffered chunks are flushed in finally.
    })
    .finally(() => {
      clearReplayFallbackTimer()

      if (!isActiveMount()) {
        return
      }

      resolveReplayGate()
    })
}

watch(
  [() => props.session?.id ?? null, () => settingsStore.terminalFontSize, () => settingsStore.terminalFontFamily],
  ([sessionId]) => {
    disposeTerminal()
    if (sessionId) {
      scheduleTerminalSetup()
    }
  }
)

onMounted(() => {
  if (props.session) {
    scheduleTerminalSetup()
  }
})

onBeforeUnmount(disposeTerminal)
</script>

<template>
  <section class="terminal-viewport" data-testid="terminal-viewport">
    <template v-if="project && session">
      <div class="terminal-viewport__xterm" data-testid="terminal-xterm">
        <div class="terminal-viewport__shell" data-testid="terminal-shell">
          <header class="terminal-viewport__status-bar" :data-status="session.status" data-testid="terminal-status-bar">
            <div class="terminal-viewport__status-copy">
              <p class="terminal-viewport__eyebrow">{{ project.name }}</p>
              <p class="terminal-viewport__session-title">{{ session.title }}</p>
              <p class="terminal-viewport__session-summary">{{ session.summary }}</p>
            </div>

            <div class="terminal-viewport__meta">
              <span class="terminal-viewport__meta-chip">{{ session.type }}</span>
              <span class="terminal-viewport__meta-chip terminal-viewport__status" :data-status="session.status">
                {{ session.status }}
              </span>
            </div>
          </header>

          <div class="terminal-viewport__xterm-mount" ref="terminalContainer" data-testid="terminal-xterm-mount" />
        </div>
      </div>
    </template>

    <template v-else>
      <section class="terminal-empty-state" data-testid="terminal-empty-state">
        <h2>{{ t('terminal.emptyTitle') }}</h2>
        <p>{{ t('terminal.emptyHint') }}</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.terminal-empty-state {
  min-height: 100%;
  border: 1px solid var(--color-line-strong);
  border-radius: 10px;
  background: var(--color-terminal-bg);
  box-shadow: inset 0 1px 0 var(--color-terminal-shell-highlight);
}

.terminal-viewport {
  height: 100%;
  display: grid;
  min-height: 0;
}

.terminal-viewport__xterm {
  height: 100%;
  width: 100%;
  min-height: 0;
}

.terminal-viewport__shell {
  height: 100%;
  width: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  padding: var(--terminal-shell-gap);
  border-radius: var(--radius-md);
  background:
    linear-gradient(180deg, var(--color-terminal-shell-sheen-strong), var(--color-terminal-shell-sheen-soft)),
    var(--color-terminal-bg);
  border: 1px solid var(--color-terminal-border);
  box-shadow: inset 0 1px 0 var(--color-terminal-shell-highlight);
  overflow: hidden;
}

.terminal-viewport__status-bar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-terminal-border);
  border-radius: var(--radius-sm);
  background: var(--color-terminal-chip);
}

.terminal-viewport__status-copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.terminal-viewport__session-title,
.terminal-viewport__session-summary {
  margin: 0;
}

.terminal-viewport__session-title {
  color: var(--color-terminal-text);
  font-size: 13px;
  font-weight: 600;
}

.terminal-viewport__session-summary {
  color: var(--color-terminal-soft);
  font-size: 12px;
}

.terminal-viewport__xterm-mount {
  height: 100%;
  width: 100%;
  min-height: 0;
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.terminal-viewport__xterm-mount :deep(.xterm) {
  height: 100%;
  width: 100%;
}

.terminal-viewport__xterm-mount :deep(.xterm-viewport) {
  background-color: var(--color-terminal-bg) !important;
}

.terminal-viewport__xterm-mount :deep(.xterm-viewport) {
  overflow-y: auto;
  scrollbar-width: none;
}

.terminal-viewport__xterm-mount :deep(.xterm-viewport::-webkit-scrollbar) {
  width: 0;
  height: 0;
}

.terminal-viewport__eyebrow {
  margin: 0;
  color: var(--color-terminal-subtle);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 11px;
  font-weight: 600;
}

.terminal-viewport__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-terminal-muted);
}

.terminal-viewport__meta-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-terminal-chip);
  border: 1px solid var(--color-terminal-border);
}

.terminal-viewport__status[data-status='running'] {
  color: var(--color-success);
}

.terminal-viewport__status[data-status='awaiting_input'],
.terminal-viewport__status[data-status='turn_complete'],
.terminal-viewport__status[data-status='degraded'],
.terminal-viewport__status[data-status='needs_confirmation'] {
  color: var(--color-warning);
}

.terminal-viewport__status[data-status='error'],
.terminal-viewport__status[data-status='exited'] {
  color: var(--color-error);
}
</style>
