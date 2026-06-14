import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'
import { createRendererAliases, createRendererPlugins } from './vite.renderer.shared'

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolve('src/main/index.ts'),
        formats: ['cjs']
      }
    },
    plugins: [externalizeDepsPlugin({ exclude: ['express'] })],
    resolve: {
      alias: {
        '@core': resolve('src/core'),
        '@shared': resolve('src/shared'),
        '@extensions': resolve('src/extensions')
      }
    }
  },
  preload: {
    build: {
      lib: {
        entry: resolve('src/preload/index.ts'),
        formats: ['cjs']
      }
    },
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@core': resolve('src/core'),
        '@shared': resolve('src/shared'),
        '@extensions': resolve('src/extensions')
      }
    }
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html')
        }
      }
    },
    resolve: {
      alias: createRendererAliases()
    },
    plugins: createRendererPlugins()
  }
})
