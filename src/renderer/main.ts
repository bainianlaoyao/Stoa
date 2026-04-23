import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@renderer/app/App.vue'
import '@renderer/styles/tailwind.css'

const application = createApp(App)
application.use(createPinia())
application.mount('#app')
