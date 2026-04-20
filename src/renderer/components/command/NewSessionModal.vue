<script setup lang="ts">
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import BaseModal from '../primitives/BaseModal.vue'
import GlassFormField from '../primitives/GlassFormField.vue'
import type { SessionType } from '@shared/project-session'
import { useWorkspaceStore } from '@renderer/stores/workspaces'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  create: [payload: { title: string; type: SessionType }]
}>()

const store = useWorkspaceStore()
const { lastError } = storeToRefs(store)

const draftTitle = ref('')
const draftType = ref<SessionType>('shell')

const sessionTypeOptions = [
  { value: 'shell', label: 'Shell' },
  { value: 'opencode', label: 'OpenCode' }
]

function submit() {
  const title = draftTitle.value.trim()
  if (!title) return
  store.clearError()
  emit('create', { title, type: draftType.value })
}

watch(() => props.show, (isVisible) => {
  if (!isVisible) {
    draftTitle.value = ''
    draftType.value = 'shell'
    store.clearError()
  }
})

watch(lastError, (err, prevErr) => {
  if (prevErr && !err && props.show) {
    emit('update:show', false)
  }
})
</script>

<template>
  <BaseModal :show="show" title="新建会话" @update:show="emit('update:show', $event)">
    <GlassFormField
      label="会话标题"
      :model-value="draftTitle"
      placeholder="my-session"
      @update:model-value="draftTitle = $event"
    />
    <GlassFormField
      label="会话类型"
      type="select"
      :model-value="draftType"
      :options="sessionTypeOptions"
      @update:model-value="draftType = $event as SessionType"
    />
    <div v-if="lastError" class="modal-panel__error">{{ lastError }}</div>
    <div class="modal-panel__footer">
      <button class="button-ghost" @click="emit('update:show', false)">取消</button>
      <button class="button-primary" @click="submit">创建</button>
    </div>
  </BaseModal>
</template>
