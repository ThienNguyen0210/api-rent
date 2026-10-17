// Display + sanity helpers for token pricing.
// The SERVER is the authority: it re-prices every purchase. These helpers only make sure the UI never
// renders malformed/inconsistent pricing and that the price shown to the user is what gets requested.

const isInt = n => Number.isSafeInteger(n) && n > 0
const ID_RE = /^[a-z0-9_-]{1,32}$/

export const fmtUsd = cents =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100)

export function fmtTokens(n) {
  n = Number(n) || 0
  const trim = x => String(Math.round(x * 100) / 100)
  if (n >= 1e9) return `${trim(n / 1e9)}B`
  if (n >= 1e6) return `${trim(n / 1e6)}M`
  if (n >= 1e3) return `${trim(n / 1e3)}K`
  return n.toLocaleString('en-US')
}

/** Same rounding as the server: whole cents, rounded up, integer maths. */
const centsFor = (tokens, base) => Math.ceil((tokens * base * 100) / 100_000_000)

/** Returns a normalised pricing object, or null if anything about the backend payload looks wrong. */
export function validatePricing(d) {
  try {
    if (!d || d.currency !== 'USD') return null
    const { baseCentsPerMillion: base, minTokens, maxTokens, stepTokens } = d
    if (![base, minTokens, maxTokens, stepTokens].every(isInt)) return null
    if (minTokens > maxTokens || minTokens % stepTokens || maxTokens % stepTokens) return null
    if (!Array.isArray(d.packages) || d.packages.length < 1 || d.packages.length > 12) return null

    const seen = new Set()
    const packages = []
    for (const p of d.packages) {
      if (!p || !ID_RE.test(p.id) || seen.has(p.id)) return null
      seen.add(p.id)
      const { tokens, priceCents, listPriceCents, discountPct } = p
      if (!isInt(tokens) || !isInt(priceCents) || !isInt(listPriceCents)) return null
      if (!Number.isInteger(discountPct) || discountPct < 0 || discountPct > 90) return null
      const list = (tokens * base) / 1e6
      if (Math.abs(listPriceCents - list) > 1) return null                       // list price matches base rate
      if (priceCents > listPriceCents) return null                                // never dearer than list
      if (Math.abs(priceCents - list * (1 - discountPct / 100)) > 1) return null  // discount matches price
      packages.push({
        id: p.id, tokens, priceCents, listPriceCents, discountPct, popular: p.popular === true,
        centsPerMillion: Math.round((priceCents / (tokens / 1e6)) * 100) / 100,   // computed, not trusted
      })
    }
    packages.sort((a, b) => a.tokens - b.tokens)
    return { currency: 'USD', baseCentsPerMillion: base, minTokens, maxTokens, stepTokens, minPriceCents: centsFor(minTokens, base), packages }
  } catch {
    return null
  }
}

/**
 * Parses what the user typed into a token count. Accepts:
 *   "5000", "2500000", "2,500,000", "2.500.000"   (digits, optional 3-digit groups)
 *   "250k", "2.5M", "2,5m"                         (decimal allowed ONLY with a K/M suffix)
 * Returns a number (may be huge; callers clamp), or null if it is not a whole number of tokens.
 */
export function parseTokens(input) {
  const s = String(input ?? '').trim().replace(/[\s_]/g, '')
  const sfx = /^(\d+(?:[.,]\d+)?)([kKmM])$/.exec(s)
  if (sfx) {
    const [int, frac = ''] = sfx[1].split(/[.,]/)
    const digits = sfx[2].toLowerCase() === 'm' ? 6 : 3
    if (frac.slice(digits).replace(/0+$/, '')) return null // would be a fraction of a token
    return Number(int) * 10 ** digits + Number(frac.slice(0, digits).padEnd(digits, '0'))
  }
  if (/^\d+$/.test(s) || /^\d{1,3}(?:[.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''))
  return null
}

/** Most tokens the user can buy right now: limited by the USD balance and by pricing.maxTokens, in whole steps. */
export function maxBuyableTokens(pricing, balanceCents) {
  if (!pricing || !(balanceCents > 0)) return 0
  const n = Math.floor(balanceCents) * 1e6
  let t = (n - (n % pricing.baseCentsPerMillion)) / pricing.baseCentsPerMillion
  t = t - (t % pricing.stepTokens)
  t = Math.min(t, pricing.maxTokens)
  while (t > 0 && centsFor(t, pricing.baseCentsPerMillion) > balanceCents) t -= pricing.stepTokens
  return Math.max(t, 0)
}

/**
 * Use in the input's onChange. If the typed amount is larger than the user can afford (or than the maximum),
 * the text is replaced with the largest purchasable amount. Otherwise the text is returned untouched.
 */
export function clampTokenInput(raw, pricing, balanceCents) {
  if (!pricing) return raw
  const n = parseTokens(raw)
  if (n === null) return raw
  const cap = maxBuyableTokens(pricing, balanceCents)
  return cap >= pricing.minTokens && n > cap ? String(cap) : raw
}

/**
 * Manual amount, in TOKENS (see parseTokens). Min/step come from pricing.json (min = $0.01 = 5,000 tokens).
 *  -> { ok: true, tokens, cents }  or  { ok: false, err: <i18n key>, params }
 */
export function previewCustom(input, pricing) {
  const params = {
    min: fmtTokens(pricing.minTokens), max: fmtTokens(pricing.maxTokens), step: fmtTokens(pricing.stepTokens),
    minPrice: fmtUsd(pricing.minPriceCents),
  }
  const tokens = parseTokens(input)
  if (tokens === null) return { ok: false, err: 'billing.err.invalid', params }
  if (tokens > pricing.maxTokens) return { ok: false, err: 'billing.err.max', params }
  if (tokens < pricing.minTokens) return { ok: false, err: 'billing.err.min', params }
  if (tokens % pricing.stepTokens !== 0) return { ok: false, err: 'billing.err.step', params }
  return { ok: true, tokens, cents: centsFor(tokens, pricing.baseCentsPerMillion) }
}
