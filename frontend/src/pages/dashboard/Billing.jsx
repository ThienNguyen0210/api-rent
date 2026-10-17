import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '../../components/Button.jsx'
import DataState from '../../components/DataState.jsx'
import { useApi } from '../../hooks/useApi.js'
import { billingApi } from '../../api/index.js'
import { fmtDate } from '../../lib/format.js'
import { useI18n } from '../../i18n/index.jsx'
import { fmtUsd, fmtTokens, validatePricing, previewCustom, clampTokenInput, maxBuyableTokens } from '../../lib/pricing.js'

export default function Billing() {
  const { t } = useI18n()
  // {name} placeholders, independent of whether t() supports interpolation
  const tf = (key, vars = {}) => Object.entries(vars).reduce((o, [k, v]) => o.replaceAll(`{${k}}`, v), t(key))
  const bill = useApi(billingApi.get)
  const inv = useApi(billingApi.invoices)
  const pricingQ = useApi(billingApi.pricing)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const idem = useRef({ sig: '', key: '' }) // same key for a retry of the same purchase => never charged twice
  const [busy, setBusy] = useState(null) // package id | 'custom'
  const [custom, setCustom] = useState('')
  // Applied the moment a purchase succeeds (from the server's response), so the page updates without waiting
  // for a refetch. Cleared as soon as freshly fetched data arrives.
  const [liveBill, setLiveBill] = useState(null) // { balance, tokenBalance }
  const [newOrders, setNewOrders] = useState([]) // invoice rows created in this session
  useEffect(() => { setLiveBill(null) }, [bill.data])
  useEffect(() => { setNewOrders([]) }, [inv.data])
  const billData = liveBill ? { ...bill.data, ...liveBill } : bill.data
  const invoiceRows = [...newOrders, ...(inv.data || []).filter(i => !newOrders.some(n => n.id === i.id))]

  // Never render backend pricing that fails validation.
  const pricing = useMemo(() => validatePricing(pricingQ.data), [pricingQ.data])
  const preview = pricing && custom ? previewCustom(custom, pricing) : null

  // Cheaper package that gives >= the tokens requested (nudge toward bulk deals)
  const betterPkg = preview?.ok
    ? pricing.packages
        .filter(p => p.tokens >= preview.tokens && p.priceCents < preview.cents)
        .sort((a, b) => a.priceCents - b.priceCents)[0]
    : null

  // Purchases are paid from the USD balance. The UI check is a convenience; the server enforces everything.
  const balanceCents = Math.round((billData?.balance ?? 0) * 100)
  const canAfford = cents => balanceCents >= cents
  // Typing more than the balance can buy snaps the field to the largest purchasable amount.
  const maxBuy = pricing ? maxBuyableTokens(pricing, balanceCents) : 0
  const onCustom = e => setCustom(clampTokenInput(e.target.value, pricing, balanceCents))
  const atBalanceCap = !!(preview?.ok && pricing && maxBuy >= pricing.minTokens && maxBuy < pricing.maxTokens && preview.tokens === maxBuy)

  const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)

  const purchase = async (key, body, expectedCents) => {
    setError('')
    setNotice('')
    setBusy(key)
    const sig = `${key}|${expectedCents}|${JSON.stringify(body)}`
    if (idem.current.sig !== sig) idem.current = { sig, key: newKey() }
    try {
      // Only the package id / token count and the price the user SAW are sent. The server prices it itself.
      const res = await billingApi.purchase({ ...body, expectedAmountCents: expectedCents, idempotencyKey: idem.current.key })
      idem.current = { sig: '', key: '' }
      // Update balances and the invoice list right away from the server's response.
      if (res.balanceAfter != null && res.tokenBalance != null) setLiveBill({ balance: res.balanceAfter, tokenBalance: res.tokenBalance })
      setNewOrders(list => [
        { id: res.orderId, createdAt: res.createdAt ?? new Date().toISOString(), amountCents: res.amountCents, tokens: res.tokens, status: 'paid' },
        ...list.filter(o => o.id !== res.orderId),
      ])
      setNotice(tf('billing.purchased', { tokens: fmtTokens(res.tokens), price: fmtUsd(res.amountCents) }))
      setCustom('')
      bill.refetch?.()
      inv.refetch?.()
    } catch (e) {
      const stale = e.code === 'price_changed' || e.status === 409
      if (stale) pricingQ.refetch?.()
      const poor = e.code === 'insufficient_funds' || e.status === 402
      setError(stale ? t('billing.err.priceChanged') : poor ? t('billing.err.insufficient') : e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="billing-store-layout" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <style>{`.bl-input::placeholder{color:inherit;opacity:.5}.bl-input:focus-visible{outline:2px solid var(--accent,#3b82f6);outline-offset:1px}`}</style>
      <div className="card" style={{ padding: '24px' }}>
        <div style={{ marginBottom: '20px' }}>
          <div className="muted" style={{ fontSize: '0.875rem', marginBottom: '4px' }}>{t('billing.tokenBalance')}</div>
          <DataState query={bill}>
            <div className="stat-v" style={{ fontSize: '1.75rem', fontWeight: 700 }}>
              {/* backend field is tokenBalance (see README §9); the old balance*100000 was the money balance */}
              {fmtTokens(billData?.tokenBalance ?? 0)} {t('billing.tokens')}
            </div>
            <div className="muted" style={{ marginTop: 4 }}>{t('billing.usdBalance')}: {fmtUsd(balanceCents)}</div>
          </DataState>
        </div>

        <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', fontWeight: 600 }}>{t('billing.store')}</h3>

        <DataState query={pricingQ}>
          {!pricing ? (
            <div className="alert">{t('billing.pricingUnavailable')}</div>
          ) : (
            <>
              <div className="store-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                {pricing.packages.map(pkg => (
                  <div key={pkg.id} style={{
                    position: 'relative',
                    border: pkg.popular ? '2px solid var(--accent, #3b82f6)' : '1px solid var(--border, rgba(128,128,128,0.3))',
                    borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px',
                    background: 'var(--card-bg, transparent)',
                  }}>
                    {pkg.popular && (
                      <span style={{ position: 'absolute', top: '-10px', right: '16px', background: 'var(--accent, #3b82f6)', color: 'var(--bg, #fff)', fontSize: '0.75rem', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>
                        {t('billing.recommended')}
                      </span>
                    )}
                    <div>
                      <div style={{ fontWeight: 600 }}>{t(`billing.pkg.${pkg.id}`)}</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '4px', color: 'var(--accent, #3b82f6)' }}>{fmtTokens(pkg.tokens)}</div>
                      <div className="muted" style={{ fontSize: '0.85rem', marginTop: '2px' }}>
                        {pkg.discountPct > 0 && <s style={{ marginRight: 6 }}>{fmtUsd(pkg.listPriceCents)}</s>}
                        {fmtUsd(pkg.priceCents)} · {tf('billing.save', { pct: pkg.discountPct })}
                      </div>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>{tf('billing.perMillion', { price: fmtUsd(pkg.centsPerMillion) })}</div>
                    </div>
                    <Button
                      variant={pkg.popular ? 'primary' : 'ghost'}
                      onClick={() => purchase(pkg.id, { packageId: pkg.id }, pkg.priceCents)}
                      disabled={busy !== null || !canAfford(pkg.priceCents)}
                      style={{ width: '100%', marginTop: 'auto' }}
                    >
                      {busy === pkg.id ? t('billing.processing') : tf('billing.buyNow', { price: fmtUsd(pkg.priceCents) })}
                    </Button>
                  </div>
                ))}
              </div>

              {/* Manual amount */}
              <div style={{ marginTop: 24, border: '1px solid var(--border, rgba(128,128,128,0.3))', borderRadius: 12, padding: 20 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('billing.customTitle')}</div>
                <div className="muted" style={{ fontSize: '0.85rem', marginBottom: 12 }}>
                  {tf('billing.customHint', { rate: fmtUsd(pricing.baseCentsPerMillion), minPrice: fmtUsd(pricing.minPriceCents), min: fmtTokens(pricing.minTokens), max: fmtTokens(pricing.maxTokens), step: fmtTokens(pricing.stepTokens) })}
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    inputMode="text"
                    autoComplete="off"
                    placeholder={t('billing.customPlaceholder')}
                    value={custom}
                    onChange={onCustom}
                    className="bl-input"
                    style={{
                      flex: '1 1 200px', padding: '10px 12px', font: 'inherit', borderRadius: 8,
                      background: 'var(--bg, transparent)', color: 'inherit',
                      border: '1px solid var(--border, rgba(128,128,128,0.3))',
                    }}
                  />
                  <div style={{ minWidth: 90, fontWeight: 700 }}>{preview?.ok ? fmtUsd(preview.cents) : '—'}</div>
                  <Button
                    onClick={() => purchase('custom', { tokens: preview.tokens }, preview.cents)}
                    disabled={!preview?.ok || busy !== null || !canAfford(preview.cents)}
                  >
                    {busy === 'custom' ? t('billing.processing') : t('billing.buy')}
                  </Button>
                </div>
                {preview && !preview.ok && <div className="muted" style={{ marginTop: 8, color: 'var(--danger, #ef4444)' }}>{tf(preview.err, preview.params)}</div>}
                {atBalanceCap && <div className="muted" style={{ marginTop: 8 }}>{tf('billing.balanceCap', { balance: fmtUsd(balanceCents) })}</div>}
                {preview?.ok && !canAfford(preview.cents) && <div className="muted" style={{ marginTop: 8, color: 'var(--danger, #ef4444)' }}>{t('billing.err.insufficient')}</div>}
                {betterPkg && (
                  <div className="muted" style={{ marginTop: 8 }}>
                    💡 {tf('billing.betterPkg', { pkg: t(`billing.pkg.${betterPkg.id}`), tokens: fmtTokens(betterPkg.tokens), price: fmtUsd(betterPkg.priceCents) })}
                  </div>
                )}
              </div>
            </>
          )}
        </DataState>

        {notice && <div className="alert ok" style={{ marginTop: 16 }}>{notice}</div>}
        {error && <div className="alert" style={{ marginTop: 16 }}>{error}</div>}
      </div>

      <div className="card" style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', fontWeight: 600 }}>{t('billing.invoices')}</h3>
        <DataState query={inv} isEmpty={!invoiceRows.length} empty={t('billing.empty')}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('billing.invoice')}</th>
                  <th>{t('billing.date')}</th>
                  <th>{t('billing.amount')}</th>
                  <th>{t('billing.status')}</th>
                </tr>
              </thead>
              <tbody>
                {invoiceRows.map(i => (
                  <tr key={i.id}>
                    <td><code>{i.id}</code></td>
                    <td>{fmtDate(i.createdAt)}</td>
                    <td>{fmtUsd(i.amountCents)}</td>
                    <td>
                      <span className={`badge ${i.status === 'paid' ? 'ok' : ''}`}>
                        {i.status === 'paid' ? t('billing.paid') : i.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>
    </div>
  )
}