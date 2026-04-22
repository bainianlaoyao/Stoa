<script setup lang="ts">
import { ref, watch } from 'vue'
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

const draftName = ref('')
const draftPath = ref('')

async function browseProjectPath() {
  const path = await window.stoa.pickFolder({ title: '选择项目目录' })
  if (path) {
    draftPath.value = path
    if (!draftName.value.trim()) {
      draftName.value = path.split(/[/\\]/).filter(Boolean).pop() ?? ''
    }
  }
}

function submit() {
  const name = draftName.value.trim()
  const path = draftPath.value.trim()
  if (!name || !path) return
  store.clearError()
  emit('create', { name, path })
  emit('update:show', false)
}

watch(() => props.show, (isVisible) => {
  if (!isVisible) {
    draftName.value = ''
    draftPath.value = ''
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
    <label class="form-field">
      <span class="form-field__label">项目路径</span>
      <div class="settings-item__row">
        <input
          class="form-field__input settings-item__path-input"
          :value="draftPath"
          placeholder="点击 Browse 选择文件夹"
          readonly
          @click="browseProjectPath"
        />
        <button class="button-ghost settings-item__browse" type="button" @click="browseProjectPath">Browse</button>
      </div>
    </label>
    <div v-if="store.lastError" class="modal-panel__error">{{ store.lastError }}</div>
    <div class="modal-panel__footer">
      <button class="button-ghost" @click="emit('update:show', false)">取消</button>
      <button class="button-primary" @click="submit">创建</button>
    </div>
  </BaseModal>
</template>
