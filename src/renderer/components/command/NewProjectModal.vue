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
    <label class="grid gap-1.5">
      <span class="text-[11px] font-semibold text-muted uppercase tracking-[0.08em]">项目路径</span>
      <div class="flex gap-2">
        <input
          class="bg-surface-solid border border-line rounded-lg px-2.5 py-2 font-inherit font-mono text-text-strong outline-none w-full focus:border-accent focus:ring-2 focus:ring-accent/12 placeholder:text-subtle"
          :value="draftPath"
          placeholder="点击 Browse 选择文件夹"
          readonly
          @click="browseProjectPath"
        />
        <button class="btn-ghost min-h-[38px]" type="button" @click="browseProjectPath">Browse</button>
      </div>
    </label>
    <div v-if="store.lastError" class="text-xs text-error bg-error/8 rounded-md px-3 py-2 mt-2">{{ store.lastError }}</div>
    <div class="flex justify-end gap-2 mt-5">
      <button class="btn-ghost" @click="emit('update:show', false)">取消</button>
      <button class="btn-primary" @click="submit">创建</button>
    </div>
  </BaseModal>
</template>
