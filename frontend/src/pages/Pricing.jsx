import Button from '../components/Button.jsx'
import ModelTable from '../components/ModelTable.jsx'
import DataState from '../components/DataState.jsx'
import { useApi } from '../hooks/useApi.js'
import { plansApi, modelsApi } from '../api/index.js'
import { useI18n } from '../i18n/index.jsx'
export default function Pricing() {
  const { t } = useI18n()
  const plans = useApi(plansApi.list), models = useApi(modelsApi.list)
  return (
    <div className="container section">
      <h1 className="h1">{t('pricing.title')}</h1>
      <DataState query={plans} isEmpty={!plans.data?.length} empty={t('pricing.plansEmpty')}>
        <div className="grid3">{(plans.data || []).map(p => (
          <div key={p.id} className={`card ${p.featured ? 'featured' : ''}`}>
            <h3>{p.name}</h3><div className="price">{p.price}</div><div className="muted">{p.priceNote}</div>
            <ul>{(p.features || []).map(f => <li key={f}>{f}</li>)}</ul>
            <Button to="/login?mode=register" variant={p.featured ? 'primary' : 'ghost'}>{t('pricing.choose', { name: p.name })}</Button>
          </div>))}</div>
      </DataState>
      <h2 style={{ marginTop: 64 }}>{t('pricing.rates')}</h2>
      <DataState query={models} isEmpty={!models.data?.length} empty={t('pricing.modelsEmpty')}><ModelTable models={models.data || []} /></DataState>
    </div>
  )
}
