import { defineConfig } from 'vitest/config'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'

const rootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    preserveSymlinks: true,
    alias: {
      '@renderer': resolve(rootDir, 'src/renderer'),
      '@core': resolve(rootDir, 'src/core'),
      '@shared': resolve(rootDir, 'src/shared'),
      '@extensions': resolve(rootDir, 'src/extensions')
    }
  },
  test: {
    setupFiles: ['./tests/env-setup.ts', './tests/i18n-setup.ts'],
    environment: 'happy-dom',
    pool: 'forks',
    exclude: [
      '**/node_modules/**',
      '**/.git/**',
      '**/.tmp/**',
      '**/.worktrees/**',
      '**/dist/**',
      '**/release/**',
      '**/research/upstreams/**',
      '**/e2e-playwright/**',
      '**/tests/generated/playwright/**'
    ]
  }
})
