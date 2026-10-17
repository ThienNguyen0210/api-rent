import { useCallback, useEffect, useRef, useState } from 'react'
import { adminApi, adminToken } from '../api/admin.js'
import '../styles/overview.css'
import '../styles/support.css'
import '../styles/admin.css'

const fmtDate = iso => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const usd = n => n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })

/** Cursor pagination: page 1 on mount (and whenever fetchPage changes), "Load more" appends the next 15. */
function usePaged(fetchPage, onExpired) {
  const [items, setItems] = useState([])
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const next = useRef(null)
  const run = useRef(0)

  const load = useCallback(async reset => {
    const id = ++run.current
    setBusy(true); setError('')
    try {
      const page = await fetchPage(reset ? null : next.current)
      if (id !== run.current) return // a newer request (e.g. a new search) took over
      next.current = page.nextCursor
      setMore(!!page.nextCursor)
      setItems(cur => reset ? page.items : [...cur, ...page.items.filter(i => !cur.some(c => c.id === i.id))])
    } catch (e) {
      if (id !== run.current) return
      if (e.status === 401) onExpired()
      else setError(e.message)
    } finally {
      if (id === run.current) setBusy(false)
    }
  }, [fetchPage, onExpired])

  useEffect(() => { load(true) }, [load])
  return { items, setItems, more, busy, error, loadMore: () => load(false), reload: () => load(true) }
}

function Login({ onDone }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async e => {
    e.preventDefault()
    if (busy || !pw) return
    setBusy(true); setError('')
    try {
      const { token } = await adminApi.login(pw)
      adminToken.set(token)
      onDone()
    } catch (err) {
      setError(err.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="w2 adm-login">
      <form className="w-card sup-form" onSubmit={submit}>
        <h1>Admin panel</h1>
        <label className="sup-f">
          <span>Password</span>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus autoComplete="current-password" />
        </label>
        {error && <p className="sup-msg err" role="alert">{error}</p>}
        <div><button className="w-btn pri" type="submit" disabled={busy || !pw}>{busy ? 'Checking…' : 'Sign in'}</button></div>
      </form>
    </div>
  )
}

function AdjustForm({ user, onSaved, onCancel }) {
  const [mode, setMode] = useState('add')
  const [dollars, setDollars] = useState('')
  const [tokens, setTokens] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async e => {
    e.preventDefault()
    if (busy) return
    const d = dollars.trim() === '' ? 0 : Number(dollars)
    const t = tokens.trim() === '' ? 0 : Number(tokens)
    if (!Number.isFinite(d) || d < 0 || !Number.isInteger(t) || t < 0) return setError('Enter positive numbers. Tokens must be whole.')
    if (!d && !t) return setError('Enter a dollar amount, a token amount, or both.')
    const sign = mode === 'deduct' ? -1 : 1
    if (mode === 'deduct' && !window.confirm(`Deduct ${d ? usd(d) : ''}${d && t ? ' and ' : ''}${t ? t.toLocaleString() + ' tokens' : ''} from ${user.email}?`)) return
    setBusy(true); setError('')
    try {
      const out = await adminApi.adjust(user.id, { amountCents: sign * Math.round(d * 100), tokens: sign * t })
      onSaved(out)
    } catch (err) {
      setError(err.message)
    } finally { setBusy(false) }
  }

  return (
    <form className="adm-adjust" onSubmit={submit}>
      <select value={mode} onChange={e => setMode(e.target.value)} aria-label="Action">
        <option value="add">Add</option>
        <option value="deduct">Deduct</option>
      </select>
      <label>USD <input inputMode="decimal" value={dollars} onChange={e => setDollars(e.target.value)} placeholder="0.00" /></label>
      <label>Tokens <input inputMode="numeric" value={tokens} onChange={e => setTokens(e.target.value)} placeholder="0" /></label>
      <button className="w-btn pri" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Apply'}</button>
      <button className="w-btn" type="button" onClick={onCancel}>Cancel</button>
      {error && <p className="sup-msg err" role="alert">{error}</p>}
    </form>
  )
}

function Users({ onExpired }) {
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null) // id of the user whose adjust form is open

  useEffect(() => {
    const id = setTimeout(() => setQ(input.trim()), 300)
    return () => clearTimeout(id)
  }, [input])

  const fetchPage = useCallback(cursor => adminApi.users({ cursor, q }), [q])
  const list = usePaged(fetchPage, onExpired)

  const saved = (id, out) => {
    list.setItems(cur => cur.map(u => u.id === id ? { ...u, balance: out.balance, tokens: out.tokens } : u))
    setOpen(null)
  }

  return (
    <section className="w-card">
      <div className="w-ch adm-bar">
        <h3>Users</h3>
        <input type="search" value={input} onChange={e => setInput(e.target.value)} placeholder="Search name or email" aria-label="Search users" />
      </div>
      {list.error && <p className="sup-msg err" role="alert">{list.error}</p>}
      {!list.busy && !list.items.length && !list.error && <div className="w-state">No users found.</div>}
      <div className="adm-scroll">
        <table className="adm-table">
          <thead>
            <tr><th>User</th><th>Joined</th><th className="num">Balance</th><th className="num">Tokens</th><th className="num">Used</th><th /></tr>
          </thead>
          <tbody>
            {list.items.map(u => (
              <FragmentRow key={u.id}>
                <tr>
                  <td>
                    <strong>{u.name || '—'}</strong>
                    <div className="w-mut">{u.email}{!u.verified && ' (unverified)'}</div>
                  </td>
                  <td className="w-mut">{fmtDate(u.createdAt)}</td>
                  <td className="num">{usd(u.balance)}</td>
                  <td className="num">{u.tokens.toLocaleString()}</td>
                  <td className="num">{u.tokensUsed.toLocaleString()}</td>
                  <td className="num"><button className="w-btn" onClick={() => setOpen(open === u.id ? null : u.id)}>Adjust</button></td>
                </tr>
                {open === u.id && (
                  <tr className="adm-open"><td colSpan={6}>
                    <AdjustForm user={u} onSaved={out => saved(u.id, out)} onCancel={() => setOpen(null)} />
                  </td></tr>
                )}
              </FragmentRow>
            ))}
          </tbody>
        </table>
      </div>
      <div className="adm-more">
        {list.busy && <span className="w-mut">Loading…</span>}
        {!list.busy && list.more && <button className="w-btn" onClick={list.loadMore}>Load 15 more</button>}
      </div>
    </section>
  )
}

// A tbody-safe fragment wrapper (keeps the key on the pair of rows).
const FragmentRow = ({ children }) => <>{children}</>

function SupportItem({ item, onReplied }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const send = async e => {
    e.preventDefault()
    if (busy) return
    if (text.trim().length < 2) return setError('Write a reply first.')
    setBusy(true); setError(''); setNote('')
    try {
      const { reply, emailed } = await adminApi.reply(item.id, text.trim())
      onReplied(item.id, reply)
      setText('')
      setNote(emailed ? 'Reply sent by email.' : 'Reply saved, but the email could not be sent.')
    } catch (err) {
      setError(err.message)
    } finally { setBusy(false) }
  }

  return (
    <li className="sup-item">
      <div className="sup-top">
        <strong>{item.title}</strong>
        {item.replies.at(-1)?.from === 'user'
          ? <span className="w-badge">User replied</span>
          : item.replies.length > 0 && <span className="w-badge ok">Replied</span>}
      </div>
      <div className="w-mut sup-meta">#{item.id} · {item.user.name || item.user.email} &lt;{item.user.email}&gt; · {fmtDate(item.createdAt)}</div>
      <p className="sup-body">{item.content}</p>
      {item.images.length > 0 && (
        <div className="sup-thumbs">
          {item.images.map((u, n) => (
            <a key={u} className="sup-thumb" href={u} target="_blank" rel="noopener noreferrer">
              <img src={u} alt={`Attachment ${n + 1}`} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {item.replies.map((r, n) => (
        <div key={r.id ?? n} className={`adm-reply${r.from === 'user' ? ' from-user' : ''}`}>
          <div className="w-mut">
            {r.from === 'user' ? 'User' : 'You'} · {fmtDate(r.createdAt)}{r.from === 'admin' && r.unread ? ' · not seen yet' : ''}
          </div>
          <p className="sup-body">{r.message}</p>
        </div>
      ))}
      <form className="adm-replyform" onSubmit={send}>
        <textarea rows={3} value={text} onChange={e => setText(e.target.value)} maxLength={5000} placeholder="Write a reply. It is emailed to the user." />
        {error && <p className="sup-msg err" role="alert">{error}</p>}
        {note && <p className="sup-msg ok" role="status">{note}</p>}
        <div><button className="w-btn pri" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reply'}</button></div>
      </form>
    </li>
  )
}

function Support({ onExpired }) {
  const fetchPage = useCallback(cursor => adminApi.support({ cursor }), [])
  const list = usePaged(fetchPage, onExpired)

  const replied = (id, reply) =>
    list.setItems(cur => cur.map(i => i.id === id ? { ...i, replies: [...i.replies, reply] } : i))

  return (
    <section className="w-card">
      <div className="w-ch"><h3>Support requests</h3></div>
      {list.error && <p className="sup-msg err" role="alert">{list.error}</p>}
      {!list.busy && !list.items.length && !list.error && <div className="w-state">No support requests yet.</div>}
      <ul className="sup-list">
        {list.items.map(i => <SupportItem key={i.id} item={i} onReplied={replied} />)}
      </ul>
      <div className="adm-more">
        {list.busy && <span className="w-mut">Loading…</span>}
        {!list.busy && list.more && <button className="w-btn" onClick={list.loadMore}>Load 15 more</button>}
      </div>
    </section>
  )
}

export default function AdminPanel() {
  const [authed, setAuthed] = useState(() => !!adminToken.get())
  const [tab, setTab] = useState('users')

  const signOut = useCallback(() => { adminToken.clear(); setAuthed(false) }, [])

  if (!authed) return <Login onDone={() => setAuthed(true)} />

  return (
    <div className="w2 adm">
      <header className="w-hd">
        <div>
          <h1>Admin panel</h1>
          <p className="w-sub">Manage accounts, funds and support requests.</p>
        </div>
        <button className="w-btn" onClick={signOut}>Sign out</button>
      </header>

      <div className="adm-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'users'} className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>Users</button>
        <button role="tab" aria-selected={tab === 'support'} className={tab === 'support' ? 'on' : ''} onClick={() => setTab('support')}>Support</button>
      </div>

      {tab === 'users' ? <Users onExpired={signOut} /> : <Support onExpired={signOut} />}
    </div>
  )
}
