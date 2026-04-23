import { config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import en from '@renderer/i18n/en'

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en }
})

config.global.plugins.push(i18n)
