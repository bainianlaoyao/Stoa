---
date: 2026-04-24
topic: Settings toggle for --dangerously-skip-permissions visibility
status: completed
mode: context-gathering
sources: 6
---

## Context Report: Skip Permission Toggle Visibility

### Why This Was Gathered
User reported the "Skip Claude permission prompts" toggle disappeared from the settings UI.

### Summary
The toggle code is intact and correctly implemented. It renders inside the Claude Code provider card on the Providers settings tab. The toggle is at the bottom of the 3rd provider card (after OpenCode and Codex), which may require scrolling to see. The recent scroll fix (d4f41b0) should enable scrolling to reach it.

### Key Findings
- Toggle exists in `ProvidersSettings.vue:99-121`, guarded by `v-if="isClaudeCodeProvider(provider.id)"`
- `isClaudeCodeProvider()` checks `provider.id === 'claude-code'` — correct
- Provider list includes claude-code (from `SESSION_PROVIDER_ORDER`), local-shell is filtered out
- The toggle is inside the claude-code provider card, which is 3rd in the list
- The `Switch` component from `@headlessui/vue` v1.7.x is used correctly
- The settings store has `claudeDangerouslySkipPermissions` state and the `updateSetting` handler
- Build succeeds without errors
- Recent scroll fix (d4f41b0) changed `settings-panel` min-height from 100% to 0, enabling scroll in the content panel

### Evidence Chain
| Finding | Source | Location |
|--------|--------|----------|
| Toggle template with v-if guard | ProvidersSettings.vue | :99-121 |
| isClaudeCodeProvider check | ProvidersSettings.vue | :45-47 |
| Provider list construction | ProvidersSettings.vue | :12-14 |
| Provider descriptors and order | provider-descriptors.ts | :62 |
| Settings store state | settings.ts | :13, :26, :45-46 |
| Scroll fix commit | git d4f41b0 | SettingsSurface.vue, tailwind.css |

### Risks / Unknowns
- [?] User may not have rebuilt the app after latest changes
- [?] Possible runtime rendering issue not visible from static analysis
- [!] If the user is looking on the General tab instead of Providers, they won't find it
