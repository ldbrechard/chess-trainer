import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]
export type AppLanguage = SupportedLanguage | 'es' | 'de' | 'it' | 'pt'

const I18N_STORAGE_KEY = 'chess-trainer:language:v1'

type TranslationMap = {
  en: string
  fr: string
  [lang: string]: string
}

type TranslateParams = Record<string, string | number>

type I18nContextValue = {
  language: AppLanguage
  setLanguage: (language: AppLanguage) => void
  t: (translations: TranslationMap, params?: TranslateParams) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function readStoredLanguage(): AppLanguage {
  try {
    const v = window.localStorage.getItem(I18N_STORAGE_KEY)
    if (!v) return 'en'
    return v as AppLanguage
  } catch {
    return 'en'
  }
}

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`))
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>(() => readStoredLanguage())

  useEffect(() => {
    try {
      window.localStorage.setItem(I18N_STORAGE_KEY, language)
    } catch {
      // ignore storage errors
    }
  }, [language])

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t: (translations, params) => {
        const selected = translations[language] ?? translations.en ?? ''
        return interpolate(selected, params)
      },
    }),
    [language],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return ctx
}

