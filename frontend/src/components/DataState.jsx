import Button from './Button.jsx'
import { useI18n } from '../i18n/index.jsx'
// Shows loading / error / empty states for a useApi result, otherwise renders children.
export default function DataState({ query, isEmpty, empty, children }) {
  const { t } = useI18n()
  if (query.loading && query.data == null) return <div className="state">{t('app.loading')}</div>
  if (query.error && !query.loading) return <div className="state alert">{query.error.message} <Button variant="ghost" onClick={query.reload}>{t('common.retry')}</Button></div>
  if (isEmpty) return <div className="state">{empty ?? t('common.nothing')}</div>
  return children
}
