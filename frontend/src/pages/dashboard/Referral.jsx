import { useState } from 'react'
import DataState from '../../components/DataState.jsx'
import { useApi } from '../../hooks/useApi.js'
import { referralsApi } from '../../api/index.js'
import { useI18n } from '../../i18n/index.jsx'
import '../../styles/overview.css'
import '../../styles/referral.css'

const int = n => Math.round(Number(n) || 0).toLocaleString()
const day = iso => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

export default function Referral() {
  const { t } = useI18n()
  const query = useApi(referralsApi.get)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [claimed, setClaimed] = useState(null) // result of a claim made on this page
  const [copied, setCopied] = useState(false)

  const d = query.data
  const claim = claimed || d?.claim // either way the code can't be used again

  const copy = async () => {
    try { await navigator.clipboard.writeText(d.code) } catch { return }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const submit = async e => {
    e.preventDefault()
    if (busy || !code.trim()) return
    setBusy(true); setError('')
    try {
      const res = await referralsApi.claim(code.trim())
      setClaimed({ status: res.status, tokens: res.tokensAwarded })
      setCode('')
    } catch (err) {
      setError(err.message || t('referral.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w2">
      <header className="w-hd">
        <div>
          <h1>{t('referral.title')}</h1>
          <p className="w-sub">{t('referral.subtitle', { tokens: int(d?.bonusTokens ?? 1000000) })}</p>
        </div>
      </header>

      <DataState query={query}>
        <div className="w-grid w-g2">
          <section className="w-card">
            <div className="w-ch"><h3>{t('referral.yourCode')}</h3></div>
            <div className="w-row">
              <code className="w-ref-code">{d?.code}</code>
              <button className="w-btn" onClick={copy} disabled={!d} aria-live="polite">{copied ? t('referral.copied') : t('referral.copy')}</button>
            </div>
            <p className="w-mut" style={{ marginTop: 12 }}>
              {t('referral.earned', { tokens: int(d?.totalEarned), n: d?.invited.filter(i => i.status === 'completed').length ?? 0 })}
            </p>
          </section>

          <section className="w-card">
            <div className="w-ch"><h3>{t('referral.haveCode')}</h3></div>
            {claim ? (
              <div className="ref-done">
                <span className="w-badge ok">{t('referral.status.completed')}</span>
                <span>{t('referral.claimedMsg', { tokens: int(claim.tokens) })}</span>
              </div>
            ) : (
              <form className="ref-claim" onSubmit={submit}>
                <input value={code} onChange={e => setCode(e.target.value)} maxLength={12} autoComplete="off" spellCheck={false}
                  placeholder={t('referral.placeholder')} aria-label={t('referral.haveCode')} aria-invalid={!!error} />
                <button className="w-btn pri" type="submit" disabled={busy || !code.trim()}>{busy ? t('referral.claiming') : t('referral.claim')}</button>
              </form>
            )}
            {error && <p className="ref-msg err" role="alert">{error}</p>}
            {claimed && <p className="ref-msg ok" role="status">{t('referral.success', { tokens: int(claimed.tokens) })}</p>}
          </section>
        </div>

        <section className="w-card">
          <div className="w-ch"><h3>{t('referral.invited')}</h3></div>
          {!d?.invited.length ? (
            <div className="w-state">{t('referral.empty')}</div>
          ) : (
            <div className="w-tw">
              <table className="w-table">
                <thead>
                  <tr>
                    <th>{t('referral.col.friend')}</th>
                    <th>{t('referral.col.date')}</th>
                    <th className="n">{t('referral.col.tokens')}</th>
                    <th>{t('referral.col.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.invited.map(i => (
                    <tr key={i.id}>
                      <td>{i.email}</td>
                      <td>{i.completedAt ? day(i.completedAt) : <span className="w-mut">–</span>}</td>
                      <td className="n">{int(i.tokens)}</td>
                      <td><span className={`w-badge ${i.status === 'completed' ? 'ok' : ''}`}>{t(`referral.status.${i.status}`)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </DataState>
    </div>
  )
}
