import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: true,
  // Keep the server bundle self-contained for packaged Electron builds.
  // Native better-sqlite3 is external so Electron can load the rebuilt .node.
  noExternal: ['stoa-shared', '@hono/node-server', 'hono', 'nanoid', 'drizzle-orm', 'zod'],
  external: ['better-sqlite3'],
});
