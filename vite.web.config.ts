import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { createRendererAliases, createRendererPlugins } from './vite.renderer.shared'

export default defineConfig({
  root: resolve('src/renderer'),
  plugins: createRendererPlugins(),
  resolve: {
    alias: createRendererAliases(),
  },
  build: {
    outDir: resolve('stoa-server/dist/web'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve('src/renderer/index.html'),
    },
  },
})
