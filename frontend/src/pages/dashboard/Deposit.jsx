import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '../../components/Button.jsx'
import DataState from '../../components/DataState.jsx'
import { useApi } from '../../hooks/useApi.js'
import { depositsApi } from '../../api/index.js'
import { fmtDate } from '../../lib/format.js'
import { fmtUsd } from '../../lib/pricing.js'
import { useI18n } from '../../i18n/index.jsx'

const PRESETS = [50000, 100000, 200000, 500000]
const POLL_MS = 5000
// vietqr.app image options: template / showinfo / fullacc are display options, holder is the account holder's name.
const QR_STYLE = 'template=compact&showinfo=true&fullacc=true'

export default function Deposit() {
  const { t, lang } = useI18n()
  // {name} placeholders, same helper as Billing.jsx
  const tf = (key, vars = {}) => Object.entries(vars).reduce((o, [k, v]) => o.replaceAll(`{${k}}`, v), t(key))
  const nf = useMemo(() => new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'vi-VN'), [lang])
  const vnd = n => nf.format(n) + ' ₫'

  const q = useApi(depositsApi.get)
  const [amount, setAmount] = useState('')
  const [copied, setCopied] = useState('')
  const [notice, setNotice] = useState(null) // { ok, text }: modal about a deposit that landed while this page was open
  const [fresh, setFresh] = useState(() => new Set()) // ids of history rows to highlight

  // Poll while the tab is visible, so a scanned-and-paid transfer shows up without a reload.
  // (Server side: the webhook credits instantly; DEPOSIT_MODE=poll credits within one poll interval.)
  // Fetches depositsApi.get() directly instead of relying on the useApi hook's refetch (which may not exist
  // or may not update q.data). `live` holds the newest response; it takes over from q.data once it arrives.
  const [live, setLive] = useState(null)
  useEffect(() => {
    let alive = true
    const tick = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const d = await depositsApi.get()
        if (alive) setLive(d)
      } catch { /* transient network error: the next tick retries */ }
    }
    const id = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [])
  const data = live ?? q.data

  // Highest deposit id seen so far (set at page load). Any row above it arrived while this page was open:
  // the history table already shows it (it comes from the same refetch), and we announce it in the modal.
  const seen = useRef(null)
  useEffect(() => {
    const items = data?.items
    if (!items) return
    const top = items.reduce((m, i) => Math.max(m, Number(i.id)), 0)
    if (seen.current === null) { seen.current = top; return }
    const added = items.filter(i => Number(i.id) > seen.current)
    if (!added.length) return
    seen.current = top
    const paid = added.filter(i => i.status === 'completed')
    if (paid.length) {
      setNotice({
        ok: true,
        text: tf('deposit.received', {
          vnd: vnd(paid.reduce((s, i) => s + i.amountVnd, 0)),
          usd: fmtUsd(Math.round(paid.reduce((s, i) => s + i.amountUsd, 0) * 100)),
        }),
      })
    } else {
      // A transfer arrived but was not credited (e.g. below the minimum): tell the user instead of staying silent.
      setNotice({ ok: false, text: `${statusLabel(added[0].status)}: ${vnd(added[0].amountVnd)}` })
    }
    setFresh(new Set(added.map(i => i.id)))
  }, [data])

  // The highlight on new history rows fades after a few seconds
  useEffect(() => {
    if (!fresh.size) return
    const id = setTimeout(() => setFresh(new Set()), 8000)
    return () => clearTimeout(id)
  }, [fresh])

  const info = data
  const amt = Number(amount.replace(/\D/g, '')) || 0
  const qr = useMemo(() => {
    if (!info) return ''
    const e = encodeURIComponent
    let u = `${info.qrUrl}&${QR_STYLE}&holder=${e(info.accountName)}`
    if (amt >= info.minVnd) u += `&amount=${amt}`
    return `${u}&des=${e(info.code)}` // des = the user's transfer code: how the payment is matched to this account
  }, [info, amt])

  const copy = async (key, value) => {
    try { await navigator.clipboard.writeText(String(value)); setCopied(key); setTimeout(() => setCopied(''), 1500) } catch { /* clipboard blocked */ }
  }

  const Row = ({ k, label, value }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border, rgba(128,128,128,0.2))' }}>
      <div>
        <div className="muted" style={{ fontSize: '0.8rem' }}>{label}</div>
        <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{value}</div>
      </div>
      <Button variant="ghost" onClick={() => copy(k, value)}>{copied === k ? t('deposit.copied') : t('deposit.copy')}</Button>
    </div>
  )

  const statusLabel = s => s === 'completed' ? t('deposit.completed') : s === 'too_small' ? t('deposit.tooSmall') : t('deposit.review')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, position: 'relative' }}>
      {/* Notification modal: uses the app's themed `card` class and inherited text color, so it follows light/dark */}
      {notice && (
        <div
          role="dialog" aria-modal="true"
          onClick={() => setNotice(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'fadeIn 0.25s ease-out'
          }}>
          <div
            className="card"
            onClick={e => e.stopPropagation()}
            style={{
              padding: '32px 24px', borderRadius: 16, maxWidth: 400, width: '90%', textAlign: 'center',
              border: '1px solid var(--border, rgba(128,128,128,0.25))',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.25), 0 10px 10px -5px rgba(0,0,0,0.12)',
              animation: 'scaleUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12
            }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: notice.ok ? 'rgba(34, 197, 94, 0.15)' : 'rgba(245, 158, 11, 0.15)',
              color: notice.ok ? '#22c55e' : '#f59e0b',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32, fontWeight: 'bold',
              animation: 'bounceIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
            }}>
              {notice.ok ? '✓' : '!'}
            </div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: notice.ok ? '#22c55e' : '#f59e0b' }}>
              {notice.ok ? t('deposit.successTitle') : t('deposit.noticeTitle')}
            </div>
            <div style={{ color: 'inherit', lineHeight: 1.5 }}>{notice.text}</div>
            <Button variant="primary" style={{ width: '100%', marginTop: 8 }} onClick={() => setNotice(null)}>
              {t('deposit.close')}
            </Button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: '1.1rem', marginBottom: 16, fontWeight: 600 }}>{t('deposit.title')}</h3>
        {/* Once data exists we render it directly, so a background refetch never remounts the QR image. */}
        {!info ? <DataState query={q}>{null}</DataState> : (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 1 280px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <img src={qr} alt={t('deposit.qrAlt')} width={280} height={280}
                style={{ width: '100%', maxWidth: 280, height: 'auto', borderRadius: 12, background: '#fff' }} />
              <input
                inputMode="numeric" autoComplete="off" value={amount}
                onChange={e => setAmount(e.target.value.replace(/\D/g, '').slice(0, 12))}
                placeholder={t('deposit.amountPlaceholder')}
                style={{ padding: '10px 12px', font: 'inherit', borderRadius: 8, background: 'var(--bg, transparent)', color: 'inherit', border: '1px solid var(--border, rgba(128,128,128,0.3))' }}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {PRESETS.map(p => <Button key={p} variant="ghost" onClick={() => setAmount(String(p))}>{vnd(p)}</Button>)}
              </div>
              {amt > 0 && <div className="muted">{vnd(amt)} ≈ {fmtUsd(Math.floor((amt * 100) / info.rate))}</div>}
            </div>

            <div style={{ flex: '1 1 300px' }}>
              <Row k="bank" label={t('deposit.bank')} value={info.bank} />
              <Row k="acc" label={t('deposit.account')} value={info.accountNumber} />
              <Row k="name" label={t('deposit.holder')} value={info.accountName} />
              <Row k="code" label={t('deposit.content')} value={info.code} />
              <Row k="amt" label={t('deposit.amount')} value={amt >= info.minVnd ? String(amt) : tf('deposit.anyAmount', { min: vnd(info.minVnd) })} />
              <div className="alert" style={{ marginTop: 16 }}>{t('deposit.warn')}</div>
              <div className="muted" style={{ marginTop: 8, fontSize: '0.85rem' }}>
                {tf('deposit.rateLine', { rate: vnd(info.rate), min: vnd(info.minVnd) })}
              </div>
              {!notice && <div className="muted" style={{ marginTop: 16 }} role="status">{t('deposit.waiting')}</div>}
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: '1.1rem', marginBottom: 16, fontWeight: 600 }}>{t('deposit.history')}</h3>
        {!info ? <DataState query={q}>{null}</DataState> : !info.items.length ? <div className="muted">{t('deposit.empty')}</div> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('deposit.date')}</th>
                  <th>{t('deposit.paid')}</th>
                  <th>{t('deposit.credited')}</th>
                  <th>{t('deposit.status')}</th>
                </tr>
              </thead>
              <tbody>
                {info.items.map(i => (
                  <tr key={i.id} style={fresh.has(i.id) ? { background: 'rgba(34,197,94,0.15)', transition: 'background 1s' } : undefined}>
                    <td>{fmtDate(i.createdAt)}</td>
                    <td>{vnd(i.amountVnd)}</td>
                    <td>{i.status === 'completed' ? fmtUsd(Math.round(i.amountUsd * 100)) : '—'}</td>
                    <td><span className={`badge ${i.status === 'completed' ? 'ok' : ''}`}>{statusLabel(i.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CSS Keyframe Animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleUp {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes bounceIn {
          0% { transform: scale(0); }
          70% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  )
}