import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@core': resolve(__dirname, 'src/core'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@extensions': resolve(__dirname, 'src/extensions')
    }
  },
  test: {
    environment: 'happy-dom',
    pool: 'forks',
    exclude: [
      '**/node_modules/**',
      '**/.git/**',
      '**/.worktrees/**',
      '**/dist/**',
      '**/e2e-playwright/**',
      '**/tests/generated/playwright/**'
    ]
  }
})
