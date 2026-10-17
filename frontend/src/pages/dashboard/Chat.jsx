import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { useApi } from '../../hooks/useApi.js'
import { useChat } from '../../hooks/useChat.js'
import { useI18n } from '../../i18n/index.jsx'
import { chatApi, CHAT_STREAM_URL } from '../../api/chat.js'
import { MAX_MESSAGES } from '../../lib/chatStorage.js'

const CSS = `
  .chat-page{
    --c-bg:#FAF9F5; --c-surface:#FFFFFF; --c-user:#F0EEE6; --c-text:#1F1E1D; --c-muted:#73726C;
    --c-border:rgba(31,30,29,.15); --c-border-strong:rgba(31,30,29,.3);
    --c-accent:#C6613F; --c-accent-hover:#AE5630; --c-err-bg:rgba(220,38,38,.08); --c-err:#B91C1C;
    --serif:"Anthropic Serif",Cambria,"Noto Serif","Times New Roman",serif;
    --sans:"Anthropic Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    display:flex;flex-direction:column;gap:12px;height:calc(100vh - 140px);height:calc(100dvh - 140px);min-height:420px;
    padding:12px 16px 4px;border-radius:12px;background:var(--c-bg);color:var(--c-text);font-family:var(--sans)
  }
  @media (prefers-color-scheme:dark){
    .chat-page{
      --c-bg:#262624; --c-surface:#30302E; --c-user:#141413; --c-text:#FAF9F5; --c-muted:#A6A39A;
      --c-border:rgba(222,220,209,.15); --c-border-strong:rgba(222,220,209,.3);
      --c-accent:#D97757; --c-accent-hover:#E48B6D; --c-err-bg:rgba(248,113,113,.1); --c-err:#FCA5A5
    }
  }
  .chat-page .cx-bar,.chat-page .cx-thread,.chat-page .cx-composer{width:100%;max-width:none;box-sizing:border-box}
  .chat-page .cx-bar{background:transparent;color:inherit;display:flex;align-items:center;justify-content:space-between;padding:0}
  .chat-page .cx-bar h2{margin:0;color:inherit;background:none;font-family:var(--serif);font-size:18px;font-weight:500;letter-spacing:-.01em}
  .chat-page .cx-ghost{padding:6px 10px;border:0;border-radius:8px;background:transparent;color:var(--c-muted);font:inherit;font-size:14px;cursor:pointer}
  .chat-page .cx-ghost:hover:not(:disabled){background:var(--c-user);color:var(--c-text)}
  .chat-page .cx-ghost:disabled{opacity:.45;cursor:default}

  .chat-page .cx-log{flex:1;overflow-y:auto;padding:8px 0;scrollbar-width:none;-ms-overflow-style:none}
  .chat-page .cx-log::-webkit-scrollbar{display:none}
  .chat-page .cx-thread{display:flex;flex-direction:column;gap:24px;min-height:100%;padding:0}
  .chat-page .cx-empty{margin:auto;display:flex;flex-direction:column;align-items:center;gap:14px;max-width:420px;text-align:center;
    font-family:var(--serif);font-size:20px;line-height:1.45;color:var(--c-muted)}
  .chat-page .cx-empty .cx-spark{width:36px;height:36px;color:var(--c-accent)}

  .chat-page .cx-msg{display:flex}
  .chat-page .cx-msg.cx-user{justify-content:flex-end}
  .chat-page .cx-bubble{word-break:break-word}
  .chat-page .cx-msg.cx-user .cx-bubble{white-space:pre-wrap}
  .chat-page .cx-md>:first-child{margin-top:0}
  .chat-page .cx-md>:last-child{margin-bottom:0}
  .chat-page .cx-md p,.chat-page .cx-md ul,.chat-page .cx-md ol,.chat-page .cx-md pre,.chat-page .cx-md table,.chat-page .cx-md blockquote{margin:0 0 .8em}
  .chat-page .cx-md h1,.chat-page .cx-md h2,.chat-page .cx-md h3,.chat-page .cx-md h4,.chat-page .cx-md h5,.chat-page .cx-md h6{margin:1em 0 .4em;font-family:var(--serif);font-weight:600;line-height:1.3}
  .chat-page .cx-md h1{font-size:1.3em}.chat-page .cx-md h2{font-size:1.15em}.chat-page .cx-md h3,.chat-page .cx-md h4,.chat-page .cx-md h5,.chat-page .cx-md h6{font-size:1.05em}
  .chat-page .cx-md ul,.chat-page .cx-md ol{padding-left:1.4em}
  .chat-page .cx-md li>p{margin:0 0 .4em}
  .chat-page .cx-md li>ul,.chat-page .cx-md li>ol{margin:.3em 0 0}
  .chat-page .cx-md li input[type=checkbox]{margin:0 .4em 0 -1.2em}
  .chat-page .cx-md hr{margin:1em 0;border:0;border-top:1px solid var(--c-border)}
  .chat-page .cx-md img{display:none}
  .chat-page .cx-md code{padding:.1em .35em;border-radius:6px;background:var(--c-user);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em}
  .chat-page .cx-md pre{padding:12px 14px;overflow-x:auto;border-radius:10px;background:var(--c-user)}
  .chat-page .cx-md pre code{padding:0;background:none}
  .chat-page .cx-md blockquote{padding-left:12px;border-left:3px solid var(--c-border-strong);color:var(--c-muted)}
  .chat-page .cx-md .cx-table{max-width:100%;margin:0 0 .8em;overflow-x:auto}
  .chat-page .cx-md .cx-table table{margin:0;border-collapse:collapse}
  .chat-page .cx-md th{background:var(--c-user);text-align:left}
  .chat-page .cx-md th,.chat-page .cx-md td{padding:6px 10px;border:1px solid var(--c-border)}
  .chat-page .cx-md a{color:var(--c-accent)}
  .chat-page .cx-system{display:block;width:100%;min-height:72px;max-height:200px;padding:10px 12px;border:1px solid var(--c-border);border-radius:12px;resize:vertical;
    background:var(--c-surface);color:inherit;font:inherit;font-size:14px;line-height:1.5;box-sizing:border-box}
  .chat-page .cx-msg.cx-user .cx-bubble{max-width:80%;padding:10px 16px;border-radius:16px;background:var(--c-user);font-size:16px;line-height:1.55}
  .chat-page .cx-msg.cx-assistant .cx-bubble{max-width:100%;padding:0 2px;font-family:var(--serif);font-size:17px;line-height:1.7}
  .chat-page .cx-msg.cx-assistant{gap:12px;align-items:flex-start}
  .chat-page .cx-msg.cx-assistant .cx-bubble{flex:1;min-width:0;min-height:28px}
  .chat-page .cx-avatar{flex:none;width:28px;height:28px;margin-top:2px;border-radius:50%;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;
    background:var(--c-surface);border:1px solid var(--c-border);color:var(--c-accent)}
  .chat-page .cx-avatar img{display:block;width:100%;height:100%;object-fit:cover}
  .chat-page .cx-avatar .cx-spark{width:16px;height:16px}
  .chat-page .cx-avatar.cx-pulse{animation:chat-fade 1.4s ease-in-out infinite}
  @keyframes chat-fade{0%,100%{opacity:.4}50%{opacity:1}}
  .chat-page .cx-dots{display:inline-flex;align-items:center;gap:5px;height:28px;margin-top:2px}
  .chat-page .cx-dots i{display:block;width:7px;height:7px;border-radius:50%;background:var(--c-muted);animation:chat-dot 1.2s ease-in-out infinite}
  .chat-page .cx-dots i:nth-child(2){animation-delay:.15s}
  .chat-page .cx-dots i:nth-child(3){animation-delay:.3s}
  @keyframes chat-dot{0%,60%,100%{transform:translateY(0);opacity:.35}30%{transform:translateY(-4px);opacity:1}}
  @media (prefers-reduced-motion:reduce){
    .chat-page .cx-avatar.cx-pulse{animation:none}
    .chat-page .cx-dots i{animation:none;opacity:.6}
  }
  .chat-page .cx-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .chat-page .cx-err{padding:10px 14px;border-radius:10px;background:var(--c-err-bg);color:var(--c-err);font-size:14px;line-height:1.5}

  .chat-page .cx-composer{margin-top:0;padding:12px 12px 10px 16px;border:1px solid var(--c-border);border-radius:20px;background:var(--c-surface);
    box-shadow:0 2px 12px rgba(0,0,0,.05);transition:border-color .15s,box-shadow .15s}
  .chat-page .cx-composer:focus-within{border-color:var(--c-border-strong);box-shadow:0 4px 24px rgba(0,0,0,.08)}
  .chat-page textarea{display:block;width:100%;min-height:28px;max-height:200px;padding:4px 0;border:0;outline:0;resize:none;overflow-y:auto;
    background:transparent;color:inherit;font:inherit;font-size:16px;line-height:1.5;box-sizing:border-box}
  .chat-page textarea::placeholder{color:var(--c-muted)}
  .chat-page .cx-tools{display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-top:6px}
  .chat-page select{max-width:60%;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:var(--c-muted);font:inherit;font-size:14px;cursor:pointer}
  .chat-page select:hover:not(:disabled){background:var(--c-user);color:var(--c-text)}
  .chat-page select:disabled{opacity:.5;cursor:default}
  .chat-page select option{background:var(--c-surface);color:var(--c-text)}
  .chat-page .cx-round{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:0;border-radius:50%;
    background:var(--c-accent);color:#fff;cursor:pointer;transition:background .15s,opacity .15s}
  .chat-page .cx-round:hover:not(:disabled){background:var(--c-accent-hover)}
  .chat-page .cx-round:disabled{opacity:.35;cursor:default}
  .chat-page .cx-round svg{width:18px;height:18px}
  .chat-page button:focus-visible,.chat-page select:focus-visible{outline:2px solid var(--c-accent);outline-offset:2px}
`

// Markdown rendering: tables scroll inside their own wrapper (keeps real table layout), links open safely in a new tab,
// and images are not rendered at all (this chat does not do images, and a remote <img> would leak the reader's IP).
const MD_COMPONENTS = {
  table: ({ node, ...props }) => <div className="cx-table"><table {...props} /></div>,
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer nofollow" />,
}
const MD_REMARK = [remarkGfm, remarkBreaks]

// Nearest ancestor that scrolls (the page itself when none does).
function scrollParent(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return document.scrollingElement || document.documentElement
}

// Sizes the chat to the space actually left under the site header, so only the message list scrolls, never the whole page.
function fitPage(el) {
  const GAP = 12 // breathing room under the card
  el.style.height = `${Math.max(420, window.innerHeight - el.getBoundingClientRect().top - GAP)}px`
  // Whatever the surrounding layout still adds below (padding, footer) would make the page scroll: take it off.
  const sp = scrollParent(el)
  const overflow = sp.scrollHeight - sp.clientHeight
  if (overflow > 0) el.style.height = `${Math.max(420, el.offsetHeight - overflow)}px`
}

function Spark({ className = 'cx-spark' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4" />
    </svg>
  )
}

// The selected model's picture from models.json (`image`); falls back to the spark if it is missing or fails to load.
function ModelIcon({ src, name, pulse }) {
  const [bad, setBad] = useState(false)
  useEffect(() => { setBad(false) }, [src])
  return (
    <span className={`cx-avatar${pulse ? ' cx-pulse' : ''}`} title={name || undefined}>
      {src && !bad ? <img src={src} alt={name || ''} onError={() => setBad(true)} /> : <Spark />}
    </span>
  )
}

export default function Chat() {
  const { t: tr } = useI18n()
  // A missing translation comes back as the key itself; show a readable default instead.
  const FALLBACK = { 'chat.system': 'System prompt', 'chat.systemPlaceholder': 'Optional instructions for the AI (role, tone, language)...' }
  const t = key => { const v = tr(key); return v === key && FALLBACK[key] ? FALLBACK[key] : v }
  // {name} placeholders, same helper as Deposit.jsx and Billing.jsx
  const tf = (key, vars = {}) => Object.entries(vars).reduce((o, [k, v]) => o.replaceAll(`{${k}}`, String(v)), tr(key))
  const modelsQ = useApi(chatApi.models)
  // One entry per key, so the picker can never render duplicate options.
  const models = [...new Map((modelsQ.data?.data ?? []).map(m => [m.key, m])).values()]
  const [system, setSystem] = useState('') // optional system prompt; Enter inserts a line break, the server also accepts a typed \n
  const [showSystem, setShowSystem] = useState(false)
  const { messages, modelKey, setModelKey, busy, error, send, stop, clear } = useChat({ url: CHAT_STREAM_URL, system })
  const current = models.find(m => m.key === modelKey)
  const [draft, setDraft] = useState('')
  const pageRef = useRef(null)
  const logRef = useRef(null)
  const inputRef = useRef(null)

  // Fit the page to the window now and whenever it is resized.
  useLayoutEffect(() => {
    const el = pageRef.current
    if (!el) return
    const fit = () => fitPage(el)
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  // Choose a model when none is saved yet, or when the saved one is no longer offered.
  useEffect(() => {
    if (models.length && !models.some(m => m.key === modelKey)) setModelKey(models[0].key)
  }, [models, modelKey])

  // Keep the newest text in view while the reply streams.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: busy ? 'auto' : 'smooth' })
  }, [messages, busy, error])

  // Grow the input with its content, up to the CSS max-height.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [draft])

  const submit = () => {
    if (!draft.trim() || busy || !modelKey) return
    const text = draft
    setDraft('')
    send(text)
  }

  const onKeyDown = e => {
    // isComposing: do not send while an IME (e.g. Vietnamese typing) is still composing text.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="chat-page" ref={pageRef}>
      <style>{CSS}</style>

      <div className="cx-bar">
        <button type="button" className="cx-ghost" onClick={() => setShowSystem(v => !v)} aria-expanded={showSystem}>
          {t('chat.system')}
        </button>
        <button type="button" className="cx-ghost" onClick={clear} disabled={busy || !messages.length}>
          {t('chat.clear')}
        </button>
      </div>

      {showSystem && (
        <textarea
          className="cx-system"
          value={system}
          onChange={e => setSystem(e.target.value)}
          placeholder={t('chat.systemPlaceholder')}
          aria-label={t('chat.system')}
          maxLength={8000}
        />
      )}

      <div className="cx-log" ref={logRef}>
        <div className="cx-thread">
          {!messages.length && (
            <div className="cx-empty">
              <Spark />
              <p style={{ margin: 0 }}>
                {models.length ? tf('chat.empty', { count: MAX_MESSAGES }) : t('chat.noModels')}
              </p>
            </div>
          )}
          {messages.map(m => {
            const thinking = busy && m.role === 'assistant' && !m.content
            return (
              <div key={m.id} className={`cx-msg cx-${m.role}`}>
                {m.role === 'assistant' && <ModelIcon src={current?.image} name={current?.name} pulse={thinking} />}
                <div className="cx-bubble">
                  {!m.content ? (
                    thinking ? (
                      <>
                        <span className="cx-dots" aria-hidden="true"><i /><i /><i /></span>
                        <span className="cx-sr" role="status">{t('chat.thinking')}</span>
                      </>
                    ) : ''
                  ) : m.role === 'assistant' ? (
                    <div className="cx-md">
                      <ReactMarkdown remarkPlugins={MD_REMARK} components={MD_COMPONENTS} disallowedElements={['img']}>
                        {m.content.normalize('NFC')}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    m.content.normalize('NFC')
                  )}
                </div>
              </div>
            )
          })}
          {error && <div className="cx-err" role="alert">{error}</div>}
        </div>
      </div>

      <div className="cx-composer">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('chat.placeholder')}
          rows={1}
          disabled={!models.length}
        />
        <div className="cx-tools">
          <select
            aria-label={t('chat.model')}
            value={modelKey}
            onChange={e => setModelKey(e.target.value)}
            disabled={busy || !models.length}
          >
            {models.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}
          </select>
          {busy ? (
            <button type="button" className="cx-round" onClick={stop} aria-label={t('chat.stop')} title={t('chat.stop')}>
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
            </button>
          ) : (
            <button
              type="button"
              className="cx-round"
              onClick={submit}
              disabled={!draft.trim() || !modelKey}
              aria-label={t('chat.send')}
              title={t('chat.send')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}