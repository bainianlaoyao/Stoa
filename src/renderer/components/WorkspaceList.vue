<script setup lang="ts">
import type { WorkspaceSummary } from '@shared/workspace'

const props = defineProps<{
  workspaces: WorkspaceSummary[]
  activeWorkspaceId: string | null
  name: string
  path: string
  providerId: 'local-shell' | 'opencode'
}>()

const emit = defineEmits<{
  select: [workspaceId: string]
  create: []
  'update:name': [value: string]
  'update:path': [value: string]
  'update:providerId': [value: 'local-shell' | 'opencode']
}>()

function statusLabel(summary: WorkspaceSummary): string {
  return summary.isProvisional ? `${summary.status} · provisional` : summary.status
}
</script>

<template>
  <aside class="workspace-list">
    <header class="workspace-list__header">
      <p class="workspace-list__eyebrow">Workspaces</p>
      <h1 class="workspace-list__title">Vibecoding Panel</h1>
      <p class="workspace-list__description">Codex 风格左侧控制台，后端状态驱动前端映射。</p>
    </header>

    <section class="workspace-create-panel">
      <label class="workspace-create-panel__field">
        <span>名称</span>
        <input :value="props.name" type="text" @input="emit('update:name', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="workspace-create-panel__field">
        <span>路径</span>
        <input :value="props.path" type="text" @input="emit('update:path', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="workspace-create-panel__field">
        <span>Provider</span>
        <select :value="props.providerId" @change="emit('update:providerId', ($event.target as HTMLSelectElement).value as 'local-shell' | 'opencode')">
          <option value="local-shell">local-shell</option>
          <option value="opencode">opencode</option>
        </select>
      </label>
      <button class="workspace-create-panel__submit" type="button" @click="emit('create')">添加工作区</button>
    </section>

    <button
      v-for="workspace in workspaces"
      :key="workspace.workspaceId"
      class="workspace-card"
      :class="{ 'workspace-card--active': workspace.workspaceId === activeWorkspaceId }"
      type="button"
      @click="emit('select', workspace.workspaceId)"
    >
      <span class="workspace-card__status" :data-status="workspace.status" />
      <div class="workspace-card__content">
        <div class="workspace-card__heading">
          <strong>{{ workspace.name }}</strong>
          <small>{{ statusLabel(workspace) }}</small>
        </div>
        <p>{{ workspace.summary }}</p>
        <code>{{ workspace.path }}</code>
      </div>
    </button>
  </aside>
</template>
