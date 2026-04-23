<template>
  <section class="grid grid-cols-[minmax(0,0.92fr)_minmax(260px,0.78fr)] gap-2.5 p-2.5" data-surface="tree">
    <section class="grid grid-rows-[auto_auto_auto_auto_auto] gap-3" data-tree-list>
      <p class="eyebrow">Context Tree</p>
      <h2>Blast radius placeholder</h2>
      <article class="flex justify-between gap-3 p-3 border border-[var(--color-line)] rounded-[var(--radius-sm)] bg-[var(--color-surface-solid)]"><span>session-manager.ts</span><strong class="font-[var(--font-mono)] text-[var(--text-caption)]">MOD</strong></article>
      <article class="flex justify-between gap-3 p-3 border border-[var(--color-line)] rounded-[var(--radius-sm)] bg-[var(--color-surface-solid)]"><span>workspace.ts</span><strong class="font-[var(--font-mono)] text-[var(--text-caption)]">READ</strong></article>
      <article class="flex justify-between gap-3 p-3 border border-[var(--color-line)] rounded-[var(--radius-sm)] bg-[var(--color-surface-solid)]"><span>opencode-provider.ts</span><strong class="font-[var(--font-mono)] text-[var(--text-caption)]">NEW</strong></article>
    </section>

    <section class="grid grid-rows-[auto_auto_auto] gap-3" data-tree-detail>
      <p class="eyebrow">Association</p>
      <h2>Read-only placeholder</h2>
      <p>This surface reserves the authoritative tree/detail layout for future file context and blast radius data.</p>
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
