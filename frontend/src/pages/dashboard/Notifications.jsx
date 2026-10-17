import { Link } from 'react-router-dom'
import DataState from '../../components/DataState.jsx'
import { useApi } from '../../hooks/useApi.js'
import { notificationsApi } from '../../api/index.js'
import { useI18n, getLang } from '../../i18n/index.jsx'
import '../../styles/overview.css'
import '../../styles/notifications.css'

// The server sends every language the admin wrote ({ en, vi, ... }). Use the user's language,
// then its base language (pt-BR -> pt), then English, then whatever exists.
const pick = (texts, lang) => {
  if (!texts) return ''
  const base = String(lang || 'en').toLowerCase().split('-')[0]
  return texts[lang] || texts[base] || texts.en || Object.values(texts)[0] || ''
}

const formatDate = (iso, lang) => {
  try { return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) }
  catch { return new Date(iso).toLocaleString() }
}

export default function Notifications() {
  const { t } = useI18n() // also re-renders this page when the language changes
  const lang = getLang()
  const query = useApi(notificationsApi.list)
  const items = query.data?.items ?? []

  return (
    <div className="w2">
      <header className="w-hd">
        <div>
          <h1>{t('notifications.title')}</h1>
          <p className="w-sub">{t('notifications.subtitle')}</p>
        </div>
      </header>

      <DataState query={query}>
        {!items.length ? (
          <section className="w-card"><div className="w-state">{t('notifications.empty')}</div></section>
        ) : (
          <ul className="ntf-list">
            {items.map(n => (
              <li key={n.id} className={`w-card ntf ntf-${n.type}`}>
                <div className="ntf-top">
                  <span className="ntf-tag">{t(`notifications.type.${n.type}`)}</span>
                  <time className="w-mut" dateTime={n.date}>{formatDate(n.date, lang)}</time>
                </div>
                <h3>{pick(n.title, lang)}</h3>
                {n.body && <p className="ntf-body">{pick(n.body, lang)}</p>}
                {n.url && (n.url.startsWith('/')
                  ? <Link className="ntf-link" to={n.url}>{t('notifications.learnMore')}</Link>
                  : <a className="ntf-link" href={n.url} target="_blank" rel="noopener noreferrer">{t('notifications.learnMore')}</a>)}
              </li>
            ))}
          </ul>
        )}
      </DataState>
    </div>
  )
}
