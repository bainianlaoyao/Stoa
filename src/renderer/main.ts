import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@renderer/app/App.vue'
import i18n from '@renderer/i18n'
import { bootstrapDesktopRenderer } from '@renderer/bootstrap-electron'
import { bootstrapWebRenderer } from '@renderer/bootstrap-web'
import { stoaClientPlugin } from '@renderer/stores/stoa-store-plugin'
import '@renderer/styles/tailwind.css'

async function bootstrap(): Promise<void> {
  if (!window.stoa) {
    if (window.stoaElectron) {
      await bootstrapDesktopRenderer()
    } else {
      bootstrapWebRenderer()
    }
  }

  const pinia = createPinia()
  pinia.use(stoaClientPlugin())

  const application = createApp(App)
  application.use(pinia)
  application.use(i18n)
  application.mount('#app')
}

void bootstrap()
