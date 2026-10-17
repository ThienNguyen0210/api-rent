import { useEffect, useMemo, useState } from 'react'
import Button from '../../components/Button.jsx'
import DataState from '../../components/DataState.jsx'
import { useApi } from '../../hooks/useApi.js'
import { notesApi } from '../../api/index.js'
import { useI18n, getLang } from '../../i18n/index.jsx'

// Keep in sync with MAX_NOTES and the zod limits in the server (routes/notes.js, services/notesService.js).
const MAX_NOTES = 20
const MAX_TITLE = 150
const MAX_CONTENT = 10000

const fmtDateTime = iso => {
  try {
    return new Intl.DateTimeFormat(getLang() === 'vi' ? 'vi-VN' : undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  } catch { return String(iso) }
}
// updatedAt starts equal to createdAt; treat a gap of under 2s as "never edited".
const wasEdited = n => new Date(n.updatedAt).getTime() - new Date(n.createdAt).getTime() > 2000

const TONES = { error: '#ef4444' }

const overlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(8,12,20,0.55)', backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: '16px',
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', background: 'var(--bg, transparent)', color: 'inherit',
  border: '1px solid var(--border, #ccc)', borderRadius: '8px', font: 'inherit',
}

const CSS = `
.nt{--nt-line:var(--border,rgba(128,128,128,.28));--nt-soft:rgba(128,128,128,.08);--nt-warn:#d97706;--nt-bad:#ef4444;display:flex;flex-direction:column;gap:20px}
.nt h2,.nt h3,.nt p{margin:0}
.nt button:focus-visible,.nt input:focus-visible,.nt textarea:focus-visible{outline:2px solid var(--accent,#3b82f6);outline-offset:2px}
.nt-panel{border:1px solid var(--nt-line);border-radius:16px;background:var(--card-bg,var(--bg-card,transparent));overflow:hidden}
.nt-head{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;padding:24px}
.nt-head h2{font-size:1.6rem;letter-spacing:-.02em;line-height:1.2}
.nt-sub{opacity:.7;margin-top:6px!important;max-width:62ch;line-height:1.55}
.nt-meter{display:flex;align-items:center;gap:10px;margin-top:16px;font-size:.85rem;font-variant-numeric:tabular-nums}
.nt-meter-bar{width:180px;max-width:50vw;height:6px;border-radius:99px;background:var(--nt-soft);overflow:hidden}
.nt-meter-bar i{display:block;height:100%;border-radius:99px;background:var(--accent,#3b82f6);transition:width .4s ease}
.nt-tools{padding:0 24px 20px}
.nt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;padding:20px 24px 24px;border-top:1px solid var(--nt-line)}
.nt-card{display:flex;flex-direction:column;gap:10px;min-height:170px;padding:16px;border:1px solid var(--nt-line);border-radius:14px;background:var(--nt-soft);cursor:pointer;transition:transform .15s,box-shadow .15s,border-color .15s}
.nt-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.14);border-color:var(--accent,#3b82f6)}
.nt-card:focus-visible{outline:2px solid var(--accent,#3b82f6);outline-offset:2px}
.nt-card h3{font-size:1rem;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nt-card h3.muted{opacity:.55;font-weight:500}
.nt-body{flex:1;margin:0;white-space:pre-wrap;word-break:break-word;line-height:1.5;font-size:.92rem;opacity:.85;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
.nt-foot{display:flex;align-items:flex-end;justify-content:space-between;gap:8px}
.nt-dates{font-size:.76rem;opacity:.6;line-height:1.5}
.nt-actions{display:flex;gap:2px;flex:none}
.nt-ib{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:8px;border:0;background:transparent;color:inherit;cursor:pointer;opacity:.7;transition:background .15s,opacity .15s}
.nt-ib:hover{background:rgba(128,128,128,.18);opacity:1}
.nt-ib.bad:hover{background:rgba(239,68,68,.14);color:var(--nt-bad)}
.nt-empty{display:flex;flex-direction:column;align-items:center;gap:14px;padding:56px 24px;text-align:center;border-top:1px solid var(--nt-line)}
.nt-badge{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;margin:0 auto;background:var(--nt-soft)}
.nt-badge.bad{background:rgba(239,68,68,.12);color:var(--nt-bad)}
.nt-badge.info{background:rgba(59,130,246,.12);color:var(--accent,#3b82f6)}
.nt-search{position:relative;max-width:360px}
.nt-search svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);opacity:.55;pointer-events:none}
.nt-label{display:block;font-size:.85rem;font-weight:600;margin:0 0 6px}
.nt-count{font-size:.78rem;opacity:.6;text-align:right;margin-top:4px;font-variant-numeric:tabular-nums}
.nt-count.bad{color:var(--nt-bad);opacity:1}
@media (prefers-reduced-motion:reduce){.nt *{transition:none!important}.nt-card:hover{transform:none}}
`

const Svg = ({ children, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)
const PlusI = () => <Svg><path d="M12 5v14M5 12h14" /></Svg>
const EditI = () => <Svg><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></Svg>
const TrashI = () => <Svg><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" /></Svg>
const SearchI = () => <Svg><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></Svg>
const NoteI = ({ size = 22 }) => <Svg size={size}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></Svg>
const WarnI = () => <Svg><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18v.01" /></Svg>

function Modal({ children, onClose, width = 520 }) {
  useEffect(() => {
    if (!onClose) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div style={overlayStyle} onMouseDown={e => { if (onClose && e.target === e.currentTarget) onClose() }}>
      <div className="card" role="dialog" aria-modal="true"
        style={{ maxWidth: width, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '28px', borderRadius: '18px', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>
        {children}
      </div>
    </div>
  )
}

const ErrorBox = ({ children }) => (
  <div role="alert" style={{
    margin: '4px 0 16px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px',
    color: TONES.error, background: 'rgba(239,68,68,0.1)', border: '1px solid ' + TONES.error,
  }}>{children}</div>
)

// Create (note === null) or edit one note.
function NoteModal({ note, onClose, onSaved, onLimit }) {
  const { t } = useI18n()
  const [title, setTitle] = useState(note?.title || '')
  const [content, setContent] = useState(note?.content || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (saving) return
    if (!title.trim() && !content.trim()) return setError(t('notes.needContent'))
    setSaving(true); setError('')
    try {
      const body = { title: title.trim(), content }
      if (note) await notesApi.update(note.id, body)
      else await notesApi.create(body)
      onSaved()
    } catch (e) {
      if (e.status === 409) return onLimit()
      setError(e.message); setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="nt-badge info"><NoteI /></div>
      <h3 style={{ margin: '14px 0 18px', textAlign: 'center' }}>{note ? t('notes.editTitle') : t('notes.newTitle')}</h3>

      <label className="nt-label" htmlFor="nt-title">{t('notes.titleLabel')}</label>
      <input id="nt-title" autoFocus value={title} maxLength={MAX_TITLE} placeholder={t('notes.titlePh')}
        onChange={e => { setTitle(e.target.value); if (error) setError('') }}
        style={{ ...inputStyle, marginBottom: 16 }} />

      <label className="nt-label" htmlFor="nt-content">{t('notes.contentLabel')}</label>
      <textarea id="nt-content" rows={9} value={content} maxLength={MAX_CONTENT} placeholder={t('notes.contentPh')}
        onChange={e => { setContent(e.target.value); if (error) setError('') }}
        onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save() }}
        style={{ ...inputStyle, resize: 'vertical', minHeight: 140, maxHeight: 360, lineHeight: 1.55 }} />
      <div className={`nt-count${content.length >= MAX_CONTENT ? ' bad' : ''}`}>{content.length.toLocaleString()}/{MAX_CONTENT.toLocaleString()}</div>

      {error && <div style={{ marginTop: 12 }}><ErrorBox>{error}</ErrorBox></div>}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
        <span style={{ fontSize: '.78rem', opacity: 0.55 }}>{t('notes.hintSave')}</span>
        <div className="row" style={{ gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={save} disabled={saving}>{t('notes.save')}</Button>
        </div>
      </div>
    </Modal>
  )
}

// Delete confirmation or an error message (replaces window.confirm / alert).
function NoticeDialog({ dialog, onClose }) {
  const { t } = useI18n()
  const { title, message, confirmLabel, onConfirm } = dialog
  const confirming = typeof onConfirm === 'function'
  return (
    <Modal onClose={onClose} width={420}>
      <div className="nt-badge bad"><WarnI /></div>
      <h3 style={{ margin: '14px 0 8px', textAlign: 'center' }}>{title}</h3>
      {message && <p style={{ marginBottom: 16, textAlign: 'center', opacity: 0.8, lineHeight: 1.5, wordBreak: 'break-word' }}>{message}</p>}
      <div className="row" style={{ justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Button variant={confirming ? 'ghost' : undefined} onClick={onClose}>{confirming ? t('common.cancel') : t('common.close')}</Button>
        {confirming && (
          <Button onClick={() => { onClose(); onConfirm() }} style={{ background: TONES.error, borderColor: TONES.error }}>
            {confirmLabel}
          </Button>
        )}
      </div>
    </Modal>
  )
}

export default function Notes() {
  const { t } = useI18n()
  const notes = useApi(notesApi.list)
  const [editing, setEditing] = useState(undefined) // undefined = closed, null = new note, object = editing that note
  const [dialog, setDialog] = useState(null)
  const [q, setQ] = useState('')

  const list = notes.data?.items || []
  const max = notes.data?.max || MAX_NOTES
  const full = list.length >= max
  const pct = Math.min(100, Math.round((list.length / max) * 100))

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return list
    return list.filter(n => n.title.toLowerCase().includes(needle) || n.content.toLowerCase().includes(needle))
  }, [list, q])

  const closeDialog = () => setDialog(null)
  const showLimit = () => { setEditing(undefined); notes.reload(); setDialog({ title: t('notes.errorTitle'), message: t('notes.limit', { max }) }) }

  const remove = n => setDialog({
    title: t('notes.deleteTitle'),
    message: t('notes.deleteBody', { name: n.title || t('notes.untitled') }),
    confirmLabel: t('notes.delete'),
    onConfirm: async () => {
      try { await notesApi.remove(n.id); notes.reload() }
      catch (e) { setDialog({ title: t('notes.errorTitle'), message: e.message }) }
    },
  })

  return (
    <div className="nt">
      <style>{CSS}</style>

      <section className="nt-panel">
        <div className="nt-head">
          <div>
            <h2>{t('notes.title')}</h2>
            <p className="nt-sub">{t('notes.desc', { max })}</p>
            <div className="nt-meter" title={`${list.length}/${max}`}>
              <div className="nt-meter-bar"><i style={{ width: pct + '%', background: full ? 'var(--nt-warn)' : undefined }} /></div>
              <span>{list.length}/{max}</span>
            </div>
          </div>
          <Button onClick={() => setEditing(null)} disabled={full}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><PlusI />{t('notes.create')}</span>
          </Button>
        </div>

        {full && <div className="alert" style={{ margin: '0 24px 24px' }}>{t('notes.limit', { max })}</div>}

        {list.length > 0 && (
          <div className="nt-tools">
            <div className="nt-search">
              <SearchI />
              <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('notes.search')} aria-label={t('notes.search')} style={{ ...inputStyle, paddingLeft: 38 }} />
            </div>
          </div>
        )}

        {dialog && <NoticeDialog dialog={dialog} onClose={closeDialog} />}

        {editing !== undefined && (
          <NoteModal note={editing} onClose={() => setEditing(undefined)} onLimit={showLimit}
            onSaved={() => { setEditing(undefined); notes.reload() }} />
        )}

        <DataState query={notes}>
          {!list.length ? (
            <div className="nt-empty">
              <div className="nt-badge"><NoteI /></div>
              <p style={{ opacity: 0.75, maxWidth: '40ch', lineHeight: 1.5 }}>{t('notes.empty')}</p>
              <Button onClick={() => setEditing(null)}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><PlusI />{t('notes.create')}</span>
              </Button>
            </div>
          ) : !shown.length ? (
            <div className="nt-empty"><p style={{ opacity: 0.75 }}>{t('notes.noMatch')}</p></div>
          ) : (
            <div className="nt-grid">
              {shown.map(n => (
                <article key={n.id} className="nt-card" tabIndex={0} role="button" aria-label={`${t('notes.edit')}: ${n.title || t('notes.untitled')}`}
                  onClick={() => setEditing(n)}
                  onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setEditing(n) } }}>
                  <h3 className={n.title ? undefined : 'muted'} title={n.title || undefined}>{n.title || t('notes.untitled')}</h3>
                  <p className="nt-body">{n.content}</p>
                  <div className="nt-foot">
                    <div className="nt-dates">
                      <div>{t('notes.created')}: {fmtDateTime(n.createdAt)}</div>
                      {wasEdited(n) && <div>{t('notes.edited')}: {fmtDateTime(n.updatedAt)}</div>}
                    </div>
                    <div className="nt-actions" onClick={e => e.stopPropagation()}>
                      <button type="button" className="nt-ib" title={t('notes.edit')} aria-label={t('notes.edit')} onClick={() => setEditing(n)}><EditI /></button>
                      <button type="button" className="nt-ib bad" title={t('notes.delete')} aria-label={t('notes.delete')} onClick={() => remove(n)}><TrashI /></button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </DataState>
      </section>
    </div>
  )
}