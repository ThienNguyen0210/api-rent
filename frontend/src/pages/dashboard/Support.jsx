import { useEffect, useRef, useState } from 'react'
import DataState from '../../components/DataState.jsx'
import { useApi } from '../../hooks/useApi.js'
import { supportApi } from '../../api/index.js'
import { useI18n } from '../../i18n/index.jsx'
import '../../styles/overview.css'
import '../../styles/support.css'
import '../../styles/support-thread.css'

const MAX_IMAGES = 10
const MAX_BYTES = 5 * 1024 * 1024
const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const fmtDate = iso => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

// One support request's conversation: admin and user messages, plus a reply box.
function Thread({ item, extra, onSent, tr }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const replies = [...(item.replies ?? []), ...extra]

  const send = async e => {
    e.preventDefault()
    if (busy) return
    if (text.trim().length < 2) return setError(tr('support.err.reply', 'Write your reply first.'))
    setBusy(true); setError('')
    try {
      const reply = await supportApi.reply(item.id, text.trim())
      onSent(item.id, reply)
      setText(''); setOpen(false)
    } catch (err) {
      setError(err.message || tr('support.err.send', 'Could not send your message.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {replies.length > 0 && (
        <div className="sup-thread">
          {replies.map(r => (
            <div key={r.id} className={`sup-reply ${r.from}${r.unread ? ' unread' : ''}`}>
              <div className="sup-reply-hd">
                <strong>{r.from === 'admin' ? tr('support.fromAdmin', 'Support team') : tr('support.fromYou', 'You')}</strong>
                <span className="w-mut">{fmtDate(r.createdAt)}</span>
                {r.unread && <span className="sup-new">{tr('support.new', 'New')}</span>}
              </div>
              <p className="sup-body">{r.message}</p>
            </div>
          ))}
        </div>
      )}

      <div className="sup-thread">
        {open ? (
          <form className="sup-replyform" onSubmit={send}>
            <textarea rows={3} value={text} onChange={e => setText(e.target.value)} maxLength={5000} autoFocus
              placeholder={tr('support.replyPh', 'Write your reply…')} />
            {error && <p className="sup-msg err" role="alert">{error}</p>}
            <div>
              <button className="w-btn pri" type="submit" disabled={busy}>{busy ? tr('support.sending', 'Sending…') : tr('support.sendReply', 'Send reply')}</button>
              {' '}
              <button className="w-btn" type="button" onClick={() => { setOpen(false); setError('') }}>{tr('support.cancel', 'Cancel')}</button>
            </div>
          </form>
        ) : (
          <div><button className="w-btn" type="button" onClick={() => setOpen(true)}>{tr('support.reply', 'Reply')}</button></div>
        )}
      </div>
    </>
  )
}

export default function Support() {
  const { t } = useI18n()
  // Falls back to English until the new keys exist in the i18n files.
  const tr = (k, fb) => { const v = t(k); return !v || v === k ? fb : v }
  const history = useApi(supportApi.list)
  const fileInput = useRef(null)

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [files, setFiles] = useState([]) // [{ id, file, url }]
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [added, setAdded] = useState([]) // requests sent on this page, shown before the history reloads
  const [extra, setExtra] = useState({}) // replies sent on this page: { [requestId]: [reply] }

  // The ref always holds the latest list, so several pastes in a row don't overwrite each other.
  const filesRef = useRef([])
  filesRef.current = files
  useEffect(() => () => filesRef.current.forEach(f => URL.revokeObjectURL(f.url)), [])

  // Opening this page counts as reading the admin's messages. The "New" marks stay until the page is reopened.
  const hasUnread = (history.data?.items ?? []).some(i => (i.replies ?? []).some(r => r.unread))
  useEffect(() => {
    if (!hasUnread) return
    supportApi.markRead()
      .then(() => window.dispatchEvent(new Event('support-unread-changed')))
      .catch(() => {})
  }, [hasUnread])

  const addFiles = list => {
    setSent(false)
    let msg = ''
    const ok = []
    for (const file of list) {
      if (!TYPES.includes(file.type)) { msg = t('support.err.type'); continue }
      if (file.size > MAX_BYTES) { msg = t('support.err.size'); continue }
      ok.push({ id: Math.random().toString(36).slice(2), file, url: URL.createObjectURL(file) })
    }
    const room = MAX_IMAGES - filesRef.current.length
    const take = ok.slice(0, room)
    ok.slice(room).forEach(f => URL.revokeObjectURL(f.url))
    if (ok.length > room) msg = t('support.err.count')
    filesRef.current = [...filesRef.current, ...take]
    setFiles(filesRef.current)
    setError(msg)
  }

  const removeFile = id => {
    const gone = filesRef.current.find(f => f.id === id)
    if (gone) URL.revokeObjectURL(gone.url)
    filesRef.current = filesRef.current.filter(f => f.id !== id)
    setFiles(filesRef.current)
    setError('')
  }

  // Ctrl+V anywhere in the form. Plain-text pastes are left alone.
  const onPaste = e => {
    const imgs = [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith('image/'))
    if (!imgs.length) return
    if (!e.clipboardData.getData('text')) e.preventDefault()
    addFiles(imgs)
  }

  const submit = async e => {
    e.preventDefault()
    if (busy) return
    const ti = title.trim(), co = content.trim()
    setSent(false)
    // Say what is missing instead of silently doing nothing.
    if (ti.length < 3) return setError(t('support.err.title'))
    if (co.length < 10) return setError(t('support.err.content'))
    setBusy(true); setError('')
    try {
      const fd = new FormData()
      fd.append('title', ti)
      fd.append('content', co)
      files.forEach(f => fd.append('images', f.file, f.file.name))
      const item = await supportApi.create(fd)
      setAdded(a => [item, ...a])
      files.forEach(f => URL.revokeObjectURL(f.url))
      filesRef.current = []
      setFiles([]); setTitle(''); setContent(''); setSent(true)
    } catch (err) {
      setError(err.message || t('support.err.send'))
    } finally {
      setBusy(false)
    }
  }

  const replySent = (id, reply) => setExtra(m => ({ ...m, [id]: [...(m[id] ?? []), reply] }))

  const items = [...added, ...(history.data?.items ?? []).filter(i => !added.some(a => a.id === i.id))]

  return (
    <div className="w2">
      <header className="w-hd">
        <div>
          <h1>{t('support.title')}</h1>
          <p className="w-sub">{t('support.subtitle')}</p>
        </div>
      </header>

      <form className="w-card sup-form" onSubmit={submit} onPaste={onPaste}>
        <label className="sup-f">
          <span>{t('support.titleLabel')}</span>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={150} placeholder={t('support.titlePh')} />
        </label>

        <label className="sup-f">
          <span>{t('support.contentLabel')}</span>
          <textarea value={content} onChange={e => setContent(e.target.value)} maxLength={5000} rows={7} placeholder={t('support.contentPh')} />
        </label>

        <div className="sup-f">
          <span>{t('support.images')} <em className="w-mut">{files.length}/{MAX_IMAGES}</em></span>
          <div className="sup-thumbs">
            {files.map((f, n) => (
              <div key={f.id} className="sup-thumb">
                <img src={f.url} alt={t('support.imageAlt', { n: n + 1 })} />
                <button type="button" aria-label={t('support.remove')} onClick={() => removeFile(f.id)}>×</button>
              </div>
            ))}
            {files.length < MAX_IMAGES && (
              <button type="button" className="sup-add" onClick={() => fileInput.current?.click()}>{t('support.addImages')}</button>
            )}
          </div>
          <input ref={fileInput} type="file" accept={TYPES.join(',')} multiple hidden
            onChange={e => { addFiles([...e.target.files]); e.target.value = '' }} />
          <small className="w-mut">{t('support.pasteHint')}</small>
        </div>

        {error && <p className="sup-msg err" role="alert">{error}</p>}
        {sent && <p className="sup-msg ok" role="status">{t('support.success')}</p>}

        <div>
          <button className="w-btn pri" type="submit" disabled={busy}>{busy ? t('support.sending') : t('support.send')}</button>
        </div>
      </form>

      <section className="w-card">
        <div className="w-ch"><h3>{t('support.history')}</h3></div>
        <DataState query={history}>
          {!items.length ? <div className="w-state">{t('support.empty')}</div> : (
            <ul className="sup-list">
              {items.map(i => (
                <li key={i.id} className="sup-item">
                  <div className="sup-top">
                    <strong>{i.title}</strong>
                    <span className="w-badge ok">{t('support.sent')}</span>
                  </div>
                  <div className="w-mut sup-meta">{t('support.ref', { id: i.id })} · {fmtDate(i.createdAt)}</div>
                  <p className="sup-body">{i.content}</p>
                  {i.images.length > 0 && (
                    <div className="sup-thumbs">
                      {i.images.map((u, n) => (
                        <a key={u} className="sup-thumb" href={u} target="_blank" rel="noopener noreferrer">
                          <img src={u} alt={t('support.imageAlt', { n: n + 1 })} loading="lazy" />
                        </a>
                      ))}
                    </div>
                  )}
                  <Thread item={i} extra={extra[i.id] ?? []} onSent={replySent} tr={tr} />
                </li>
              ))}
            </ul>
          )}
        </DataState>
      </section>
    </div>
  )
}
