// Single source of truth for model metadata: data/models.json (override path with MODELS_FILE).
// Every process re-reads the file whenever its mtime/size changes, so an edit made through any
// instance (or by hand, on a shared volume) shows up everywhere without a restart.
//
// Fields per model:
//   key         stable slug used in URLs and by the routers ('chatgpt', 'gemini'). Never edited.
//   modelId     the identity stored in the DB `models` table, usage and cache rows. Never edited,
//               so renaming a model can't orphan its history.
//   name        public model name: what clients send as `model` and what GET /api/models shows. Editable.
//   description  { en, vi } (a plain string in the file is treated as both languages). Editable.
//   image        display metadata. Editable.
//   provider     company name shown on the card ('OpenAI'). Editable.
//   category     any of CATEGORIES; drives the filter tabs. Editable.
//   capabilities any of CAPABILITIES; the UI translates each one (models.cap.<name>). Editable.
//   contextTokens  context window in tokens, or null. Editable.
//   pricePer1k   USD per 1,000 tokens, or null. Display price, and the fallback for `pricing` below. Editable.
//   pricing      { inputPer1k, outputPer1k }: USD per 1,000 prompt / completion tokens used to price each request.
//                Either side may be null (falls back to pricePer1k, then to 0 = free). Editable.
//   status       'active' | 'maintenance' | 'disabled'. Anything but 'active' makes the completion route answer 503.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HttpError } from '../http.js'

const FILE =
  process.env.MODELS_FILE ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/models.json')

let snap = { mtimeMs: -1, size: -1, models: [] }

function load() {
  try {
    const st = fs.statSync(FILE)
    if (st.mtimeMs !== snap.mtimeMs || st.size !== snap.size) {
      const { models } = JSON.parse(fs.readFileSync(FILE, 'utf8'))
      if (!Array.isArray(models)) throw new Error('"models" must be an array')
      snap = { mtimeMs: st.mtimeMs, size: st.size, models }
    }
  } catch (e) {
    // Keep serving the last good copy; fail only if there has never been one.
    if (!snap.models.length) throw new Error(`models file unreadable (${FILE}): ${e.message}`)
    console.error('[models] reload failed, using last good copy:', e.message)
  }
  return snap.models
}

export const LANGS = ['en', 'vi']
export const CATEGORIES = ['chat', 'vision', 'code']
export const CAPABILITIES = ['text', 'reasoning', 'vision', 'multimodal', 'code', 'fast', 'streaming']
export const STATUSES = ['active', 'maintenance', 'disabled']

const norm = d =>
  typeof d === 'string'
    ? { en: d, vi: d }
    : { en: String(d?.en ?? ''), vi: String(d?.vi ?? '') }

// A usable price is a finite number >= 0; anything else counts as "not set".
const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

// Effective per-1k prices for a model: its own input/output price, else the single pricePer1k, else null.
const pricingOf = m => {
  const base = num(m.pricePer1k)
  return {
    inputPer1k: num(m.pricing?.inputPer1k) ?? base,
    outputPer1k: num(m.pricing?.outputPer1k) ?? base,
  }
}

// lang: 'en' | 'vi' -> description is a string (falls back to the other language when empty)
//       'all'       -> description is { en, vi } (used for the admin editor)
const pub = (m, lang = 'en') => {
  const d = norm(m.description)
  return {
    key: m.key,
    name: m.name,
    description: lang === 'all' ? d : d[lang] || d.en || d.vi || '',
    image: m.image ?? '',
    provider: m.provider ?? '',
    category: (m.category || []).filter(c => CATEGORIES.includes(c)),
    capabilities: (m.capabilities || []).filter(c => CAPABILITIES.includes(c)),
    contextTokens: m.contextTokens ?? null,
    pricePer1k: m.pricePer1k ?? null,
    pricing: pricingOf(m),
    status: STATUSES.includes(m.status) ? m.status : 'active',
    endpoint: `/v1/${m.key}/chat/completions`,
  }
}

export const listModels = lang => load().map(m => pub(m, lang))

export function findModel(key, lang) {
  const m = load().find(x => x.key === key)
  return m ? pub(m, lang) : null
}

// Used by the completion routers on every request (cheap: one stat call).
export function getModel(key) {
  const m = load().find(x => x.key === key)
  if (!m) throw new Error(`Unknown model key '${key}' in ${FILE}`)
  return {
    key: m.key,
    name: m.name,
    image: m.image ?? null,
    modelId: m.modelId || m.name,
    status: STATUSES.includes(m.status) ? m.status : 'active',
    pricing: pricingOf(m),
  }
}

let queue = Promise.resolve() // serialises writes inside this process

// patch: any of { name, description: { en?, vi? }, image, provider, category, capabilities, contextTokens, pricePer1k,
//                 pricing: { inputPer1k?, outputPer1k? }, status }.
// Missing languages / missing price sides keep their current value.
// Atomic write (temp file + rename). Returns the model with description as { en, vi }.
export function updateModel(key, patch) {
  const run = async () => {
    snap.mtimeMs = -1 // force a fresh read so we never write over a newer edit
    const models = structuredClone(load())
    const m = models.find(x => x.key === key)
    if (!m) throw new HttpError(404, `Model '${key}' not found.`)
    if (patch.name !== undefined && models.some(x => x !== m && x.name === patch.name))
      throw new HttpError(409, `Another model is already named '${patch.name}'.`)
    const { description, pricing, ...rest } = patch
    if (pricing !== undefined) {
      for (const side of ['inputPer1k', 'outputPer1k']) {
        const v = pricing?.[side]
        if (v !== undefined && v !== null && num(v) === null)
          throw new HttpError(400, `pricing.${side} must be a number >= 0 or null.`)
      }
      m.pricing = { ...(m.pricing || {}), ...pricing }
    }
    Object.assign(m, rest)
    if (description !== undefined) m.description = { ...norm(m.description), ...description }
    const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`
    await fs.promises.writeFile(tmp, JSON.stringify({ models }, null, 2) + '\n')
    await fs.promises.rename(tmp, FILE)
    snap.mtimeMs = -1
    return pub(load().find(x => x.key === key), 'all')
  }
  const p = queue.then(run, run)
  queue = p.catch(() => {})
  return p
}
