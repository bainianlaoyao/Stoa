<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { SessionType } from '@shared/project-session'
import { listProviderDescriptors } from '@shared/provider-descriptors'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'
import GlassListbox from './primitives/GlassListbox.vue'

const { t } = useI18n()

const props = defineProps<{
  hierarchy: ProjectHierarchyNode[]
  activeProjectId: string | null
  activeSessionId: string | null
  projectName: string
  projectPath: string
  sessionTitle: string
  sessionType: SessionType
}>()

const emit = defineEmits<{
  selectProject: [projectId: string]
  selectSession: [sessionId: string]
  createProject: []
  createSession: [projectId: string]
  'update:projectName': [value: string]
  'update:projectPath': [value: string]
  'update:sessionTitle': [value: string]
  'update:sessionType': [value: SessionType]
}>()

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ')
}

function updateProjectName(event: Event): void {
  emit('update:projectName', (event.target as HTMLInputElement).value)
}

function updateProjectPath(event: Event): void {
  emit('update:projectPath', (event.target as HTMLInputElement).value)
}

function updateSessionTitle(event: Event): void {
  emit('update:sessionTitle', (event.target as HTMLInputElement).value)
}

function updateSessionType(value: string): void {
  emit('update:sessionType', value as SessionType)
}

const sessionTypeOptions = listProviderDescriptors().map((descriptor) => ({
  value: descriptor.sessionType,
  label: descriptor.displayName
}))
</script>

<template>
  <aside class="workspace-list">
    <header class="workspace-list__header">
      <p class="workspace-list__eyebrow">{{ t('workspace.eyebrow') }}</p>
      <h1 class="workspace-list__title">Stoa</h1>
      <p class="workspace-list__description">{{ t('workspace.description') }}</p>
    </header>

    <section class="workspace-create-panel">
      <label class="workspace-create-panel__field">
        <span>{{ t('workspace.projectName') }}</span>
        <input
          :value="props.projectName"
          type="text"
          @input="updateProjectName"
        />
      </label>
      <label class="workspace-create-panel__field">
        <span>{{ t('workspace.projectPath') }}</span>
        <input
          :value="props.projectPath"
          type="text"
          @input="updateProjectPath"
        />
      </label>
      <button class="workspace-create-panel__submit" type="button" @click="emit('createProject')">{{ t('workspace.newProject') }}</button>
    </section>

    <section class="workspace-create-panel workspace-create-panel--session">
      <label class="workspace-create-panel__field">
        <span>{{ t('workspace.sessionTitle') }}</span>
        <input
          :value="props.sessionTitle"
          type="text"
          @input="updateSessionTitle"
        />
      </label>
      <label class="workspace-create-panel__field">
        <span>{{ t('workspace.sessionType') }}</span>
        <GlassListbox
          :model-value="props.sessionType"
          :options="sessionTypeOptions"
          @update:model-value="updateSessionType"
        />
      </label>
    </section>

    <section
      v-for="project in hierarchy"
      :key="project.id"
      class="project-card"
      :class="{ 'project-card--active': project.id === activeProjectId }"
      :data-parent-group="project.id"
    >
      <div class="project-card__header">
        <button class="project-card__trigger" type="button" @click="emit('selectProject', project.id)">
          <div>
            <strong>{{ project.name }}</strong>
            <code>{{ project.path }}</code>
          </div>
        </button>
        <button
          class="project-card__add-session"
          type="button"
          :data-project-create-session="project.id"
          @click="emit('createSession', project.id)"
        >
          +
        </button>
      </div>

      <button
        v-for="session in project.sessions"
        :key="session.id"
        class="workspace-card workspace-card--session"
        :class="{ 'workspace-card--active': session.id === activeSessionId }"
        type="button"
        @click="emit('selectSession', session.id)"
      >
        <span class="workspace-card__status" :data-status="session.status" />
        <div class="workspace-card__content">
          <div class="workspace-card__heading">
            <strong>{{ session.title }}</strong>
            <small>{{ statusLabel(session.status) }}</small>
          </div>
          <p>{{ session.summary }}</p>
          <code>{{ session.type }}</code>
        </div>
      </button>
    </section>
  </aside>
</template>
