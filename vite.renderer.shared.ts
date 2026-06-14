import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
import { resolve } from 'node:path'

export function createRendererAliases() {
  return {
    '@renderer': resolve('src/renderer'),
    '@shared': resolve('src/shared'),
    '@extensions': resolve('src/extensions'),
  }
}

export function createRendererPlugins() {
  return [
    vue(),
    tailwindcss(),
    VueI18nPlugin({
      include: [resolve('src/renderer/i18n/en.ts'), resolve('src/renderer/i18n/zh-CN.ts')],
    }),
  ]
}
