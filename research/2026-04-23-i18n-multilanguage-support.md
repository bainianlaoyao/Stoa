---
date: 2026-04-23
topic: i18n multilanguage support (English + Chinese)
status: completed
mode: context-gathering
sources: 18
---

## Context Report: i18n Multi-Language Support (EN + zh-CN)

### Why This Was Gathered
Planning the addition of internationalization support to the project, starting with English (en) and Simplified Chinese (zh-CN). Need to understand current string distribution, tech stack compatibility, and migration scope.

### Summary
The project is a Vue 3.5 + Electron 37 + Vite 7 desktop app with no existing i18n setup. Strings are hardcoded — a mix of English and Chinese across ~24 Vue components and backend TypeScript files. **vue-i18n v9** is the recommended library (Vue 3 compatible, Composition API native, Vite plugin available). Estimated scope: ~100-130 unique user-facing strings across renderer, with an additional ~10 system messages in main/core layers.

### Key Findings

#### Tech Stack (i18n-compatible)
- **Vue 3.5.22** with Composition API (`<script setup>`) — vue-i18n v9 has first-class support
- **Vite 7.1.7** with electron-vite 4.0.0 — `@intlify/unplugin-vue-i18n` provides Vite integration
- **TypeScript 5.9.3** (strict) — vue-i18n v9 has full TS support with type-safe messages
- **Pinia 3.0.3** — can store locale preference
- **No vue-router** — surface-based navigation, so no URL-based locale routing needed
- **Custom component library** — no third-party UI framework i18n to worry about

#### Current String Distribution

**Chinese strings (user-facing, Vue components): 18 strings in 4 files**
| File | Count | Examples |
|------|-------|---------|
| `src/renderer/components/command/NewProjectModal.vue` | 7 | 选择项目目录, 新建项目, 项目名称, 取消, 创建 |
| `src/renderer/components/WorkspaceList.vue` | 5 | 项目名称, 项目路径, 新建项目, 会话标题, 会话类型 |
| `src/renderer/components/archive/ArchiveSurface.vue` | 4 | 已归档会话, 恢复, 当前没有已归档的会话 |
| `src/renderer/components/TerminalViewport.vue` | 2 | 没有可显示的会话, 先创建项目... |

**English strings (user-facing, Vue components): ~70-80 strings across ~13 files**
- Settings components (GeneralSettings, AboutSettings, ProvidersSettings): ~30 strings
- Navigation/activity bar (GlobalActivityBar): ~8 strings
- Workspace hierarchy panel: ~10 strings
- Command surface & modals: ~15 strings
- Accessibility labels (aria-label, title): ~46 attributes
- Provider display names (shared/provider-descriptors.ts): 4 strings

**System messages (main/core, not renderer): ~10 strings**
- `src/main/index.ts`: 3 error messages with interpolation
- `src/main/session-runtime-controller.ts`: 1 status message
- `src/core/session-runtime.ts`: 2 runtime status messages
- `src/core/project-session-manager.ts`: 2 status messages

**Test files: ~20 Chinese strings** — should NOT be migrated (test data should stay hardcoded)

#### Recommended i18n Library

**vue-i18n v9** (latest: v9.x, part of @intlify ecosystem)
- Native Vue 3 Composition API support via `useI18n()`
- `legacy: false` mode for Composition API
- TypeScript message type safety
- Vite plugin: `@intlify/unplugin-vue-i18n` for SFC `<i18n>` blocks and lazy loading
- JSON locale files with nested key support
- Interpolation: `t('message.hello', { name: 'World' })`
- Pluralization support
- Large ecosystem, well-maintained (2,052+ commits on GitHub)

#### Recommended File Structure

```
src/renderer/
├── locales/
│   ├── en.ts          # English translations
│   ├── zh-CN.ts       # Simplified Chinese translations
│   └── index.ts       # i18n setup + export
```

Alternative: JSON files (`en.json`, `zh-CN.json`) if you prefer separation from TypeScript.

#### Key Integration Points

1. **Vue app entry** (`src/renderer/main.ts` or equivalent): Register i18n plugin
2. **Components**: Replace hardcoded strings with `$t()` in templates, `t()` in `<script setup>`
3. **Settings surface**: Add language switcher dropdown
4. **Pinia store**: Persist locale preference (electron-store or localStorage)
5. **System messages (main/core)**: These run in Electron main process, NOT Vue. Options:
   - Pass locale from renderer via IPC, translate in main process with shared locale files
   - OR keep main process messages in English, translate only renderer-side display

#### Migration Strategy

**Phase 1: Infrastructure (setup)**
- Install vue-i18n + Vite plugin
- Create locale files (en.ts, zh-CN.ts)
- Configure i18n instance
- Add language switcher to Settings

**Phase 2: Renderer strings (bulk work)**
- Extract Chinese strings from 4 Vue components → zh-CN locale keys
- Extract English strings from ~13 Vue components → en locale keys
- Replace hardcoded strings with `t()` calls
- Handle aria-label attributes: `:aria-label="t('archive.title')"`

**Phase 3: System messages (optional)**
- Main/core process messages: decide if these need i18n
- If yes: share locale files, use IPC to pass current locale

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Vue 3.5.22, no vue-router | package.json | package.json |
| No existing i18n setup | Grep for vue-i18n, i18n, locale | (no results) |
| 7 Chinese strings in NewProjectModal | File content | src/renderer/components/command/NewProjectModal.vue:22-72 |
| 5 Chinese strings in WorkspaceList | File content | src/renderer/components/WorkspaceList.vue:63-91 |
| 4 Chinese strings in ArchiveSurface | File content | src/renderer/components/archive/ArchiveSurface.vue:23-56 |
| 2 Chinese strings in TerminalViewport | File content | src/renderer/components/TerminalViewport.vue:274-275 |
| Provider names in shared | File content | src/shared/provider-descriptors.ts |
| System messages in main process | File content | src/main/index.ts:149,234,256 |
| Runtime status messages | File content | src/core/session-runtime.ts:99,110 |
| Custom CSS with variables | File content | src/renderer/styles.css |
| ~20 Chinese strings in tests | File content | Multiple test files in src/core/ and src/main/ |
| vue-i18n v9 is latest | Web search | github.com/intlify/vue-i18n-next |

### Risks / Unknowns

- [!] **Main process i18n**: Electron main process doesn't have Vue — need separate strategy for system messages (dialog boxes, error logs). May want to keep these English-only initially.
- [!] **CSS typography**: Some fonts may not render both Chinese and English well. Current CSS uses `'Menlo', 'Consolas', monospace` for terminal — may need CJK font fallback.
- [!] **String interpolation in core**: Status messages like `正在启动 ${session.type}` use template literals — need proper i18n interpolation syntax (`t('status.starting', { type })`).
- [!] **Text direction**: Chinese/English are both LTR, so no RTL concerns for these two languages. If adding Arabic/Hebrew later, this becomes relevant.
- [?] **Electron dialog boxes**: `dialog.showMessageBox()` in main process has hardcoded titles/messages — need to check if these should be localized.
- [?] **Font sizing**: Chinese characters are typically wider than English — may need CSS adjustments for layout density.
- [?] **Date/time formatting**: Terminal output may contain timestamps — check if these need locale-aware formatting.
