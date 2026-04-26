<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@renderer/components/primitives/BaseModal.vue'
import type { UpdateState } from '@shared/update-state'

const { t } = useI18n()

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
  return props.state.phase === 'downloaded' ? t('updatePrompt.titleDownloaded') : t('updatePrompt.titleAvailable')
})

const bodyMessage = computed(() => {
  return props.state.message ?? t('updatePrompt.defaultMessage')
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
      <p v-if="versionLabel" class="update-prompt__version">{{ t('updatePrompt.version', { version: versionLabel }) }}</p>
      <p
        v-if="state.phase === 'downloaded' && state.requiresSessionWarning"
        class="update-prompt__warning"
      >
        {{ t('updatePrompt.warning') }}
      </p>

      <div class="update-prompt__actions">
        <button
          type="button"
          class="btn-ghost"
          data-update-action="dismiss"
          @click="emit('dismiss')"
        >
          {{ t('updatePrompt.dismiss') }}
        </button>
        <button
          v-if="state.phase === 'downloaded'"
          type="button"
          class="btn-primary"
          data-update-action="install"
          @click="emit('install')"
        >
          {{ t('updatePrompt.install') }}
        </button>
        <button
          v-else
          type="button"
          class="btn-primary"
          data-update-action="download"
          @click="emit('download')"
        >
          {{ t('updatePrompt.download') }}
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
