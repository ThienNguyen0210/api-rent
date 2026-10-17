import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApi } from '../../hooks/useApi.js'
import { keysApi } from '../../api/index.js'
import { useI18n } from '../../i18n/index.jsx'

// AI cache of an API key: every successful call is stored as an input/output pair (max 300). With the cache switched on,
// a new input whose embedding is at least `threshold` similar to a stored one gets that stored output back instantly.
const fmt = d => (d ? new Date(d).toLocaleString() : '-')
const toNum = v => { const n = Number(v); return Number.isFinite(n) ? n : NaN }

export default function Cache() {
  const { t } = useI18n()
  const msg = e => e?.message || t('cache.error')
  const keysQ = useApi(keysApi.list)
  const [params, setParams] = useSearchParams() // ?key=<id> comes from the "AI Cache" item in the API keys menu
  const [keyId, setKeyId] = useState(params.get('key') || '')
  useEffect(() => {
    const list = keysQ.data
    if (list?.length && !list.some(k => k.id === keyId)) setKeyId(list[0].id)
  }, [keysQ.data, keyId])

  const q = useApi(() => (keyId ? keysApi.cache(keyId) : Promise.resolve(null)), [keyId])
  const c = q.data

  const [thr, setThr] = useState(0.85)
  useEffect(() => { if (c) setThr(c.threshold) }, [c?.threshold, keyId])

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ input: '', output: '', threshold: '' })
  const [editId, setEditId] = useState(null)
  const [edit, setEdit] = useState({ input: '', output: '', threshold: '' })

  const act = async fn => {
    setBusy(true); setErr('')
    try { await fn(); q.reload(); return true } catch (e) { setErr(msg(e)); return false } finally { setBusy(false) }
  }
  // '' = "use the global threshold" (null); otherwise a number 0.5-1.
  const thrOf = s => {
    if (String(s).trim() === '') return null
    const n = toNum(s)
    if (!(n >= 0.5 && n <= 1)) throw new Error(t('cache.thrRange'))
    return n
  }

  const saveSettings = patch => act(() => keysApi.setCacheSettings(keyId, patch))
  const create = async () => {
    const ok = await act(async () => {
      await keysApi.createCacheEntry(keyId, { input: draft.input, output: draft.output, threshold: thrOf(draft.threshold) })
    })
    if (ok) { setDraft({ input: '', output: '', threshold: '' }); setAdding(false) }
  }
  const startEdit = it => { setEditId(it.id); setEdit({ input: it.input, output: it.output, threshold: it.threshold == null ? '' : String(it.threshold) }) }
  const saveEdit = async () => {
    const ok = await act(() => keysApi.updateCacheEntry(keyId, editId, { input: edit.input, output: edit.output, threshold: thrOf(edit.threshold) }))
    if (ok) setEditId(null)
  }
  const remove = id => act(() => keysApi.removeCacheEntry(keyId, id))
  const clearAll = () => { if (window.confirm(t('cache.confirmClear'))) act(() => keysApi.clearCache(keyId)) }

  if (keysQ.loading) return <p>{t('cache.loading')}</p>
  if (!keysQ.data?.length) return <div className="card"><p>{t('cache.noKeys')}</p></div>

  return (
    <div className="cache-page">
      <style>{`
        .cache-page .card{padding:16px;margin-bottom:16px}
        .cache-page .row-gap{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
        .cache-page textarea,.cache-page input[type=text],.cache-page input[type=number],.cache-page select{width:100%;box-sizing:border-box;padding:8px;border:1px solid rgba(128,128,128,.35);border-radius:6px;background:transparent;color:inherit;font:inherit}
        .cache-page textarea{min-height:90px;resize:vertical}
        .cache-page .pair{border-top:1px solid rgba(128,128,128,.25);padding:12px 0}
        .cache-page .pair:first-child{border-top:0}
        .cache-page .lbl{font-size:12px;opacity:.65;margin:6px 0 2px}
        .cache-page .txt{white-space:pre-wrap;word-break:break-word;max-height:140px;overflow:auto}
        .cache-page .meta{font-size:12px;opacity:.7;display:flex;gap:12px;flex-wrap:wrap;margin-top:6px}
        .cache-page .err{color:#dc2626;margin:8px 0}
        .cache-page .tag{font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid rgba(128,128,128,.4)}
      `}</style>

      <div className="card">
        <div className="row-gap">
          <label>{t('cache.apiKey')}&nbsp;
            <select value={keyId} onChange={e => { setKeyId(e.target.value); setParams({ key: e.target.value }, { replace: true }); setEditId(null); setErr('') }} style={{ width: 'auto' }}>
              {keysQ.data.map(k => <option key={k.id} value={k.id}>{k.name} ({k.prefix}…)</option>)}
            </select>
          </label>
          {c && (
            <label className="row-gap" style={{ gap: 6 }}>
              <input type="checkbox" checked={c.enabled} disabled={busy} onChange={e => saveSettings({ enabled: e.target.checked })} />
              <strong>{t('cache.enable')}</strong>
            </label>
          )}
        </div>

        {c && (
          <>
            <p style={{ opacity: .75, margin: '12px 0 8px' }}>
              {t('cache.intro', { max: c.max })}
            </p>
            <div className="row-gap">
              <label>{t('cache.globalThr')} <strong>{Number(thr).toFixed(2)}</strong></label>
              <input type="range" min="0.5" max="1" step="0.01" value={thr} onChange={e => setThr(toNum(e.target.value))} style={{ flex: '1 1 200px' }} />
              <button type="button" className="btn" disabled={busy || thr === c.threshold} onClick={() => saveSettings({ threshold: thr })}>{t('keys.save')}</button>
            </div>
            <p style={{ fontSize: 12, opacity: .65, margin: '4px 0 0' }}>
              {t('cache.thrHint')}
            </p>
          </>
        )}
        {err && <div className="err">{err}</div>}
      </div>

      <div className="card">
        <div className="row-gap" style={{ justifyContent: 'space-between' }}>
          <strong>{t('cache.pairs')} {c ? `(${c.items.length}/${c.max})` : ''}</strong>
          <div className="row-gap">
            <button type="button" className="btn" disabled={busy || !c || c.items.length >= c.max} onClick={() => setAdding(a => !a)}>{adding ? t('common.cancel') : t('cache.add')}</button>
            <button type="button" className="btn btn-ghost" disabled={busy || !c?.items.length} onClick={clearAll}>{t('cache.clearAll')}</button>
          </div>
        </div>

        {adding && (
          <div className="pair">
            <div className="lbl">{t('cache.input')}</div>
            <textarea value={draft.input} onChange={e => setDraft({ ...draft, input: e.target.value })} />
            <div className="lbl">{t('cache.output')}</div>
            <textarea value={draft.output} onChange={e => setDraft({ ...draft, output: e.target.value })} />
            <div className="lbl">{t('cache.pairThr')}</div>
            <input type="number" min="0.5" max="1" step="0.01" value={draft.threshold} onChange={e => setDraft({ ...draft, threshold: e.target.value })} style={{ maxWidth: 160 }} />
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn" disabled={busy || !draft.input.trim() || !draft.output.trim()} onClick={create}>{t('cache.savePair')}</button>
            </div>
          </div>
        )}

        {q.loading && !c && <p>{t('cache.loading')}</p>}
        {c && !c.items.length && !adding && <p style={{ opacity: .7 }}>{t('cache.empty')}</p>}

        {c?.items.map(it => (
          <div className="pair" key={it.id}>
            {editId === it.id ? (
              <>
                <div className="lbl">{t('cache.input')}</div>
                <textarea value={edit.input} onChange={e => setEdit({ ...edit, input: e.target.value })} />
                <div className="lbl">{t('cache.output')}</div>
                <textarea value={edit.output} onChange={e => setEdit({ ...edit, output: e.target.value })} />
                <div className="lbl">{t('cache.pairThr')}</div>
                <input type="number" min="0.5" max="1" step="0.01" value={edit.threshold} onChange={e => setEdit({ ...edit, threshold: e.target.value })} style={{ maxWidth: 160 }} />
                <div className="row-gap" style={{ marginTop: 8 }}>
                  <button type="button" className="btn" disabled={busy || !edit.input.trim() || !edit.output.trim()} onClick={saveEdit}>{t('keys.save')}</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setEditId(null)}>{t('common.cancel')}</button>
                </div>
              </>
            ) : (
              <>
                <div className="lbl">{t('cache.input')}</div>
                <div className="txt">{it.input}</div>
                <div className="lbl">{t('cache.output')}</div>
                <div className="txt">{it.output}</div>
                <div className="meta">
                  <span className="tag">{t(it.manual ? 'cache.manual' : 'cache.auto')}</span>
                  <span>{t('cache.metaThreshold', { value: it.threshold == null ? t('cache.global', { value: c.threshold.toFixed(2) }) : it.threshold.toFixed(2) })}</span>
                  <span>{t('cache.metaModel', { value: it.modelId === '*' ? t('cache.anyModel') : it.modelId })}</span>
                  <span>{t('cache.metaHits', { n: it.hits })}</span>
                  <span>{t('cache.metaLastHit', { value: fmt(it.lastHitAt) })}</span>
                  <span>{t('cache.metaSaved', { value: fmt(it.createdAt) })}</span>
                </div>
                <div className="row-gap" style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => startEdit(it)}>{t('cache.edit')}</button>
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => remove(it.id)}>{t('keys.delete')}</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}