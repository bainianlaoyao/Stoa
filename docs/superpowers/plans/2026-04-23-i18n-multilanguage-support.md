# i18n Multi-Language Support (EN + zh-CN) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add internationalization support for English (en) and Simplified Chinese (zh-CN) across all renderer components, with a language switcher in Settings and persisted locale preference.

**Architecture:** Install vue-i18n v9 as the i18n engine with `legacy: false` (Composition API mode). Locale files are TypeScript modules exporting nested message objects. The i18n plugin is registered in the Vue app entry. A `locale` field is added to `AppSettings` for persistence via the existing IPC settings channel. Components replace hardcoded strings with `t()` / `$t()` calls.

**Tech Stack:** vue-i18n v9, `@intlify/unplugin-vue-i18n` (Vite plugin), TypeScript, Pinia, existing IPC settings channel

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/renderer/i18n/en.ts` | English locale messages |
| Create | `src/renderer/i18n/zh-CN.ts` | Simplified Chinese locale messages |
| Create | `src/renderer/i18n/index.ts` | Create vue-i18n instance, export `useI18n` wrapper |
| Modify | `src/renderer/main.ts` | Register i18n plugin on Vue app |
| Modify | `electron.vite.config.ts` | Add `@intlify/unplugin-vue-i18n` to renderer plugins |
| Modify | `src/shared/project-session.ts` | Add `locale` to `AppSettings` and `DEFAULT_SETTINGS` |
| Modify | `src/renderer/stores/settings.ts` | Add `locale` ref, handle `locale` in load/update |
| Modify | `src/renderer/components/settings/GeneralSettings.vue` | Add language switcher + translate strings |
| Modify | `src/renderer/components/settings/SettingsSurface.vue` | Translate header strings |
| Modify | `src/renderer/components/settings/AboutSettings.vue` | Translate strings |
| Modify | `src/renderer/components/settings/ProvidersSettings.vue` | Translate strings |
| Modify | `src/renderer/components/command/NewProjectModal.vue` | Translate Chinese strings |
| Modify | `src/renderer/components/WorkspaceList.vue` | Translate Chinese + English strings |
| Modify | `src/renderer/components/archive/ArchiveSurface.vue` | Translate Chinese strings |
| Modify | `src/renderer/components/TerminalViewport.vue` | Translate Chinese + English strings |
| Modify | `src/renderer/components/GlobalActivityBar.vue` | Translate tooltip strings |

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json` (via pnpm add)

- [ ] **Step 1: Install vue-i18n and Vite plugin**

Run:
```bash
cd D:/Data/DEV/ultra_simple_panel && pnpm add vue-i18n && pnpm add -D @intlify/unplugin-vue-i18n
```

- [ ] **Step 2: Verify installation**

Run: `pnpm ls vue-i18n @intlify/unplugin-vue-i18n`
Expected: Both packages listed with versions

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add vue-i18n and @intlify/unplugin-vue-i18n"
```

---

### Task 2: Configure Vite Plugin

**Files:**
- Modify: `electron.vite.config.ts`

- [ ] **Step 1: Add the i18n Vite plugin to the renderer config**

In `electron.vite.config.ts`, import the plugin and add it to the renderer plugins array:

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@core': resolve('src/core'),
        '@shared': resolve('src/shared'),
        '@extensions': resolve('src/extensions')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@core': resolve('src/core'),
        '@shared': resolve('src/shared'),
        '@extensions': resolve('src/extensions')
      }
    }
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared'),
        '@extensions': resolve('src/extensions')
      }
    },
    plugins: [
      vue(),
      VueI18nPlugin({
        include: [resolve('src/renderer/i18n/**')]
      })
    ]
  }
})
```

- [ ] **Step 2: Verify build succeeds**

Run: `pnpm run build`
Expected: Build completes without errors

- [ ] **Step 3: Commit**

```bash
git add electron.vite.config.ts
git commit -m "feat(i18n): configure @intlify/unplugin-vue-i18n in Vite"
```

---

### Task 3: Create English Locale File

**Files:**
- Create: `src/renderer/i18n/en.ts`

- [ ] **Step 1: Create the English locale file**

Create `src/renderer/i18n/en.ts` with all renderer strings organized by component/feature namespace:

```typescript
export default {
  // Settings surface shell
  settings: {
    eyebrow: 'Workspace settings',
    title: 'Settings',
    lede: 'Manage shell, provider, and application details for the current workspace.',
    heroLabel: 'Current section',
    navLabel: 'Sections',
    navText: 'Core preferences and reference information.',
    tabs: {
      general: { label: 'General', summary: 'Shell path and terminal font size.' },
      providers: { label: 'Providers', summary: 'Local provider executable paths.' },
      about: { label: 'About', summary: 'Version, stack, and project links.' }
    }
  },

  // General settings
  general: {
    eyebrow: 'General',
    title: 'Shell and terminal defaults',
    description: 'Configure the default shell path and the monospace scale used by terminal surfaces.',
    shellSection: {
      title: 'Shell executable',
      description: 'Use the detected shell when available, or point Stoa at a custom binary.',
      badge: 'Path',
      label: 'Shell path',
      placeholder: 'Auto-detected',
      browse: 'Browse',
      detecting: 'Detecting...',
      autoDetected: 'Auto-detected',
      autoDetectedWith: 'Auto-detected: {path}',
      customPath: 'Custom path'
    },
    typographySection: {
      title: 'Terminal typography',
      description: 'Keep command output legible while preserving the tighter console density.',
      badge: 'Mono UI'
    },
    languageSection: {
      title: 'Display language',
      description: 'Choose the interface language. Changes take effect immediately.',
      badge: 'Locale'
    }
  },

  // Language options (these stay as-is — language names are universal)
  language: {
    en: 'English',
    'zh-CN': '简体中文'
  },

  // Providers settings
  providers: {
    eyebrow: 'Providers',
    title: 'Provider runtime paths',
    description: 'Keep executable discovery predictable so provider-backed sessions can start without extra repair work.',
    executablePath: 'Executable path',
    browse: 'Browse',
    detecting: 'Detecting...',
    autoDetected: 'Auto-detected',
    customPath: 'Custom path',
    notFound: 'Not found — click Browse to locate',
    placeholderMissing: 'not found',
    selectExecutable: 'Select {provider} executable'
  },

  // About settings
  about: {
    eyebrow: 'About',
    title: 'Project details',
    description: 'Reference information for the current build, the stack it runs on, and related links.',
    summary: 'Multi-session workspace console for local provider-driven development.',
    stack: 'Electron · Vue 3 · node-pty',
    links: {
      title: 'Project links',
      description: 'Quick links to the project repository, docs, and issue reporting.',
      badge: 'Resources',
      github: 'GitHub',
      documentation: 'Documentation',
      reportIssue: 'Report Issue'
    }
  },

  // New project modal
  newProject: {
    title: 'New project',
    nameLabel: 'Project name',
    pathLabel: 'Project path',
    pathPlaceholder: 'Click Browse to select folder',
    browse: 'Browse',
    selectFolder: 'Select project folder',
    cancel: 'Cancel',
    create: 'Create'
  },

  // Workspace list
  workspace: {
    eyebrow: 'Projects',
    title: 'Stoa',
    description: 'Project → Session hierarchy with canonical state from the main process.',
    projectName: 'Project name',
    projectPath: 'Project path',
    newProject: 'New project',
    sessionTitle: 'Session title',
    sessionType: 'Session type'
  },

  // Archive surface
  archive: {
    eyebrow: 'Session Archive',
    title: 'Archived sessions',
    subtitle: 'Restore historical sessions from a central location. The command palette retains only the archive action.',
    empty: 'No archived sessions found.',
    restore: 'Restore'
  },

  // Terminal viewport
  terminal: {
    details: 'Session details',
    project: 'Project',
    path: 'Path',
    recovery: 'Recovery',
    externalSession: 'External Session',
    notBound: 'not bound',
    emptyTitle: 'No session to display',
    emptyHint: 'Create a project first, then create a session under it.'
  },

  // Global activity bar
  activityBar: {
    command: 'Command panel',
    archive: 'Archive',
    settings: 'Settings'
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/i18n/en.ts
git commit -m "feat(i18n): add English locale file"
```

---

### Task 4: Create Chinese Locale File

**Files:**
- Create: `src/renderer/i18n/zh-CN.ts`

- [ ] **Step 1: Create the Simplified Chinese locale file**

Create `src/renderer/i18n/zh-CN.ts` with the same key structure as `en.ts`:

```typescript
export default {
  settings: {
    eyebrow: '工作区设置',
    title: '设置',
    lede: '管理当前工作区的 Shell、提供商和应用程序详情。',
    heroLabel: '当前分区',
    navLabel: '分区',
    navText: '核心偏好设置和参考信息。',
    tabs: {
      general: { label: '通用', summary: 'Shell 路径和终端字体大小。' },
      providers: { label: '提供商', summary: '本地提供商可执行文件路径。' },
      about: { label: '关于', summary: '版本、技术栈和项目链接。' }
    }
  },

  general: {
    eyebrow: '通用',
    title: 'Shell 和终端默认设置',
    description: '配置默认 Shell 路径和终端使用的等宽字体缩放。',
    shellSection: {
      title: 'Shell 可执行文件',
      description: '优先使用自动检测到的 Shell，或指定自定义路径。',
      badge: '路径',
      label: 'Shell 路径',
      placeholder: '自动检测',
      browse: '浏览',
      detecting: '检测中...',
      autoDetected: '已自动检测',
      autoDetectedWith: '已自动检测: {path}',
      customPath: '自定义路径'
    },
    typographySection: {
      title: '终端字体',
      description: '保持命令输出清晰可读，同时维持控制台紧凑的行距。',
      badge: '等宽 UI'
    },
    languageSection: {
      title: '显示语言',
      description: '选择界面语言。更改后立即生效。',
      badge: '语言'
    }
  },

  language: {
    en: 'English',
    'zh-CN': '简体中文'
  },

  providers: {
    eyebrow: '提供商',
    title: '提供商运行时路径',
    description: '保持可执行文件的自动发现稳定可靠，让提供商驱动的会话无需额外修复即可启动。',
    executablePath: '可执行文件路径',
    browse: '浏览',
    detecting: '检测中...',
    autoDetected: '已自动检测',
    customPath: '自定义路径',
    notFound: '未找到 — 点击浏览以定位',
    placeholderMissing: '未找到',
    selectExecutable: '选择 {provider} 可执行文件'
  },

  about: {
    eyebrow: '关于',
    title: '项目详情',
    description: '当前构建版本、运行技术栈和相关链接的参考信息。',
    summary: '面向本地提供商驱动开发的多会话工作区控制台。',
    stack: 'Electron · Vue 3 · node-pty',
    links: {
      title: '项目链接',
      description: '项目仓库、文档和问题反馈的快速链接。',
      badge: '资源',
      github: 'GitHub',
      documentation: '文档',
      reportIssue: '报告问题'
    }
  },

  newProject: {
    title: '新建项目',
    nameLabel: '项目名称',
    pathLabel: '项目路径',
    pathPlaceholder: '点击浏览选择文件夹',
    browse: '浏览',
    selectFolder: '选择项目目录',
    cancel: '取消',
    create: '创建'
  },

  workspace: {
    eyebrow: '项目',
    title: 'Stoa',
    description: '项目 → 会话层级结构，状态来自主进程的规范数据。',
    projectName: '项目名称',
    projectPath: '项目路径',
    newProject: '新建项目',
    sessionTitle: '会话标题',
    sessionType: '会话类型'
  },

  archive: {
    eyebrow: '会话归档',
    title: '已归档会话',
    subtitle: '集中恢复历史会话，命令面板只保留归档动作。',
    empty: '当前没有已归档的会话。',
    restore: '恢复'
  },

  terminal: {
    details: '会话详情',
    project: '项目',
    path: '路径',
    recovery: '恢复模式',
    externalSession: '外部会话',
    notBound: '未绑定',
    emptyTitle: '没有可显示的会话',
    emptyHint: '先创建项目，再在项目下创建会话。'
  },

  activityBar: {
    command: '命令面板',
    archive: '归档',
    settings: '设置'
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/i18n/zh-CN.ts
git commit -m "feat(i18n): add Simplified Chinese locale file"
```

---

### Task 5: Create i18n Instance and Register Plugin

**Files:**
- Create: `src/renderer/i18n/index.ts`
- Modify: `src/renderer/main.ts`

- [ ] **Step 1: Create the i18n setup module**

Create `src/renderer/i18n/index.ts`:

```typescript
import { createI18n } from 'vue-i18n'
import en from './en'

export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: SupportedLocale = 'en'

const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: 'en',
  messages: {
    en
  }
})

export default i18n
```

Note: `zh-CN` messages are loaded lazily in Task 8 when the locale is changed. This keeps the initial bundle small. If the persisted locale is `zh-CN`, it loads during app init (handled in the settings store).

- [ ] **Step 2: Register i18n plugin in the Vue app**

Modify `src/renderer/main.ts`:

```typescript
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@renderer/app/App.vue'
import i18n from '@renderer/i18n'
import '@renderer/styles.css'

const application = createApp(App)
application.use(createPinia())
application.use(i18n)
application.mount('#app')
```

- [ ] **Step 3: Verify the app starts**

Run: `pnpm run dev`
Expected: App launches without console errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/i18n/index.ts src/renderer/main.ts
git commit -m "feat(i18n): create i18n instance and register Vue plugin"
```

---

### Task 6: Add `locale` to AppSettings and Settings Store

**Files:**
- Modify: `src/shared/project-session.ts`
- Modify: `src/renderer/stores/settings.ts`

- [ ] **Step 1: Extend AppSettings with locale**

In `src/shared/project-session.ts`, add `locale` to the `AppSettings` interface and `DEFAULT_SETTINGS`:

Change the `AppSettings` interface (line 61-66):
```typescript
export interface AppSettings {
  shellPath: string
  terminalFontSize: number
  terminalFontFamily: string
  providers: Record<string, string>
  locale: string
}
```

Change `DEFAULT_SETTINGS` (line 70-75):
```typescript
export const DEFAULT_SETTINGS: AppSettings = {
  shellPath: '',
  terminalFontSize: 14,
  terminalFontFamily: 'JetBrains Mono',
  providers: {},
  locale: 'en'
}
```

- [ ] **Step 2: Add locale to the settings store**

In `src/renderer/stores/settings.ts`, add locale handling:

Add imports at the top:
```typescript
import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { AppSettings } from '@shared/project-session'
import { BUILTIN_FONT_FAMILIES } from '@shared/project-session'
import i18n, { SUPPORTED_LOCALES, DEFAULT_LOCALE } from '@renderer/i18n'
import type { SupportedLocale } from '@renderer/i18n'
```

Add `locale` ref after `providers`:
```typescript
const locale = ref<string>(DEFAULT_LOCALE)
```

In `loadSettings`, after the `providers.value` assignment, add:
```typescript
if (settings.locale && SUPPORTED_LOCALES.includes(settings.locale as SupportedLocale)) {
  locale.value = settings.locale
}
```

After the `loaded.value = true` line in `loadSettings`, add locale application:
```typescript
void applyLocale(locale.value)
```

In `updateSetting`, add a new `else if` branch before the closing brace:
```typescript
} else if (key === 'locale' && typeof value === 'string') {
  locale.value = value
}
```

Add the `applyLocale` function before the return statement:
```typescript
async function applyLocale(newLocale: string): Promise<void> {
  if (newLocale !== 'en' && !i18n.global.availableLocales.includes(newLocale)) {
    const messages = await import(`./i18n/${newLocale}.ts`)
    i18n.global.setLocaleMessage(newLocale, messages.default)
  }
  i18n.global.locale.value = newLocale
}
```

Add `locale` and `applyLocale` to the return statement:
```typescript
return {
  shellPath, terminalFontSize, terminalFontFamily, providers, loaded, locale,
  loadSettings, updateSetting, detectAndSetShell, detectAndSetProvider,
  pickFolder, pickFile, applyLocale
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: No new type errors

- [ ] **Step 4: Commit**

```bash
git add src/shared/project-session.ts src/renderer/stores/settings.ts
git commit -m "feat(i18n): add locale to AppSettings and settings store"
```

---

### Task 7: Add Language Switcher to GeneralSettings

**Files:**
- Modify: `src/renderer/components/settings/GeneralSettings.vue`

- [ ] **Step 1: Add language switcher UI**

In `src/renderer/components/settings/GeneralSettings.vue`, add i18n and the language section.

Update `<script setup>`:
```typescript
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@renderer/stores/settings'
import GlassFormField from '../primitives/GlassFormField.vue'
import { SUPPORTED_LOCALES } from '@renderer/i18n'

const { t } = useI18n()
const store = useSettingsStore()

const detectedShell = ref<string | null>(null)
const detecting = ref(true)

const languageOptions = SUPPORTED_LOCALES.map((locale) => ({
  value: locale,
  label: t(`language.${locale}`)
}))

// ... existing onMounted, handleBrowse, handleShellChange, handleFontSizeChange, handleFontFamilyChange remain unchanged ...

async function handleLanguageChange(value: string): Promise<void> {
  await store.applyLocale(value)
  await store.updateSetting('locale', value)
}
</script>
```

In the `<template>`, add the language section after the typography `<section>` closing tag and before `</div>` that closes `settings-section`:

```html
      <section class="settings-card" aria-label="Display language">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">{{ t('general.languageSection.title') }}</h4>
            <p class="settings-card__description">{{ t('general.languageSection.description') }}</p>
          </div>
          <span class="settings-card__badge">{{ t('general.languageSection.badge') }}</span>
        </div>

        <GlassFormField
          :label="t('general.languageSection.title')"
          type="select"
          :model-value="store.locale"
          :options="languageOptions"
          data-settings-field="locale"
          @update:model-value="handleLanguageChange"
        />
      </section>
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: No new type errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/GeneralSettings.vue
git commit -m "feat(i18n): add language switcher to GeneralSettings"
```

---

### Task 8: Translate GeneralSettings Existing Strings

**Files:**
- Modify: `src/renderer/components/settings/GeneralSettings.vue`

- [ ] **Step 1: Replace hardcoded strings with `t()` calls**

The `<script setup>` already has `const { t } = useI18n()` from Task 7. Now replace all hardcoded strings in the template.

Replace the template content:
```html
<template>
  <div role="tabpanel" id="settings-panel-general" class="settings-panel" aria-label="General settings">
    <header class="settings-panel__header">
      <div>
        <p class="eyebrow">{{ t('general.eyebrow') }}</p>
        <h3 class="settings-panel__title">{{ t('general.title') }}</h3>
      </div>
      <p class="settings-panel__description">
        {{ t('general.description') }}
      </p>
    </header>

    <div class="settings-section">
      <section class="settings-card" aria-label="Shell executable">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">{{ t('general.shellSection.title') }}</h4>
            <p class="settings-card__description">{{ t('general.shellSection.description') }}</p>
          </div>
          <span class="settings-card__badge settings-card__badge--mono">{{ t('general.shellSection.badge') }}</span>
        </div>

        <div class="settings-field" data-settings-field="shellPath">
          <label class="form-field settings-field__main">
            <span class="form-field__label">{{ t('general.shellSection.label') }}</span>
            <input
              class="form-field__input settings-item__path-input settings-item__path-input--mono"
              type="text"
              :value="store.shellPath"
              :placeholder="t('general.shellSection.placeholder')"
              @change="handleShellChange"
            />
          </label>
          <button class="button-ghost settings-item__browse" type="button" @click="handleBrowse">{{ t('general.shellSection.browse') }}</button>
        </div>

        <p v-if="detecting" class="settings-item__hint">{{ t('general.shellSection.detecting') }}</p>
        <p v-else-if="detectedShell && !store.shellPath" class="settings-item__hint settings-item__hint--success">
          {{ t('general.shellSection.autoDetectedWith', { path: detectedShell }) }}
        </p>
        <p v-else-if="store.shellPath && store.shellPath !== detectedShell" class="settings-item__hint">{{ t('general.shellSection.customPath') }}</p>
        <p v-else-if="detectedShell" class="settings-item__hint settings-item__hint--success">{{ t('general.shellSection.autoDetected') }}</p>
      </section>

      <section class="settings-card" aria-label="Terminal font size">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">{{ t('general.typographySection.title') }}</h4>
            <p class="settings-card__description">{{ t('general.typographySection.description') }}</p>
          </div>
          <span class="settings-card__badge">{{ t('general.typographySection.badge') }}</span>
        </div>

        <GlassFormField
          :label="t('general.typographySection.title')"
          type="select"
          :model-value="store.terminalFontFamily"
          :options="fontFamilyOptions"
          data-settings-field="terminalFontFamily"
          @update:model-value="handleFontFamilyChange"
        />
        <GlassFormField
          :label="t('general.typographySection.title')"
          type="select"
          :model-value="String(store.terminalFontSize)"
          :options="fontSizeOptions"
          data-settings-field="terminalFontSize"
          @update:model-value="handleFontSizeChange"
        />
      </section>

      <!-- Language switcher section from Task 7 remains here -->
    </div>
  </div>
</template>
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: No new type errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/GeneralSettings.vue
git commit -m "feat(i18n): translate GeneralSettings strings"
```

---

### Task 9: Translate SettingsSurface

**Files:**
- Modify: `src/renderer/components/settings/SettingsSurface.vue`

- [ ] **Step 1: Add i18n and replace hardcoded strings**

```typescript
<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsTabBar from './SettingsTabBar.vue'
import type { SettingsTab } from './SettingsTabBar.vue'
import GeneralSettings from './GeneralSettings.vue'
import ProvidersSettings from './ProvidersSettings.vue'
import AboutSettings from './AboutSettings.vue'

const { t } = useI18n()

const activeTab = ref<SettingsTab>('general')

const tabMeta = computed(() => [
  { id: 'general' as SettingsTab, label: t('settings.tabs.general.label'), summary: t('settings.tabs.general.summary') },
  { id: 'providers' as SettingsTab, label: t('settings.tabs.providers.label'), summary: t('settings.tabs.providers.summary') },
  { id: 'about' as SettingsTab, label: t('settings.tabs.about.label'), summary: t('settings.tabs.about.summary') }
])

const tabComponents: Record<SettingsTab, Component> = {
  general: GeneralSettings,
  providers: ProvidersSettings,
  about: AboutSettings
}

const activeTabMeta = computed(() => tabMeta.value.find((tab) => tab.id === activeTab.value) ?? tabMeta.value[0])
</script>
```

Replace template strings:
```html
<template>
  <section class="settings-surface" data-surface="settings" aria-label="Settings surface">
    <header class="settings-surface__hero">
      <div class="settings-surface__hero-copy">
        <p class="eyebrow">{{ t('settings.eyebrow') }}</p>
        <h2 class="settings-surface__title">{{ t('settings.title') }}</h2>
        <p class="settings-surface__lede">{{ t('settings.lede') }}</p>
      </div>
      <div class="settings-surface__hero-meta">
        <span class="settings-surface__hero-label">{{ t('settings.heroLabel') }}</span>
        <strong class="settings-surface__hero-value">{{ activeTabMeta.label }}</strong>
        <span class="settings-surface__hero-summary">{{ activeTabMeta.summary }}</span>
      </div>
    </header>

    <div class="settings-surface__shell">
      <aside class="settings-surface__nav-panel" aria-label="Settings sections">
        <div class="settings-surface__nav-copy">
          <span class="settings-surface__nav-label">{{ t('settings.navLabel') }}</span>
          <p class="settings-surface__nav-text">{{ t('settings.navText') }}</p>
        </div>
        <SettingsTabBar :active-tab="activeTab" @select="activeTab = $event" />
      </aside>

      <div class="settings-surface__content-panel">
        <component :is="tabComponents[activeTab]" />
      </div>
    </div>
  </section>
</template>
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: No new type errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/SettingsSurface.vue
git commit -m "feat(i18n): translate SettingsSurface strings"
```

---

### Task 10: Translate AboutSettings

**Files:**
- Modify: `src/renderer/components/settings/AboutSettings.vue`

- [ ] **Step 1: Add i18n and replace hardcoded strings**

```typescript
<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const APP_VERSION = '0.1.0'
</script>

<template>
  <div role="tabpanel" id="settings-panel-about" class="settings-panel" aria-label="About">
    <header class="settings-panel__header settings-panel__header--about">
      <div>
        <p class="eyebrow">{{ t('about.eyebrow') }}</p>
        <h3 class="settings-panel__title">{{ t('about.title') }}</h3>
      </div>
      <p class="settings-panel__description">
        {{ t('about.description') }}
      </p>
    </header>

    <div class="settings-section settings-section--about">
      <section class="settings-card settings-card--hero settings-about" aria-label="Stoa project information">
        <div class="settings-about__brand">
          <div class="settings-about__logo" aria-hidden="true">S</div>
          <div class="settings-about__identity">
            <h2 class="settings-about__name">Stoa</h2>
            <span class="settings-about__version">v{{ APP_VERSION }}</span>
          </div>
        </div>
        <p class="settings-about__summary">{{ t('about.summary') }}</p>
        <span class="settings-about__stack">{{ t('about.stack') }}</span>
      </section>

      <section class="settings-card" aria-label="Project links">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">{{ t('about.links.title') }}</h4>
            <p class="settings-card__description">{{ t('about.links.description') }}</p>
          </div>
          <span class="settings-card__badge">{{ t('about.links.badge') }}</span>
        </div>

        <div class="settings-about__links">
          <a class="settings-about__link" href="https://github.com" target="_blank" rel="noopener noreferrer">{{ t('about.links.github') }}</a>
          <a class="settings-about__link" href="https://github.com" target="_blank" rel="noopener noreferrer">{{ t('about.links.documentation') }}</a>
          <a class="settings-about__link" href="https://github.com" target="_blank" rel="noopener noreferrer">{{ t('about.links.reportIssue') }}</a>
        </div>
      </section>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/settings/AboutSettings.vue
git commit -m "feat(i18n): translate AboutSettings strings"
```

---

### Task 11: Translate ProvidersSettings

**Files:**
- Modify: `src/renderer/components/settings/ProvidersSettings.vue`

- [ ] **Step 1: Add i18n and replace hardcoded strings**

```typescript
<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { listProviderDescriptors } from '@shared/provider-descriptors'
import { useSettingsStore } from '@renderer/stores/settings'

const { t } = useI18n()
const store = useSettingsStore()

const providerList = listProviderDescriptors()
  .filter(provider => provider.providerId !== 'local-shell')
  .map(provider => ({ id: provider.providerId, label: provider.displayName }))

const detectedPaths = reactive<Record<string, string | null>>({})
const detecting = ref(true)

onMounted(async () => {
  detecting.value = true
  for (const provider of providerList) {
    detectedPaths[provider.id] = await store.detectAndSetProvider(provider.id)
  }
  detecting.value = false
})

async function browseProvider(providerId: string): Promise<void> {
  const path = await store.pickFile({ title: t('providers.selectExecutable', { provider: providerId }) })
  if (path) {
    const updated = { ...store.providers, [providerId]: path }
    await store.updateSetting('providers', updated)
    detectedPaths[providerId] = null
  }
}

function getStatus(providerId: string): 'detected' | 'custom' | 'missing' {
  const configured = store.providers[providerId]
  const detected = detectedPaths[providerId]
  if (configured && configured === detected) return 'detected'
  if (configured) return 'custom'
  if (detected) return 'detected'
  return 'missing'
}
</script>

<template>
  <div role="tabpanel" id="settings-panel-providers" class="settings-panel" aria-label="Provider settings">
    <header class="settings-panel__header">
      <div>
        <p class="eyebrow">{{ t('providers.eyebrow') }}</p>
        <h3 class="settings-panel__title">{{ t('providers.title') }}</h3>
      </div>
      <p class="settings-panel__description">
        {{ t('providers.description') }}
      </p>
    </header>

    <div class="settings-section">
      <section
        v-for="provider in providerList"
        :key="provider.id"
        class="settings-card"
        :aria-label="`${provider.label} provider`"
      >
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">{{ provider.label }}</h4>
            <p class="settings-card__description">{{ t('providers.description') }}</p>
          </div>
          <span class="settings-card__badge" :class="`settings-card__badge--${getStatus(provider.id)}`">
            {{ getStatus(provider.id) }}
          </span>
        </div>

        <div class="settings-field" :data-settings-field="`provider-${provider.id}`">
          <label class="form-field settings-field__main">
            <span class="form-field__label">{{ t('providers.executablePath') }}</span>
            <input
              class="form-field__input settings-item__path-input settings-item__path-input--mono"
              type="text"
              :value="store.providers[provider.id] ?? ''"
              :placeholder="getStatus(provider.id) === 'missing' ? t('providers.placeholderMissing') : t('providers.autoDetected')"
              @change="store.updateSetting('providers', { ...store.providers, [provider.id]: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <button class="button-ghost settings-item__browse" type="button" @click="browseProvider(provider.id)">{{ t('providers.browse') }}</button>
        </div>

        <p v-if="detecting" class="settings-item__hint">{{ t('providers.detecting') }}</p>
        <p v-else-if="getStatus(provider.id) === 'detected'" class="settings-item__hint settings-item__hint--success">{{ t('providers.autoDetected') }}</p>
        <p v-else-if="getStatus(provider.id) === 'custom'" class="settings-item__hint">{{ t('providers.customPath') }}</p>
        <p v-else class="settings-item__hint settings-item__hint--warning">{{ t('providers.notFound') }}</p>
      </section>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/settings/ProvidersSettings.vue
git commit -m "feat(i18n): translate ProvidersSettings strings"
```

---

### Task 12: Translate NewProjectModal

**Files:**
- Modify: `src/renderer/components/command/NewProjectModal.vue`

- [ ] **Step 1: Add i18n and replace Chinese/English strings**

```typescript
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '../primitives/BaseModal.vue'
import GlassFormField from '../primitives/GlassFormField.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'

const { t } = useI18n()

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
    <label class="form-field">
      <span class="form-field__label">{{ t('newProject.pathLabel') }}</span>
      <div class="settings-item__row">
        <input
          class="form-field__input settings-item__path-input"
          :value="draftPath"
          :placeholder="t('newProject.pathPlaceholder')"
          readonly
          @click="browseProjectPath"
        />
        <button class="button-ghost settings-item__browse" type="button" @click="browseProjectPath">{{ t('newProject.browse') }}</button>
      </div>
    </label>
    <div v-if="store.lastError" class="modal-panel__error">{{ store.lastError }}</div>
    <div class="modal-panel__footer">
      <button class="button-ghost" @click="emit('update:show', false)">{{ t('newProject.cancel') }}</button>
      <button class="button-primary" @click="submit">{{ t('newProject.create') }}</button>
    </div>
  </BaseModal>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/command/NewProjectModal.vue
git commit -m "feat(i18n): translate NewProjectModal strings"
```

---

### Task 13: Translate WorkspaceList

**Files:**
- Modify: `src/renderer/components/WorkspaceList.vue`

- [ ] **Step 1: Add i18n and replace hardcoded strings**

```typescript
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { SessionType } from '@shared/project-session'
import { listProviderDescriptors } from '@shared/provider-descriptors'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'

const { t } = useI18n()

// ... props, emits, helper functions unchanged ...

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
        <select
          :value="props.sessionType"
          @change="updateSessionType"
        >
          <option
            v-for="option in sessionTypeOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </label>
    </section>

    <!-- rest of the template unchanged — project cards use dynamic data, not hardcoded strings -->
  </aside>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/WorkspaceList.vue
git commit -m "feat(i18n): translate WorkspaceList strings"
```

---

### Task 14: Translate ArchiveSurface

**Files:**
- Modify: `src/renderer/components/archive/ArchiveSurface.vue`

- [ ] **Step 1: Add i18n and replace Chinese strings**

```typescript
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { SessionSummary } from '@shared/project-session'

interface ArchivedSessionEntry extends SessionSummary {
  projectName: string
  projectPath: string
}

const { t } = useI18n()

defineProps<{
  archivedSessions: ArchivedSessionEntry[]
}>()

const emit = defineEmits<{
  restoreSession: [sessionId: string]
}>()
</script>

<template>
  <section class="archive-surface" data-surface="archive" data-testid="surface.archive" aria-label="Archive surface">
    <div class="archive-body">
      <header class="archive-header">
        <p class="archive-eyebrow">{{ t('archive.eyebrow') }}</p>
        <h2 class="archive-title">{{ t('archive.title') }}</h2>
        <p class="archive-subtitle">{{ t('archive.subtitle') }}</p>
      </header>

      <p v-if="archivedSessions.length === 0" class="archive-empty">{{ t('archive.empty') }}</p>

      <div v-else class="archive-list">
        <article
          v-for="session in archivedSessions"
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
              <span class="archive-card__project">{{ session.projectName }}</span>
              <code class="archive-card__path">{{ session.projectPath }}</code>
            </div>

            <p class="archive-card__summary">{{ session.summary || session.status }}</p>
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
    </div>
  </section>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/archive/ArchiveSurface.vue
git commit -m "feat(i18n): translate ArchiveSurface strings"
```

---

### Task 15: Translate TerminalViewport

**Files:**
- Modify: `src/renderer/components/TerminalViewport.vue`

- [ ] **Step 1: Add i18n and replace hardcoded strings**

In the `<script setup>` block, add the import:
```typescript
import { useI18n } from 'vue-i18n'
```

Add after the existing imports:
```typescript
const { t } = useI18n()
```

Replace the empty state section (lines 272-277):
```html
    <template v-else>
      <section class="terminal-empty-state">
        <h2>{{ t('terminal.emptyTitle') }}</h2>
        <p>{{ t('terminal.emptyHint') }}</p>
      </section>
    </template>
```

Replace the session details header and field labels (lines 237-267):
```html
      <div v-else class="terminal-viewport__overlay">
        <header class="terminal-viewport__header">
          <div>
            <p class="terminal-viewport__eyebrow">{{ t('terminal.details') }}</p>
            <h2>{{ session.title }}</h2>
          </div>
          <div class="terminal-viewport__meta">
            <span>{{ session.type }}</span>
            <span class="terminal-viewport__status">{{ session.status }}</span>
          </div>
        </header>

        <div class="terminal-viewport__details">
          <p>{{ session.summary }}</p>
          <dl class="terminal-viewport__field-list">
            <div>
              <dt>{{ t('terminal.project') }}</dt>
              <dd>{{ project.name }}</dd>
            </div>
            <div>
              <dt>{{ t('terminal.path') }}</dt>
              <dd><code>{{ project.path }}</code></dd>
            </div>
            <div>
              <dt>{{ t('terminal.recovery') }}</dt>
              <dd>{{ session.recoveryMode }}</dd>
            </div>
            <div>
              <dt>{{ t('terminal.externalSession') }}</dt>
              <dd><code>{{ session.externalSessionId ?? t('terminal.notBound') }}</code></dd>
            </div>
          </dl>
        </div>
      </div>
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/TerminalViewport.vue
git commit -m "feat(i18n): translate TerminalViewport strings"
```

---

### Task 16: Translate GlobalActivityBar

**Files:**
- Modify: `src/renderer/components/GlobalActivityBar.vue`

- [ ] **Step 1: Add i18n and replace tooltip strings**

```typescript
<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

export type AppSurface = 'command' | 'archive' | 'settings'

defineProps<{
  activeSurface: AppSurface
}>()

const emit = defineEmits<{
  select: [surface: AppSurface]
}>()

const topItems: Array<{ id: AppSurface; label: string; title: string }> = [
  { id: 'command', label: '⌘', title: t('activityBar.command') }
]

const bottomItems: Array<{ id: AppSurface; label: string; title: string }> = [
  { id: 'archive', label: 'Ar', title: t('activityBar.archive') },
  { id: 'settings', label: '⚙', title: t('activityBar.settings') }
]
</script>
```

Note: The template already uses `item.title` dynamically, so no template changes needed — only the script data needs i18n.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/GlobalActivityBar.vue
git commit -m "feat(i18n): translate GlobalActivityBar tooltip strings"
```

---

### Task 17: Verify Build and Manual Test

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `pnpm run typecheck`
Expected: Zero errors

- [ ] **Step 2: Run unit tests**

Run: `pnpm run test`
Expected: All existing tests pass (test files use hardcoded strings, not affected)

- [ ] **Step 3: Run dev build**

Run: `pnpm run dev`
Expected: App launches. UI shows in English by default.

- [ ] **Step 4: Manual test — language switch**

1. Open Settings → General
2. Change language to "简体中文"
3. Verify all visible strings switch to Chinese immediately
4. Restart the app
5. Verify language persists as Chinese after restart
6. Switch back to English, verify it persists

- [ ] **Step 5: Run production build**

Run: `pnpm run build`
Expected: Build completes without errors

- [ ] **Step 6: Commit any fixups if needed**

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] Install vue-i18n + Vite plugin → Tasks 1-2
- [x] Create locale files (en, zh-CN) → Tasks 3-4
- [x] Configure i18n instance → Task 5
- [x] Add locale to AppSettings for persistence → Task 6
- [x] Language switcher in Settings → Task 7
- [x] Translate all renderer components → Tasks 8-16
- [x] Main process messages: intentionally excluded (kept English-only per research recommendation)
- [x] Test files: intentionally not migrated (per research recommendation)

**2. Placeholder scan:** No TBD/TODO/fill-in-later found. All steps contain complete code.

**3. Type consistency:**
- `AppSettings.locale` is `string` — consistent with `SUPPORTED_LOCALES` array check in store
- `SupportedLocale` type exported from `i18n/index.ts` — used in settings store
- `t()` calls all reference keys that exist in both `en.ts` and `zh-CN.ts` with identical structure
