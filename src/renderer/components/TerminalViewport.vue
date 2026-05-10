<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount, nextTick, useTemplateRef } from 'vue'
import '@xterm/xterm/css/xterm.css'
import { createTerminalRuntime } from '@renderer/terminal/xterm-runtime'
import { useSettingsStore } from '@renderer/stores/settings'
import { useI18n } from 'vue-i18n'
import WorkspaceQuickActions from './command/WorkspaceQuickActions.vue'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { OpenWorkspaceRequest, ProjectSummary, SessionSummary, TerminalDataChunk } from '@shared/project-session'

const props = withDefaults(defineProps<{
  project: ProjectSummary | null
  session: SessionSummary | null
  visible?: boolean
}>(), {
  visible: true
})

const emit = defineEmits<{
  openWorkspace: [request: OpenWorkspaceRequest]
}>()

function copyTerminalSelection(): void {
  if (!terminal) return
  const selection = terminal.getSelection()
  if (!selection) return
  navigator.clipboard.writeText(selection)
}

const terminalContainer = useTemplateRef<HTMLDivElement>('terminalContainer')
const settingsStore = useSettingsStore()
const { t } = useI18n()

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
let unsubscribeData: (() => void) | null = null
let unsubscribeEvents: (() => void) | null = null
let dataDisposable: { dispose(): void } | null = null
let binaryDisposable: { dispose(): void } | null = null
let pendingFitResolve: (() => void) | null = null
let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null
let mountVersion = 0
let setupScheduleVersion = 0
let visibleSyncVersion = 0
const REPLAY_FALLBACK_TIMEOUT_MS = 1_000

function disposeTerminal() {
  setupScheduleVersion += 1
  mountVersion += 1
  visibleSyncVersion += 1
  pendingFitResolve?.()
  pendingFitResolve = null
  dataDisposable?.dispose()
  dataDisposable = null
  binaryDisposable?.dispose()
  binaryDisposable = null
  unsubscribeData?.()
  unsubscribeData = null
  unsubscribeEvents?.()
  unsubscribeEvents = null
  resizeObserver?.disconnect()
  resizeObserver = null
  if (resizeDebounceTimer !== null) {
    clearTimeout(resizeDebounceTimer)
    resizeDebounceTimer = null
  }
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

async function syncVisibleTerminal(): Promise<void> {
  const currentTerminal = terminal
  const currentFitAddon = fitAddon
  const sessionId = props.session?.id
  const stoa = window.stoa

  if (!props.visible || !currentTerminal || !currentFitAddon || !sessionId || !stoa) {
    return
  }

  const localVisibleSyncVersion = ++visibleSyncVersion

  await nextTick()

  if (
    localVisibleSyncVersion !== visibleSyncVersion
    || !props.visible
    || terminal !== currentTerminal
    || fitAddon !== currentFitAddon
    || props.session?.id !== sessionId
  ) {
    return
  }

  await (document.fonts?.ready ?? Promise.resolve())

  if (
    localVisibleSyncVersion !== visibleSyncVersion
    || !props.visible
    || terminal !== currentTerminal
    || fitAddon !== currentFitAddon
    || props.session?.id !== sessionId
  ) {
    return
  }

  currentFitAddon.fit()
  const { cols, rows } = currentTerminal
  if (cols && rows) {
    stoa.sendSessionResize(sessionId, cols, rows)
  }
  currentTerminal.focus()
}

function scheduleTerminalSetup() {
  const localScheduleVersion = ++setupScheduleVersion

  nextTick(async () => {
    if (localScheduleVersion !== setupScheduleVersion) {
      return
    }

    const resolved = settingsStore.resolvedTerminalSettings()
    const fontStr = `${resolved.fontSize}px "${resolved.fontFamily}"`
    await (document.fonts?.load(fontStr) ?? Promise.resolve())

    if (props.session) {
      try {
        setupTerminal()
      } catch (error) {
        console.error('[terminal] Failed to initialize xterm viewport:', error)
        disposeTerminal()
      }
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
  let writeBuffer = ''
  let writeRafId: number | null = null
  let replayFallbackTimer: ReturnType<typeof setTimeout> | null = null

  let localFitResolve: (() => void) | null = null
  const fitSettled = new Promise<void>((resolve) => { localFitResolve = resolve })
  pendingFitResolve = localFitResolve

  const { terminal: localTerminal, fitAddon: localFitAddon, serializeAddon: localSerializeAddon, shellIntegrationAddon: localShellIntegration } = createTerminalRuntime({
    settings: settingsStore.terminal,
    openExternal: undefined,
    windowsBuildNumber: stoa.windowsBuildNumber
  })
  terminal = localTerminal
  fitAddon = localFitAddon
  localTerminal.open(terminalContainer.value)

  const helperTextarea = terminalContainer.value.querySelector('.xterm-helper-textarea')
  if (helperTextarea) {
    helperTextarea.addEventListener('keydown', (e: Event) => {
      if (!(e instanceof KeyboardEvent)) {
        return
      }
      if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && !e.code) {
        e.stopImmediatePropagation()
      }
    }, true)
  }

  if (props.visible) {
    localTerminal.focus()
  }

  localShellIntegration.onCwdChanged = (cwd: string) => {
    if (!isActiveMount()) return
    console.debug('[terminal] cwd changed:', cwd)
  }
  localShellIntegration.onCommandFinished = (event) => {
    if (!isActiveMount()) return
    console.debug('[terminal] command finished:', event.commandLine, 'exit:', event.exitCode)
  }

  const isActiveMount = () => mountVersion === localMountVersion && terminal === localTerminal
  const flushWriteBuffer = () => {
    if (!isActiveMount() || !writeBuffer) {
      writeBuffer = ''
      writeRafId = null
      return
    }

    const data = writeBuffer
    writeBuffer = ''
    writeRafId = null

    void fitSettled.then(() => {
      if (!isActiveMount()) return
      writeChunk(localTerminal, data)
    })
  }
  const enqueueWrite = (data: string) => {
    if (!data) return

    writeBuffer += data
    if (writeRafId === null) {
      writeRafId = requestAnimationFrame(flushWriteBuffer)
    }
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
      localFitResolve?.()
      return
    }

    await (document.fonts?.ready ?? Promise.resolve())

    if (props.visible) {
      localFitAddon.fit()
      const cols = localTerminal.cols
      const rows = localTerminal.rows
      if (cols && rows) {
        stoa.sendSessionResize(sessionId, cols, rows)
      }
      localTerminal.focus()
    }

    localFitResolve?.()
    localFitResolve = null
  })

  dataDisposable = localTerminal.onData((data) => {
    stoa.sendSessionInput(sessionId, data)
  })
  binaryDisposable = localTerminal.onBinary((data) => {
    stoa.sendSessionBinaryInput(sessionId, Uint8Array.from(data, (char) => char.charCodeAt(0) & 0xff))
  })

  resizeObserver = new ResizeObserver(() => {
    if (!isActiveMount() || !props.visible) return

    if (resizeDebounceTimer !== null) {
      clearTimeout(resizeDebounceTimer)
    }
    resizeDebounceTimer = setTimeout(() => {
      resizeDebounceTimer = null
      if (!isActiveMount() || !props.visible) return

      localFitAddon.fit()

      const { cols, rows } = localTerminal
      stoa.sendSessionResize(sessionId, cols, rows)
    }, 150)
  })
  resizeObserver.observe(terminalContainer.value)

  unsubscribeData = stoa.onTerminalData((chunk: TerminalDataChunk) => {
    if (chunk.sessionId === sessionId) {
      queueOrWrite(chunk.data)
    }
  })

  unsubscribeEvents = stoa.onSessionPresenceChanged((snapshot) => {
    if (snapshot.sessionId !== sessionId) {
      return
    }

    if (snapshot.runtimeState === 'exited') {
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
  [() => props.session?.id ?? null, () => settingsStore.terminal],
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

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      void syncVisibleTerminal()
    }
  }
)

onBeforeUnmount(disposeTerminal)
</script>

<template>
  <section class="terminal-viewport" data-testid="terminal-viewport">
    <template v-if="project && session">
      <div class="terminal-viewport__xterm" data-testid="terminal-xterm">
        <WorkspaceQuickActions
          :project="project"
          :session="session"
          @open-workspace="emit('openWorkspace', $event)"
          @copy-selection="copyTerminalSelection"
        />
        <div class="terminal-viewport__shell" data-testid="terminal-shell">
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
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
}

.terminal-viewport__shell {
  height: 100%;
  width: 100%;
  min-height: 0;
  padding: var(--terminal-shell-gap);
  border-radius: var(--radius-md);
  background:
    linear-gradient(180deg, var(--color-terminal-shell-sheen-strong), var(--color-terminal-shell-sheen-soft)),
    var(--color-terminal-bg);
  border: 1px solid var(--color-terminal-border);
  box-shadow: inset 0 1px 0 var(--color-terminal-shell-highlight);
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

</style>
