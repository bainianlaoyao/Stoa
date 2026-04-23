<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import '@xterm/xterm/css/xterm.css'
import { createTerminalRuntime } from '@renderer/terminal/xterm-runtime'
import { useSettingsStore } from '@renderer/stores/settings'
import { useI18n } from 'vue-i18n'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { ProjectSummary, SessionStatus, SessionSummary, TerminalDataChunk } from '@shared/project-session'

const props = defineProps<{
  project: ProjectSummary | null
  session: SessionSummary | null
}>()

const terminalContainer = ref<HTMLDivElement>()
const LIVE_TERMINAL_STATUSES = new Set<SessionStatus>(['running', 'awaiting_input'])
const settingsStore = useSettingsStore()
const { t } = useI18n()
const isLiveTerminal = computed(() => {
  return props.session ? LIVE_TERMINAL_STATUSES.has(props.session.status) : false
})

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

    if (props.session && isLiveTerminal.value) {
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
  [() => props.session?.id ?? null, isLiveTerminal, () => settingsStore.terminalFontSize],
  ([sessionId, liveTerminal]) => {
    disposeTerminal()
    if (sessionId && liveTerminal) {
      scheduleTerminalSetup()
    }
  }
)

onMounted(() => {
  if (isLiveTerminal.value) {
    scheduleTerminalSetup()
  }
})

onBeforeUnmount(disposeTerminal)
</script>

<template>
  <section class="terminal-viewport">
    <template v-if="project && session">
      <div v-if="isLiveTerminal" class="terminal-viewport__xterm">
        <div class="terminal-viewport__shell">
          <div class="terminal-viewport__xterm-mount" ref="terminalContainer" />
        </div>
      </div>

      <div v-else class="terminal-viewport__overlay">
        <header class="terminal-viewport__header">
          <div>
            <p class="terminal-viewport__eyebrow">{{ t('terminal.details') }}</p>
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
              <dt>{{ t('terminal.project') }}</dt>
              <dd>{{ project.name }}</dd>
            </div>
            <div>
              <dt>{{ t('terminal.path') }}</dt>
              <dd><code>{{ project.path }}</code></dd>
            </div>
            <div>
              <dt>{{ t('terminal.recovery') }}</dt>
              <dd>{{ session.recoveryMode }}</dd>
            </div>
            <div>
              <dt>{{ t('terminal.externalSession') }}</dt>
              <dd><code>{{ session.externalSessionId ?? t('terminal.notBound') }}</code></dd>
            </div>
          </dl>
        </div>
      </div>
    </template>

    <template v-else>
      <section class="terminal-empty-state">
        <h2>{{ t('terminal.emptyTitle') }}</h2>
        <p>{{ t('terminal.emptyHint') }}</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.terminal-empty-state {
  min-height: 100%;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  background: var(--color-terminal-bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
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
  padding: var(--terminal-shell-gap);
  border-radius: var(--radius-md);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0.01)),
    var(--color-terminal-bg);
  border: 1px solid var(--color-terminal-border);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  overflow: hidden;
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

.terminal-viewport__overlay {
  display: grid;
  gap: 16px;
  padding: 20px 24px;
  border: 1px solid var(--color-terminal-border);
  border-radius: var(--radius-md);
  background: var(--color-terminal-bg);
  color: var(--color-terminal-text);
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
  color: var(--color-terminal-text);
  font-size: 15px;
  font-weight: 600;
}

.terminal-viewport__eyebrow {
  margin: 0 0 6px;
  color: rgba(226, 232, 240, 0.45);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 11px;
  font-weight: 600;
}

.terminal-viewport__meta {
  display: flex;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
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
  font-size: 13px;
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
  font-size: 11px;
  color: rgba(226, 232, 240, 0.35);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.terminal-viewport__field-list dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-terminal-text);
}

.terminal-viewport__field-list code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: rgba(226, 232, 240, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
}
</style>
