# Session Quick-Create Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global `NewSessionModal` with mouse-proximate floating card + radial menu interactions for session creation.

**Architecture:** Delete `NewSessionModal.vue` and its test. Add `ProviderFloatingCard.vue` (click/right-click trigger) and `ProviderRadialMenu.vue` (long-press trigger), both Teleported to `<body>` with `position: fixed`. Add `provider-icons.ts` for icon definitions. Modify `WorkspaceHierarchyPanel.vue` to wire up the new components with auto-naming.

**Tech Stack:** Vue 3 (Composition API), Vitest + @vue/test-utils, Pinia, CSS design tokens from `:root`

**Spec:** `docs/superpowers/specs/2026-04-22-session-quick-create-design.md`

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/renderer/composables/provider-icons.ts` | Provider icon definitions (SVG + metadata) |
| Create | `src/renderer/components/command/ProviderFloatingCard.vue` | Floating icon card (Mode A + C) |
| Create | `src/renderer/components/command/ProviderFloatingCard.test.ts` | Tests for floating card |
| Create | `src/renderer/components/command/ProviderRadialMenu.vue` | Full-ring radial menu (Mode B) |
| Create | `src/renderer/components/command/ProviderRadialMenu.test.ts` | Tests for radial menu |
| Delete | `src/renderer/components/command/NewSessionModal.vue` | Old modal — removed |
| Delete | `src/renderer/components/command/NewSessionModal.test.ts` | Old modal tests — removed |
| Modify | `src/renderer/components/command/WorkspaceHierarchyPanel.vue` | Wire new components, remove old modal |
| Modify | `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts` | Update tests for new components |
| Modify | `src/renderer/styles.css` | Floating card, radial menu, improved `+` button styles |

---

### Task 1: Provider Icon Definitions

**Files:**
- Create: `src/renderer/composables/provider-icons.ts`

- [ ] **Step 1: Create the provider-icons module**

```typescript
// src/renderer/composables/provider-icons.ts
import type { SessionType } from '@shared/project-session'

export interface ProviderIcon {
  type: SessionType
  label: string
  svg: string
  viewBox: string
}

export const PROVIDER_ICONS: ProviderIcon[] = [
  {
    type: 'opencode',
    label: 'OC',
    viewBox: '0 0 512 512',
    svg: '<rect width="512" height="512" fill="#131010"/>'
      + '<path d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z" fill="white"/>'
      + '<path d="M320 224V352H192V224H320Z" fill="#5A5858"/>'
  },
  {
    type: 'shell',
    label: 'Shell',
    viewBox: '0 0 24 24',
    svg: '<rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>'
      + '<path d="M7 8l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<line x1="13" y1="14" x2="17" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
  }
]
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/composables/provider-icons.ts
git commit -m "feat: add provider icon definitions for quick-create UI"
```

---

### Task 2: ProviderFloatingCard Component + Tests (TDD)

**Files:**
- Create: `src/renderer/components/command/ProviderFloatingCard.vue`
- Create: `src/renderer/components/command/ProviderFloatingCard.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/renderer/components/command/ProviderFloatingCard.test.ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ProviderFloatingCard from './ProviderFloatingCard.vue'

const MOCK_POSITION = { x: 100, y: 50, width: 24, height: 24 }

function mountCard(overrides: { visible?: boolean } = {}) {
  return mount(ProviderFloatingCard, {
    props: {
      visible: overrides.visible ?? true,
      projectId: 'project_alpha',
      position: MOCK_POSITION
    },
    attachTo: document.body
  })
}

describe('ProviderFloatingCard', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setActivePinia(createPinia())
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders a role="group" with aria-label="Session providers"', () => {
    mountCard()
    const group = document.body.querySelector('[role="group"][aria-label="Session providers"]')
    expect(group).toBeTruthy()
  })

  it('renders one button per provider with semantic aria-labels', () => {
    mountCard()
    const buttons = document.body.querySelectorAll('[role="group"] button[aria-label]')
    expect(buttons).toHaveLength(2)

    const labels = Array.from(buttons).map(b => b.getAttribute('aria-label'))
    expect(labels).toContain('Create OpenCode session')
    expect(labels).toContain('Create Shell session')
  })

  it('clicking a provider button emits create with correct type', async () => {
    const wrapper = mountCard()
    const buttons = document.body.querySelectorAll('[role="group"] button[aria-label]')

    const shellButton = Array.from(buttons).find(
      b => b.getAttribute('aria-label') === 'Create Shell session'
    ) as HTMLButtonElement

    shellButton.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('create')).toEqual([[{ type: 'shell' }]])
  })

  it('clicking the OpenCode button emits create with type opencode', async () => {
    const wrapper = mountCard()
    const buttons = document.body.querySelectorAll('[role="group"] button[aria-label]')

    const ocButton = Array.from(buttons).find(
      b => b.getAttribute('aria-label') === 'Create OpenCode session'
    ) as HTMLButtonElement

    ocButton.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('create')).toEqual([[{ type: 'opencode' }]])
  })

  it('pressing Escape emits close', async () => {
    const wrapper = mountCard()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('does not render the group when visible is false', () => {
    mountCard({ visible: false })
    const group = document.body.querySelector('[role="group"][aria-label="Session providers"]')
    expect(group).toBeFalsy()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/components/command/ProviderFloatingCard.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component implementation**

```vue
<!-- src/renderer/components/command/ProviderFloatingCard.vue -->
<script setup lang="ts">
import type { SessionType } from '@shared/project-session'
import { PROVIDER_ICONS } from '@renderer/composables/provider-icons'

defineProps<{
  visible: boolean
  projectId: string
  position: { x: number; y: number; width: number; height: number }
}>()

const emit = defineEmits<{
  create: [payload: { type: SessionType }]
  close: []
}>()

function select(type: SessionType) {
  emit('create', { type })
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      role="group"
      aria-label="Session providers"
      class="provider-floating-card"
      :style="{
        left: `${position.x + position.width + 4}px`,
        top: `${position.y - 4}px`
      }"
      @keydown="onKeydown"
    >
      <button
        v-for="provider in PROVIDER_ICONS"
        :key="provider.type"
        class="provider-icon-cell"
        :aria-label="`Create ${provider.label === 'OC' ? 'OpenCode' : provider.label} session`"
        @click="select(provider.type)"
      >
        <span class="provider-icon-cell__icon" v-html="provider.svg" />
        <span class="provider-icon-cell__label">{{ provider.label }}</span>
      </button>
    </div>
  </Teleport>
</template>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/components/command/ProviderFloatingCard.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/command/ProviderFloatingCard.vue src/renderer/components/command/ProviderFloatingCard.test.ts
git commit -m "feat: add ProviderFloatingCard component with semantic tests"
```

---

### Task 3: ProviderRadialMenu Component + Tests (TDD)

**Files:**
- Create: `src/renderer/components/command/ProviderRadialMenu.vue`
- Create: `src/renderer/components/command/ProviderRadialMenu.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/renderer/components/command/ProviderRadialMenu.test.ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ProviderRadialMenu from './ProviderRadialMenu.vue'

const MOCK_CENTER = { x: 200, y: 150 }

function mountRadial(overrides: { visible?: boolean } = {}) {
  return mount(ProviderRadialMenu, {
    props: {
      visible: overrides.visible ?? true,
      projectId: 'project_alpha',
      center: MOCK_CENTER
    },
    attachTo: document.body
  })
}

describe('ProviderRadialMenu', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setActivePinia(createPinia())
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders a role="group" with aria-label="Session providers (radial)"', () => {
    mountRadial()
    const group = document.body.querySelector(
      '[role="group"][aria-label="Session providers (radial)"]'
    )
    expect(group).toBeTruthy()
  })

  it('renders one button per provider with semantic aria-labels', () => {
    mountRadial()
    const buttons = document.body.querySelectorAll('[role="group"] button[aria-label]')
    expect(buttons).toHaveLength(2)

    const labels = Array.from(buttons).map(b => b.getAttribute('aria-label'))
    expect(labels).toContain('Create OpenCode session')
    expect(labels).toContain('Create Shell session')
  })

  it('clicking a provider button emits create with correct type', async () => {
    const wrapper = mountRadial()
    const buttons = document.body.querySelectorAll('[role="group"] button[aria-label]')

    const shellButton = Array.from(buttons).find(
      b => b.getAttribute('aria-label') === 'Create Shell session'
    ) as HTMLButtonElement

    shellButton.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('create')).toEqual([[{ type: 'shell' }]])
  })

  it('does not render the group when visible is false', () => {
    mountRadial({ visible: false })
    const group = document.body.querySelector(
      '[role="group"][aria-label="Session providers (radial)"]'
    )
    expect(group).toBeFalsy()
  })

  it('renders a decorative ring track with aria-hidden', () => {
    mountRadial()
    const track = document.body.querySelector('.radial-menu__track')
    expect(track).toBeTruthy()
    expect(track?.getAttribute('aria-hidden')).toBe('true')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/components/command/ProviderRadialMenu.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component implementation**

```vue
<!-- src/renderer/components/command/ProviderRadialMenu.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { SessionType } from '@shared/project-session'
import { PROVIDER_ICONS } from '@renderer/composables/provider-icons'

const props = defineProps<{
  visible: boolean
  projectId: string
  center: { x: number; y: number }
}>()

const emit = defineEmits<{
  create: [payload: { type: SessionType }]
  close: []
}>()

const RING_RADIUS = 52

const providerPositions = computed(() => {
  const count = PROVIDER_ICONS.length
  return PROVIDER_ICONS.map((provider, index) => {
    // Distribute evenly around full 360°, starting from top (-90° offset)
    const angle = (index * 360 / count) - 90
    const radians = angle * Math.PI / 180
    return {
      provider,
      x: Math.cos(radians) * RING_RADIUS,
      y: Math.sin(radians) * RING_RADIUS
    }
  })
})

function select(type: SessionType) {
  emit('create', { type })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      role="group"
      aria-label="Session providers (radial)"
      class="radial-menu"
      :style="{
        left: `${center.x}px`,
        top: `${center.y}px`
      }"
    >
      <div
        class="radial-menu__track"
        aria-hidden="true"
        :style="{
          width: `${RING_RADIUS * 2}px`,
          height: `${RING_RADIUS * 2}px`,
          marginLeft: `${-RING_RADIUS}px`,
          marginTop: `${-RING_RADIUS}px`
        }"
      />

      <button
        v-for="item in providerPositions"
        :key="item.provider.type"
        class="radial-menu__item"
        :aria-label="`Create ${item.provider.label === 'OC' ? 'OpenCode' : item.provider.label} session`"
        :style="{
          left: `${item.x}px`,
          top: `${item.y}px`
        }"
        @click="select(item.provider.type)"
      >
        <span class="radial-menu__item-icon" v-html="item.provider.svg" />
      </button>
    </div>
  </Teleport>
</template>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/components/command/ProviderRadialMenu.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/command/ProviderRadialMenu.vue src/renderer/components/command/ProviderRadialMenu.test.ts
git commit -m "feat: add ProviderRadialMenu component with semantic tests"
```

---

### Task 4: CSS Styles for New Components

**Files:**
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Add styles at the end of `src/renderer/styles.css`**

Append the following after the existing `@media` block (line 709):

```css
/* ─── Provider Quick-Create: Floating Card ─── */

.provider-floating-card {
  position: fixed;
  z-index: 100;
  background: var(--surface);
  backdrop-filter: blur(40px) saturate(120%);
  -webkit-backdrop-filter: blur(40px) saturate(120%);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-soft);
  padding: 6px;
  display: flex;
  gap: 4px;
}

.provider-icon-cell {
  display: grid;
  place-items: center;
  gap: 2px;
  width: 52px;
  height: 52px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: var(--font-ui);
}

.provider-icon-cell:hover {
  background: var(--black-soft);
}

.provider-icon-cell:active {
  background: rgba(0, 0, 0, 0.06);
}

.provider-icon-cell__icon {
  display: grid;
  place-items: center;
}

.provider-icon-cell__icon :deep(svg) {
  width: 22px;
  height: 22px;
}

.provider-icon-cell__label {
  font-size: 9px;
  font-weight: 600;
  color: var(--muted);
}

/* ─── Provider Quick-Create: Radial Menu ─── */

.radial-menu {
  position: fixed;
  z-index: 200;
  pointer-events: none;
}

.radial-menu__track {
  position: absolute;
  border: 1.5px solid var(--line);
  border-radius: 50%;
}

.radial-menu__item {
  position: absolute;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--surface);
  backdrop-filter: blur(40px) saturate(120%);
  -webkit-backdrop-filter: blur(40px) saturate(120%);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-soft);
  cursor: pointer;
  pointer-events: auto;
  transition: all 0.2s ease;
  transform: translate(-50%, -50%);
  padding: 0;
  margin: 0;
}

.radial-menu__item:hover {
  background: var(--surface-solid);
  border-color: rgba(0, 0, 0, 0.04);
  box-shadow: var(--shadow-card);
}

.radial-menu__item-icon {
  display: grid;
  place-items: center;
}

.radial-menu__item-icon :deep(svg) {
  width: 20px;
  height: 20px;
}

/* ─── + Button Improvement ─── */

.route-add-session {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 999px;
  display: grid;
  place-items: center;
  padding: 0;
  background: transparent;
  color: var(--muted);
  font-size: 14px;
  line-height: 1;
  font-weight: 300;
  flex: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.route-add-session:hover {
  background: var(--black-soft);
  color: var(--text-strong);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles.css
git commit -m "feat: add floating card, radial menu, and improved + button styles"
```

---

### Task 5: Wire WorkspaceHierarchyPanel — Replace Modal with New Components

**Files:**
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`

This is the core integration task. The panel must:
1. Remove all `NewSessionModal` references
2. Add floating card + radial menu
3. Add long-press detection on `+` button
4. Add right-click handler on project rows
5. Implement auto-naming logic

- [ ] **Step 1: Replace the entire `WorkspaceHierarchyPanel.vue`**

```vue
<!-- src/renderer/components/command/WorkspaceHierarchyPanel.vue -->
<script setup lang="ts">
import { ref, watch } from 'vue'
import type { SessionType } from '@shared/project-session'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import NewProjectModal from './NewProjectModal.vue'
import ProviderFloatingCard from './ProviderFloatingCard.vue'
import ProviderRadialMenu from './ProviderRadialMenu.vue'

const props = defineProps<{
  hierarchy: ProjectHierarchyNode[]
  activeProjectId: string | null
  activeSessionId: string | null
}>()

const emit = defineEmits<{
  selectProject: [projectId: string]
  selectSession: [sessionId: string]
  createProject: [payload: { name: string; path: string }]
  createSession: [payload: { projectId: string; type: SessionType; title: string }]
}>()

const showNewProject = ref(false)
const workspaceStore = useWorkspaceStore()

// Floating card state
const floatingCardVisible = ref(false)
const floatingCardProjectId = ref('')
const floatingCardPosition = ref({ x: 0, y: 0, width: 0, height: 0 })

// Radial menu state
const radialMenuVisible = ref(false)
const radialMenuProjectId = ref('')
const radialMenuCenter = ref({ x: 0, y: 0 })

// Long-press state
let longPressTimer: ReturnType<typeof setTimeout> | null = null

function generateTitle(projectId: string, type: SessionType): string {
  const project = props.hierarchy.find(p => p.id === projectId)
  if (type === 'opencode') {
    const projectName = project?.name ?? 'session'
    return `opencode-${projectName}`
  }
  const shellCount = project?.sessions.filter(s => s.type === 'shell').length ?? 0
  return `shell-${shellCount + 1}`
}

function handleFloatingCardCreate(payload: { type: SessionType }) {
  const title = generateTitle(floatingCardProjectId.value, payload.type)
  emit('createSession', { projectId: floatingCardProjectId.value, type: payload.type, title })
  floatingCardVisible.value = false
}

function handleRadialMenuCreate(payload: { type: SessionType }) {
  const title = generateTitle(radialMenuProjectId.value, payload.type)
  emit('createSession', { projectId: radialMenuProjectId.value, type: payload.type, title })
  radialMenuVisible.value = false
}

function closeFloatingCard() {
  floatingCardVisible.value = false
}

function closeRadialMenu() {
  radialMenuVisible.value = false
}

// + button: mousedown starts long-press timer, mouseup before 200ms = click (floating card)
function onAddButtonMouseDown(event: MouseEvent, projectId: string) {
  const buttonEl = event.currentTarget as HTMLElement
  const rect = buttonEl.getBoundingClientRect()

  radialMenuProjectId.value = projectId
  floatingCardProjectId.value = projectId
  floatingCardPosition.value = { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
  radialMenuCenter.value = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }

  longPressTimer = setTimeout(() => {
    longPressTimer = null
    floatingCardVisible.value = false
    radialMenuVisible.value = true
  }, 200)
}

function onAddButtonMouseUp() {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
    // Short click — show floating card
    floatingCardVisible.value = true
    radialMenuVisible.value = false
  }
}

function onAddButtonMouseLeave() {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

// Right-click on project row
function onProjectRowContextmenu(event: MouseEvent, projectId: string) {
  event.preventDefault()
  floatingCardProjectId.value = projectId
  floatingCardPosition.value = { x: event.clientX, y: event.clientY, width: 0, height: 0 }
  floatingCardVisible.value = true
  radialMenuVisible.value = false
}

// Auto-close floating card on session creation success
watch(
  () => workspaceStore.isCreatingSession,
  (isCreatingSession, wasCreatingSession) => {
    if (wasCreatingSession && !isCreatingSession && workspaceStore.sessionCreateSucceeded) {
      floatingCardVisible.value = false
      radialMenuVisible.value = false
    }
  }
)

// Auto-close new project modal on success
watch(
  () => workspaceStore.isCreatingProject,
  (isCreatingProject, wasCreatingProject) => {
    if (wasCreatingProject && !isCreatingProject && workspaceStore.projectCreateSucceeded) {
      showNewProject.value = false
    }
  }
)
</script>

<template>
  <aside class="workspace-hierarchy-panel" aria-label="Workspace hierarchy">
    <div class="route-body">
      <div class="route-actions">
        <button class="route-action" type="button" @click="showNewProject = true">
          <span class="route-action-label">New Project</span>
          <span class="route-action-icon">+</span>
        </button>
      </div>

      <div class="route-group">
        <h2 class="group-label">Projects</h2>

        <div v-for="project in hierarchy" :key="project.id" class="route-project">
          <div
            class="route-project-row"
            @contextmenu="onProjectRowContextmenu($event, project.id)"
          >
            <button
              class="route-item route-item--parent"
              :class="{ 'route-item--active': project.id === activeProjectId }"
              :aria-current="project.id === activeProjectId ? 'true' : undefined"
              type="button"
              @click="emit('selectProject', project.id)"
            >
              <div class="route-dot idle" />
              <div class="route-copy">
                <div class="route-name">{{ project.name }}</div>
                <div class="route-path">{{ project.path }}</div>
              </div>
            </button>
            <div class="route-project-actions">
              <button
                class="route-add-session"
                type="button"
                :aria-label="`Add session to ${project.name}`"
                title="Add session · long-press for radial"
                @mousedown="onAddButtonMouseDown($event, project.id)"
                @mouseup="onAddButtonMouseUp"
                @mouseleave="onAddButtonMouseLeave"
              >
                +
              </button>
            </div>
          </div>

          <button
            v-for="session in project.sessions"
            :key="session.id"
            class="route-item child"
            :class="{ 'route-item--active': session.id === activeSessionId }"
            :aria-current="session.id === activeSessionId ? 'true' : undefined"
            type="button"
            @click="emit('selectSession', session.id)"
          >
            <div class="route-dot" :class="session.status" />
            <div class="route-copy">
              <div class="route-name">{{ session.title }}</div>
              <div class="route-time">{{ session.type }}</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  </aside>

  <NewProjectModal
    v-model:show="showNewProject"
    :pending="workspaceStore.isCreatingProject"
    @create="emit('createProject', $event)"
  />

  <ProviderFloatingCard
    :visible="floatingCardVisible"
    :project-id="floatingCardProjectId"
    :position="floatingCardPosition"
    @create="handleFloatingCardCreate"
    @close="closeFloatingCard"
  />

  <ProviderRadialMenu
    :visible="radialMenuVisible"
    :project-id="radialMenuProjectId"
    :center="radialMenuCenter"
    @create="handleRadialMenuCreate"
    @close="closeRadialMenu"
  />
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/command/WorkspaceHierarchyPanel.vue
git commit -m "feat: wire floating card + radial menu into WorkspaceHierarchyPanel"
```

---

### Task 6: Update WorkspaceHierarchyPanel Tests

**Files:**
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`

- [ ] **Step 1: Update the test file**

Replace the import and the modal integration tests. The full file replacement:

```typescript
// src/renderer/components/command/WorkspaceHierarchyPanel.test.ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import WorkspaceHierarchyPanel from './WorkspaceHierarchyPanel.vue'
import NewProjectModal from './NewProjectModal.vue'
import ProviderFloatingCard from './ProviderFloatingCard.vue'
import ProviderRadialMenu from './ProviderRadialMenu.vue'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'

function createHierarchy(): ProjectHierarchyNode[] {
  return [
    {
      id: 'project_alpha',
      name: 'infra-control',
      path: 'D:/infra-control',
      createdAt: 'a',
      updatedAt: 'a',
      active: true,
      sessions: [
        {
          id: 'session_1',
          projectId: 'project_alpha',
          type: 'opencode',
          status: 'running',
          title: 'deploy gateway',
          summary: 'running',
          recoveryMode: 'resume-external',
          externalSessionId: 'sess_1',
          createdAt: 'a',
          updatedAt: 'a',
          lastActivatedAt: 'a',
          active: false
        },
        {
          id: 'session_2',
          projectId: 'project_alpha',
          type: 'shell',
          status: 'awaiting_input',
          title: 'need confirmation',
          summary: 'awaiting',
          recoveryMode: 'resume-external',
          externalSessionId: 'sess_2',
          createdAt: 'b',
          updatedAt: 'b',
          lastActivatedAt: 'b',
          active: true
        }
      ]
    }
  ]
}

function createTwoProjectHierarchy(): ProjectHierarchyNode[] {
  return [
    {
      id: 'project_alpha',
      name: 'infra-control',
      path: 'D:/infra-control',
      createdAt: 'a',
      updatedAt: 'a',
      active: true,
      sessions: [
        {
          id: 'session_1',
          projectId: 'project_alpha',
          type: 'opencode',
          status: 'running',
          title: 'deploy gateway',
          summary: 'running',
          recoveryMode: 'resume-external',
          externalSessionId: 'sess_1',
          createdAt: 'a',
          updatedAt: 'a',
          lastActivatedAt: 'a',
          active: false
        }
      ]
    },
    {
      id: 'project_beta',
      name: 'data-pipeline',
      path: 'D:/data-pipeline',
      createdAt: 'c',
      updatedAt: 'c',
      active: false,
      sessions: [
        {
          id: 'session_3',
          projectId: 'project_beta',
          type: 'shell',
          status: 'exited',
          title: 'etl run',
          summary: 'done',
          recoveryMode: 'fresh-shell',
          externalSessionId: null,
          createdAt: 'c',
          updatedAt: 'c',
          lastActivatedAt: 'c',
          active: false
        }
      ]
    }
  ]
}

function mountPanel(overrides: { hierarchy?: ProjectHierarchyNode[]; activeProjectId?: string | null; activeSessionId?: string | null } = {}) {
  return mount(WorkspaceHierarchyPanel, {
    global: { plugins: [createPinia()] },
    props: {
      hierarchy: overrides.hierarchy ?? createHierarchy(),
      activeProjectId: overrides.activeProjectId !== undefined ? overrides.activeProjectId : 'project_alpha',
      activeSessionId: overrides.activeSessionId !== undefined ? overrides.activeSessionId : 'session_2'
    }
  })
}

describe('WorkspaceHierarchyPanel', () => {
  describe('render', () => {
    it('renders a named workspace hierarchy complementary region', () => {
      const wrapper = mountPanel()
      const panel = wrapper.get('aside.workspace-hierarchy-panel[aria-label="Workspace hierarchy"]')
      expect(panel.element.tagName).toBe('ASIDE')
    })

    it('renders .route-body container', () => {
      const wrapper = mountPanel()
      expect(wrapper.find('.route-body').exists()).toBe(true)
    })

    it('renders the new project action as a named button', () => {
      const wrapper = mountPanel()
      const btn = wrapper.get('button.route-action')
      expect(btn.text()).toContain('New Project')
    })

    it('renders the project group label as a heading', () => {
      const wrapper = mountPanel()
      const label = wrapper.get('h2.group-label')
      expect(label.text()).toBe('Projects')
    })

    it('renders one .route-project div per project', () => {
      const wrapper = mountPanel()
      expect(wrapper.findAll('.route-project')).toHaveLength(1)

      const wrapper2 = mountPanel({ hierarchy: createTwoProjectHierarchy() })
      expect(wrapper2.findAll('.route-project')).toHaveLength(2)
    })

    it('exposes project rows as semantic buttons with stable names', () => {
      const wrapper = mountPanel()
      const projectButton = wrapper.get('button.route-item--parent')
      expect(projectButton.text()).toContain('infra-control')
    })

    it('renders project path in .route-path', () => {
      const wrapper = mountPanel()
      const path = wrapper.find('.route-project .route-item--parent .route-path')
      expect(path.text()).toBe('D:/infra-control')
    })

    it('renders one semantic session button per session', () => {
      const wrapper = mountPanel()
      const children = wrapper.findAll('.route-item.child')
      expect(children).toHaveLength(2)
      expect(children.every(c => c.element.tagName === 'BUTTON')).toBe(true)
    })

    it('renders session title in child .route-name', () => {
      const wrapper = mountPanel()
      const children = wrapper.findAll('.route-item.child')
      const titles = children.map(c => c.find('.route-name').text())
      expect(titles).toContain('deploy gateway')
      expect(titles).toContain('need confirmation')
    })

    it('renders session type in child .route-time', () => {
      const wrapper = mountPanel()
      const children = wrapper.findAll('.route-item.child')
      const types = children.map(c => c.find('.route-time').text())
      expect(types).toContain('opencode')
      expect(types).toContain('shell')
    })

    it('renders .route-dot with session.status as CSS class', () => {
      const wrapper = mountPanel()
      const children = wrapper.findAll('.route-item.child')
      const dot1 = children[0].find('.route-dot')
      expect(dot1.classes()).toContain('running')
      const dot2 = children[1].find('.route-dot')
      expect(dot2.classes()).toContain('awaiting_input')
    })

    it('exposes contextual accessible names for add-session actions', () => {
      const wrapper = mountPanel()
      const btns = wrapper.findAll('.route-add-session')
      expect(btns).toHaveLength(1)
      expect(btns[0].attributes('aria-label')).toBe('Add session to infra-control')
      expect(btns[0].text()).toBe('+')
    })
  })

  describe('empty hierarchy', () => {
    it('renders "New Project" button even with empty hierarchy', () => {
      const wrapper = mountPanel({ hierarchy: [], activeProjectId: null, activeSessionId: null })
      expect(wrapper.find('.route-action').exists()).toBe(true)
      expect(wrapper.find('.route-action').text()).toContain('New Project')
    })

    it('renders the project heading even with empty hierarchy', () => {
      const wrapper = mountPanel({ hierarchy: [], activeProjectId: null, activeSessionId: null })
      expect(wrapper.get('h2.group-label').text()).toBe('Projects')
    })

    it('renders zero .route-project divs', () => {
      const wrapper = mountPanel({ hierarchy: [], activeProjectId: null, activeSessionId: null })
      expect(wrapper.findAll('.route-project')).toHaveLength(0)
    })

    it('does NOT crash with empty hierarchy', () => {
      expect(() => mountPanel({ hierarchy: [], activeProjectId: null, activeSessionId: null })).not.toThrow()
    })
  })

  describe('active states', () => {
    it('project matching activeProjectId exposes a semantic current state', () => {
      const wrapper = mountPanel()
      const parentItem = wrapper.get('button.route-item--parent')
      expect(parentItem.attributes('aria-current')).toBe('true')
      expect(parentItem.classes()).toContain('route-item--active')
    })

    it('session matching activeSessionId exposes a semantic current state', () => {
      const wrapper = mountPanel()
      const children = wrapper.findAll('.route-item.child')
      const activeSession = children.find(c => c.classes().includes('route-item--active'))
      expect(activeSession).toBeDefined()
      expect(activeSession!.attributes('aria-current')).toBe('true')
      expect(activeSession!.text()).toContain('need confirmation')
    })

    it('only ONE .route-item--active project when multiple exist', () => {
      const wrapper = mountPanel({
        hierarchy: createTwoProjectHierarchy(),
        activeProjectId: 'project_beta',
        activeSessionId: 'session_3'
      })
      const parentItems = wrapper.findAll('.route-item--parent')
      const activeParents = parentItems.filter(p => p.classes().includes('route-item--active'))
      expect(activeParents).toHaveLength(1)
      expect(activeParents[0].find('.route-name').text()).toBe('data-pipeline')
    })

    it('does not expose project current state when activeProjectId is null', () => {
      const wrapper = mountPanel({ activeProjectId: null, activeSessionId: null })
      const parentItems = wrapper.findAll('.route-item--parent')
      const activeParents = parentItems.filter(p => p.classes().includes('route-item--active'))
      expect(activeParents).toHaveLength(0)
      expect(parentItems.every((item) => item.attributes('aria-current') === undefined)).toBe(true)
    })

    it('does not expose session current state when activeSessionId is null', () => {
      const wrapper = mountPanel({ activeProjectId: null, activeSessionId: null })
      const children = wrapper.findAll('.route-item.child')
      const activeChildren = children.filter(c => c.classes().includes('route-item--active'))
      expect(activeChildren).toHaveLength(0)
      expect(children.every((item) => item.attributes('aria-current') === undefined)).toBe(true)
    })
  })

  describe('project selection', () => {
    it('clicking the semantic project button emits selectProject with project id', async () => {
      const wrapper = mountPanel()
      await wrapper.get('button.route-item--parent').trigger('click')
      expect(wrapper.emitted('selectProject')).toEqual([['project_alpha']])
    })

    it('clicking inactive project emits correct id', async () => {
      const wrapper = mountPanel({
        hierarchy: createTwoProjectHierarchy(),
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_1'
      })
      const parents = wrapper.findAll('.route-item--parent')
      await parents[1].trigger('click')
      expect(wrapper.emitted('selectProject')).toEqual([['project_beta']])
    })
  })

  describe('session selection', () => {
    it('clicking session row emits selectSession with session id', async () => {
      const wrapper = mountPanel()
      const children = wrapper.findAll('.route-item.child')
      await children[0].trigger('click')
      expect(wrapper.emitted('selectSession')).toEqual([['session_1']])
    })
  })

  describe('add session button', () => {
    it('clicking the named add-session button does NOT emit selectProject (click.stop works)', async () => {
      const wrapper = mountPanel()
      await wrapper.find('.route-add-session').trigger('click')
      expect(wrapper.emitted('selectProject')).toBeUndefined()
    })

    it('clicking "+" does NOT directly emit createSession', async () => {
      const wrapper = mountPanel()
      await wrapper.find('.route-add-session').trigger('click')
      expect(wrapper.emitted('createSession')).toBeUndefined()
    })
  })

  describe('new project button', () => {
    it('clicking the named New Project button keeps the component mounted', async () => {
      const wrapper = mountPanel()
      await wrapper.get('button.route-action').trigger('click')
      expect(wrapper.get('button.route-action')).toBeTruthy()
    })
  })

  describe('component integration', () => {
    it('NewProjectModal component is rendered in the wrapper', () => {
      const wrapper = mountPanel()
      expect(wrapper.findComponent(NewProjectModal).exists()).toBe(true)
    })

    it('ProviderFloatingCard component is rendered in the wrapper', () => {
      const wrapper = mountPanel()
      expect(wrapper.findComponent(ProviderFloatingCard).exists()).toBe(true)
    })

    it('ProviderRadialMenu component is rendered in the wrapper', () => {
      const wrapper = mountPanel()
      expect(wrapper.findComponent(ProviderRadialMenu).exists()).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('project with zero sessions renders project row but no session buttons', () => {
      const hierarchy: ProjectHierarchyNode[] = [
        {
          id: 'project_empty',
          name: 'empty-project',
          path: 'D:/empty',
          createdAt: 'a',
          updatedAt: 'a',
          active: true,
          sessions: []
        }
      ]
      const wrapper = mountPanel({ hierarchy, activeProjectId: 'project_empty', activeSessionId: null })
      expect(wrapper.findAll('.route-project')).toHaveLength(1)
      expect(wrapper.get('button.route-item--parent')).toBeTruthy()
      expect(wrapper.findAll('.route-item.child')).toHaveLength(0)
    })

    it('hierarchy with multiple projects renders all with correct data', () => {
      const wrapper = mountPanel({
        hierarchy: createTwoProjectHierarchy(),
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_1'
      })
      const projects = wrapper.findAll('.route-project')
      expect(projects).toHaveLength(2)

      const names = projects.map(p => p.find('.route-item--parent .route-name').text())
      expect(names).toEqual(['infra-control', 'data-pipeline'])

      const paths = projects.map(p => p.find('.route-item--parent .route-path').text())
      expect(paths).toEqual(['D:/infra-control', 'D:/data-pipeline'])
    })
  })
})
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/command/WorkspaceHierarchyPanel.test.ts
git commit -m "test: update WorkspaceHierarchyPanel tests for new components"
```

---

### Task 7: Delete Old NewSessionModal + Test

**Files:**
- Delete: `src/renderer/components/command/NewSessionModal.vue`
- Delete: `src/renderer/components/command/NewSessionModal.test.ts`

- [ ] **Step 1: Delete the files**

```bash
git rm src/renderer/components/command/NewSessionModal.vue src/renderer/components/command/NewSessionModal.test.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: remove NewSessionModal — replaced by floating card + radial menu"
```

---

### Task 8: Full Test Suite Verification

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: Zero unexpected failures (the known `sandbox:false` intentional failure in `main-config-guard.test.ts` is acceptable)

- [ ] **Step 2: Run LSP diagnostics on all changed files**

Check `ProviderFloatingCard.vue`, `ProviderRadialMenu.vue`, `WorkspaceHierarchyPanel.vue`, `provider-icons.ts` for type errors.

- [ ] **Step 3: Fix any failures**

If any test fails, fix the code (not the test). Re-run until green.

- [ ] **Step 4: Final commit if fixes were needed**

```bash
git add -A
git commit -m "fix: resolve test failures from quick-create integration"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec Requirement | Task |
|---|---|
| Provider icon definitions with SVG | Task 1 |
| Floating card component | Task 2 |
| Floating card tests | Task 2 |
| Radial menu component (full ring, 0°/180°) | Task 3 |
| Radial menu tests | Task 3 |
| CSS styles (glass surface, tokens only) | Task 4 |
| Improved `+` button (24px, circular) | Task 4 |
| WorkspaceHierarchyPanel integration | Task 5 |
| Long-press detection (200ms) | Task 5 |
| Right-click on project row | Task 5 |
| Auto-naming (`shell-{N}`, `opencode-{projectName}`) | Task 5 |
| Teleport to body + position: fixed | Task 2 + Task 3 |
| WorkspaceHierarchyPanel test updates | Task 6 |
| Delete NewSessionModal + test | Task 7 |
| Full test suite passes | Task 8 |

### Placeholder Scan

No TBD, TODO, or vague steps. All code blocks contain complete implementations.

### Type Consistency

- `ProviderIcon.type` → `SessionType` → matches emit payload `{ type: SessionType }`
- `position` prop type → `{ x: number; y: number; width: number; height: number }` → consistent between ProviderFloatingCard and WorkspaceHierarchyPanel
- `center` prop type → `{ x: number; y: number }` → consistent between ProviderRadialMenu and WorkspaceHierarchyPanel
- `createSession` emit → `{ projectId: string; type: SessionType; title: string }` → matches App.vue `handleSessionCreate` signature
