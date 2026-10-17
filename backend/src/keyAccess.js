// Per-key access rules: allowed IPs, allowed domains, and a requests-per-minute cap.
// Every rule uses null for "no restriction", which is the default for new keys.
//   - validation/serialising (used when settings are saved):  accessSchema, toColumns
//   - reading a key row (used by keysService + the list route): accessOf
//   - enforcing on a request (used by core/router):      enforceAccess
import net from 'node:net'
import { domainToASCII } from 'node:url'
import { z } from 'zod'
import { HttpError } from './http.js'

export const MAX_ENTRIES = 1000          // per list (IPs / domains)
export const MAX_RATE_PER_MIN = 1_000_000

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

// PUT body. A missing/null field means "any" (this is a full replacement, not a patch).
export const accessSchema = z.object({
  ips: z.array(z.string().max(300)).max(MAX_ENTRIES).nullable().optional(),
  domains: z.array(z.string().max(300)).max(MAX_ENTRIES).nullable().optional(),
  rateLimitPerMin: z.number().int().min(1).max(MAX_RATE_PER_MIN).nullable().optional(),
})

const stripV4Mapped = ip => ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1')

// "203.0.113.7" | "2001:db8::1" | "203.0.113.0/24" | "2001:db8::/32"  ->  canonical string, or null.
function normalizeIp(raw) {
  const [addr, prefix, ...extra] = stripV4Mapped(raw.trim()).split('/')
  const family = net.isIP(addr)
  if (!family || addr.includes('%') || extra.length) return null
  if (prefix === undefined) return addr.toLowerCase()
  if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)) return null
  return `${addr.toLowerCase()}/${Number(prefix)}`
}

// "https://App.Example.com:3000/x" -> "app.example.com";  "*.example.com" stays a wildcard.
function normalizeDomain(raw) {
  let s = raw.trim().toLowerCase()
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '')
  const wild = s.startsWith('*.')
  const host = domainToASCII(wild ? s.slice(2) : s) // also converts IDNs to punycode, like browsers send them
  const label = '(?!-)[a-z0-9-]{1,63}(?<!-)'
  if (!host || host.length > 253 || !new RegExp(`^${label}(\\.${label})*$`).test(host)) return null
  return wild ? `*.${host}` : host
}

function cleanList(list, normalize, label) {
  const raw = (list ?? []).map(s => String(s).trim()).filter(Boolean)
  if (!raw.length) return null // empty list = "any"
  const ok = new Set()
  const bad = []
  for (const r of raw) {
    const v = normalize(r)
    if (v) ok.add(v); else bad.push(r.slice(0, 60))
  }
  if (bad.length)
    throw new HttpError(400, `Invalid ${label}: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ` (+${bad.length - 3} more)` : ''}`)
  if (ok.size > MAX_ENTRIES) throw new HttpError(400, `Too many ${label} (max ${MAX_ENTRIES}).`)
  return [...ok]
}

// Validated input -> values ready for db.keys.setAccess().
export function toColumns({ ips, domains, rateLimitPerMin }) {
  const i = cleanList(ips, normalizeIp, 'IP addresses')
  const d = cleanList(domains, normalizeDomain, 'domains')
  return {
    ips: i && JSON.stringify(i),
    domains: d && JSON.stringify(d),
    rateLimitPerMin: rateLimitPerMin ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Reading a key row                                                   */
/* ------------------------------------------------------------------ */

// Corrupt JSON fails CLOSED: [] matches nothing, so the key is denied rather than silently unrestricted.
const parseList = s => {
  if (!s) return null
  try {
    const a = JSON.parse(s)
    if (!Array.isArray(a)) return []
    return a.length ? a : null
  } catch { return [] }
}

// api_keys row -> { ips: string[]|null, domains: string[]|null, rateLimitPerMin: number|null }
export const accessOf = row => ({
  ips: parseList(row.allowed_ips),
  domains: parseList(row.allowed_domains),
  rateLimitPerMin: row.rate_limit_per_min ?? null,
})

/* ------------------------------------------------------------------ */
/* Enforcement                                                         */
/* ------------------------------------------------------------------ */

// req.ip is the real client IP only when Express `trust proxy` matches your deployment (see http.js).
const clientIp = req => stripV4Mapped(String(req.ip || ''))

// Compiled IP matchers, rebuilt only when a key's list changes.
const ipCache = new Map() // keyId -> { src, list }
function ipMatcher(keyId, ips) {
  const src = ips.join(',')
  const hit = ipCache.get(keyId)
  if (hit?.src === src) return hit.list
  const list = new net.BlockList()
  for (const e of ips) {
    const [addr, prefix] = e.split('/')
    const family = net.isIPv4(addr) ? 'ipv4' : 'ipv6'
    if (prefix === undefined) list.addAddress(addr, family)
    else list.addSubnet(addr, Number(prefix), family)
  }
  if (ipCache.size > 2000) ipCache.clear()
  ipCache.set(keyId, { src, list })
  return list
}

// Browsers always send Origin on cross-origin requests (and usually Referer otherwise).
function requestHost(req) {
  const v = req.get('origin') || req.get('referer')
  if (!v) return null
  try { return new URL(v).hostname.toLowerCase() } catch { return null } // Origin: null -> denied
}
// "*.example.com" matches any subdomain, not example.com itself (list that separately).
const hostAllowed = (host, domains) =>
  domains.some(d => (d.startsWith('*.') ? host.endsWith(d.slice(1)) : host === d))

// Fixed one-minute window per key. In memory: per process, resets on restart.
const WINDOW_MS = 60_000
const buckets = new Map() // keyId -> { start, count }
// Returns null if the request may proceed, else the number of seconds until the window resets.
function consumeRate(keyId, limit, now = Date.now()) {
  const start = now - (now % WINDOW_MS)
  const b = buckets.get(keyId)
  if (!b || b.start !== start) { buckets.set(keyId, { start, count: 1 }); return null }
  if (b.count >= limit) return Math.max(1, Math.ceil((start + WINDOW_MS - now) / 1000))
  b.count++
  return null
}
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS
  for (const [id, b] of buckets) if (b.start < cutoff) buckets.delete(id)
}, 5 * 60_000).unref()

/**
 * Throws HttpError 403 (IP/domain) or 429 (rate limit, with Retry-After) when the request breaks the key's rules.
 * Order matters: rejected-by-IP/domain requests never use up the key's rate budget.
 */
export function enforceAccess(req, res, keyId, access) {
  // A missing `access` means verifyKey() wasn't updated. Fail loudly instead of silently allowing everything.
  if (!access) throw new Error('enforceAccess: verifyKey() must return the key\'s access settings')

  if (access.ips) {
    const ip = clientIp(req)
    const family = net.isIPv4(ip) ? 'ipv4' : net.isIPv6(ip) ? 'ipv6' : null
    if (!family || !ipMatcher(keyId, access.ips).check(ip, family))
      throw new HttpError(403, `This API key can't be used from IP address ${ip || 'unknown'}.`)
  }

  if (access.domains) {
    const host = requestHost(req)
    if (!host) throw new HttpError(403, 'This API key only accepts requests from approved domains, but the request had no Origin or Referer header.')
    if (!hostAllowed(host, access.domains)) throw new HttpError(403, `This API key can't be used from ${host}.`)
  }

  if (access.rateLimitPerMin != null) {
    const wait = consumeRate(keyId, access.rateLimitPerMin)
    if (wait) {
      res.set('Retry-After', String(wait))
      throw new HttpError(429, `Rate limit of ${access.rateLimitPerMin} requests per minute exceeded for this API key. Retry in ${wait}s.`)
    }
  }
}
