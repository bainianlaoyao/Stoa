<script setup lang="ts">
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import BaseModal from '../primitives/BaseModal.vue'
import GlassFormField from '../primitives/GlassFormField.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  create: [payload: { name: string; path: string }]
}>()

const store = useWorkspaceStore()
const { lastError } = storeToRefs(store)

const draftName = ref('')
const draftPath = ref('')

function submit() {
  const name = draftName.value.trim()
  const path = draftPath.value.trim()
  if (!name || !path) return
  store.clearError()
  emit('create', { name, path })
}

// Auto-close on success (lastError cleared and no pending error)
watch(() => props.show, (isVisible) => {
  if (!isVisible) {
    draftName.value = ''
    draftPath.value = ''
    store.clearError()
  }
})

// Close modal when error is cleared after successful creation
watch(lastError, (err, prevErr) => {
  if (prevErr && !err && props.show) {
    emit('update:show', false)
  }
})
</script>

<template>
  <BaseModal :show="show" title="新建项目" @update:show="emit('update:show', $event)">
    <GlassFormField
      label="项目名称"
      :model-value="draftName"
      placeholder="my-project"
      @update:model-value="draftName = $event"
    />
    <GlassFormField
      label="项目路径"
      :model-value="draftPath"
      placeholder="/path/to/project"
      @update:model-value="draftPath = $event"
    />
    <div v-if="lastError" class="modal-panel__error">{{ lastError }}</div>
    <div class="modal-panel__footer">
      <button class="button-ghost" @click="emit('update:show', false)">取消</button>
      <button class="button-primary" @click="submit">创建</button>
    </div>
  </BaseModal>
</template>
