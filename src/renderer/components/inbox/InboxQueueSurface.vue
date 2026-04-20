<template>
  <section class="placeholder-surface" data-surface="queue">
    <section class="placeholder-surface__lane" data-queue-list>
      <p class="eyebrow">Inbox / Queue</p>
      <h2>Queue placeholder</h2>
      <p>This placeholder keeps the authoritative queue lane visible while backend queue data is not wired yet.</p>
      <article class="placeholder-card">
        <strong>workspace-console-ux spec ready</strong>
        <small>placeholder item · awaiting review</small>
      </article>
    </section>

    <section class="placeholder-surface__lane" data-queue-detail>
      <p class="eyebrow">Detail</p>
      <h2>placeholder detail</h2>
      <p>Completed outputs and confirmation flows will land here in a later phase.</p>
      <button class="placeholder-button" disabled type="button">Acknowledge</button>
    </section>
  </section>
</template>
