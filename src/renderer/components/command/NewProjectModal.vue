<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '../primitives/BaseModal.vue'
import GlassFormField from '../primitives/GlassFormField.vue'
import GlassPathField from '../primitives/GlassPathField.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  create: [payload: { name: string; path: string }]
}>()

const { t } = useI18n()
const store = useWorkspaceStore()

const draftName = ref('')
const draftPath = ref('')

async function browseProjectPath() {
  const path = await window.stoa.pickFolder({ title: t('newProject.selectFolder') })
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
  <BaseModal :show="show" :title="t('newProject.title')" @update:show="emit('update:show', $event)">
    <GlassFormField
      :label="t('newProject.nameLabel')"
      :model-value="draftName"
      placeholder="my-project"
      @update:model-value="draftName = $event"
    />
    <GlassPathField
      :label="t('newProject.pathLabel')"
      :model-value="draftPath"
      :placeholder="t('newProject.pathPlaceholder')"
      mono
      readonly
      :browse-label="t('newProject.browse')"
      @browse="browseProjectPath"
    />
    <div v-if="store.lastError" class="text-xs text-error bg-error/8 rounded-md px-3 py-2 mt-2">{{ store.lastError }}</div>
    <div class="flex justify-end gap-2 mt-5">
      <button class="btn-ghost" @click="emit('update:show', false)">{{ t('newProject.cancel') }}</button>
      <button class="btn-primary" @click="submit">{{ t('newProject.create') }}</button>
    </div>
  </BaseModal>
</template>
