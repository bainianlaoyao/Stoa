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

<style scoped>
.settings-panel__header--about {
  padding-bottom: 2px;
}

.settings-panel__header {
  display: grid;
  gap: 8px;
}

.settings-panel__title {
  margin: 0;
  color: var(--color-text-strong);
  font-family: var(--font-ui);
  font-size: var(--text-title);
  font-weight: 600;
}

.settings-panel__description {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.5;
  max-width: 640px;
  font-size: var(--text-body);
}

.settings-section {
  display: grid;
  gap: 14px;
}

.settings-section--about {
  grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
}

.settings-card--hero {
  align-content: start;
}

.settings-card__header {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  align-items: start;
}

.settings-card__title {
  margin: 0;
  color: var(--color-text-strong);
  font-family: var(--font-ui);
  font-size: var(--text-title-sm);
  font-weight: 600;
}

.settings-card__description {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.5;
  margin-top: 4px;
  font-size: var(--text-body-sm);
}

.settings-card__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--color-black-faint);
  color: var(--color-muted);
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}

.settings-about {
  min-height: 100%;
}

.settings-about__brand {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 14px;
  align-items: center;
}

.settings-about__logo {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: var(--color-text-strong);
  color: var(--color-surface-solid);
  font-size: 18px;
  font-weight: 700;
  box-shadow: var(--shadow-soft);
}

.settings-about__identity {
  display: grid;
  gap: 4px;
}

.settings-about__name {
  margin: 0;
  color: var(--color-text-strong);
  font-family: var(--font-ui);
}

.settings-about__version {
  color: var(--color-muted);
  font-size: 12px;
  font-family: var(--font-mono);
}

.settings-about__summary {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.5;
}

.settings-about__stack {
  color: var(--color-muted);
  font-size: 12px;
  display: inline-flex;
  width: fit-content;
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--color-black-faint);
}

.settings-about__links {
  display: grid;
  gap: 8px;
}

.settings-about__link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-solid);
  color: var(--color-text-strong);
  text-decoration: none;
  border: 1px solid var(--color-line);
  transition: all 0.2s ease;
}

.settings-about__link:hover,
.settings-about__link:focus-visible {
  background: var(--color-black-soft);
  outline: none;
}

.settings-about__link::after {
  content: '\2197';
  color: var(--color-subtle);
  font-size: 12px;
}

@media (max-width: 980px) {
  .settings-section--about {
    grid-template-columns: 1fr;
  }
}
</style>
