import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import Button from '../../components/Button.jsx'
import DataState from '../../components/DataState.jsx'
import { useApi } from '../../hooks/useApi.js'
import { keysApi } from '../../api/index.js'
import { fmtDate } from '../../lib/format.js'
import { useI18n } from '../../i18n/index.jsx'

const MAX_KEYS = 15

// Keep in sync with MAX_ENTRIES / MAX_RATE_PER_MIN in the server's keyAccess.js (the server is the real gate).
const MAX_ENTRIES = 1000
const MAX_RATE = 1000000
const parseEntries = text => [...new Set(text.split(/[\s,;]+/).filter(Boolean))]

// Adjust API_BASE to your real public domain (the server exposes /v1/<model>/chat/completions at its root).
const API_BASE = 'https://your-domain.com'
const API_KEY_PLACEHOLDER = 'NXR_your_api_key_here'

// One entry per AI browser on the backend (routes/v1.js). `id` is the URL segment that picks the model;
// `name` is the default value of the optional "model" field. To add a model, add an entry here.
const MODELS = [
  { id: 'chatgpt', label: 'ChatGPT', name: 'GPT-5.6-Luna' },
  { id: 'gemini', label: 'Gemini', name: 'Gemini-3.5-Flash' },
]
const baseUrlOf = m => `${API_BASE}/v1/${m.id}`
const endpointOf = m => `${baseUrlOf(m)}/chat/completions`

/* Code samples are code, not UI copy, so they are not translated.
   (String.raw keeps \" intact; no backticks or ${} inside samples.)
   Placeholders: __URL__ = full endpoint, __BASE__ = base URL for OpenAI SDKs, __KEY__, __MODEL__. */
const SAMPLE_TEMPLATES = [
  {
    id: 'curl', label: 'cURL', code: String.raw`curl -X POST "__URL__" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer __KEY__" \
  -d '{"model": "__MODEL__", "messages": [{"role": "user", "content": "Hello!"}]}'

# The reply text is at choices[0].message.content`,
  },
  {
    id: 'node', label: 'Node.js', code: String.raw`// Node.js 18+ (fetch is built in)
const API_KEY = '__KEY__'

const res = await fetch('__URL__', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + API_KEY,
  },
  body: JSON.stringify({
    model: '__MODEL__',
    messages: [{ role: 'user', content: 'Hello!' }],
  }),
})

const data = await res.json()
console.log(data.choices[0].message.content)`,
  },
  {
    id: 'python', label: 'Python', code: String.raw`# pip install requests
import requests

API_KEY = "__KEY__"

res = requests.post(
    "__URL__",
    headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + API_KEY,
    },
    json={
        "model": "__MODEL__",
        "messages": [{"role": "user", "content": "Hello!"}],
    },
)

print(res.json()["choices"][0]["message"]["content"])`,
  },
  {
    id: 'openai-node', label: 'OpenAI SDK (JS)', code: String.raw`// npm install openai
// The API is OpenAI-compatible: switch models by changing the last part of baseURL.
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: '__KEY__',
  baseURL: '__BASE__',
})

const completion = await client.chat.completions.create({
  model: '__MODEL__',
  messages: [{ role: 'user', content: 'Hello!' }],
})

console.log(completion.choices[0].message.content)`,
  },
  {
    id: 'openai-python', label: 'OpenAI SDK (Python)', code: String.raw`# pip install openai
# The API is OpenAI-compatible: switch models by changing the last part of base_url.
from openai import OpenAI

client = OpenAI(api_key="__KEY__", base_url="__BASE__")

completion = client.chat.completions.create(
    model="__MODEL__",
    messages=[{"role": "user", "content": "Hello!"}],
)

print(completion.choices[0].message.content)`,
  },
  {
    id: 'php', label: 'PHP', code: String.raw`<?php
$apiKey = '__KEY__';

$ch = curl_init('__URL__');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $apiKey,
    ],
    CURLOPT_POSTFIELDS     => json_encode([
        'model'    => '__MODEL__',
        'messages' => [['role' => 'user', 'content' => 'Hello!']],
    ]),
]);

$response = curl_exec($ch);
curl_close($ch);

$data = json_decode($response, true);
echo $data['choices'][0]['message']['content'];`,
  },
  {
    id: 'dotnet', label: '.NET (C#)', code: String.raw`using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

var apiKey = "__KEY__";

using var client = new HttpClient();
client.DefaultRequestHeaders.Authorization =
    new AuthenticationHeaderValue("Bearer", apiKey);

var body = new StringContent(
    "{\"model\":\"__MODEL__\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello!\"}]}",
    Encoding.UTF8, "application/json");

var res = await client.PostAsync("__URL__", body);
using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
Console.WriteLine(doc.RootElement
    .GetProperty("choices")[0]
    .GetProperty("message")
    .GetProperty("content")
    .GetString());`,
  },
  {
    id: 'java', label: 'Java', code: String.raw`// Java 11+
import java.net.URI;
import java.net.http.*;

public class Example {
  public static void main(String[] args) throws Exception {
    String apiKey = "__KEY__";
    String json = "{\"model\":\"__MODEL__\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello!\"}]}";

    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("__URL__"))
        .header("Content-Type", "application/json")
        .header("Authorization", "Bearer " + apiKey)
        .POST(HttpRequest.BodyPublishers.ofString(json))
        .build();

    HttpResponse<String> response = HttpClient.newHttpClient()
        .send(request, HttpResponse.BodyHandlers.ofString());

    // The reply text is at choices[0].message.content (parse with your JSON library)
    System.out.println(response.body());
  }
}`,
  },
]

const buildSamples = m =>
  SAMPLE_TEMPLATES.map(s => ({
    ...s,
    code: s.code
      .replaceAll('__URL__', endpointOf(m))
      .replaceAll('__BASE__', baseUrlOf(m))
      .replaceAll('__KEY__', API_KEY_PLACEHOLDER)
      .replaceAll('__MODEL__', m.name),
  }))

/* ------------------------------------------------------------------ */
/* Helpers / shared styles                                             */
/* ------------------------------------------------------------------ */
function ago(iso, t) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return t('keys.justNow')
  if (s < 3600) return t('keys.minAgo', { n: Math.floor(s / 60) })
  if (s < 86400) return t('keys.hrAgo', { n: Math.floor(s / 3600) })
  return fmtDate(iso)
}

const fmtTokens = n => Number(n || 0).toLocaleString()
const compactTokens = n => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n || 0))

const TONES = { error: '#ef4444', info: 'var(--accent, #3b82f6)', warning: 'var(--warning, #d97706)' }

const overlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(8,12,20,0.55)', backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: '16px',
}

const inputStyle = {
  width: '100%', padding: '10px 12px', background: 'var(--bg, transparent)', color: 'inherit',
  border: '1px solid var(--border, #ccc)', borderRadius: '8px',
}

const codeBoxStyle = {
  display: 'block', padding: '12px', background: 'var(--bg-code, rgba(128,128,128,0.1))',
  border: '1px solid var(--border, #ccc)', borderRadius: '10px', wordBreak: 'break-all',
}

/* Scoped styles (.ak-*): hover, focus, responsive layout and the dark code window. */
const CSS = `
.ak{--ak-line:var(--border,rgba(128,128,128,.28));--ak-soft:rgba(128,128,128,.08);--ak-ok:#16a34a;--ak-warn:#d97706;--ak-bad:#ef4444;
  --ak-mono:ui-monospace,'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;display:flex;flex-direction:column;gap:20px}
.ak h2,.ak h3,.ak h4,.ak p{margin:0}
.ak button:focus-visible,.ak input:focus-visible,.ak a:focus-visible{outline:2px solid var(--accent,#3b82f6);outline-offset:2px}
.ak-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.ak-panel{border:1px solid var(--ak-line);border-radius:16px;background:var(--card-bg,var(--bg-card,transparent));overflow:hidden}
.ak-head{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;padding:24px}
.ak-head h2{font-size:1.6rem;letter-spacing:-.02em;line-height:1.2}
.ak-sub{opacity:.7;margin-top:6px!important;max-width:62ch;line-height:1.55}
.ak-meter{display:flex;align-items:center;gap:10px;margin-top:16px;font-size:.85rem;font-variant-numeric:tabular-nums}
.ak-meter-bar{width:180px;max-width:50vw;height:6px;border-radius:99px;background:var(--ak-soft);overflow:hidden}
.ak-meter-bar i{display:block;height:100%;border-radius:99px;background:var(--accent,#3b82f6);transition:width .4s ease}
.ak-callout{display:flex;gap:12px;align-items:flex-start;margin:0 24px 24px;padding:12px 14px;border-radius:12px;
  background:rgba(217,119,6,.1);border:1px solid rgba(217,119,6,.35);font-size:.9rem;line-height:1.5}
.ak-callout svg{flex:none;margin-top:2px;color:var(--ak-warn)}
.ak-callout a{margin-left:auto;white-space:nowrap;font-weight:600;color:inherit;text-decoration:underline;text-underline-offset:3px}
.ak-cols,.ak-row{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1.1fr) 120px 140px 130px 110px 40px;gap:16px;align-items:center;padding:14px 24px}
.ak-cols{font-size:.8rem;opacity:.65;border-top:1px solid var(--ak-line);border-bottom:1px solid var(--ak-line);padding-top:10px;padding-bottom:10px}
.ak-row{border-bottom:1px solid var(--ak-line);transition:background .15s}
.ak-row:last-child{border-bottom:0}
.ak-row:hover{background:var(--ak-soft)}
.ak-row.off .ak-name,.ak-row.off .ak-chip{opacity:.55}
.ak-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ak-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 4px 3px 10px;border:1px solid var(--ak-line);border-radius:10px;max-width:100%}
.ak-chip code{font-family:var(--ak-mono);font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:none;border:0;padding:0}
.ak-sm{display:block;font-size:.8rem;opacity:.65;margin-top:2px}
.ak-pill{display:inline-flex;align-items:center;gap:7px;padding:3px 10px 3px 8px;border-radius:99px;font-size:.82rem;font-weight:500;background:var(--ak-soft)}
.ak-pill i{width:8px;height:8px;border-radius:50%;background:#94a3b8}
.ak-pill.on{background:rgba(22,163,74,.12);color:var(--ak-ok)}
.ak-pill.on i{background:var(--ak-ok);box-shadow:0 0 0 3px rgba(22,163,74,.2)}
.ak-ib{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:8px;border:0;background:transparent;color:inherit;cursor:pointer;opacity:.7;transition:background .15s,opacity .15s}
.ak-ib:hover{background:var(--ak-soft);opacity:1}
.ak-inline{padding:4px 8px;border-radius:8px;width:100%;background:var(--bg,transparent);color:inherit;border:1px solid var(--accent,#3b82f6)}
.ak-empty{display:flex;flex-direction:column;align-items:center;gap:14px;padding:56px 24px;text-align:center;border-top:1px solid var(--ak-line)}
.ak-badge{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;margin:0 auto;background:var(--ak-soft)}
.ak-badge.ok{background:rgba(22,163,74,.14);color:var(--ak-ok)}
.ak-badge.bad{background:rgba(239,68,68,.12);color:var(--ak-bad)}
.ak-badge.info{background:rgba(59,130,246,.12);color:var(--accent,#3b82f6)}
.ak-secret{display:flex;gap:12px;align-items:center;padding:12px 12px 12px 16px;border-radius:12px;background:#0d1117;color:#e6edf3;border:1px solid #21262d}
.ak-secret code{flex:1;min-width:0;word-break:break-all;font-family:var(--ak-mono);font-size:.9rem;background:none;border:0;padding:0;color:inherit}
.ak-term{border-radius:14px;overflow:hidden;background:#0d1117;color:#e6edf3;border:1px solid #21262d;margin-top:16px}
.ak-term-bar{display:flex;align-items:center;gap:12px;padding:0 10px 0 14px;background:#161b22;border-bottom:1px solid #21262d}
.ak-dots{display:flex;gap:6px}.ak-dots i{width:10px;height:10px;border-radius:50%;background:#30363d}
.ak-tabs{display:flex;gap:2px;overflow-x:auto;flex:1;scrollbar-width:none}.ak-tabs::-webkit-scrollbar{display:none}
.ak-tab{background:none;border:0;border-bottom:2px solid transparent;color:#8b949e;padding:13px 10px;font:inherit;font-size:.85rem;cursor:pointer;white-space:nowrap}
.ak-tab:hover{color:#e6edf3}
.ak-tab[aria-selected=true]{color:#fff;border-bottom-color:var(--accent,#58a6ff)}
.ak-copy{display:inline-flex;align-items:center;gap:6px;flex:none;padding:6px 10px;border-radius:8px;border:1px solid #30363d;background:transparent;color:#e6edf3;font:inherit;font-size:.82rem;cursor:pointer}
.ak-copy:hover{background:#21262d}
.ak-pre{margin:0;padding:18px 20px;overflow:auto;font:13px/1.65 var(--ak-mono);tab-size:2;max-height:420px}
.ak-pre code{background:none;border:0;padding:0;color:inherit;font:inherit}
.ak-pre .cm{color:#7d8590}
.ak-models{display:grid;gap:8px;margin-top:10px}
.ak-model{display:grid;grid-template-columns:120px minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 14px;border:1px solid var(--ak-line);border-radius:12px}
.ak-model code{font-family:var(--ak-mono);font-size:.82rem;overflow-x:auto;white-space:nowrap}
.ak-steps{margin:16px 0 0;padding-left:20px;line-height:1.7}
.ak-field{border:1px solid var(--ak-line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;margin-bottom:12px}
.ak-field h4{font-size:.95rem}
.ak-opts{display:flex;gap:18px;flex-wrap:wrap}
.ak-opt{display:inline-flex;align-items:center;gap:8px;cursor:pointer}
.ak-area{width:100%;box-sizing:border-box;padding:10px 12px;background:var(--bg,transparent);color:inherit;border:1px solid var(--border,#ccc);border-radius:8px;font:13px/1.55 var(--ak-mono);resize:vertical;min-height:110px;max-height:320px}
.ak-hint{font-size:.8rem;opacity:.65;line-height:1.5}
.ak-hint.bad{color:var(--ak-bad);opacity:1}
.ak-link{background:none;border:0;padding:0;font:inherit;font-size:.85rem;color:var(--accent,#3b82f6);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
@media (max-width:860px){
  .ak-cols{display:none}
  .ak-row{grid-template-columns:1fr 1fr 40px;grid-template-areas:"name name menu" "key key key" "created used status" "tokens tokens tokens";row-gap:10px;padding:16px}
  .ak-c-name{grid-area:name}.ak-c-key{grid-area:key}.ak-c-created{grid-area:created}.ak-c-used{grid-area:used}.ak-c-tokens{grid-area:tokens}.ak-c-status{grid-area:status;justify-self:end}.ak-c-menu{grid-area:menu}
  [data-label]::before{content:attr(data-label);display:block;font-size:.75rem;opacity:.6;margin-bottom:2px}
  .ak-model{grid-template-columns:1fr}
  .ak-callout{flex-wrap:wrap}.ak-callout a{margin-left:30px}
}
@media (prefers-reduced-motion:reduce){.ak *{transition:none!important}}
`

const Svg = ({ children, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)
const EyeI = () => <Svg><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Svg>
const DotsI = () => <Svg><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></Svg>
const PlusI = () => <Svg><path d="M12 5v14M5 12h14" /></Svg>
const CopyI = () => <Svg><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></Svg>
const CheckI = () => <Svg><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>
const KeyI = ({ size = 22 }) => <Svg size={size}><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3" /></Svg>
const WarnI = () => <Svg><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18v.01" /></Svg>

function Modal({ children, onClose, width = 450 }) {
  return (
    <div style={overlayStyle} onMouseDown={e => { if (onClose && e.target === e.currentTarget) onClose() }}>
      <div className="card" role="dialog" aria-modal="true"
        style={{ maxWidth: width, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '28px', borderRadius: '18px', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>
        {children}
      </div>
    </div>
  )
}

// In-app replacement for window.alert / window.confirm.
function NoticeDialog({ dialog, onClose }) {
  const { t } = useI18n()
  const { type = 'info', title, message, body, confirmLabel, onConfirm } = dialog
  const confirming = typeof onConfirm === 'function'
  return (
    <Modal onClose={onClose} width={420}>
      <div className={`ak-badge ${type === 'error' ? 'bad' : 'info'}`}>{type === 'error' ? <WarnI /> : <KeyI size={18} />}</div>
      <h3 style={{ margin: '14px 0 8px', textAlign: 'center' }}>{title}</h3>
      {message && <p style={{ marginBottom: '16px', textAlign: 'center', opacity: 0.8, lineHeight: 1.5 }}>{message}</p>}
      {body && <div style={{ marginBottom: '16px' }}>{body}</div>}
      <div className="row" style={{ justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <Button variant={confirming ? 'ghost' : undefined} onClick={onClose}>
          {confirming ? t('common.cancel') : t('common.close')}
        </Button>
        {confirming && (
          <Button onClick={() => { onClose(); onConfirm() }}
            style={type === 'error' ? { background: TONES.error, borderColor: TONES.error } : undefined}>
            {confirmLabel || t('common.confirm')}
          </Button>
        )}
      </div>
    </Modal>
  )
}

// Row action menu. Rendered in a portal with fixed positioning so the table's
// overflow container can never clip it.
function RowMenu({ menu, onClose, onRename, onSettings, onCache, onToggle, onDelete }) {
  const { t } = useI18n()

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true) // capture: also catches the table's own scroll
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  const { k, top, bottom, right } = menu

  // Style cơ bản cho các item trong menu
  const itemStyle = {
    background: 'transparent',
    border: 'none',
    color: 'inherit',
    padding: '8px 12px',
    justifyContent: 'flex-start',
    textAlign: 'left',
    width: '100%',
    cursor: 'pointer',
    borderRadius: '4px',
    fontSize: '14px',
    transition: 'background 0.15s ease',
  }

  return createPortal(
    <>
      <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1100 }} />
      <div role="menu" style={{
        position: 'fixed', top, bottom, right, zIndex: 1101, minWidth: '160px', padding: '6px',
        display: 'flex', flexDirection: 'column', gap: '2px',
        background: 'var(--card-bg, var(--bg-card, var(--bg, #1e293b)))',
        color: 'var(--text-color, var(--text, #f8fafc))',
        border: '1px solid var(--border, #334155)',
        borderRadius: '12px',
        boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
      }}>
        <button
          role="menuitem"
          style={itemStyle}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-bg, rgba(128, 128, 128, 0.15))'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          onClick={() => onRename(k)}
        >
          {t('keys.rename')}
        </button>

        <button
          role="menuitem"
          style={itemStyle}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-bg, rgba(128, 128, 128, 0.15))'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          onClick={() => onSettings(k)}
        >
          {t('keys.settings')}
        </button>

        <button
          role="menuitem"
          style={itemStyle}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-bg, rgba(128, 128, 128, 0.15))'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          onClick={() => onCache(k)}
        >
          {t('keys.cache')}
        </button>

        <button
          role="menuitem"
          style={itemStyle}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-bg, rgba(128, 128, 128, 0.15))'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          onClick={() => onToggle(k)}
        >
          {t(k.status === 'active' ? 'keys.disable' : 'keys.enable')}
        </button>

        <button
          role="menuitem"
          style={{ ...itemStyle, color: TONES.error }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          onClick={() => onDelete(k)}
        >
          {t('keys.delete')}
        </button>
      </div>
    </>,
    document.body
  )
}

// "3 IPs · 2 domains · 60/min", or '' when the key has no restrictions.
function accessSummary(k, t) {
  const a = k.access || {}
  const parts = []
  if (a.ips?.length) parts.push(t('keys.nIps', { n: a.ips.length }))
  if (a.domains?.length) parts.push(t('keys.nDomains', { n: a.domains.length }))
  if (a.rateLimitPerMin != null) parts.push(t('keys.nPerMin', { n: a.rateLimitPerMin.toLocaleString() }))
  if (k.cacheEnabled) parts.push(t('keys.cacheOn'))
  return parts.join(' · ')
}

// One "Any ... / Only ..." choice; the editor (children) only shows for the restricted option.
function AccessField({ title, name, on, onToggle, anyLabel, onlyLabel, children }) {
  return (
    <div className="ak-field" role="group" aria-label={title}>
      <h4>{title}</h4>
      <div className="ak-opts">
        <label className="ak-opt"><input type="radio" name={name} checked={!on} onChange={() => onToggle(false)} />{anyLabel}</label>
        <label className="ak-opt"><input type="radio" name={name} checked={on} onChange={() => onToggle(true)} />{onlyLabel}</label>
      </div>
      {on && children}
    </div>
  )
}

function EntryBox({ value, onChange, count, placeholder, hint }) {
  const { t } = useI18n()
  return (
    <>
      <textarea className="ak-area" rows={6} spellCheck={false} autoCapitalize="off" value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)} />
      <p className={`ak-hint${count > MAX_ENTRIES ? ' bad' : ''}`}>{t('keys.entries', { n: count, max: MAX_ENTRIES })}</p>
      <p className="ak-hint">{hint}</p>
    </>
  )
}

// Per-key rules: allowed IPs, allowed domains, requests per minute. Every default is "no restriction".
function AccessModal({ k, onClose, onSaved }) {
  const { t } = useI18n()
  const a = k.access || {}
  const [rateOn, setRateOn] = useState(a.rateLimitPerMin != null)
  const [rate, setRate] = useState(a.rateLimitPerMin != null ? String(a.rateLimitPerMin) : '60')
  const [ipsOn, setIpsOn] = useState(!!a.ips?.length)
  const [ips, setIps] = useState((a.ips || []).join('\n'))
  const [domOn, setDomOn] = useState(!!a.domains?.length)
  const [doms, setDoms] = useState((a.domains || []).join('\n'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const ipList = useMemo(() => parseEntries(ips), [ips])
  const domList = useMemo(() => parseEntries(doms), [doms])

  const save = async () => {
    if (saving) return
    const n = Number(rate)
    if (rateOn && !(Number.isInteger(n) && n >= 1 && n <= MAX_RATE)) return setError(t('keys.rateInvalid', { max: MAX_RATE.toLocaleString() }))
    if (ipsOn && !ipList.length) return setError(t('keys.ipsEmpty'))
    if (domOn && !domList.length) return setError(t('keys.domainsEmpty'))
    if ((ipsOn && ipList.length > MAX_ENTRIES) || (domOn && domList.length > MAX_ENTRIES)) return setError(t('keys.tooMany', { max: MAX_ENTRIES }))
    setSaving(true); setError('')
    try {
      await keysApi.setAccess(k.id, {
        ips: ipsOn ? ipList : null,
        domains: domOn ? domList : null,
        rateLimitPerMin: rateOn ? n : null,
      })
      onSaved()
    } catch (e) {
      setError(e.message); setSaving(false)
    }
  }

  return (
    <Modal width={580}>
      <div className="ak-badge info"><KeyI /></div>
      <h3 style={{ margin: '14px 0 6px', textAlign: 'center' }}>{t('keys.accessTitle')}</h3>
      <p style={{ margin: '0 0 18px', textAlign: 'center', opacity: 0.75, lineHeight: 1.5 }}>{t('keys.accessIntro', { name: k.name })}</p>

      <AccessField title={t('keys.rateTitle')} name="ak-rate" on={rateOn} onToggle={setRateOn}
        anyLabel={t('keys.rateUnlimited')} onlyLabel={t('keys.rateLimited')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input type="number" min={1} max={MAX_RATE} step={1} value={rate} onChange={e => setRate(e.target.value)}
            aria-label={t('keys.rateTitle')} style={{ ...inputStyle, width: 140 }} />
          <span>{t('keys.perMin')}</span>
        </div>
      </AccessField>

      <AccessField title={t('keys.ipsTitle')} name="ak-ips" on={ipsOn} onToggle={setIpsOn}
        anyLabel={t('keys.ipsAny')} onlyLabel={t('keys.ipsOnly')}>
        <EntryBox value={ips} onChange={setIps} count={ipList.length} placeholder={'203.0.113.7\n198.51.100.0/24\n2001:db8::/32'} hint={t('keys.ipsHint')} />
      </AccessField>

      <AccessField title={t('keys.domainsTitle')} name="ak-domains" on={domOn} onToggle={setDomOn}
        anyLabel={t('keys.domainsAny')} onlyLabel={t('keys.domainsOnly')}>
        <EntryBox value={doms} onChange={setDoms} count={domList.length} placeholder={'app.example.com\n*.example.org'} hint={t('keys.domainsHint')} />
      </AccessField>

      {error && (
        <div role="alert" style={{
          margin: '4px 0 16px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px',
          color: TONES.error, background: 'rgba(239,68,68,0.1)', border: '1px solid ' + TONES.error,
        }}>{error}</div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end', gap: '8px' }}>
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button onClick={save} disabled={saving}>{t('keys.save')}</Button>
      </div>
    </Modal>
  )
}

// 6-digit code field: digits only, masked, numeric keypad on phones.
function OtpInput({ value, onChange, onEnter, placeholder, autoFocus, invalid }) {
  return (
    <input type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus={autoFocus}
      value={value} placeholder={placeholder} aria-invalid={!!invalid}
      onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      onKeyDown={e => { if (e.key === 'Enter') onEnter?.() }}
      style={{ ...inputStyle, letterSpacing: '0.4em', textAlign: 'center', fontFamily: 'var(--ak-mono)', borderColor: invalid ? TONES.error : undefined }} />
  )
}

// Asks for the OTP code, then shows the full key. The server decrypts it only for the right code.
function RevealModal({ k, onClose, onForgot }) {
  const { t } = useI18n()
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState(null)
  const [copied, setCopied] = useState(false)

  const submit = async () => {
    if (!/^\d{1,6}$/.test(otp)) return setError(t('keys.otpInvalid'))
    if (busy) return
    setBusy(true); setError('')
    try {
      setSecret((await keysApi.reveal(k.id, otp)).secret)
    } catch (e) {
      setError(e.message); setOtp('')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  if (secret) {
    return (
      <Modal width={540} onClose={onClose}>
        <div className="ak-badge ok"><CheckI /></div>
        <h3 style={{ margin: '14px 0 6px', textAlign: 'center' }}>{k.name}</h3>
        <p style={{ color: TONES.warning, marginBottom: '16px', textAlign: 'center', lineHeight: 1.5 }}>{t('keys.revealWarn')}</p>
        <div className="ak-secret">
          <code>{secret}</code>
          <button type="button" className="ak-copy" onClick={copy}>
            {copied ? <CheckI /> : <CopyI />}{copied ? t('common.copied') : t('common.copy')}
          </button>
        </div>
        <div className="row" style={{ justifyContent: 'center', marginTop: '20px' }}>
          <Button onClick={onClose}>{t('keys.done')}</Button>
        </div>
      </Modal>
    )
  }

  // Keys created before OTP protection have no encrypted copy, so there is nothing to reveal.
  if (!k.canReveal) {
    return (
      <Modal width={420} onClose={onClose}>
        <div className="ak-badge info"><KeyI size={18} /></div>
        <h3 style={{ margin: '14px 0 8px', textAlign: 'center' }}>{t('keys.infoTitle')}</h3>
        <p style={{ marginBottom: '12px', textAlign: 'center', opacity: 0.8, lineHeight: 1.5 }}>{t('keys.infoBody')}</p>
        <code style={{ ...codeBoxStyle, textAlign: 'center', marginBottom: '12px' }}>{k.prefix}••••••••••••••••</code>
        <p style={{ fontSize: '13px', opacity: 0.8, textAlign: 'center', marginBottom: '16px' }}>{t('keys.infoLost', { name: k.name })}</p>
        <div className="row" style={{ justifyContent: 'center' }}><Button onClick={onClose}>{t('keys.done')}</Button></div>
      </Modal>
    )
  }

  return (
    <Modal width={420} onClose={onClose}>
      <div className="ak-badge info"><KeyI size={18} /></div>
      <h3 style={{ margin: '14px 0 6px', textAlign: 'center' }}>{t('keys.revealTitle')}</h3>
      <p style={{ margin: '0 0 6px', textAlign: 'center', opacity: 0.75, lineHeight: 1.5 }}>{t('keys.revealPrompt', { name: k.name })}</p>
      <code style={{ ...codeBoxStyle, textAlign: 'center', margin: '0 0 14px' }}>{k.prefix}••••••••••••••••</code>
      <OtpInput autoFocus value={otp} onChange={v => { setOtp(v); if (error) setError('') }} onEnter={submit}
        placeholder="••••••" invalid={!!error} />
      {error && (
        <div role="alert" style={{
          marginTop: '12px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px',
          color: TONES.error, background: 'rgba(239,68,68,0.1)', border: '1px solid ' + TONES.error,
        }}>{error}</div>
      )}
      <button type="button" className="ak-link" style={{ marginTop: '12px' }} onClick={onForgot}>{t('keys.forgotOtp')}</button>
      <div className="row" style={{ justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button onClick={submit} disabled={busy}>{t('keys.reveal')}</Button>
      </div>
    </Modal>
  )
}

// Forgot OTP: emailed code -> verify -> old OTP + new OTP + confirmation.
function ForgotOtpModal({ onClose }) {
  const { t } = useI18n()
  const [step, setStep] = useState('send') // send -> code -> reset -> done
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [token, setToken] = useState('')
  const [newOtp, setNewOtp] = useState('')
  const [confirmOtp, setConfirmOtp] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async fn => {
    if (busy) return
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const clear = set => v => { set(v); if (error) setError('') }

  const send = () => run(async () => {
    setEmail((await keysApi.forgotOtp()).email); setCode(''); setStep('code')
  })
  const verify = () => run(async () => {
    if (!/^\d{6}$/.test(code)) throw new Error(t('keys.forgotCodeInvalid'))
    setToken((await keysApi.verifyOtpReset(code)).resetToken); setStep('reset')
  })
  const save = () => run(async () => {
    if (!/^\d{1,6}$/.test(newOtp)) throw new Error(t('keys.otpInvalid'))
    if (newOtp !== confirmOtp) throw new Error(t('keys.otpNewMismatch'))
    await keysApi.resetOtp({ resetToken: token, newOtp, confirmNewOtp: confirmOtp })
    setStep('done')
  })

  const titles = { send: 'forgotTitle', code: 'forgotCodeTitle', reset: 'forgotResetTitle', done: 'forgotDoneTitle' }
  const bodies = { send: ['forgotSendBody'], code: ['forgotCodeBody', { email }], reset: ['forgotResetBody'], done: ['forgotDoneBody'] }

  return (
    <Modal width={420} onClose={step === 'done' ? onClose : undefined}>
      <div className={`ak-badge ${step === 'done' ? 'ok' : 'info'}`}>{step === 'done' ? <CheckI /> : <KeyI size={18} />}</div>
      <h3 style={{ margin: '14px 0 6px', textAlign: 'center' }}>{t(`keys.${titles[step]}`)}</h3>
      <p style={{ margin: '0 0 16px', textAlign: 'center', opacity: 0.75, lineHeight: 1.5 }}>{t(`keys.${bodies[step][0]}`, bodies[step][1])}</p>

      {step === 'code' && (
        <>
          <OtpInput autoFocus value={code} onChange={clear(setCode)} onEnter={verify} placeholder="••••••" invalid={!!error} />
          <button type="button" className="ak-link" style={{ marginTop: '12px' }} onClick={send} disabled={busy}>{t('keys.forgotResend')}</button>
        </>
      )}
      {step === 'reset' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <OtpInput autoFocus value={newOtp} onChange={clear(setNewOtp)} placeholder={t('keys.otpNewPlaceholder')} invalid={!!error} />
          <OtpInput value={confirmOtp} onChange={clear(setConfirmOtp)} onEnter={save} placeholder={t('keys.otpNewConfirmPlaceholder')} invalid={!!error} />
          <p className="ak-hint">{t('keys.forgotWipeHint')}</p>
        </div>
      )}

      {error && (
        <div role="alert" style={{
          marginTop: '12px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px',
          color: TONES.error, background: 'rgba(239,68,68,0.1)', border: '1px solid ' + TONES.error,
        }}>{error}</div>
      )}

      <div className="row" style={{ justifyContent: step === 'done' ? 'center' : 'flex-end', gap: '8px', marginTop: '20px' }}>
        {step === 'done' ? <Button onClick={onClose}>{t('keys.done')}</Button> : (
          <>
            <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
            {step === 'send' && <Button onClick={send} disabled={busy}>{t('keys.forgotSend')}</Button>}
            {step === 'code' && <Button onClick={verify} disabled={busy}>{t('keys.forgotVerify')}</Button>}
            {step === 'reset' && <Button onClick={save} disabled={busy}>{t('keys.forgotSave')}</Button>}
          </>
        )}
      </div>
    </Modal>
  )
}

// Documentation shown directly on the page (no click needed to reveal it).
function ApiDocs() {
  const { t } = useI18n()
  const [tab, setTab] = useState(SAMPLE_TEMPLATES[0].id)
  const [copied, setCopied] = useState(false)
  // Samples show the first model; the list below gives every model's endpoint and "model" value.
  const samples = useMemo(() => buildSamples(MODELS[0]), [])
  const current = samples.find(s => s.id === tab)

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(current.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <section id="api-docs" className="ak-panel" style={{ padding: '24px' }}>
      <h3 style={{ fontSize: '1.25rem', letterSpacing: '-0.01em' }}>{t('keys.docsTitle')}</h3>
      <p className="ak-sub">{t('keys.docsIntro', { placeholder: API_KEY_PLACEHOLDER })}</p>

      <div className="ak-term">
        <div className="ak-term-bar">
          <span className="ak-dots" aria-hidden="true"><i /><i /><i /></span>
          <div role="tablist" className="ak-tabs">
            {samples.map(s => (
              <button key={s.id} type="button" role="tab" aria-selected={tab === s.id} className="ak-tab"
                onClick={() => { setTab(s.id); setCopied(false) }}>
                {s.label}
              </button>
            ))}
          </div>
          <button type="button" className="ak-copy" onClick={copyCode}>
            {copied ? <CheckI /> : <CopyI />}{copied ? t('common.copied') : t('common.copy')}
          </button>
        </div>
        <pre className="ak-pre"><code>{current.code.split('\n').map((line, i) => (
          <span key={i} className={/^\s*(#|\/\/)/.test(line) ? 'cm' : undefined}>{line}{'\n'}</span>
        ))}</code></pre>
      </div>

      <h4 style={{ margin: '28px 0 0', fontSize: '1.05rem' }}>{t('keys.switchTitle')}</h4>
      <div className="ak-models">
        <div className="ak-sr">{t('keys.docsModel')} / {t('keys.docsEndpoint')} / model</div>
        {MODELS.map(m => (
          <div key={m.id} className="ak-model">
            <strong>{m.label}</strong>
            <code>POST {endpointOf(m)}</code>
            <span className="ak-chip" style={{ padding: '3px 10px' }}><code>{m.name}</code></span>
          </div>
        ))}
      </div>
      <ol className="ak-steps">
        <li>{t('keys.switchStep1')}</li>
        <li>{t('keys.switchStep2')}</li>
        <li>{t('keys.switchStep3')}</li>
        <li>{t('keys.switchStep4')}</li>
      </ol>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function ApiKeys() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const keys = useApi(keysApi.list)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [createError, setCreateError] = useState('')
  const [editId, setEditId] = useState(null)
  const [editName, setEditName] = useState('')
  const [secret, setSecret] = useState(null)
  const [copied, setCopied] = useState(false)
  const [menu, setMenu] = useState(null)   // { k, top?, bottom?, right }
  const [dialog, setDialog] = useState(null)
  const [settingsKey, setSettingsKey] = useState(null) // key whose access rules are being edited
  const otpQ = useApi(keysApi.otpStatus)           // { registered }
  const registered = !!otpQ.data?.registered
  const [step, setStep] = useState('name')          // create flow: 'name' -> 'otp' (register or enter the code)
  const [otp, setOtp] = useState('')
  const [confirmOtp, setConfirmOtp] = useState('')
  const [revealing, setRevealing] = useState(null)  // key whose full value is being unlocked
  const [forgot, setForgot] = useState(false)       // "Forgot OTP" dialog

  const list = keys.data || []
  const full = list.length >= MAX_KEYS

  const closeDialog = () => setDialog(null)
  const closeMenu = () => setMenu(null)
  const showError = message => setDialog({ type: 'error', title: t('keys.errorTitle'), message })

  const act = async fn => { try { await fn(); keys.reload() } catch (e) { showError(e.message) } }

  const openCreate = () => { setName(''); setOtp(''); setConfirmOtp(''); setStep('name'); setCreateError(''); setCreating(true) }
  const closeCreate = () => { setCreating(false); setName(''); setOtp(''); setConfirmOtp(''); setStep('name'); setCreateError('') }

  const create = async () => {
    const next = name.trim()
    if (!next) return setCreateError(t('keys.nameRequired'))
    // Every creation goes through the OTP step: first time it registers the code (enter + confirm),
    // afterwards the user must enter the correct existing code. The server verifies it (the real gate).
    if (step === 'name') { setCreateError(''); return setStep('otp') }
    if (!/^\d{1,6}$/.test(otp)) return setCreateError(t('keys.otpInvalid'))
    if (!registered && otp !== confirmOtp) return setCreateError(t('keys.otpMismatch'))
    if (saving) return
    setSaving(true); setCreateError('')
    try {
      const k = await keysApi.create(next, otp, registered ? undefined : confirmOtp)
      closeCreate(); setSecret(k.secret)
      keys.reload(); otpQ.reload()
    } catch (e) {
      setCreateError(e.message)
      if (registered) setOtp('') // wrong code: clear it so the user retypes
    } finally {
      setSaving(false)
    }
  }

  const saveRename = k => {
    const next = editName.trim()
    setEditId(null)
    if (next && next !== k.name) act(() => keysApi.rename(k.id, next))
  }

  const remove = k => setDialog({
    type: 'error',
    title: t('keys.deleteTitle'),
    message: t('keys.confirmDelete', { name: k.name }),
    confirmLabel: t('keys.delete'),
    onConfirm: () => act(() => keysApi.remove(k.id)),
  })

  // The server keeps the key's suffix encrypted with the user's OTP code; the full key comes back only for the right code.
  const viewKey = k => setRevealing(k)

  // Position the menu next to the button; flip upward when there is no room below.
  const openMenu = (e, k) => {
    if (menu?.k.id === k.id) return closeMenu()
    const r = e.currentTarget.getBoundingClientRect()
    const openUp = r.bottom + 235 > window.innerHeight
    setMenu({
      k,
      right: Math.max(8, window.innerWidth - r.right),
      top: openUp ? undefined : r.bottom + 4,
      bottom: openUp ? window.innerHeight - r.top + 4 : undefined,
    })
  }

  const copy = async text => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }


  const pct = Math.min(100, Math.round((list.length / MAX_KEYS) * 100))

  return (
    <div className="ak">
      <style>{CSS}</style>

      <section className="ak-panel">
        <div className="ak-head">
          <div>
            <h2>{t('keys.title')}</h2>
            <p className="ak-sub">{t('keys.desc')}</p>
            <div className="ak-meter" title={`${list.length}/${MAX_KEYS}`}>
              <div className="ak-meter-bar"><i style={{ width: pct + '%', background: full ? 'var(--ak-warn)' : undefined }} /></div>
              <span>{list.length}/{MAX_KEYS}</span>
            </div>
          </div>
          <Button onClick={openCreate} disabled={full}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><PlusI />{t('keys.create')}</span>
          </Button>
        </div>

        <div className="ak-callout" role="note">
          <WarnI />
          <div><strong>{t('keys.warnTitle')}</strong> <span style={{ opacity: 0.85 }}>{t('keys.warnBody')}</span></div>
          <a href="#api-docs" onClick={e => { e.preventDefault(); document.getElementById('api-docs')?.scrollIntoView({ behavior: 'smooth' }) }}>
            {t('keys.docs')}
          </a>
        </div>

        {full && <div className="alert" style={{ margin: '0 24px 24px' }}>{t('keys.limit', { n: MAX_KEYS })}</div>}

        {dialog && <NoticeDialog dialog={dialog} onClose={closeDialog} />}

        {revealing && <RevealModal k={revealing} onClose={() => setRevealing(null)}
          onForgot={() => { setRevealing(null); setForgot(true) }} />}

        {forgot && <ForgotOtpModal onClose={() => setForgot(false)} />}

        {settingsKey && (
          <AccessModal k={settingsKey} onClose={() => setSettingsKey(null)}
            onSaved={() => { setSettingsKey(null); keys.reload() }} />
        )}

        {menu && (
          <RowMenu menu={menu} onClose={closeMenu}
            onRename={k => { setEditId(k.id); setEditName(k.name); closeMenu() }}
            onSettings={k => { closeMenu(); setSettingsKey(k) }}
            onCache={k => { closeMenu(); navigate(`/dashboard/cache?key=${k.id}`) }}
            onToggle={k => { closeMenu(); act(() => keysApi.setStatus(k.id, k.status === 'active' ? 'disabled' : 'active')) }}
            onDelete={k => { closeMenu(); remove(k) }} />
        )}

        {creating && (
          <Modal onClose={closeCreate}>
            <div className="ak-badge info"><KeyI /></div>
            <h3 style={{ margin: '14px 0 6px', textAlign: 'center' }}>
              {step === 'name' ? t('keys.create') : registered ? t('keys.otpEnterTitle') : t('keys.otpSetupTitle')}
            </h3>
            <p style={{ margin: '0 0 16px', textAlign: 'center', opacity: 0.75, lineHeight: 1.5 }}>
              {step === 'name' ? t('keys.namePrompt') : registered ? t('keys.otpEnterBody') : t('keys.otpSetupBody')}
            </p>

            {step === 'name' ? (
              <input autoFocus value={name} maxLength={100} placeholder={t('keys.name')}
                aria-invalid={!!createError}
                onChange={e => { setName(e.target.value); if (createError) setCreateError('') }}
                onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') closeCreate() }}
                style={{ ...inputStyle, marginBottom: createError ? '8px' : '20px', borderColor: createError ? TONES.error : undefined }} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: createError ? '8px' : '20px' }}>
                {registered ? (
                  <>
                    <OtpInput autoFocus value={otp} placeholder="••••••" invalid={!!createError}
                      onChange={v => { setOtp(v); if (createError) setCreateError('') }} onEnter={create} />
                    <button type="button" className="ak-link"
                      onClick={() => { closeCreate(); setForgot(true) }}>{t('keys.forgotOtp')}</button>
                  </>
                ) : (
                  <>
                    <OtpInput autoFocus value={otp} placeholder={t('keys.otpPlaceholder')} invalid={!!createError}
                      onChange={v => { setOtp(v); if (createError) setCreateError('') }} />
                    <OtpInput value={confirmOtp} placeholder={t('keys.otpConfirmPlaceholder')} invalid={!!createError}
                      onChange={v => { setConfirmOtp(v); if (createError) setCreateError('') }} onEnter={create} />
                    <p className="ak-hint">{t('keys.otpSetupHint')}</p>
                  </>
                )}
              </div>
            )}

            {createError && (
              <div role="alert" style={{
                marginBottom: '16px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px',
                color: TONES.error, background: 'rgba(239,68,68,0.1)', border: '1px solid ' + TONES.error,
              }}>{createError}</div>
            )}
            <div className="row" style={{ justifyContent: 'flex-end', gap: '8px' }}>
              {step === 'otp'
                ? <Button variant="ghost" onClick={() => { setStep('name'); setCreateError('') }}>{t('keys.back')}</Button>
                : <Button variant="ghost" onClick={closeCreate}>{t('common.cancel')}</Button>}
              <Button onClick={create} disabled={saving}>
                {step === 'name' ? t('keys.next') : registered ? t('keys.generate') : t('keys.otpRegisterAndGenerate')}
              </Button>
            </div>
          </Modal>
        )}

        {secret && (
          <Modal width={540}>
            <div className="ak-badge ok"><CheckI /></div>
            <h3 style={{ margin: '14px 0 6px', textAlign: 'center' }}>{t('keys.createdTitle')}</h3>
            <p style={{ color: TONES.warning, marginBottom: '16px', textAlign: 'center', lineHeight: 1.5 }}>{t('keys.notice')}</p>
            <div className="ak-secret">
              <code>{secret}</code>
              <button type="button" className="ak-copy" onClick={() => copy(secret)}>
                {copied ? <CheckI /> : <CopyI />}{copied ? t('common.copied') : t('common.copy')}
              </button>
            </div>
            <div className="row" style={{ justifyContent: 'center', marginTop: '20px' }}>
              <Button onClick={() => setSecret(null)}>{t('keys.done')}</Button>
            </div>
          </Modal>
        )}

        <DataState query={keys}>
          {!list.length ? (
            <div className="ak-empty">
              <div className="ak-badge"><KeyI /></div>
              <p style={{ opacity: 0.75, maxWidth: '40ch', lineHeight: 1.5 }}>{t('keys.empty')}</p>
              <Button onClick={openCreate}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><PlusI />{t('keys.create')}</span>
              </Button>
            </div>
          ) : (
            <div role="table">
              <div className="ak-cols" role="row">
                <span>{t('keys.colName')}</span>
                <span>{t('keys.colKey')}</span>
                <span>{t('keys.colCreated')}</span>
                <span>{t('keys.colLastUsed')}</span>
                <span>{t('keys.colTokens')}</span>
                <span>{t('keys.colStatus')}</span>
                <span className="ak-sr">{t('keys.colActions')}</span>
              </div>
              {list.map(k => {
                const active = k.status === 'active'
                return (
                  <div key={k.id} role="row" className={`ak-row${active ? '' : ' off'}`}>
                    <div className="ak-c-name">
                      {editId === k.id
                        ? <input autoFocus className="ak-inline" value={editName} maxLength={100} onChange={e => setEditName(e.target.value)}
                            onBlur={() => saveRename(k)}
                            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditId(null) }} />
                        : <>
                            <div className="ak-name" title={k.name}>{k.name}</div>
                            {accessSummary(k, t) && <small className="ak-sm">{accessSummary(k, t)}</small>}
                          </>}
                    </div>

                    <div className="ak-c-key">
                      <span className="ak-chip">
                        <code>{k.prefix}••••••••</code>
                        <button type="button" className="ak-ib" onClick={() => viewKey(k)} title={t('keys.viewKey')} aria-label={t('keys.viewKey')}><EyeI /></button>
                      </span>
                    </div>

                    <div className="ak-c-created" data-label={t('keys.colCreated')}>{fmtDate(k.createdAt)}</div>

                    <div className="ak-c-used" data-label={t('keys.colLastUsed')}>
                      <div>{k.lastUsedAt ? ago(k.lastUsedAt, t) : t('keys.never')}</div>
                      {k.requestCount > 0 && <small className="ak-sm">{t('keys.requests', { n: k.requestCount.toLocaleString() })}</small>}
                    </div>

                    <div className="ak-c-tokens" data-label={t('keys.colTokens')}>
                      <div>{fmtTokens(k.tokensUsed)}</div>
                      {k.tokensUsed > 0 && <small className="ak-sm">{t('keys.tokensSplit', { input: compactTokens(k.promptTokens), output: compactTokens(k.completionTokens) })}</small>}
                    </div>

                    <div className="ak-c-status">
                      <span className={`ak-pill${active ? ' on' : ''}`}><i />{t(active ? 'keys.active' : 'keys.disabled')}</span>
                    </div>

                    <div className="ak-c-menu" style={{ textAlign: 'right' }}>
                      <button type="button" className="ak-ib" aria-label={t('keys.colActions')} aria-haspopup="menu" onClick={e => openMenu(e, k)}><DotsI /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </DataState>
      </section>

      <ApiDocs />
    </div>
  )
}