import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@renderer/app/App.vue'
import i18n from '@renderer/i18n'
import '@renderer/styles/tailwind.css'

const application = createApp(App)
application.use(createPinia())
application.use(i18n)
application.mount('#app')
