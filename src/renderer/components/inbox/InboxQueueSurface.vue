<template>
  <section class="grid grid-cols-[minmax(0,0.92fr)_minmax(260px,0.78fr)] gap-2.5 p-2.5" data-surface="queue">
    <section class="grid grid-rows-[auto_auto_auto_auto] gap-3" data-queue-list>
      <p class="eyebrow">Inbox / Queue</p>
      <h2>Queue placeholder</h2>
      <p>This placeholder keeps the authoritative queue lane visible while backend queue data is not wired yet.</p>
      <article class="flex justify-between gap-3 p-3 border border-[var(--color-line)] rounded-[var(--radius-sm)] bg-[var(--color-surface-solid)]">
        <strong>workspace-console-ux spec ready</strong>
        <small>placeholder item · awaiting review</small>
      </article>
    </section>

    <section class="grid grid-rows-[auto_auto_auto_auto] gap-3" data-queue-detail>
      <p class="eyebrow">Detail</p>
      <h2>placeholder detail</h2>
      <p>Completed outputs and confirmation flows will land here in a later phase.</p>
      <button class="btn-ghost text-[var(--text-body-sm)]" disabled type="button">Acknowledge</button>
    </section>
  </section>
</template>

<style scoped>
@media (max-width: 960px) {
  section[data-surface] {
    grid-template-columns: 1fr;
  }
}
</style>
