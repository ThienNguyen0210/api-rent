import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../i18n/index.jsx'
import { modelsApi } from '../../api/index.js' // adjust the paths if your folders differ

const FILTERS = ['all', 'chat', 'vision', 'code']
const STATUS_CLASS = { active: 'ok', maintenance: 'warn', disabled: 'off' }
const TILES = ['t-blue', 't-indigo', 't-amber', 't-sky', 't-pink', 't-teal']

const toList = res => (Array.isArray(res) ? res : res?.data ?? res?.items ?? [])
const tileOf = key => TILES[[...String(key)].reduce((a, c) => a + c.charCodeAt(0), 0) % TILES.length]
const compact = n => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))
const descOf = (m, lang) => (typeof m.description === 'string' ? m.description : m.description?.[lang] || m.description?.en || m.description?.vi || '')

function curlOf(m) {
  return `curl ${window.location.origin}${m.endpoint} \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${m.name}", "messages": [{"role": "user", "content": "Hello"}]}'`
}

function Tile({ m, big }) {
  const [broken, setBroken] = useState(false)
  return (
    <div className={`mdl-tile ${tileOf(m.key)} ${big ? 'big' : ''}`}>
      {m.image && !broken ? <img src={m.image} alt="" loading="lazy" onError={() => setBroken(true)} /> : <span>{(m.name || '?').charAt(0).toUpperCase()}</span>}
    </div>
  )
}

export default function Models() {
  const { t, lang } = useI18n()
  const [models, setModels] = useState(null) // null = loading
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const [toast, setToast] = useState('')

  const load = useCallback(() => {
    setModels(null); setError('')
    modelsApi.list().then(res => setModels(toList(res))).catch(e => { setError(e?.message || ''); setModels([]) })
  }, [])
  useEffect(load, [load])

  useEffect(() => {
    if (!selected) return
    const onKey = e => e.key === 'Escape' && setSelected(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(''), 2500)
    return () => clearTimeout(id)
  }, [toast])

  const counts = useMemo(() => {
    const c = { all: (models || []).length }
    for (const f of FILTERS.slice(1)) c[f] = (models || []).filter(m => m.category?.includes(f)).length
    return c
  }, [models])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (models || []).filter(m => {
      if (filter !== 'all' && !m.category?.includes(filter)) return false
      if (!q) return true
      return [m.name, m.provider, descOf(m, lang)].some(v => String(v || '').toLowerCase().includes(q))
    })
  }, [models, filter, query, lang])

  const copy = async text => {
    try {
      await navigator.clipboard.writeText(text)
      setToast(t('models.copied'))
    } catch {
      setToast(t('models.copyFailed'))
    }
  }

  const context = m => (m.contextTokens ? t('models.tokens', { n: compact(m.contextTokens) }) : t('models.unknown'))
  const price = m => (m.pricePer1k != null ? t('models.perTokens', { price: `$${m.pricePer1k}` }) : t('models.unknown'))
  const StatusPill = ({ m }) => <span className={`mdl-status ${STATUS_CLASS[m.status] || 'ok'}`}><i />{t(`models.status.${m.status || 'active'}`)}</span>

  return (
    <div className="mdl">
      {models === null && <p className="mdl-muted mdl-center">{t('models.loading')}</p>}

      {models !== null && error && (
        <div className="mdl-state">
          <h3>{t('models.error.title')}</h3>
          <p className="mdl-muted">{error || t('models.error.body')}</p>
          <button className="mdl-btn dark" onClick={load}>{t('models.retry')}</button>
        </div>
      )}

      {models !== null && !error && models.length === 0 && (
        <div className="mdl-state">
          <div className="mdl-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          </div>
          <h3>{t('models.empty.title')}</h3>
          <p className="mdl-muted">{t('models.empty.body')}</p>
        </div>
      )}

      {models !== null && !error && models.length > 0 && (
        <>
          <div className="mdl-head">
            <div>
              <h2>{t('models.title')} <span className="mdl-badge">{t('models.count', { count: models.length })}</span></h2>
              <p className="mdl-muted">{t('models.subtitle')}</p>
            </div>
          </div>

          <div className="mdl-toolbar">
            <div className="mdl-tabs">
              {FILTERS.map(f => (
                <button key={f} className={`mdl-tab ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
                  {t(`models.filter.${f}`)} <em>{counts[f]}</em>
                </button>
              ))}
            </div>
            <div className="mdl-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('models.search')} />
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="mdl-state">
              <h3>{t('models.noResults.title')}</h3>
              <p className="mdl-muted">{t('models.noResults.body')}</p>
            </div>
          ) : (
            <div className="mdl-grid">
              {visible.map(m => (
                <article className="mdl-card" key={m.key}>
                  <div className="mdl-top">
                    <Tile m={m} />
                    <StatusPill m={m} />
                  </div>
                  <h3>{m.name}</h3>
                  <p className="mdl-desc">{descOf(m, lang) || t('models.noDescription')}</p>
                  <div className="mdl-chips">
                    {m.contextTokens ? <span className="chip purple">{t('models.tokens', { n: compact(m.contextTokens) })}</span> : null}
                    {(m.capabilities || []).map(c => <span key={c} className="chip">{t(`models.cap.${c}`)}</span>)}
                  </div>
                  <div className="mdl-foot">
                    <span className="mdl-muted small">{t('models.provider')}: {m.provider || t('models.unknown')}</span>
                    <button className="mdl-btn dark" onClick={() => setSelected(m)}>{t('models.details')} <span aria-hidden>→</span></button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {selected && (
        <div className="mdl-overlay" onMouseDown={e => e.target === e.currentTarget && setSelected(null)}>
          <div className="mdl-modal" role="dialog" aria-modal="true" aria-label={selected.name}>
            <div className="mdl-mhead">
              <Tile m={selected} big />
              <div className="mdl-mtitle">
                <StatusPill m={selected} />
                <h2>{selected.name}</h2>
              </div>
              <button className="mdl-x" onClick={() => setSelected(null)} aria-label={t('models.close')}>×</button>
            </div>

            <h4>{t('models.description')}</h4>
            <p className="mdl-mdesc">{descOf(selected, lang) || t('models.noDescription')}</p>

            <div className="mdl-facts">
              <div><span>{t('models.provider')}</span><b>{selected.provider || t('models.unknown')}</b></div>
              <div><span>{t('models.context')}</span><b>{context(selected)}</b></div>
              <div><span>{t('models.pricing')}</span><b>{price(selected)}</b></div>
              <div><span>{t('models.endpoint')}</span><code>{selected.endpoint}</code></div>
            </div>

            {selected.capabilities?.length > 0 && (
              <>
                <h4>{t('models.capabilities')}</h4>
                <div className="mdl-chips">{selected.capabilities.map(c => <span key={c} className="chip">{t(`models.cap.${c}`)}</span>)}</div>
              </>
            )}

            <h4>{t('models.modelName')}</h4>
            <div className="mdl-copyrow">
              <code>{selected.name}</code>
              <button className="mdl-btn blue" onClick={() => copy(selected.name)}>{t('models.copy')}</button>
            </div>

            <h4>{t('models.sample')}</h4>
            <div className="mdl-code">
              <pre>{curlOf(selected)}</pre>
              <button className="mdl-btn blue" onClick={() => copy(curlOf(selected))}>{t('models.copy')}</button>
            </div>

            <div className="mdl-mfoot"><button className="mdl-btn light" onClick={() => setSelected(null)}>{t('models.close')}</button></div>
          </div>
        </div>
      )}

      <div className={`mdl-toast ${toast ? 'show' : ''}`} role="status">{toast}</div>

      <style>{CSS}</style>
    </div>
  )
}

/*
 * Theming: the dashboard sets data-theme="light|dark" on the .dash wrapper
 * (ThemeContext). All colours below come from CSS variables that are defined
 * per theme, so every component follows the theme toggle.
 */
const CSS = `
/* ---------- Light theme (default) ---------- */
.mdl{
  --m-text:#0f172a;--m-card:#ffffff;--m-border:#e2e8f0;--m-head:#1e293b;--m-muted:#64748b;--m-soft:#f1f5f9;
  --m-accent:#2563eb;--m-accent-hover:#1d4ed8;--m-accent-ring:rgba(37,99,235,.15);--m-card-hover-border:#93c5fd;
  --m-shadow:rgba(0,0,0,.04);--m-glow:rgba(37,99,235,.35);
  --m-badge-bg:#dbeafe;--m-badge-fg:#1d4ed8;
  --m-btn-dark:#0f172a;--m-btn-dark-hover:#2563eb;
  --m-chip-purple-bg:#f3e8ff;--m-chip-purple-fg:#7e22ce;--m-chip-purple-bd:#e9d5ff;
  --m-ok-bg:#ecfdf5;--m-ok-fg:#059669;--m-ok-bd:#a7f3d0;
  --m-warn-bg:#fffbeb;--m-warn-fg:#b45309;--m-warn-bd:#fde68a;
  --m-off-bg:#f1f5f9;--m-off-fg:#64748b;--m-off-bd:#cbd5e1;
  --m-code-bg:#0f172a;--m-code-fg:#34d399;
  --m-inline-code-fg:#2563eb;--m-inline-code-bg:rgba(37,99,235,.1);
  --m-overlay:rgba(15,23,42,.6);--m-modal-shadow:rgba(0,0,0,.4);
  --m-toast-bg:#0f172a;--m-toast-fg:#fff;
  --m-state-icon:#4f46e5;
  color-scheme:light;
}
/* ---------- Dark theme ---------- */
[data-theme="dark"] .mdl{
  --m-text:#e2e8f0;--m-card:#161f30;--m-border:#212e45;--m-head:#f1f5f9;--m-muted:#94a3b8;--m-soft:#1e293b;
  --m-accent:#3b82f6;--m-accent-hover:#2563eb;--m-accent-ring:rgba(59,130,246,.25);--m-card-hover-border:#3b82f6;
  --m-shadow:rgba(0,0,0,.35);--m-glow:rgba(59,130,246,.35);
  --m-badge-bg:rgba(59,130,246,.18);--m-badge-fg:#93c5fd;
  --m-btn-dark:#2563eb;--m-btn-dark-hover:#3b82f6;
  --m-chip-purple-bg:rgba(168,85,247,.16);--m-chip-purple-fg:#d8b4fe;--m-chip-purple-bd:rgba(168,85,247,.35);
  --m-ok-bg:rgba(16,185,129,.14);--m-ok-fg:#6ee7b7;--m-ok-bd:rgba(16,185,129,.35);
  --m-warn-bg:rgba(245,158,11,.14);--m-warn-fg:#fcd34d;--m-warn-bd:rgba(245,158,11,.35);
  --m-off-bg:rgba(148,163,184,.14);--m-off-fg:#cbd5e1;--m-off-bd:rgba(148,163,184,.3);
  --m-code-bg:#0b1220;--m-code-fg:#34d399;
  --m-inline-code-fg:#93c5fd;--m-inline-code-bg:rgba(147,197,253,.12);
  --m-overlay:rgba(2,6,23,.75);--m-modal-shadow:rgba(0,0,0,.7);
  --m-toast-bg:#e2e8f0;--m-toast-fg:#0f172a;
  --m-state-icon:#818cf8;
  color-scheme:dark;
}

.mdl{color:var(--m-text);width:100%}
.mdl *{box-sizing:border-box}
.mdl h2,.mdl h3,.mdl h4,.mdl p{margin:0}
.mdl-muted{color:var(--m-muted);font-size:.9rem}.mdl-muted.small{font-size:.78rem}.mdl-center{text-align:center;padding:3rem 0}
.mdl-head{margin-bottom:1rem}
.mdl-head h2{font-size:1.4rem;font-weight:700;color:var(--m-head);display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.mdl-badge{font-size:.72rem;font-weight:600;padding:.2rem .6rem;border-radius:999px;background:var(--m-badge-bg);color:var(--m-badge-fg)}
.mdl-toolbar{display:flex;flex-wrap:wrap;gap:.9rem;align-items:center;justify-content:space-between;background:var(--m-card);border:1px solid var(--m-border);border-radius:16px;padding:.9rem 1rem;margin-bottom:1.25rem;box-shadow:0 1px 2px var(--m-shadow)}
.mdl-tabs{display:flex;gap:.5rem;overflow-x:auto;max-width:100%;padding-bottom:2px}
.mdl-tab{border:0;cursor:pointer;white-space:nowrap;padding:.5rem .9rem;border-radius:12px;font-size:.85rem;font-weight:500;background:var(--m-soft);color:var(--m-muted);transition:.15s}
.mdl-tab:hover{color:var(--m-head);filter:brightness(1.08)}
.mdl-tab em{font-style:normal;font-size:.72rem;opacity:.7;margin-left:.25rem}
.mdl-tab.on{background:var(--m-accent);color:#fff;font-weight:600;box-shadow:0 2px 6px var(--m-glow)}
.mdl-search{position:relative;min-width:240px;flex:1;max-width:340px}
.mdl-search svg{position:absolute;left:.8rem;top:50%;width:16px;height:16px;transform:translateY(-50%);color:var(--m-muted)}
.mdl-search input{width:100%;padding:.6rem .9rem .6rem 2.3rem;border-radius:12px;border:1px solid var(--m-border);background:var(--m-soft);color:var(--m-text);font-size:.88rem;outline:none;transition:.15s}
.mdl-search input::placeholder{color:var(--m-muted);opacity:.8}
.mdl-search input:focus{background:var(--m-card);border-color:var(--m-accent);box-shadow:0 0 0 3px var(--m-accent-ring)}
.mdl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.25rem}
.mdl-card{position:relative;overflow:hidden;display:flex;flex-direction:column;background:var(--m-card);border:1px solid var(--m-border);border-radius:20px;padding:1.4rem;box-shadow:0 1px 2px var(--m-shadow);transition:transform .2s,box-shadow .2s,border-color .2s}
.mdl-card::before{content:"";position:absolute;top:0;right:0;width:96px;height:96px;border-bottom-left-radius:100%;background:linear-gradient(to bottom left,rgba(59,130,246,.14),transparent);pointer-events:none}
.mdl-card:hover{transform:translateY(-3px);box-shadow:0 14px 30px -12px var(--m-glow);border-color:var(--m-card-hover-border)}
.mdl-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem}
.mdl-card h3{font-size:1.1rem;font-weight:700;color:var(--m-head);margin-bottom:.3rem;word-break:break-word;transition:color .15s}
.mdl-card:hover h3{color:var(--m-accent)}
.mdl-desc{color:var(--m-muted);font-size:.88rem;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.6em;margin-bottom:1rem}
.mdl-chips{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:1.2rem}
.chip{font-size:.72rem;font-weight:500;padding:.2rem .55rem;border-radius:8px;background:var(--m-soft);color:var(--m-muted);border:1px solid var(--m-border)}
.chip.purple{background:var(--m-chip-purple-bg);color:var(--m-chip-purple-fg);border-color:var(--m-chip-purple-bd)}
.mdl-foot{margin-top:auto;padding-top:1rem;border-top:1px solid var(--m-border);display:flex;align-items:center;justify-content:space-between;gap:.6rem}
.mdl-tile{flex:0 0 auto;width:56px;height:56px;border-radius:16px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.5rem;overflow:hidden;box-shadow:0 4px 10px rgba(0,0,0,.2);transition:transform .25s}
.mdl-card:hover .mdl-tile{transform:scale(1.07)}
.mdl-tile.big{width:48px;height:48px;font-size:1.3rem;border-radius:14px}
.mdl-tile img{width:100%;height:100%;object-fit:cover}
.t-blue{background:linear-gradient(135deg,#2563eb,#38bdf8)}.t-indigo{background:linear-gradient(135deg,#4f46e5,#8b5cf6)}.t-amber{background:linear-gradient(135deg,#d97706,#fbbf24)}
.t-sky{background:linear-gradient(135deg,#0284c7,#22d3ee)}.t-pink{background:linear-gradient(135deg,#db2777,#fb7185)}.t-teal{background:linear-gradient(135deg,#0d9488,#34d399)}
.mdl-status{display:inline-flex;align-items:center;gap:.4rem;font-size:.72rem;font-weight:600;padding:.25rem .65rem;border-radius:999px;border:1px solid}
.mdl-status i{width:6px;height:6px;border-radius:50%;background:currentColor}
.mdl-status.ok{color:var(--m-ok-fg);background:var(--m-ok-bg);border-color:var(--m-ok-bd)}
.mdl-status.warn{color:var(--m-warn-fg);background:var(--m-warn-bg);border-color:var(--m-warn-bd)}
.mdl-status.off{color:var(--m-off-fg);background:var(--m-off-bg);border-color:var(--m-off-bd)}
.mdl-btn{border:0;cursor:pointer;border-radius:12px;font-size:.78rem;font-weight:600;padding:.55rem .95rem;transition:.15s;display:inline-flex;align-items:center;gap:.4rem;white-space:nowrap}
.mdl-btn.dark{background:var(--m-btn-dark);color:#fff}.mdl-btn.dark:hover{background:var(--m-btn-dark-hover)}
.mdl-btn.blue{background:var(--m-accent);color:#fff}.mdl-btn.blue:hover{background:var(--m-accent-hover)}
.mdl-btn.light{background:var(--m-soft);color:var(--m-head);font-size:.85rem;padding:.6rem 1.2rem;border:1px solid var(--m-border)}.mdl-btn.light:hover{filter:brightness(1.08)}
.mdl-state{margin:2rem auto;text-align:center;max-width:400px;background:var(--m-card);border:1px solid var(--m-border);border-radius:16px;padding:2.5rem 2rem;box-shadow:0 4px 6px -1px var(--m-shadow);display:flex;flex-direction:column;align-items:center;gap:.5rem}
.mdl-state h3{font-size:1.2rem;color:var(--m-head)}
.mdl-state .mdl-btn{margin-top:.8rem}
.mdl-state-icon{width:48px;height:48px;border-radius:12px;background:var(--m-soft);color:var(--m-state-icon);display:flex;align-items:center;justify-content:center;margin-bottom:.5rem}
.mdl-state-icon svg{width:24px;height:24px}
.mdl-overlay{position:fixed;inset:0;z-index:1000;background:var(--m-overlay);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:1rem;animation:mdlFade .2s}
.mdl-modal{background:var(--m-card);color:var(--m-text);border:1px solid var(--m-border);border-radius:24px;width:100%;max-width:560px;max-height:92vh;overflow-y:auto;padding:1.5rem;box-shadow:0 25px 50px -12px var(--m-modal-shadow);animation:mdlPop .22s}
.mdl-mhead{display:flex;align-items:center;gap:.9rem;padding-bottom:1rem;border-bottom:1px solid var(--m-border);margin-bottom:1rem}
.mdl-mtitle{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:.35rem}
.mdl-mtitle h2{font-size:1.25rem;font-weight:700;color:var(--m-head);word-break:break-word}
.mdl-x{border:0;cursor:pointer;width:32px;height:32px;border-radius:50%;background:var(--m-soft);color:var(--m-muted);font-size:1.3rem;line-height:1;transition:.15s}
.mdl-x:hover{color:var(--m-head);filter:brightness(1.1)}
.mdl-modal h4{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--m-muted);margin:1.1rem 0 .45rem}
.mdl-mdesc{font-size:.9rem;line-height:1.6;color:var(--m-text)}
.mdl-facts{display:grid;grid-template-columns:1fr 1fr;gap:.9rem;margin-top:1rem;padding:1rem;background:var(--m-soft);border:1px solid var(--m-border);border-radius:16px}
.mdl-facts span{display:block;font-size:.72rem;color:var(--m-muted);margin-bottom:.15rem}.mdl-facts b{font-size:.88rem;color:var(--m-head)}
.mdl-facts code,.mdl-copyrow code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.74rem;color:var(--m-inline-code-fg);background:var(--m-inline-code-bg);padding:.15rem .45rem;border-radius:6px;word-break:break-all}
.mdl-copyrow{display:flex;align-items:center;justify-content:space-between;gap:.6rem}
.mdl-copyrow code{font-size:.82rem}
.mdl-code{position:relative;background:var(--m-code-bg);border:1px solid var(--m-border);border-radius:14px;padding:.9rem 1rem}
.mdl-code pre{margin:0;color:var(--m-code-fg);font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.72rem;line-height:1.55;overflow-x:auto;white-space:pre;padding-right:4.5rem}
.mdl-code .mdl-btn{position:absolute;top:.6rem;right:.6rem;padding:.35rem .7rem}
.mdl-mfoot{display:flex;justify-content:flex-end;margin-top:1.3rem;padding-top:1rem;border-top:1px solid var(--m-border)}
.mdl-toast{position:fixed;right:1.5rem;bottom:1.5rem;z-index:1100;background:var(--m-toast-bg);color:var(--m-toast-fg);padding:.75rem 1.1rem;border-radius:14px;font-size:.85rem;font-weight:500;box-shadow:0 10px 25px rgba(0,0,0,.3);transform:translateY(80px);opacity:0;pointer-events:none;transition:.3s}
.mdl-toast.show{transform:none;opacity:1}
@keyframes mdlFade{from{opacity:0}to{opacity:1}}
@keyframes mdlPop{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:none}}
@media (max-width:560px){.mdl-facts{grid-template-columns:1fr}.mdl-search{max-width:none}}
`