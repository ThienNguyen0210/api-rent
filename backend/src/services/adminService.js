// Admin panel: password login, user list, balance/token adjustments, support replies.
// The admin session is separate from user logins: ADMIN_PASSWORD (.env) -> signed token valid for 2 hours.
import crypto from 'node:crypto'
import { HttpError } from '../http.js'
import { admin, users } from '../db.js'
import { view as supportView, replyView } from './supportService.js'
import * as mail from '../mail.js'

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000
const MAX_ATTEMPTS = 5
const LOCK_MS = 15 * 60 * 1000
const num = v => Number(v ?? 0)
const pageSize = v => Math.min(Math.max(parseInt(v, 10) || 15, 1), 50)
const cursorOf = v => (/^\d+$/.test(String(v ?? '')) ? Number(v) : null)

const sha = s => crypto.createHash('sha256').update(String(s ?? '')).digest()
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b))

// 503 while ADMIN_PASSWORD is unset, so a missing .env entry keeps the panel closed instead of open.
function secret() {
  const pw = process.env.ADMIN_PASSWORD
  if (!pw) throw new HttpError(503, 'Admin panel is not configured.')
  return process.env.ADMIN_TOKEN_SECRET || pw
}
const sign = s => crypto.createHmac('sha256', secret()).update(s).digest('base64url')

// ---------- auth ----------
const attempts = new Map() // ip -> { n, resetAt }  (in memory: resets on restart)

export function login(password, ip = '') {
  secret()
  const now = Date.now()
  const a = attempts.get(ip)
  if (a && a.resetAt > now && a.n >= MAX_ATTEMPTS) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.')
  if (!safeEqual(password, process.env.ADMIN_PASSWORD)) {
    const cur = a && a.resetAt > now ? a : { n: 0, resetAt: now + LOCK_MS }
    cur.n++
    attempts.set(ip, cur)
    throw new HttpError(403, 'Wrong password.') // 403, not 401: the user-facing client treats 401 as "session expired"
  }
  attempts.delete(ip)
  const exp = String(now + TOKEN_TTL_MS)
  return { token: `${exp}.${sign(exp)}`, expiresAt: Number(exp) }
}

/** Throws 401 unless the header carries a valid, unexpired admin token. */
export function assertAdmin(header) {
  const token = /^Bearer\s+(.+)$/i.exec(header || '')?.[1] ?? ''
  const [exp = '', sig = ''] = token.split('.')
  const good = Buffer.from(sign(exp))
  const given = Buffer.from(sig)
  const ok = /^\d+$/.test(exp) && given.length === good.length && crypto.timingSafeEqual(good, given) && Number(exp) > Date.now()
  if (!ok) throw new HttpError(401, 'Admin session expired.')
}

// ---------- users ----------
const escLike = s => s.replace(/[\\%_]/g, '\\$&')

export async function listUsers({ cursor, limit, q } = {}) {
  const lim = pageSize(limit)
  const term = String(q ?? '').trim().slice(0, 100)
  const rows = await admin.listUsers({ cursor: cursorOf(cursor), like: term ? `%${escLike(term)}%` : null, limit: lim })
  const page = rows.slice(0, lim)
  return {
    items: page.map(r => ({
      id: r.id, email: r.email, name: r.name, verified: !!r.email_verified, createdAt: r.created_at,
      balance: num(r.balance), tokens: num(r.tokens_granted), tokensUsed: num(r.tokens_consumed),
    })),
    nextCursor: rows.length > lim ? String(page.at(-1).id) : null,
  }
}

/** amountCents / tokens: positive adds, negative deducts. Neither value can end up below zero. */
export async function adjustBalance(userId, { amountCents = 0, tokens = 0 } = {}) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new HttpError(400, 'Invalid user id.')
  if (!Number.isSafeInteger(amountCents) || !Number.isSafeInteger(tokens)) throw new HttpError(400, 'amountCents and tokens must be whole numbers.')
  if (!amountCents && !tokens) throw new HttpError(400, 'Nothing to change.')
  if (Math.abs(amountCents) > 100_000_000 || Math.abs(tokens) > 10_000_000_000) throw new HttpError(400, 'Amount is too large.')
  if (!(await users.findById(userId))) throw new HttpError(404, 'User not found.')

  const result = await admin.adjustBalance(userId, (amountCents / 100).toFixed(2), tokens)
  if (!result) throw new HttpError(409, 'That would take the balance or tokens below zero.')
  return result
}

// ---------- support ----------
export async function listSupport({ cursor, limit } = {}) {
  const lim = pageSize(limit)
  const rows = await admin.listSupport({ cursor: cursorOf(cursor), limit: lim })
  const page = rows.slice(0, lim)
  return {
    items: page.map(r => ({
      ...supportView(r),
      user: { id: r.user_id, email: r.email, name: r.name },
    })),
    nextCursor: rows.length > lim ? String(page.at(-1).id) : null,
  }
}

export async function replyToRequest(requestId, message) {
  if (!Number.isSafeInteger(requestId) || requestId <= 0) throw new HttpError(400, 'Invalid request id.')
  const text = String(message ?? '').trim()
  if (text.length < 2 || text.length > 5000) throw new HttpError(400, 'Reply must be 2-5000 characters.')
  const req = await admin.findSupportWithUser(requestId)
  if (!req) throw new HttpError(404, 'Support request not found.')

  const replyId = await admin.addReply(requestId, text)

  // The reply is saved either way; a mail problem is reported to the admin instead of failing the call.
  let emailed = false
  try {
    if (typeof mail.sendSupportReplyEmail === 'function') {
      await mail.sendSupportReplyEmail(req.email, { id: req.id, name: req.name || req.email, title: req.title, message: text })
      emailed = true
    } else console.error('mail.sendSupportReplyEmail is missing: see README.md step 4')
  } catch (e) { console.error('Support reply email failed:', e.message) }
  return { reply: replyView({ id: replyId, sender: 'admin', message: text, created_at: new Date().toISOString(), read_at: null }), emailed }
}
