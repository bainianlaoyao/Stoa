<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'

const { t } = useI18n()

const props = defineProps<{
  hierarchy: ProjectHierarchyNode[]
}>()

const emit = defineEmits<{
  restoreSession: [sessionId: string]
}>()

interface ProjectWithArchived {
  projectId: string
  projectName: string
  projectPath: string
  archivedSessions: ProjectHierarchyNode['archivedSessions']
}

const projectsWithArchived = computed<ProjectWithArchived[]>(() => {
  return props.hierarchy
    .filter((node) => node.archivedSessions.length > 0)
    .map((node) => ({
      projectId: node.id,
      projectName: node.name,
      projectPath: node.path,
      archivedSessions: node.archivedSessions
    }))
})

const totalArchivedCount = computed(() => {
  return projectsWithArchived.value.reduce((sum, p) => sum + p.archivedSessions.length, 0)
})
</script>

<template>
  <section
    class="archive-surface"
    data-surface="archive"
    data-testid="surface.archive"
    aria-label="Archive surface"
  >
    <div class="archive-body">
      <header class="archive-header">
        <p class="archive-eyebrow">{{ t('archive.eyebrow') }}</p>
        <h2 class="archive-title">{{ t('archive.title') }}</h2>
        <p class="archive-subtitle">{{ t('archive.subtitle') }}</p>
      </header>

      <p
        v-if="totalArchivedCount === 0"
        class="archive-empty"
        data-testid="archive.empty"
      >
        {{ t('archive.empty') }}
      </p>

      <div v-else class="archive-groups" data-testid="archive.groups">
        <section
          v-for="project in projectsWithArchived"
          :key="project.projectId"
          class="archive-group"
          :data-project-id="project.projectId"
          data-testid="archive.project.group"
        >
          <header class="archive-group__header">
            <h3 class="archive-group__name">{{ project.projectName }}</h3>
            <code class="archive-group__path">{{ project.projectPath }}</code>
          </header>

          <div class="archive-card-list">
            <article
              v-for="session in project.archivedSessions"
              :key="session.id"
              class="archive-card"
              :data-archive-session="session.id"
              data-testid="archive.session.row"
            >
              <div class="archive-card__content">
                <div class="archive-card__head">
                  <strong class="archive-card__title">{{ session.title }}</strong>
                  <span class="archive-card__badge">{{ session.type }}</span>
                </div>

                <div class="archive-card__meta">
                  <p class="archive-card__summary">
                    {{ session.summary || `${session.runtimeState} / ${session.turnState}` }}
                  </p>
                </div>
              </div>

              <button
                class="archive-card__restore"
                type="button"
                :data-archive-restore="session.id"
                data-testid="archive.session.restore"
                @click="emit('restoreSession', session.id)"
              >
                {{ t('archive.restore') }}
              </button>
            </article>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.archive-surface {
  height: 100%;
  min-height: 0;
}

.archive-body {
  height: 100%;
  min-height: 0;
  overflow: auto;
  display: grid;
  align-content: start;
  gap: 24px;
  padding: 28px 32px;
}

.archive-header {
  display: grid;
  gap: 6px;
}

.archive-eyebrow {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.archive-title {
  margin: 0;
  color: var(--color-text-strong);
  font-size: var(--text-title);
  font-weight: 600;
}

.archive-subtitle {
  margin: 0;
  color: var(--color-muted);
}

.archive-empty {
  margin: 0;
  color: var(--color-muted);
}

/* Project groups */
.archive-groups {
  display: grid;
  gap: 24px;
}

.archive-group {
  display: grid;
  gap: 12px;
}

.archive-group__header {
  display: grid;
  gap: 2px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-line);
}

.archive-group__name {
  margin: 0;
  color: var(--color-text-strong);
  font-size: var(--text-body);
  font-weight: 600;
}

.archive-group__path {
  color: var(--color-subtle);
  font: var(--text-caption) var(--font-mono);
}

/* Cards */
.archive-card-list {
  display: grid;
  gap: 10px;
}

.archive-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 14px 18px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-surface-solid);
  box-shadow: var(--shadow-card);
  transition: all 0.2s ease;
}

.archive-card:hover {
  border-color: var(--color-line-strong);
  background: var(--color-surface-solid);
}

.archive-card__content {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.archive-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.archive-card__title {
  color: var(--color-text-strong);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.archive-card__badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  background: var(--color-surface-solid);
  color: var(--color-muted);
  font-size: var(--text-caption);
  line-height: 1.4;
  text-transform: uppercase;
}

.archive-card__meta {
  display: grid;
  gap: 4px;
}

.archive-card__summary {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--text-body-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.archive-card__restore {
  align-self: center;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-sm);
  background: var(--color-surface-solid);
  color: var(--color-text-strong);
  padding: 8px 12px;
  font: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
}

.archive-card__restore:hover,
.archive-card__restore:focus-visible {
  background: var(--control-fill-hover);
  border-color: var(--color-accent);
  color: var(--color-accent);
  outline: none;
}
</style>
