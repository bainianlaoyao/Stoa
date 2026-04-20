<script setup lang="ts">
import type { ProjectSummary, SessionSummary } from '@shared/project-session'

const props = defineProps<{
  project: ProjectSummary | null
  session: SessionSummary | null
}>()
</script>

<template>
  <section class="terminal-viewport">
    <template v-if="project && session">
      <header class="terminal-viewport__header">
        <div>
          <p class="terminal-viewport__eyebrow">Session details</p>
          <h2>{{ session.title }}</h2>
        </div>
        <div class="terminal-viewport__meta">
          <span>{{ session.type }}</span>
          <span>{{ session.status }}</span>
        </div>
      </header>

      <div class="terminal-surface">
        <div class="terminal-surface__summary">
          <p>{{ session.summary }}</p>
          <dl class="terminal-surface__details">
            <div>
              <dt>Project</dt>
              <dd>{{ project.name }}</dd>
            </div>
            <div>
              <dt>Path</dt>
              <dd><code>{{ project.path }}</code></dd>
            </div>
            <div>
              <dt>Recovery</dt>
              <dd>{{ session.recoveryMode }}</dd>
            </div>
            <div>
              <dt>External Session</dt>
              <dd><code>{{ session.externalSessionId ?? 'not bound' }}</code></dd>
            </div>
          </dl>
        </div>
      </div>
    </template>

    <template v-else>
      <section class="terminal-empty-state">
        <h2>没有可显示的会话</h2>
        <p>先创建项目，再在项目下创建会话。</p>
      </section>
    </template>
  </section>
</template>
