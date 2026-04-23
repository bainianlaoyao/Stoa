<script setup lang="ts">
import { computed } from 'vue'
import BaseModal from '@renderer/components/primitives/BaseModal.vue'
import type { UpdateState } from '@shared/update-state'

const props = defineProps<{
  visible: boolean
  state: UpdateState
}>()

const emit = defineEmits<{
  dismiss: []
  download: []
  install: []
}>()

const title = computed(() => {
  return props.state.phase === 'downloaded' ? 'Ready to install' : 'Update available'
})

const bodyMessage = computed(() => {
  return props.state.message ?? 'A new build is ready for this installation.'
})

const versionLabel = computed(() => {
  return props.state.downloadedVersion ?? props.state.availableVersion
})
</script>

<template>
  <BaseModal
    :show="visible"
    :title="title"
    @update:show="emit('dismiss')"
  >
    <div data-testid="update-prompt" class="update-prompt">
      <p class="update-prompt__message">{{ bodyMessage }}</p>
      <p v-if="versionLabel" class="update-prompt__version">Version {{ versionLabel }}</p>
      <p
        v-if="state.phase === 'downloaded' && state.requiresSessionWarning"
        class="update-prompt__warning"
      >
        Installing will close active sessions.
      </p>

      <div class="update-prompt__actions">
        <button
          type="button"
          class="btn-ghost"
          data-update-action="dismiss"
          @click="emit('dismiss')"
        >
          Not now
        </button>
        <button
          v-if="state.phase === 'downloaded'"
          type="button"
          class="btn-primary"
          data-update-action="install"
          @click="emit('install')"
        >
          Install now
        </button>
        <button
          v-else
          type="button"
          class="btn-primary"
          data-update-action="download"
          @click="emit('download')"
        >
          Download now
        </button>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
.update-prompt {
  display: grid;
  gap: 14px;
}

.update-prompt__message {
  margin: 0;
  color: var(--color-text);
  line-height: 1.5;
}

.update-prompt__version {
  margin: 0;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 12px;
}

.update-prompt__warning {
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-line);
  background: var(--color-black-faint);
  color: var(--color-text-strong);
  line-height: 1.5;
}

.update-prompt__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
