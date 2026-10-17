import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '../../components/Button.jsx'
import DataState from '../../components/DataState.jsx'
import StatCard from '../../components/StatCard.jsx'
import { useApi } from '../../hooks/useApi.js'
import { usageApi, billingApi } from '../../api/index.js'
import { fmtNum, fmtMoney, fmtDateTime } from '../../lib/format.js'
import { useI18n } from '../../i18n/index.jsx'
import './usage.css'

const DAY_OPTIONS = [7, 14, 30]
const PER_PAGE = 10
const STATE_COLOR = { ok: '#16A34A', degraded: '#F59E0B', down: '#DC2626' }
const MODEL_COLORS = ['#4F46E5', '#8B5CF6', '#0EA5E9', '#14B8A6', '#F59E0B', '#94A3B8']
const compact = n => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n ?? 0)
const fmtDelta = n => n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' }) + '%'
const fmtLatency = ms => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`)

// t() with an English fallback, so the page works before the new keys are added to the dictionaries.
function useT() {
  const { t } = useI18n()
  return (key, fallback, vars) => {
    const v = t(key, vars)
    return v && v !== key ? v : fallback
  }
}

function Delta({ value, change, note }) {
  const up = change != null && change >= 0
  return (
    <>
      {value}
      {change != null && (
        <small className="u-delta" style={{ color: up ? '#16A34A' : '#DC2626' }}>
          {fmtDelta(change)} <span className="muted">{note}</span>
        </small>
      )}
    </>
  )
}

/** Smooth area chart with grid, axis labels and hover tooltip. data: [{ label, value }] */
function AreaChart({ data, format, height = 260 }) {
  const box = useRef(null)
  const [w, setW] = useState(600)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    if (!box.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])

  const p = { l: 46, r: 12, t: 12, b: 26 }
  const max = Math.max(...data.map(d => d.value), 1) * 1.15
  const x = i => p.l + (data.length > 1 ? (i * (w - p.l - p.r)) / (data.length - 1) : (w - p.l - p.r) / 2)
  const y = n => p.t + (1 - n / max) * (height - p.t - p.b)
  const pts = data.map((d, i) => [x(i), y(d.value)])

  let path = `M${pts[0]?.join(',')}`
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i - 1] || pts[i], b = pts[i], c = pts[i + 1], e = pts[i + 2] || c
    path += `C${b[0] + (c[0] - a[0]) / 6},${b[1] + (c[1] - a[1]) / 6} ${c[0] - (e[0] - b[0]) / 6},${c[1] - (e[1] - b[1]) / 6} ${c[0]},${c[1]}`
  }
  const area = `${path}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z`
  const step = Math.ceil(data.length / 7)

  const onMove = e => {
    const r = box.current.getBoundingClientRect()
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left
    const i = Math.round(((cx - p.l) / (w - p.l - p.r)) * (data.length - 1))
    setHover(Math.max(0, Math.min(data.length - 1, i)))
  }

  return (
    <div ref={box} className="u-chart" style={{ height }}>
      <svg width={w} height={height} role="img" aria-label="Usage over time">
        <defs>
          <linearGradient id="u-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4F46E5" stopOpacity=".25" />
            <stop offset="1" stopColor="#4F46E5" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <g key={f}>
            <line x1={p.l} x2={w - p.r} y1={y(max * f)} y2={y(max * f)} className="u-grid" />
            <text x={p.l - 8} y={y(max * f) + 4} textAnchor="end" className="u-axis">{format(max * f)}</text>
          </g>
        ))}
        {data.map((d, i) => (i % step === 0 || i === data.length - 1) && (
          <text key={d.label} x={x(i)} y={height - 6} textAnchor="middle" className="u-axis">{d.label}</text>
        ))}
        <path d={area} fill="url(#u-fill)" />
        <path d={path} fill="none" stroke="#4F46E5" strokeWidth="2.5" strokeLinecap="round" />
        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={p.t} y2={height - p.b} className="u-grid" />
            <circle cx={x(hover)} cy={y(data[hover].value)} r="5" fill="#fff" stroke="#4F46E5" strokeWidth="2.5" />
          </>
        )}
        <rect x={p.l} y="0" width={w - p.l - p.r} height={height} fill="transparent"
          onMouseMove={onMove} onTouchMove={onMove} onTouchStart={onMove}
          onMouseLeave={() => setHover(null)} onTouchEnd={() => setHover(null)} />
      </svg>
      {hover != null && (
        <div className="u-tip" style={{ left: x(hover), top: y(data[hover].value) }}>
          <b>{data[hover].label}</b> · {format(data[hover].value)}
        </div>
      )}
    </div>
  )
}

function StatusStrip({ query }) {
  const t = useT()
  const s = query.data || {}
  const rows = [['api', 'API'], ['models', 'Models'], ['gateway', 'Gateway']]
  return (
    <ul className="u-status">
      {rows.map(([k, fb]) => (
        <li key={k}>
          <span aria-hidden="true" className="u-dotc" style={{ background: STATE_COLOR[s[k]] || STATE_COLOR.down }} />
          <span>{t(`overview.${k}`, fb)}</span>
          <small className="muted">{t(`overview.state.${s[k] || 'down'}`, s[k] || 'down')}</small>
        </li>
      ))}
    </ul>
  )
}

function ExportMenu({ onExport }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = e => e.key === 'Escape' && setOpen(false)
    document.addEventListener('click', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', esc) }
  }, [])
  return (
    <div className="u-menu" ref={ref}>
      <Button onClick={() => setOpen(o => !o)} aria-haspopup="true" aria-expanded={open}>{t('usage.export', 'Export Report')}</Button>
      {open && (
        <div className="u-pop" role="menu">
          {['CSV', 'JSON', 'PDF'].map(f => (
            <button key={f} role="menuitem" onClick={() => { onExport(f); setOpen(false) }}>{t(`usage.export${f}`, `Export ${f}`)}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function download(name, type, text) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function Usage() {
  const t = useT()
  const [days, setDays] = useState(7)
  const [metric, setMetric] = useState('requests')
  const [fModel, setFModel] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [page, setPage] = useState(1)

  const usage = useApi(() => usageApi.summary(days), [days])
  const reqs = useApi(() => usageApi.requests(100))
  const bill = useApi(billingApi.get)
  const status = useApi(usageApi.status)

  const u = usage.data
  const b = bill.data
  const cur = b?.currency
  const note = t('overview.vsPrev', 'vs previous period')
  const daily = u?.daily ?? []
  const byModel = u?.byModel ?? []
  const totalTokens = byModel.reduce((s, m) => s + m.tokens, 0)

  const METRICS = {
    requests: { label: t('usage.requests', 'Requests'), fmt: fmtNum },
    tokens: { label: t('usage.tokens', 'Tokens'), fmt: compact },
    spend: { label: t('usage.cost', 'Cost'), fmt: n => fmtMoney(n, cur) },
  }

  // History (client-side filter + pagination over the latest 100 requests).
  const all = reqs.data ?? []
  const modelNames = useMemo(() => [...new Set(all.map(r => r.modelId))], [all])
  const rows = all.filter(r => (!fModel || r.modelId === fModel) && (!fStatus || (fStatus === 'ok' ? r.status < 400 : r.status >= 400)))
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE))
  const cp = Math.min(page, pages)
  const shown = rows.slice((cp - 1) * PER_PAGE, cp * PER_PAGE)
  const win = Array.from({ length: Math.min(5, pages) }, (_, i) => Math.min(Math.max(1, cp - 2), Math.max(1, pages - 4)) + i)
  const filtered = fModel || fStatus

  const exportReport = f => {
    const stamp = new Date().toISOString().slice(0, 10)
    if (f === 'PDF') return window.print()
    if (f === 'JSON') return download(`usage-${stamp}.json`, 'application/json', JSON.stringify({ summary: u, requests: rows }, null, 2))
    const head = ['id', 'model', 'status', 'promptTokens', 'completionTokens', 'tokens', 'cost', 'latencyMs', 'createdAt']
    const csv = [head.join(','), ...rows.map(r => head.map(k => JSON.stringify(r[k === 'model' ? 'modelId' : k] ?? '')).join(','))].join('\n')
    download(`usage-${stamp}.csv`, 'text/csv', csv)
  }

  return (
    <div className="u-page">
      <div className="u-head">
        <div>
          <h2>{t('usage.title', 'Usage')}</h2>
          <p className="muted">{t('usage.subtitle', 'Monitor your API usage, token consumption, and spending.')}</p>
        </div>
        <div className="u-actions">
          <div className="seg" role="group" aria-label="Date range">
            {DAY_OPTIONS.map(d => (
              <button key={d} className={days === d ? 'on' : ''} aria-pressed={days === d} onClick={() => setDays(d)}>
                {t('usage.days', `Last ${d} days`, { n: d })}
              </button>
            ))}
          </div>
          <ExportMenu onExport={exportReport} />
        </div>
      </div>

      <DataState query={usage}>
        <div className="grid4">
          <StatCard label={t('overview.requests7', 'Total Requests')}
            value={<Delta value={fmtNum(u?.totals.requests)} change={u?.change.requests} note={note} />} />
          <StatCard label={t('overview.tokensConsumed', 'Tokens Used')}
            value={<Delta value={compact(u?.totals.tokens)} change={u?.change.tokens} note={note} />} />
          <StatCard label={t('overview.spend7', 'Total Cost')}
            value={<Delta value={fmtMoney(u?.totals.spend, cur)} change={u?.change.spend} note={note} />} />
          <StatCard label={t('overview.balance', 'Remaining Credits')} value={
            <>
              {b ? fmtMoney(b.balance, cur) : '–'}
              {b?.tokensGranted > 0 && (
                <>
                  <div className="u-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100}
                    aria-valuenow={Math.round((b.tokensRemaining / b.tokensGranted) * 100)}>
                    <div style={{ width: `${(b.tokensRemaining / b.tokensGranted) * 100}%` }} />
                  </div>
                  <small className="muted u-delta">{compact(b.tokensRemaining)} / {compact(b.tokensGranted)} {t('usage.tokensLeft', 'tokens left')}</small>
                </>
              )}
            </>
          } />
        </div>
      </DataState>

      <div className="u-cols">
        <div className="card u-main">
          <div className="card-head">
            <h3>{t('usage.apiUsage', 'API Usage')}</h3>
            <div className="seg" role="group" aria-label="Metric">
              {Object.entries(METRICS).map(([k, m]) => (
                <button key={k} className={metric === k ? 'on' : ''} aria-pressed={metric === k} onClick={() => setMetric(k)}>{m.label}</button>
              ))}
            </div>
          </div>
          <DataState query={usage} isEmpty={!daily.length} empty={t('usage.empty', 'No usage yet')}>
            <AreaChart data={daily.map(d => ({ label: d.date.slice(5), value: d[metric] }))} format={METRICS[metric].fmt} />
          </DataState>
        </div>

        <div className="u-side">
          <div className="card">
            <h3>{t('usage.byModel', 'Usage by Model')}</h3>
            <DataState query={usage} isEmpty={!byModel.length} empty={t('usage.empty', 'No usage yet')}>
              {byModel.map((m, i) => {
                const pct = totalTokens ? Math.round((m.tokens / totalTokens) * 100) : 0
                return (
                  <div key={m.modelId} className="meter">
                    <div className="row between">
                      <span><i className="u-dotc" style={{ background: MODEL_COLORS[i % MODEL_COLORS.length] }} /><code>{m.modelId}</code></span>
                      <span>{pct}%</span>
                    </div>
                    <div className="u-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={m.modelId}>
                      <div style={{ width: `${pct}%`, background: MODEL_COLORS[i % MODEL_COLORS.length] }} />
                    </div>
                    <small className="muted">{compact(m.tokens)} {t('usage.tokensUnit', 'tokens')} · {fmtMoney(m.spend, cur)}</small>
                  </div>
                )
              })}
            </DataState>
          </div>
          <div className="card">
            <h3>{t('overview.apiStatus', 'API Status')}</h3>
            <DataState query={status}><StatusStrip query={status} /></DataState>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>{t('usage.history', 'Usage History')}</h3>
          <div className="u-filters">
            <select value={fModel} onChange={e => { setFModel(e.target.value); setPage(1) }} aria-label="Model">
              <option value="">{t('usage.allModels', 'All models')}</option>
              {modelNames.map(m => <option key={m}>{m}</option>)}
            </select>
            <select value={fStatus} onChange={e => { setFStatus(e.target.value); setPage(1) }} aria-label="Status">
              <option value="">{t('usage.allStatuses', 'All statuses')}</option>
              <option value="ok">{t('usage.success', 'Success')}</option>
              <option value="err">{t('usage.failed', 'Failed')}</option>
            </select>
            {filtered && <Button variant="ghost" onClick={() => { setFModel(''); setFStatus(''); setPage(1) }}>{t('usage.clear', 'Clear filters')}</Button>}
          </div>
        </div>
        <DataState query={reqs} isEmpty={!rows.length} empty={filtered ? t('usage.noMatch', 'No requests match these filters.') : t('overview.empty', 'No requests yet')}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('overview.time', 'Time')}</th>
                  <th>{t('overview.model', 'Model')}</th>
                  <th>{t('overview.id', 'Request ID')}</th>
                  <th className="u-n">{t('overview.tokens', 'Tokens')}</th>
                  <th className="u-n">{t('usage.cost', 'Cost')}</th>
                  <th className="u-n">{t('overview.latency', 'Latency')}</th>
                  <th>{t('overview.status', 'Status')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id}>
                    <td className="muted">{fmtDateTime(r.createdAt)}</td>
                    <td>{r.modelId}</td>
                    <td><code>{r.id}</code></td>
                    <td className="u-n">{fmtNum(r.tokens)}</td>
                    <td className="u-n">{fmtMoney(r.cost, cur)}</td>
                    <td className="u-n">{fmtLatency(r.latencyMs)}</td>
                    <td><span className={`badge ${r.status < 400 ? 'ok' : 'err'}`}>{r.status < 400 ? t('usage.success', 'Success') : `${t('usage.failed', 'Failed')} ${r.status}`}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="u-pg">
            <span className="muted">{(cp - 1) * PER_PAGE + 1}–{(cp - 1) * PER_PAGE + shown.length} / {rows.length}</span>
            <div>
              <button disabled={cp === 1} onClick={() => setPage(cp - 1)} aria-label="Previous page">←</button>
              {win.map(n => <button key={n} aria-current={n === cp ? 'page' : undefined} onClick={() => setPage(n)}>{n}</button>)}
              <button disabled={cp === pages} onClick={() => setPage(cp + 1)} aria-label="Next page">→</button>
            </div>
          </div>
        </DataState>
      </div>
    </div>
  )
}