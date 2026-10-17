import { useI18n } from '../i18n/index.jsx'
export default function StatCard({ label, value, delta }) {
  const { t } = useI18n()
  return <div className="card stat"><div className="muted">{label}</div><div className="stat-v">{value}</div>{delta && <div className={`delta ${delta.startsWith('-') ? 'down' : 'up'}`}>{t('stat.vsLastWeek', { delta })}</div>}</div>
}
