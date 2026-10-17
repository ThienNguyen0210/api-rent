import { useI18n, LANGS } from '../i18n/index.jsx'
export default function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n()
  return (
    <div className="seg" role="group" aria-label={t('lang.label')}>
      {LANGS.map(l => <button key={l} type="button" className={lang === l ? 'on' : ''} aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}
    </div>
  )
}
