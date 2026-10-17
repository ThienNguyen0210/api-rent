import { useI18n } from '../i18n/index.jsx'

// Same helper as Models.jsx.
const compact = n => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))

// API prices are USD per 1,000 tokens; the table shows USD per 1M tokens. null = not set -> '–' (0 stays "$0").
const perM = v => (typeof v === 'number' ? `$${+(v * 1000).toFixed(2)}` : '–')

export default function ModelTable({ models }) {
  const { t } = useI18n()
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>{t('table.model')}</th><th>{t('table.type')}</th><th>{t('table.context')}</th><th>{t('table.input')}</th><th>{t('table.output')}</th></tr></thead>
      <tbody>{models.map(m => (
        <tr key={m.key}>
          <td><code>{m.name}</code></td>
          <td>{(m.category || []).map(c => t(`models.filter.${c}`)).join(', ') || '–'}</td>
          <td>{m.contextTokens ? compact(m.contextTokens) : '–'}</td>
          <td>{perM(m.pricing?.inputPer1k)}</td>
          <td>{perM(m.pricing?.outputPer1k)}</td>
        </tr>
      ))}</tbody>
    </table></div>
  )
}