<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OpenWorkspaceRequest, ProjectSummary, SessionSummary } from '@shared/project-session'

const props = defineProps<{
  project: ProjectSummary | null
  session: SessionSummary | null
}>()

const emit = defineEmits<{
  openWorkspace: [request: OpenWorkspaceRequest]
}>()

const { t } = useI18n()
const canOpenWorkspace = computed(() => props.project !== null && props.session !== null)

function emitOpenWorkspace(target: OpenWorkspaceRequest['target']): void {
  if (!props.session) {
    return
  }

  emit('openWorkspace', {
    sessionId: props.session.id,
    target
  })
}
</script>

<template>
  <div v-if="canOpenWorkspace" class="workspace-quick-actions" data-testid="workspace.quick-actions">
    <button
      type="button"
      class="workspace-quick-actions__button"
      data-testid="workspace.open-ide"
      :aria-label="t('terminal.quickActions.openIdeAria')"
      @click="emitOpenWorkspace('ide')"
    >
      <svg
        class="workspace-quick-actions__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M5.75 5.75h12.5A1.75 1.75 0 0 1 20 7.5v9a1.75 1.75 0 0 1-1.75 1.75H5.75A1.75 1.75 0 0 1 4 16.5v-9a1.75 1.75 0 0 1 1.75-1.75Z" />
        <path d="m8 10 2.25 2.25L8 14.5" />
        <path d="M13 14.5h3.25" />
      </svg>
      <span>{{ t('terminal.quickActions.openIde') }}</span>
    </button>
    <button
      type="button"
      class="workspace-quick-actions__button"
      data-testid="workspace.open-file-manager"
      :aria-label="t('terminal.quickActions.openFileManagerAria')"
      @click="emitOpenWorkspace('file-manager')"
    >
      <svg
        class="workspace-quick-actions__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M4.75 7.25A1.75 1.75 0 0 1 6.5 5.5h3.2l1.6 1.6h6.2a1.75 1.75 0 0 1 1.75 1.75v7.65a1.75 1.75 0 0 1-1.75 1.75h-11A1.75 1.75 0 0 1 4.75 16.5V7.25Z" />
        <path d="M8 12h8" />
      </svg>
      <span>{{ t('terminal.quickActions.openFileManager') }}</span>
    </button>
  </div>
</template>

<style scoped>
.workspace-quick-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-height: 36px;
}

.workspace-quick-actions__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-sm);
  background: var(--color-surface-solid);
  color: var(--color-text-strong);
  font-family: var(--font-ui);
  font-size: var(--text-body-sm);
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.2s ease;
}

.workspace-quick-actions__button:hover,
.workspace-quick-actions__button:focus-visible {
  border-color: var(--color-line-strong);
  background: var(--color-black-faint);
  outline: none;
}

.workspace-quick-actions__button:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.workspace-quick-actions__icon {
  color: var(--color-muted);
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}
</style>
