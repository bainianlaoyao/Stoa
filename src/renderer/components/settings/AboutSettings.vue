<script setup lang="ts">
const APP_VERSION = '0.1.0'
</script>

<template>
  <div role="tabpanel" id="settings-panel-about" class="settings-surface__content" aria-label="About">
    <div class="settings-about">
      <div class="settings-about__brand">
        <div class="settings-about__logo">V</div>
        <h2 class="settings-about__name">Vibecoding Panel</h2>
        <span class="settings-about__version">v{{ APP_VERSION }}</span>
      </div>
      <div class="settings-about__divider"></div>
      <span class="settings-about__stack">Electron · Vue 3 · node-pty</span>
      <div class="settings-about__links">
        <a class="settings-about__link" href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a class="settings-about__link" href="https://github.com" target="_blank" rel="noopener noreferrer">Documentation</a>
        <a class="settings-about__link" href="https://github.com" target="_blank" rel="noopener noreferrer">Report Issue</a>
      </div>
    </div>
  </div>
</template>
