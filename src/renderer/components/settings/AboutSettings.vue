<script setup lang="ts">
const APP_VERSION = '0.1.0'
</script>

<template>
  <div role="tabpanel" id="settings-panel-about" class="settings-panel" aria-label="About">
    <header class="settings-panel__header settings-panel__header--about">
      <div>
        <p class="eyebrow">About</p>
        <h3 class="settings-panel__title">Project details</h3>
      </div>
      <p class="settings-panel__description">
        Reference information for the current build, the stack it runs on, and related links.
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
        <p class="settings-about__summary">Multi-session workspace console for local provider-driven development.</p>
        <span class="settings-about__stack">Electron · Vue 3 · node-pty</span>
      </section>

      <section class="settings-card" aria-label="Project links">
        <div class="settings-card__header">
          <div>
            <h4 class="settings-card__title">Project links</h4>
            <p class="settings-card__description">Quick links to the project repository, docs, and issue reporting.</p>
          </div>
          <span class="settings-card__badge">Resources</span>
        </div>

        <div class="settings-about__links">
          <a class="settings-about__link" href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a class="settings-about__link" href="https://github.com" target="_blank" rel="noopener noreferrer">Documentation</a>
          <a class="settings-about__link" href="https://github.com" target="_blank" rel="noopener noreferrer">Report Issue</a>
        </div>
      </section>
    </div>
  </div>
</template>
