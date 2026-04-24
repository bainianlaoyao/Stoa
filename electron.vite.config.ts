import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
import { resolve } from 'node:path'

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
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared'),
        '@extensions': resolve('src/extensions')
      }
    },
    plugins: [
      vue(),
      tailwindcss(),
      VueI18nPlugin({
        include: [resolve('src/renderer/i18n/en.ts'), resolve('src/renderer/i18n/zh-CN.ts')]
      })
    ]
  }
})
