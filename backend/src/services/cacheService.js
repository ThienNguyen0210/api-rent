// Embedding cache of an API key: every successful completion is stored as an (input, output) pair (max 300 per key);
// when the key's cache is switched on, a new input whose embedding is similar enough to a stored one gets that output back
// without opening a browser tab. Users can edit pairs, add their own, and set the similarity threshold globally or per pair.
//
// "Threshold" is cosine similarity, 0.50 - 1.00 (higher = stricter; 1.00 = the same text only). Tolerance = 1 - threshold.
import crypto from 'node:crypto'
import { HttpError } from '../http.js'
import { keys, cacheEntries } from '../db.js'
import { embed, normalizeText, toBuffer, fromBuffer, dot } from './embedding.js'

export const MAX_ENTRIES = 300
export const DEFAULT_THRESHOLD = 0.85
export const MIN_THRESHOLD = 0.5
export const MAX_INPUT_CHARS = 8000
export const MAX_OUTPUT_CHARS = 100000
const ANY_MODEL = '*'
const EPS = 1e-6

const hashOf = (modelId, input) => crypto.createHash('sha256').update(modelId + '\n' + normalizeText(input)).digest('hex')

const publicEntry = r => ({
  id: String(r.id),
  modelId: r.model_id,
  input: r.input_text,
  output: r.output_text,
  threshold: r.threshold == null ? null : Number(r.threshold), // null = uses the key's global threshold
  manual: !!r.manual,
  hits: Number(r.hits),
  lastHitAt: r.last_hit_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

// ---------------------------------------------------------------------------
// Request path (called by core/completion; failures there are logged, never surfaced to API callers)
// ---------------------------------------------------------------------------

/** Best stored entry whose similarity reaches its threshold (its own, else `threshold`), or null. */
export async function lookup({ keyId, modelId, input, threshold }) {
  if (!input || input.length > MAX_INPUT_CHARS) return null
  const { vector, model } = await embed(input)
  let best = null
  let bestSim = -1
  for (const r of await cacheEntries.vectors(keyId, modelId, model)) {
    const sim = dot(vector, fromBuffer(r.embedding))
    const need = r.threshold == null ? threshold : Number(r.threshold)
    if (sim + EPS >= need && sim > bestSim) { best = r; bestSim = sim }
  }
  if (!best) return null
  const e = await cacheEntries.get(keyId, best.id)
  if (!e) return null
  cacheEntries.hit(e.id).catch(err => console.error('[cache] hit count failed', err))
  return { output: e.output_text, similarity: bestSim, id: e.id }
}

/** Stores a finished completion. Same input again -> refreshes the stored output; full -> evicts the least recently used auto entry. */
export async function record({ keyId, userId, modelId, input, output }) {
  if (!input || !output || !output.trim()) return
  if (input.length > MAX_INPUT_CHARS || output.length > MAX_OUTPUT_CHARS) return
  const hash = hashOf(modelId, input)
  const existing = await cacheEntries.findByHash(keyId, modelId, hash)
  if (existing) { await cacheEntries.setOutput(existing.id, output); return } // manual entries stay as the user wrote them
  const { vector, model } = await embed(input)
  await cacheEntries.insertIfRoom(keyId,
    { userId, modelId, input, output, hash, embedding: toBuffer(vector), embeddingModel: model, threshold: null, manual: false },
    MAX_ENTRIES, { evict: true })
}

// ---------------------------------------------------------------------------
// Dashboard (the logged-in user's own keys)
// ---------------------------------------------------------------------------
async function owned(userId, keyId) {
  const k = await keys.findOwned(keyId, userId)
  if (!k) throw new HttpError(404, 'API key not found.')
  return k
}

export async function overview(userId, keyId) {
  const k = await owned(userId, keyId)
  return {
    enabled: !!k.cache_enabled,
    threshold: Number(k.cache_threshold ?? DEFAULT_THRESHOLD),
    max: MAX_ENTRIES,
    items: (await cacheEntries.listByKey(keyId)).map(publicEntry),
  }
}

export async function setSettings(userId, keyId, { enabled, threshold }) {
  await owned(userId, keyId)
  await keys.setCache(keyId, userId, { enabled, threshold })
  return overview(userId, keyId)
}

export async function createEntry(userId, keyId, { input, output, threshold, modelId }) {
  await owned(userId, keyId)
  const { vector, model } = await embed(input)
  const m = modelId || ANY_MODEL
  const r = await cacheEntries.insertIfRoom(keyId,
    { userId, modelId: m, input, output, hash: hashOf(m, input), embedding: toBuffer(vector), embeddingModel: model, threshold: threshold ?? null, manual: true },
    MAX_ENTRIES, { evict: false })
  if (r.full) throw new HttpError(400, `A key can hold up to ${MAX_ENTRIES} pairs. Delete one to add another.`)
  if (r.dup) throw new HttpError(409, 'A pair with this input already exists.')
  return publicEntry(await cacheEntries.get(keyId, r.id))
}

// `patch.threshold`: a number sets this pair's own threshold, null returns it to the global one, undefined leaves it.
export async function updateEntry(userId, keyId, id, patch) {
  await owned(userId, keyId)
  const e = await cacheEntries.get(keyId, id)
  if (!e) throw new HttpError(404, 'Cache entry not found.')
  const merged = {
    input: patch.input ?? e.input_text,
    output: patch.output ?? e.output_text,
    threshold: patch.threshold !== undefined ? patch.threshold : (e.threshold == null ? null : Number(e.threshold)),
    hash: e.input_hash,
    embedding: e.embedding,
    embeddingModel: e.embedding_model,
  }
  if (patch.input !== undefined && normalizeText(patch.input) !== normalizeText(e.input_text)) { // new input -> new vector
    const { vector, model } = await embed(patch.input)
    merged.hash = hashOf(e.model_id, patch.input)
    merged.embedding = toBuffer(vector)
    merged.embeddingModel = model
  }
  const r = await cacheEntries.update(keyId, id, merged)
  if (r === 'dup') throw new HttpError(409, 'A pair with this input already exists.')
  if (r === 'missing') throw new HttpError(404, 'Cache entry not found.')
  return publicEntry(await cacheEntries.get(keyId, id))
}

export async function removeEntry(userId, keyId, id) {
  await owned(userId, keyId)
  if (!(await cacheEntries.remove(keyId, id))) throw new HttpError(404, 'Cache entry not found.')
}

export async function clear(userId, keyId) {
  await owned(userId, keyId)
  await cacheEntries.clear(keyId)
}
