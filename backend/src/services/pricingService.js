// Prices come from backend/config/pricing.json (loaded and validated once at startup; restart to apply edits).
// The client NEVER sends a price we trust: every purchase is re-priced here from (packageId | tokens).
import { readFileSync } from 'node:fs'
import { HttpError } from '../http.js'

const CONFIG_PATH = process.env.PRICING_FILE || new URL('../../config/pricing.json', import.meta.url)
const ID_RE = /^[a-z0-9_-]{1,32}$/
const isInt = n => Number.isSafeInteger(n) && n > 0

/** Integer maths only, rounded UP to a whole cent: tokens * cents/1M * (100 - pct)/100. */
export const centsFor = (tokens, baseCentsPerMillion, discountPct = 0) =>
  Math.ceil((tokens * baseCentsPerMillion * (100 - discountPct)) / 100_000_000)

/** Validates the raw JSON and returns the derived pricing. Throws a readable Error on any mistake (fail fast at boot). */
export function buildPricing(raw) {
  const bad = msg => { throw new Error(`pricing.json: ${msg}`) }
  if (!raw || raw.currency !== 'USD') bad('currency must be "USD"')
  const { baseCentsPerMillion: base, minTokens, maxTokens, stepTokens } = raw
  for (const [k, v] of Object.entries({ baseCentsPerMillion: base, minTokens, maxTokens, stepTokens })) {
    if (!isInt(v)) bad(`${k} must be a positive integer`)
  }
  if (minTokens > maxTokens) bad('minTokens > maxTokens')
  if (minTokens % stepTokens || maxTokens % stepTokens) bad('minTokens and maxTokens must be multiples of stepTokens')
  if (!Array.isArray(raw.packages) || raw.packages.length === 0 || raw.packages.length > 12) bad('packages must be a list of 1-12 items')

  const seen = new Set()
  const packages = raw.packages.map(p => {
    if (!p || !ID_RE.test(p.id)) bad(`invalid package id ${JSON.stringify(p?.id)}`)
    if (seen.has(p.id)) bad(`duplicate package id "${p.id}"`)
    seen.add(p.id)
    if (!isInt(p.tokens)) bad(`${p.id}: tokens must be a positive integer`)
    if (!Number.isInteger(p.discountPct) || p.discountPct < 0 || p.discountPct > 90) bad(`${p.id}: discountPct must be an integer 0-90`)
    const priceCents = centsFor(p.tokens, base, p.discountPct)
    if (priceCents < 1) bad(`${p.id}: price rounds to 0`)
    return {
      id: p.id, tokens: p.tokens, discountPct: p.discountPct, popular: p.popular === true,
      listPriceCents: centsFor(p.tokens, base, 0), priceCents,
      centsPerMillion: Math.round((priceCents / (p.tokens / 1e6)) * 100) / 100,
    }
  }).sort((a, b) => a.tokens - b.tokens)

  // Guard against config typos: a bigger package must never cost more per token than a smaller one, or than the base rate.
  packages.forEach((p, i) => {
    if (p.centsPerMillion > base + 0.01) bad(`${p.id} costs more per token than the base rate`)
    if (i > 0 && p.centsPerMillion > packages[i - 1].centsPerMillion + 0.01) bad(`${p.id} costs more per token than the smaller package ${packages[i - 1].id}`)
  })
  return { currency: 'USD', baseCentsPerMillion: base, minTokens, maxTokens, stepTokens, packages }
}

const PRICING = buildPricing(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')))

export const getPricing = () => PRICING

/**
 * Prices a purchase request. Returns { tokens, amountCents, packageId }.
 * Custom amounts are billed at the base rate (no discount), so bulk packages are always cheaper per token.
 */
export function quote({ packageId, tokens }) {
  if (packageId !== undefined) {
    const p = PRICING.packages.find(x => x.id === packageId)
    if (!p) throw new HttpError(400, 'Unknown package.')
    return { tokens: p.tokens, amountCents: p.priceCents, packageId: p.id }
  }
  if (!Number.isSafeInteger(tokens)) throw new HttpError(400, 'Invalid token amount.')
  if (tokens < PRICING.minTokens || tokens > PRICING.maxTokens) throw new HttpError(400, 'Token amount out of range.')
  if (tokens % PRICING.stepTokens !== 0) throw new HttpError(400, 'Token amount must be a multiple of the step size.')
  return { tokens, amountCents: centsFor(tokens, PRICING.baseCentsPerMillion), packageId: null }
}
