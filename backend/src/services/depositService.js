// Bank-transfer deposits via SePay (VND -> USD balance).
import crypto from 'node:crypto'
import { HttpError } from '../http.js'
import { withTransaction, deposits, users } from '../db.js'

const num = v => Number(v ?? 0)

const cfg = () => ({
  bank: process.env.DEPOSIT_BANK || 'BIDV',
  accountNumber: process.env.DEPOSIT_ACCOUNT_NUMBER || '',
  accountName: process.env.DEPOSIT_ACCOUNT_NAME || 'NGUYEN CHI THIEN',
  rate: num(process.env.VND_PER_USD) || 25000, // VND per 1 USD
  minVnd: num(process.env.DEPOSIT_MIN_VND) || 10000,
})

// Unambiguous characters only (no 0/O, 1/I) so a code survives being typed by hand.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const makeCode = () => 'NAP' + Array.from(crypto.randomBytes(8), b => ALPHABET[b % ALPHABET.length]).join('')
const CODE_RE = /NAP[A-HJ-NP-Z2-9]{8}/

/**
 * THE link between a bank transfer and a user. A QR scan / bank transfer carries no user identity at all,
 * so the identity is the per-user code (deposit_codes) placed in the transfer content (the QR pre-fills it).
 * Banks sometimes lowercase it or insert spaces/dashes, so try the raw text first, then a stripped copy.
 * A match only counts if the code really exists in deposit_codes (checked in the transaction below).
 */
function findCode(p) {
  const raw = `${p.code ?? ''} ${p.content ?? ''} ${p.description ?? ''}`.toUpperCase()
  return CODE_RE.exec(raw)?.[0] ?? CODE_RE.exec(raw.replace(/[^A-Z0-9]/g, ''))?.[0] ?? null
}

/** The user's permanent transfer code, created on first use. Safe under concurrent calls. */
async function ensureCode(userId) {
  for (let i = 0; i < 6; i++) {
    const existing = await deposits.codeOf(userId)
    if (existing) return existing
    await deposits.insertCode(userId, makeCode()) // false = parallel call won, or random code collided: re-read / retry
  }
  throw new HttpError(500, 'Could not create a deposit code.')
}

/** Everything the deposit page needs. */
export async function getDepositInfo(userId, limit = 20) {
  const c = cfg()
  const code = await ensureCode(userId)
  const rows = await deposits.listByUser(userId, limit)
  return {
    code,
    bank: c.bank, accountNumber: c.accountNumber, accountName: c.accountName,
    qrUrl: `https://vietqr.app/img?acc=${encodeURIComponent(c.accountNumber)}&bank=${encodeURIComponent(c.bank)}`,
    rate: c.rate, minVnd: c.minVnd,
    items: rows.map(r => ({
      id: String(r.id), amountVnd: num(r.amount_vnd), amountUsd: num(r.amount_usd),
      status: r.status, createdAt: r.created_at,
    })),
  }
}

/** Transfers that were NOT credited (no/unknown code, or below the minimum), newest first. For operators. */
export const listUnassigned = limit => deposits.listUnassigned(limit)

/**
 * Operator backup: credit a recorded-but-uncredited transfer to a user. One transaction; the row is locked, so
 * running it twice (or racing a live webhook) can never credit the transfer twice. Uses the rate stored at transfer time.
 */
export async function assignDeposit(sepayId, userId) {
  if (!Number.isSafeInteger(sepayId) || !Number.isSafeInteger(userId)) throw new HttpError(400, 'sepayId and userId must be integers.')
  if (!(await users.findById(userId))) throw new HttpError(404, `User ${userId} does not exist.`)
  return withTransaction(async tx => {
    const d = await deposits.lockUnassigned(tx, sepayId)
    if (!d) throw new HttpError(404, 'No uncredited deposit with that SePay id (unknown, or already credited).')
    const cents = Math.floor((num(d.amount_vnd) * 100) / num(d.rate_vnd_per_usd))
    if (cents < 1) throw new HttpError(400, 'This amount is worth less than $0.01.')
    const usd = (cents / 100).toFixed(2)
    await deposits.markAssigned(tx, d.id, userId, usd)
    await deposits.creditUsd(tx, userId, usd)
    return { sepayId, userId, amountVnd: num(d.amount_vnd), amountUsd: Number(usd) }
  })
}

/** DEPOSIT_MODE: webhook (default) | poll | both. Invalid values fail loudly instead of silently disabling deposits. */
export function depositMode() {
  const m = (process.env.DEPOSIT_MODE || 'webhook').trim().toLowerCase()
  if (!['webhook', 'poll', 'both'].includes(m)) throw new Error(`DEPOSIT_MODE must be webhook, poll or both (got "${m}")`)
  return { mode: m, webhook: m !== 'poll', poll: m !== 'webhook' }
}

/** Constant-time check of "Authorization: Apikey <key>" against SEPAY_WEBHOOK_KEY. */
export function assertSepayAuth(header) {
  const expected = process.env.SEPAY_WEBHOOK_KEY
  if (!expected) throw new HttpError(500, 'SEPAY_WEBHOOK_KEY is not configured.')
  const given = /^Apikey\s+(.+)$/i.exec(header || '')?.[1] ?? ''
  const h = s => crypto.createHash('sha256').update(s).digest()
  if (!crypto.timingSafeEqual(h(given), h(expected))) throw new HttpError(401, 'Unauthorized')
}

/**
 * Process one SePay webhook; never credits the same bank transaction twice.
 *  - ONE transaction: deposits row + balance credit + ledger row (all or nothing).
 *  - deposits.sepay_id is UNIQUE: a retry or two parallel deliveries collide on INSERT; the loser rolls back
 *    and reports "duplicate", so the money is credited exactly once.
 *  - The credit is an atomic `balance = balance + ?`, so simultaneous deposits for one user serialise on the row lock.
 *  - Throwing (HTTP 500) makes SePay retry, which is safe because of the unique key.
 */
export async function processSepayWebhook(p) {
  const c = cfg()
  const sepayId = Number(p?.id)
  const amountVnd = Number(p?.transferAmount)
  if (!Number.isSafeInteger(sepayId) || sepayId <= 0) throw new HttpError(400, 'Invalid id')
  if (!Number.isSafeInteger(amountVnd) || amountVnd <= 0) throw new HttpError(400, 'Invalid transferAmount')

  // Outgoing money, or money into another account: acknowledge so SePay stops retrying.
  if (p.transferType !== 'in') return { status: 'ignored' }
  if (c.accountNumber && String(p.accountNumber) !== c.accountNumber) return { status: 'ignored' }

  const code = findCode(p)

  // USD = VND / rate, rounded DOWN to the cent so we never over-credit.
  const usdCents = Math.floor((amountVnd * 100) / c.rate)
  const usd = (usdCents / 100).toFixed(2)

  try {
    const result = await withTransaction(async tx => {
      const userId = code ? await deposits.findUserByCode(tx, code) : null
      const status = !userId ? 'unmatched' : amountVnd < c.minVnd || usdCents < 1 ? 'too_small' : 'completed'

      await deposits.insert(tx, {
        sepayId, userId, code, amountVnd, rate: c.rate, status, raw: p,
        amountUsd: status === 'completed' ? usd : 0,
        referenceCode: p.referenceCode ?? null,
        content: String(p.content ?? '').slice(0, 512),
      })
      if (status === 'completed') await deposits.creditUsd(tx, userId, usd)
      return { status }
    })
    // Not credited: surface it so an operator can fix it with scripts/deposits-admin.js.
    if (result.status !== 'completed') {
      console.warn(`[deposit] ${result.status} transfer sepay_id=${sepayId} amount=${amountVnd} VND code=${code ?? '-'} -> needs manual review`)
    }
    return result
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return { status: 'duplicate' }
    throw e
  }
}
