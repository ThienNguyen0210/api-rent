import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import en from './en.js'
import vi from './vi.js'

const DICTS = { en, vi }
export const LANGS = ['en', 'vi']
const KEY = 'lang'
const VN_ZONES = ['Asia/Ho_Chi_Minh', 'Asia/Saigon']

// Order: ?lang=vi (for testing) > the visitor's saved choice > location (time zone) > English.
// Location is inferred from the device time zone: Vietnam gets Vietnamese, everyone else English.
export function detectLang() {
  try {
    const q = new URLSearchParams(window.location.search).get('lang')
    if (DICTS[q]) return q
  } catch {}
  try { const s = localStorage.getItem(KEY); if (DICTS[s]) return s } catch {}
  try { if (VN_ZONES.includes(Intl.DateTimeFormat().resolvedOptions().timeZone)) return 'vi' } catch {}
  return 'en'
}

let current = detectLang()
export const getLang = () => current

// Plain function so non-React code (API client, formatters) can translate too.
export function t(key, vars) {
  const s = DICTS[current][key] ?? en[key] ?? key
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m) : s
}

const Ctx = createContext({ lang: 'en', setLang: () => {}, t })
export const useI18n = () => useContext(Ctx)

export function LanguageProvider({ children }) {
  const [lang, set] = useState(current)
  const setLang = l => {
    if (!DICTS[l]) return
    current = l
    try { localStorage.setItem(KEY, l) } catch {}
    set(l)
  }
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  const value = useMemo(() => ({ lang, setLang, t }), [lang])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
