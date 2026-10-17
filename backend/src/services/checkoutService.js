// Orders: price on the server, verify what the user saw, create a pending order, and credit tokens
// ONLY after the payment provider's signed webhook confirms the exact amount was paid.
import crypto from 'node:crypto'
import { HttpError } from '../http.js'
import { withTransaction, orders } from '../db.js'
import { quote, CURRENCY } from './pricingService.js'
import { createCheckoutSession } from './paymentService.js'
import { creditInTx } from './billingService.js'

const MAX_PENDING_PER_HOUR = 10

export async function checkout(userId, { packageId, tokens, expectedAmountCents }) {
  const q = quote({ packageId, tokens })

  // The user must be charged exactly what they were shown.
  if (expectedAmountCents !== undefined && expectedAmountCents !== q.amountCents) {
    const err = new HttpError(409, 'Prices have changed. Please review the new price and try again.')
    err.code = 'price_changed'
    throw err
  }
  if ((await orders.countRecentPending(userId, 60)) >= MAX_PENDING_PER_HOUR) {
    throw new HttpError(429, 'Too many unpaid checkouts. Please complete or wait before trying again.')
  }

  const order = {
    id: `ord_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
    userId, packageId: q.packageId, tokens: q.tokens, amountCents: q.amountCents, currency: CURRENCY,
  }
  await orders.create(order)
  const { providerRef, url } = await createCheckoutSession(order)
  await orders.setProviderRef(order.id, providerRef)
  return { orderId: order.id, tokens: q.tokens, amountCents: q.amountCents, currency: CURRENCY, checkoutUrl: url }
}

/** Called by the verified webhook. Idempotent: a replayed event never credits twice. */
export async function fulfillOrder({ orderId, amountCents, currency, providerRef }) {
  return withTransaction(async tx => {
    const { rows: [o] } = await tx.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId])
    if (!o) throw new HttpError(404, 'Unknown order.')
    if (o.status === 'paid') return { duplicate: true }
    if (Number(o.amount_cents) !== amountCents || String(o.currency).toUpperCase() !== String(currency).toUpperCase()) {
      console.error(`order ${orderId}: paid ${amountCents} ${currency}, expected ${o.amount_cents} ${o.currency}`)
      await tx.query("UPDATE orders SET status = 'failed' WHERE id = ?", [orderId])
      return { mismatch: true }
    }
    await tx.query("UPDATE orders SET status = 'paid', paid_at = UTC_TIMESTAMP(), provider_ref = ? WHERE id = ?", [providerRef ?? o.provider_ref, orderId])
    await creditInTx(tx, o.user_id, { amount: 0, tokens: Number(o.tokens), reason: 'topup' })
    return { credited: Number(o.tokens) }
  })
}

/** Paid orders, newest first. `amount` is dollars; `amountCents` is the exact figure. */
export async function invoices(userId) {
  const rows = await orders.listPaidByUser(userId, 50)
  return rows.map(r => ({
    id: r.id, tokens: Number(r.tokens), amountCents: Number(r.amount_cents), amount: Number(r.amount_cents) / 100,
    currency: r.currency, status: r.status, createdAt: r.created_at,
  }))
}
