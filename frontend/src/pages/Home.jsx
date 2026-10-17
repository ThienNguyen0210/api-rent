import { useMemo } from 'react'
import Button from '../components/Button.jsx'
import CodeBlock from '../components/CodeBlock.jsx'
import ModelTable from '../components/ModelTable.jsx'
import DataState from '../components/DataState.jsx'
import { useApi } from '../hooks/useApi.js'
import { modelsApi } from '../api/index.js'
import { useI18n } from '../i18n/index.jsx'

const API_HOST = 'https://api.nexora.dev'

// Same tolerant unwrapping as Models.jsx: accepts [..], { data: [..] } or { items: [..] }.
const toList = res => (Array.isArray(res) ? res : res?.data ?? res?.items ?? [])

// Same shape as curlOf() in Models.jsx: the model's own endpoint + its public name.
function curlOf(m) {
  return `curl ${API_HOST}${m?.endpoint ?? '/v1/chat'} \\
  -H "Authorization: Bearer $NEXORA_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${m?.name ?? 'MODEL_NAME'}","messages":[{"role":"user","content":"Hello"}]}'`
}

// The animated background lives in MarketingLayout, so this page is content only.
export default function Home() {
  const { t } = useI18n()
  const models = useApi(modelsApi.list)
  const list = useMemo(() => toList(models.data), [models.data])

  // "Current" model for the sample: first active one, else the first listed.
  const current = useMemo(() => list.find(m => (m.status || 'active') === 'active') || list[0] || null, [list])

  return (
    <>
      <section className="hero container">
        <h1>{t('home.title')}</h1>
        <p>{t('home.subtitle')}</p>
        <div className="row">
          <Button to="/login?mode=register">{t('home.getKey')}</Button>
          <Button to="/pricing" variant="ghost">{t('home.viewPricing')}</Button>
        </div>
        <div style={{ margin: '20px auto 0', maxWidth: 650 }}><CodeBlock title={t('home.terminal')} code={curlOf(current)} /></div>
      </section>
      <section className="container section">
        <h2>{t('home.models')}</h2>
        <DataState query={models} isEmpty={!list.length} empty={t('home.modelsEmpty')}>
          <ModelTable models={list} />
        </DataState>
      </section>
    </>
  )
}