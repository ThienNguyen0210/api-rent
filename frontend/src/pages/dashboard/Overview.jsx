import { useEffect, useMemo, useRef, useState } from 'react'
import DataState from '../../components/DataState.jsx'
import { useApi } from '../../hooks/useApi.js'
import { usageApi, billingApi, keysApi } from '../../api/index.js'
import { fmtNum, fmtMoney } from '../../lib/format.js'
import { useI18n } from '../../i18n/index.jsx'
import '../../styles/overview.css'

const ICONS = {
  requests: 'M13 2L3 14h9l-1 8 10-12h-9z',
  token: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9 9h6M12 9v7',
  cost: 'M3 7h16a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 7l2-3h12M16 14h2',
  wallet: 'M20 12V8a2 2 0 00-2-2H5a2 2 0 010-4h13v4M4 6v12a2 2 0 002 2h14v-4M18 12a2 2 0 100 4h4v-4z',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M5 21h14',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeOff: 'M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22',
}
const Icon = ({ name }) => <svg className="w-i" viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name]} /></svg>

const DAY_OPTIONS = [7, 14, 30]
const PER_PAGE = 10
const MODEL_COLORS = ['#4F46E5', '#8B5CF6', '#0EA5E9', '#14B8A6', '#F59E0B', '#94A3B8']
const RANK = { ok: 0, degraded: 1, down: 2 }
const compact = n => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n ?? 0)
const int = n => Math.round(Number(n) || 0).toLocaleString()
const fmtDelta = n => n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' }) + '%'
const fmtLatency = ms => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`)
const shortDate = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })

function Sk({ w = '100%', h = 14, mt = 0 }) {
  return <span className="w-sk" style={{ width: w, height: h, marginTop: mt }} />
}

// Shows *** until the eye icon is clicked; click again to hide. Hidden by default on every page load.
function HiddenValue({ value }) {
  const { t } = useI18n()
  const [shown, setShown] = useState(false)
  const label = t(shown ? 'overview.hideBalance' : 'overview.showBalance')
  return (
    <>
      <span>{shown ? value : '*******'}</span>
      <button type="button" onClick={() => setShown(s => !s)} aria-label={label} title={label} aria-pressed={shown}
        style={{ background: 'none', border: 0, padding: 0, marginLeft: 10, cursor: 'pointer', color: 'inherit', opacity: 0.6, verticalAlign: 'middle', display: 'inline-flex' }}>
        <Icon name={shown ? 'eyeOff' : 'eye'} />
      </button>
    </>
  )
}

function Stat({ label, tip, icon, value, loading, children }) {
  return (
    <div className="w-card w-stat">
      <div className="w-lbl">
        <span>
          {label}
          {tip && <span className="w-tip" tabIndex={0} data-tip={tip} aria-label={tip}><Icon name="info" /></span>}
        </span>
        <span className="w-ico"><Icon name={icon} /></span>
      </div>
      {loading ? <><Sk w="70%" h={30} mt={14} /><Sk w="55%" h={12} mt={10} /></> : (
        <>
          <div className="w-big">{value}</div>
          <div className="w-cmp">{children}</div>
        </>
      )}
    </div>
  )
}

/** Smooth area chart: grid, axis labels, hover/touch tooltip. data: [{ label, value }] */
function AreaChart({ data, format, label, height = 260 }) {
  const box = useRef(null)
  const [w, setW] = useState(600)
  const [hover, setHover] = useState(null)
  useEffect(() => {
    if (!box.current) return
    // Measure the surrounding card rather than our own box, so a shrink-to-fit wrapper (e.g. inside DataState) cannot collapse the chart.
    const card = box.current.closest('.w-card') || box.current.parentElement
    const measure = () => setW(Math.max(280, Math.floor(card.clientWidth - 40)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(card)
    return () => ro.disconnect()
  }, [])

  const p = { l: 50, r: 12, t: 12, b: 26 }
  // Round the top of the axis up to a multiple of 4 so all 5 gridlines (0, 25%, 50%, 75%, 100%) are whole numbers.
  const max = Math.max(4, Math.ceil((Math.max(...data.map(d => d.value), 1) * 1.15) / 4) * 4)
  const x = i => p.l + (data.length > 1 ? (i * (w - p.l - p.r)) / (data.length - 1) : (w - p.l - p.r) / 2)
  const y = n => p.t + (1 - n / max) * (height - p.t - p.b)
  const pts = data.map((d, i) => [x(i), y(d.value)])
  let path = `M${pts[0]?.join(',')}`
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i - 1] || pts[i], b = pts[i], c = pts[i + 1], e = pts[i + 2] || c
    path += `C${b[0] + (c[0] - a[0]) / 6},${b[1] + (c[1] - a[1]) / 6} ${c[0] - (e[0] - b[0]) / 6},${c[1] - (e[1] - b[1]) / 6} ${c[0]},${c[1]}`
  }
  const step = Math.ceil(data.length / 7)
  const onMove = e => {
    const r = box.current.getBoundingClientRect()
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left
    const i = Math.round(((cx - p.l) / (w - p.l - p.r)) * (data.length - 1))
    setHover(Math.max(0, Math.min(data.length - 1, i)))
  }

  return (
    <div ref={box} className="w-chart" style={{ height, width: w }}>
      <svg viewBox={`0 0 ${w} ${height}`} width={w} height={height} role="img" aria-label={label}>
        <defs>
          <linearGradient id="w-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--ac)" stopOpacity=".25" />
            <stop offset="1" stopColor="var(--ac)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <g key={f}>
            <line x1={p.l} x2={w - p.r} y1={y(max * f)} y2={y(max * f)} className="w-gl" />
            <text x={p.l - 8} y={y(max * f) + 4} textAnchor="end" className="w-ax">{format(max * f)}</text>
          </g>
        ))}
        {data.map((d, i) => (i % step === 0 || i === data.length - 1) && (
          <text key={i} x={x(i)} y={height - 6} textAnchor="middle" className="w-ax">{d.label}</text>
        ))}
        <path d={`${path}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill="url(#w-fill)" />
        <path d={path} fill="none" stroke="var(--ac)" strokeWidth="2.5" strokeLinecap="round" />
        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={p.t} y2={height - p.b} className="w-gl" />
            <circle cx={x(hover)} cy={y(data[hover].value)} r="5" fill="var(--card)" stroke="var(--ac)" strokeWidth="2.5" />
          </>
        )}
        <rect x={p.l} y="0" width={w - p.l - p.r} height={height} fill="transparent"
          onMouseMove={onMove} onTouchMove={onMove} onTouchStart={onMove}
          onMouseLeave={() => setHover(null)} onTouchEnd={() => setHover(null)} />
      </svg>
      {hover != null && (
        <div className="w-tt" style={{ left: x(hover), top: y(data[hover].value) }}>
          <b>{data[hover].label}</b> · {format(data[hover].value)}
        </div>
      )}
    </div>
  )
}

function ExportMenu({ onExport }) {
  const { t } = useI18n()
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
    <div className="w-menu" ref={ref}>
      <button className="w-btn pri" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name="download" />{t('overview.export')}
      </button>
      {open && (
        <div className="w-pop" role="menu">
          {[['CSV', 'overview.exportCsv'], ['JSON', 'overview.exportJson'], ['PDF', 'overview.exportPdf']].map(([f, k]) => (
            <button key={f} role="menuitem" onClick={() => { onExport(f); setOpen(false) }}>{t(k)}</button>
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

export default function Overview() {
  const { t } = useI18n()
  const [days, setDays] = useState(7)
  const [metric, setMetric] = useState('requests')
  const [f, setF] = useState({ range: '7', model: '', key: '', status: '' })
  const [page, setPage] = useState(1)

  const usage = useApi(() => usageApi.summary(days), [days])
  const reqs = useApi(() => usageApi.requests(100))
  const bill = useApi(billingApi.get)
  const keys = useApi(keysApi.list)
  const status = useApi(usageApi.status)

  const u = usage.data, b = bill.data, cur = b?.currency
  const daily = u?.daily ?? []
  const byModel = u?.byModel ?? []
  const totalTokens = byModel.reduce((s, m) => s + m.tokens, 0)
  const keyName = useMemo(() => Object.fromEntries((keys.data ?? []).map(k => [k.id, k.name])), [keys.data])

  const worst = status.data ? ['api', 'models', 'gateway'].reduce((w, k) => (RANK[status.data[k] ?? 'down'] > RANK[w] ? (status.data[k] ?? 'down') : w), 'ok') : null

  // Credit left = balance / (balance + everything spent so far).
  const creditTotal = b ? b.balance + b.totalSpend : 0
  const creditPct = creditTotal > 0 ? Math.max(0, Math.min(100, Math.round((b.balance / creditTotal) * 100))) : 0

  const METRICS = {
    requests: { key: 'requests', fmt: fmtNum },
    input: { key: 'inputTokens', fmt: compact },
    output: { key: 'outputTokens', fmt: compact },
    cost: { key: 'tokens', fmt: int }, // total tokens consumed per day (all requests of that day)
  }
  const M = METRICS[metric]

  const delta = v => v == null ? null : <><span className={v >= 0 ? 'up' : 'down'}>{fmtDelta(v)}</span> {t('overview.vsPrev')}</>

  // History: client-side filters + pagination over the latest 100 requests.
  const all = reqs.data ?? []
  const modelNames = useMemo(() => [...new Set(all.map(r => r.modelId))], [all])
  const rows = useMemo(() => {
    const cutoff = Date.now() - Number(f.range) * 864e5
    return all.filter(r =>
      new Date(r.createdAt).getTime() >= cutoff &&
      (!f.model || r.modelId === f.model) &&
      (!f.key || r.keyId === f.key) &&
      (!f.status || (f.status === 'ok' ? r.status < 400 : r.status >= 400)))
  }, [all, f])
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE))
  const cp = Math.min(page, pages)
  const shown = rows.slice((cp - 1) * PER_PAGE, cp * PER_PAGE)
  const win = Array.from({ length: Math.min(5, pages) }, (_, i) => Math.min(Math.max(1, cp - 2), Math.max(1, pages - 4)) + i)
  const dirty = f.range !== '7' || f.model || f.key || f.status
  const setFilter = k => e => { setF(s => ({ ...s, [k]: e.target.value })); setPage(1) }

  const exportReport = fmt => {
    const stamp = new Date().toISOString().slice(0, 10)
    if (fmt === 'PDF') return window.print()
    if (fmt === 'JSON') return download(`usage-${stamp}.json`, 'application/json', JSON.stringify({ summary: u, requests: rows.map(({ cost, ...r }) => r) }, null, 2))
    const head = ['id', 'modelId', 'keyId', 'status', 'promptTokens', 'completionTokens', 'tokens', 'latencyMs', 'createdAt']
    const csv = [head.join(','), ...rows.map(r => head.map(k => JSON.stringify(r[k] ?? '')).join(','))].join('\n')
    download(`usage-${stamp}.csv`, 'text/csv', csv)
  }

  const cell = dt => {
    const d = new Date(dt)
    return <>{d.toLocaleTimeString([], { hour12: false })} <span className="w-mut" style={{ fontSize: 12.5 }}>{d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })}</span></>
  }

  return (
    <div className="w2">
      <header className="w-hd">
        <div>
          <h1>{t('overview.title')}</h1>
          <p className="w-sub">{t('overview.subtitle')}</p>
          {worst && <span className={`w-pill ${worst}`}>{t(`overview.banner.${worst}`)}</span>}
        </div>
        <div className="w-row">
          <select className="w-sel" value={days} onChange={e => setDays(Number(e.target.value))} aria-label={t('overview.filter.range')}>
            {DAY_OPTIONS.map(d => <option key={d} value={d}>{t('overview.lastDays', { n: d })}</option>)}
          </select>
          <ExportMenu onExport={exportReport} />
        </div>
      </header>

      <DataState query={usage}>
        <section className="w-grid w-g4">
          <Stat label={t('overview.totalRequests')} tip={t('overview.tip.requests')} icon="requests" loading={!u} value={fmtNum(u?.totals.requests)}>{delta(u?.change.requests)}</Stat>
          <Stat label={t('overview.tokensUsed')} tip={t('overview.tip.tokens')} icon="token" loading={!u} value={compact(u?.totals.tokens)}>{delta(u?.change.tokens)}</Stat>
          <Stat label={t('overview.tokensGranted')} tip={t('overview.tip.tokensGranted')} icon="cost" loading={!b} value={int(b?.tokensGranted)} />
          <Stat label={t('overview.remainingCredits')} tip={t('overview.tip.credits')} icon="wallet" loading={!b} value={b ? <HiddenValue value={fmtMoney(b.balance, cur)} /> : '–'}>
            {creditTotal > 0 ? (
              <>
                {t('overview.creditLeft', { pct: creditPct, total: fmtMoney(creditTotal, cur) })}
                <div className="w-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={creditPct}><div style={{ width: `${creditPct}%` }} /></div>
              </>
            ) : t('overview.noCredit')}
          </Stat>
        </section>
      </DataState>

      <div className="w-grid w-g2">
        <div className="w-card">
          <div className="w-ch">
            <h3>{t('overview.apiUsage')}</h3>
            <div className="w-seg" role="group" aria-label={t('overview.apiUsage')}>
              {Object.keys(METRICS).map(k => (
                <button key={k} aria-pressed={metric === k} onClick={() => setMetric(k)}>{t(`overview.metric.${k}`)}</button>
              ))}
            </div>
          </div>
          <DataState query={usage} isEmpty={!!u && !daily.length} empty={<div className="w-state">{t('overview.usageEmpty')}</div>}>
            {u ? <AreaChart data={daily.map(d => ({ label: shortDate(d.date), value: Math.round(d[M.key] ?? 0) }))} format={M.fmt} label={t('overview.apiUsage')} /> : <Sk h={260} />}
          </DataState>
        </div>

        <div className="w-card">
          <div className="w-ch"><h3>{t('overview.byModel')}</h3></div>
          <DataState query={usage} isEmpty={!!u && !byModel.length} empty={<div className="w-state">{t('overview.usageEmpty')}</div>}>
            {!u ? <><Sk h={40} /><Sk h={40} mt={16} /><Sk h={40} mt={16} /></> : byModel.map((m, i) => {
              const pct = totalTokens ? Math.round((m.tokens / totalTokens) * 100) : 0
              const c = MODEL_COLORS[i % MODEL_COLORS.length]
              return (
                <div key={m.modelId} className="w-mrow">
                  <div className="r"><span><i className="w-dot" style={{ background: c }} />{m.modelId}</span><span>{pct}%</span></div>
                  <div className="w-bar" role="progressbar" aria-label={m.modelId} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div style={{ width: `${pct}%`, background: c }} /></div>
                  <div className="m">{t('overview.modelMeta', { tokens: compact(m.tokens), cost: fmtMoney(m.spend, cur) })}</div>
                </div>
              )
            })}
          </DataState>
        </div>
      </div>

      <section className="w-card">
        <div className="w-ch"><h3>{t('overview.history')}</h3></div>
        <div className="w-filters">
          <label>{t('overview.filter.range')}
            <select className="w-sel" value={f.range} onChange={setFilter('range')}>
              <option value="1">{t('overview.today')}</option>
              {DAY_OPTIONS.map(d => <option key={d} value={d}>{t('overview.lastDays', { n: d })}</option>)}
            </select>
          </label>
          <label>{t('overview.filter.model')}
            <select className="w-sel" value={f.model} onChange={setFilter('model')}>
              <option value="">{t('overview.allModels')}</option>
              {modelNames.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label>{t('overview.filter.key')}
            <select className="w-sel" value={f.key} onChange={setFilter('key')}>
              <option value="">{t('overview.allKeys')}</option>
              {(keys.data ?? []).map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </label>
          <label>{t('overview.filter.status')}
            <select className="w-sel" value={f.status} onChange={setFilter('status')}>
              <option value="">{t('overview.allStatuses')}</option>
              <option value="ok">{t('overview.success')}</option>
              <option value="err">{t('overview.failed')}</option>
            </select>
          </label>
          <button className="w-linkbtn" disabled={!dirty} style={{ opacity: dirty ? 1 : .4 }}
            onClick={() => { setF({ range: '7', model: '', key: '', status: '' }); setPage(1) }}>{t('overview.clear')}</button>
        </div>

        <DataState query={reqs} isEmpty={!!reqs.data && !rows.length} empty={<div className="w-state">{dirty ? t('overview.noMatch') : t('overview.empty')}</div>}>
          {!reqs.data ? <><Sk h={36} /><Sk h={36} mt={10} /><Sk h={36} mt={10} /><Sk h={36} mt={10} /></> : (
            <>
              <div className="w-tw">
                <table className="w-table">
                  <thead>
                    <tr>
                      <th>{t('overview.col.time')}</th>
                      <th>{t('overview.col.model')}</th>
                      <th>{t('overview.col.key')}</th>
                      <th className="n">{t('overview.col.tokens')}</th>
                      <th className="n">{t('overview.col.latency')}</th>
                      <th>{t('overview.col.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(r => (
                      <tr key={r.id}>
                        <td>{cell(r.createdAt)}</td>
                        <td>{r.modelId}</td>
                        <td>{keyName[r.keyId] ? <span className="w-code">{keyName[r.keyId]}</span> : <span className="w-mut">–</span>}</td>
                        <td className="n">{fmtNum(r.tokens)}</td>
                        <td className="n">{fmtLatency(r.latencyMs)}</td>
                        <td><span className={`w-badge ${r.status < 400 ? 'ok' : 'err'}`}>{r.status < 400 ? t('overview.success') : `${t('overview.failed')} ${r.status}`}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="w-pg">
                <span>{t('overview.showing', { from: (cp - 1) * PER_PAGE + 1, to: (cp - 1) * PER_PAGE + shown.length, total: rows.length })}</span>
                <div>
                  <button disabled={cp === 1} onClick={() => setPage(cp - 1)} aria-label={t('overview.prev')}>←</button>
                  {win.map(n => <button key={n} aria-current={n === cp ? 'page' : undefined} onClick={() => setPage(n)}>{n}</button>)}
                  <button disabled={cp === pages} onClick={() => setPage(cp + 1)} aria-label={t('overview.next')}>→</button>
                </div>
              </div>
            </>
          )}
        </DataState>
      </section>
    </div>
  )
}