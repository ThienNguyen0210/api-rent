// Balance, tokens and the ledger (MySQL).
import { HttpError } from '../http.js'
import crypto from 'node:crypto'
import { query, withTransaction, orders } from '../db.js'
import { quote } from './pricingService.js'

const num = v => Number(v ?? 0)

/** The Overview "Balance" card. A user with no row yet simply has a zero balance. */
export async function getBilling(userId) {
  const { rows: [b] } = await query('SELECT * FROM balances WHERE user_id = ?', [userId])
  const granted = num(b?.tokens_granted)
  const consumed = num(b?.tokens_consumed)
  return {
    balance: num(b?.balance),
    currency: b?.currency ?? 'USD',
    tokensGranted: granted,
    tokensConsumed: consumed,
    tokenBalance: granted, // current balance: top-ups minus tokens used
    tokensRemaining: granted,
    totalRequests: num(b?.total_requests),
    totalSpend: num(b?.total_spend),
  }
}

/** Ledger, newest first. `reason` is a code (topup | usage | refund | adjustment); the frontend translates it. */
export async function transactions(userId, limit = 20) {
  const { rows } = await query(
    `SELECT id, reason, amount, tokens, balance_after, request_id, created_at
     FROM balance_transactions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    [userId, limit]
  )
  return rows.map(r => ({
    id: String(r.id), reason: r.reason, amount: num(r.amount), tokens: num(r.tokens),
    balanceAfter: num(r.balance_after), requestId: r.request_id, createdAt: r.created_at,
  }))
}

/**
 * Tokens are a currency: tokens_granted is the current balance (addCredit adds to it, recordUsage deducts
 * each request's total tokens from it and adds them to tokens_consumed). Blocks the request when the balance is zero or negative.
 * The exact size of a reply isn't known beforehand, so the request that crosses zero is still served and
 * deducted in full; the next one is refused.
 */
export async function assertHasTokens(userId) {
  const { rows: [b] } = await query(
    'SELECT tokens_granted FROM balances WHERE user_id = ?',
    [userId]
  )
  if (num(b?.tokens_granted) <= 0) throw new HttpError(402, 'Insufficient tokens. Add tokens to continue.')
}

/** Adds money and/or tokens atomically: balance row + ledger row. Call it from your payment or admin code. */
export async function addCredit(userId, { amount = 0, tokens = 0, reason = 'topup' }) {
  return withTransaction(async tx => {
    await tx.query(
      `INSERT INTO balances (user_id, balance, tokens_granted) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance),
         tokens_granted = tokens_granted + VALUES(tokens_granted), updated_at = UTC_TIMESTAMP()`,
      [userId, amount, tokens])
    const { rows: [b] } = await tx.query('SELECT balance FROM balances WHERE user_id = ?', [userId])
    await tx.query(
      'INSERT INTO balance_transactions (user_id, reason, amount, tokens, balance_after) VALUES (?, ?, ?, ?, ?)',
      [userId, reason, amount, tokens, num(b.balance)])
    return { balanceAfter: num(b.balance) }
  })
}

const orderView = r => ({
  orderId: r.id, tokens: num(r.tokens), amountCents: num(r.amount_cents), currency: r.currency, createdAt: r.created_at,
})

/**
 * Buy tokens with the user's USD balance. Everything happens in ONE transaction:
 *   guarded debit + token credit (single UPDATE) + order row + ledger row.
 * Anti-cheat rules:
 *  - the price is computed here from pricing.json; the client only names a package or a token count;
 *  - expectedAmountCents must equal the server price (else 409), so users pay exactly what they saw;
 *  - the debit is `WHERE balance >= price` in the same UPDATE as the credit, so parallel requests can't
 *    overspend or push the balance below zero;
 *  - idempotencyKey (unique per user) makes a retried or double-submitted request a no-op.
 */
export async function purchaseTokens(userId, { packageId, tokens, expectedAmountCents, idempotencyKey }) {
  const q = quote({ packageId, tokens })
  if (expectedAmountCents !== q.amountCents) {
    const err = new HttpError(409, 'Prices have changed. Please review the new price and try again.')
    err.code = 'price_changed'
    throw err
  }
  if (idempotencyKey) {
    const prior = await orders.findByKey(userId, idempotencyKey)
    if (prior) return { ...orderView(prior), duplicate: true }
  }

  const usd = (q.amountCents / 100).toFixed(2)
  const id = `ord_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
  try {
    return await withTransaction(async tx => {
      const upd = await tx.query(
        `UPDATE balances SET balance = balance - ?, tokens_granted = tokens_granted + ?, updated_at = UTC_TIMESTAMP()
          WHERE user_id = ? AND balance >= ?`,
        [usd, q.tokens, userId, usd])
      if (upd.affectedRows !== 1) {
        const err = new HttpError(402, 'Insufficient USD balance.')
        err.code = 'insufficient_funds'
        throw err
      }
      const { rows: [b] } = await tx.query('SELECT balance, tokens_granted FROM balances WHERE user_id = ?', [userId])
      await tx.query(
        `INSERT INTO orders (id, user_id, idempotency_key, package_id, tokens, amount_cents, currency, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'USD', UTC_TIMESTAMP())`,
        [id, userId, idempotencyKey ?? null, q.packageId, q.tokens, q.amountCents])
      await tx.query(
        `INSERT INTO balance_transactions (user_id, reason, amount, tokens, balance_after) VALUES (?, 'purchase', ?, ?, ?)`,
        [userId, -Number(usd), q.tokens, num(b.balance)])
      return {
        orderId: id, tokens: q.tokens, amountCents: q.amountCents, currency: 'USD',
        balanceAfter: num(b.balance), tokenBalance: num(b.tokens_granted),
      }
    })
  } catch (e) {
    // Two identical requests raced past the check above: the unique key rolled the loser back (no double charge).
    if (e.code === 'ER_DUP_ENTRY' && idempotencyKey) {
      const prior = await orders.findByKey(userId, idempotencyKey)
      if (prior) return { ...orderView(prior), duplicate: true }
    }
    throw e
  }
}

/** Completed purchases, newest first. */
export async function invoices(userId) {
  const rows = await orders.listByUser(userId, 50)
  return rows.map(r => ({ ...orderView(r), id: r.id, amount: num(r.amount_cents) / 100, status: 'paid' }))
}
