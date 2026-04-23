import { createI18n } from 'vue-i18n'
import en from './en'
import zhCN from './zh-CN'

export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: SupportedLocale = 'en'

const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: 'en',
  messages: {
    en,
    'zh-CN': zhCN
  }
})

export default i18n
