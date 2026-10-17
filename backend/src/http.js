// Web plumbing shared by the routes: errors, request parsing, rate limiting, auth tokens.
import jwt from 'jsonwebtoken'
import rateLimit from 'express-rate-limit'
import { config } from './config.js'
import { users } from './db.js'

// The one way to signal a failure. The error handler in server.js turns it into { message }.
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

// Wraps an async route so a thrown error reaches the error handler (Express 4 needs this).
export const handler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Validates `body` against a zod schema and returns the cleaned data, or throws a 400.
export function parse(schema, body) {
  const r = schema.safeParse(body)
  if (!r.success) {
    const i = r.error.issues[0]
    throw new HttpError(400, `${i.path.join('.') || 'body'}: ${i.message}`)
  }
  return r.data
}

// Per-IP rate limit for abuse-prone routes: limiter(max, windowMinutes = 15).
export const limiter = (max, windowMin = 15) =>
  rateLimit({
    windowMs: windowMin * 60_000,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpError(429, 'Too many requests. Try again later.')),
  })

// Where a request came from, for the login history. req.ip is the real client IP only if Express
// has `trust proxy` configured when the app runs behind a proxy/load balancer.
export function clientInfo(req) {
  const ip = String(req.ip || '').replace(/^::ffff:/, '').slice(0, 45) || null
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 255) || null
  const tz = String(req.headers['x-timezone'] || '').slice(0, 64)
  let timeZone = null
  if (tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); timeZone = tz } catch { /* not a real IANA zone */ } }
  return { ip, userAgent, timeZone }
}

// ---- Session tokens (JWT) ----
const JWT_OPTS = { algorithms: ['HS256'], issuer: 'rentapi' }

// `tv` is the user's token_version at sign time. Bumping it in the DB revokes every older token.
export const signToken = (userId, tokenVersion = 0) =>
  jwt.sign({ tv: tokenVersion }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: String(userId),
    issuer: 'rentapi',
    expiresIn: config.jwtExpiresIn,
  })

// ---- Session cookie ----
// The JWT lives in an HttpOnly cookie, so page JavaScript (and any XSS) can never read it.
//   COOKIE_SAMESITE=lax   (default) frontend and API on the same site (e.g. app.example.com + api.example.com)
//   COOKIE_SAMESITE=none  frontend and API on different sites; also needs CORS with credentials
export const SESSION_COOKIE = 'session'
const IS_PROD = process.env.NODE_ENV === 'production'
const SAME_SITE = ['lax', 'strict', 'none'].includes(process.env.COOKIE_SAMESITE) ? process.env.COOKIE_SAMESITE : 'lax'
const COOKIE_OPTS = {
  httpOnly: true,
  secure: IS_PROD || SAME_SITE === 'none', // browsers require Secure with SameSite=None
  sameSite: SAME_SITE,
  path: '/',
}

// Sets the session cookie; its lifetime follows the token's own expiry.
export function setSessionCookie(res, token) {
  const exp = jwt.decode(token)?.exp
  res.cookie(SESSION_COOKIE, token, { ...COOKIE_OPTS, ...(exp ? { expires: new Date(exp * 1000) } : {}) })
}

export const clearSessionCookie = res => res.clearCookie(SESSION_COOKIE, COOKIE_OPTS)

// Minimal Cookie header reader (no cookie-parser dependency needed).
function readCookie(req, name) {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i < 0 || part.slice(0, i).trim() !== name) continue
    try { return decodeURIComponent(part.slice(i + 1).trim()) } catch { return null }
  }
  return null
}

// CSRF defence for cookie-authenticated requests that change state. A cross-site page cannot set a
// custom header without a CORS preflight, which the API refuses, so requiring one blocks forged requests.
// The frontend must send `X-Requested-With: XMLHttpRequest` on every non-GET request.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
export function csrfGuard(req, _res, next) {
  if (SAFE_METHODS.has(req.method) || req.headers['x-requested-with'] === 'XMLHttpRequest') return next()
  next(new HttpError(403, 'Missing CSRF header.'))
}

// ---- Password-reset tokens ----
// Signed with a DIFFERENT secret than session tokens, so one can never be accepted as the other.
// Carries the user's token_version, so it dies the moment the password changes (single use).
const RESET_SECRET = `${config.jwtSecret}:pwreset`
export const RESET_TTL_SECONDS = 10 * 60

export const signResetToken = (userId, tokenVersion) =>
  jwt.sign({ tv: tokenVersion }, RESET_SECRET, {
    algorithm: 'HS256',
    subject: String(userId),
    issuer: 'rentapi',
    expiresIn: RESET_TTL_SECONDS,
  })

// Returns { userId, tv } or throws a 400 (400, not 401: the client treats 401 as "session expired").
export function verifyResetToken(token) {
  try {
    const p = jwt.verify(token, RESET_SECRET, JWT_OPTS)
    return { userId: Number(p.sub), tv: p.tv ?? 0 }
  } catch {
    throw new HttpError(400, 'Reset session expired. Please start again.')
  }
}

// Express middleware: reads the session from the HttpOnly cookie and sets req.userId.
// During the migration it still accepts "Authorization: Bearer <token>" as a fallback for clients
// that haven't updated yet; delete the `bearer` lines below once they all have.
// Also rejects tokens whose version no longer matches the user's current token_version.
export async function requireAuth(req, _res, next) {
  const cookieToken = readCookie(req, SESSION_COOKIE)
  const [scheme, bearer] = (req.headers.authorization || '').split(' ')
  const token = cookieToken || (scheme === 'Bearer' ? bearer : null)
  if (!token) return next(new HttpError(401, 'Authentication required.'))

  // Only cookie auth is CSRF-prone (browsers attach it automatically); Bearer headers are not.
  if (cookieToken) {
    try { await new Promise((ok, no) => csrfGuard(req, null, e => (e ? no(e) : ok()))) } catch (e) { return next(e) }
  }

  try {
    const p = jwt.verify(token, config.jwtSecret, JWT_OPTS)
    const current = await users.tokenVersion(Number(p.sub))
    if (current === null || (p.tv ?? 0) !== current) throw new Error('revoked')
    req.userId = Number(p.sub)
    next()
  } catch {
    next(new HttpError(401, 'Session expired. Please log in again.'))
  }
}