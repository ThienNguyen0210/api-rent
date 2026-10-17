// Text -> unit-length vector, used by the API-key cache.
//
// Default: a local, dependency-free embedding (feature hashing of words, word bigrams and character trigrams into 384 dims).
// It needs no network and no extra RAM, and it catches rewording, typos and inflections, but it is lexical, not neural.
// For true semantic matching, point it at any OpenAI-compatible /embeddings endpoint:
//   CACHE_EMBEDDING_URL=https://api.openai.com/v1/embeddings  CACHE_EMBEDDING_KEY=sk-...  CACHE_EMBEDDING_MODEL=text-embedding-3-small
// Vectors are tagged with the model that made them and only compared with vectors of the same model, so you can switch at any time
// (old entries simply stop matching until they are re-saved).

const DIM = 384
const LOCAL_MODEL = `local-hash-${DIM}`
const URL_ = process.env.CACHE_EMBEDDING_URL
const KEY_ = process.env.CACHE_EMBEDDING_KEY
const REMOTE_MODEL = process.env.CACHE_EMBEDDING_MODEL || 'text-embedding-3-small'

export const normalizeText = s => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()

function fnv(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}

function unit(v) {
  let n = 0
  for (let i = 0; i < v.length; i++) n += v[i] * v[i]
  n = Math.sqrt(n) || 1
  for (let i = 0; i < v.length; i++) v[i] /= n
  return v
}

export function localEmbed(text) {
  const v = new Float32Array(DIM)
  const add = (feat, w) => { const h = fnv(feat); v[h % DIM] += (h >>> 31) ? -w : w }
  const words = normalizeText(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  words.forEach((w, i) => {
    add('w:' + w, 1)
    if (i > 0) add('b:' + words[i - 1] + ' ' + w, 1)
    if (w.length >= 3) { const p = `#${w}#`; for (let j = 0; j + 3 <= p.length; j++) add('c:' + p.slice(j, j + 3), 0.4) }
  })
  return unit(v)
}

/** -> { vector: Float32Array (unit length), model: string } */
export async function embed(text) {
  if (URL_) {
    try {
      const res = await fetch(URL_, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(KEY_ ? { Authorization: `Bearer ${KEY_}` } : {}) },
        body: JSON.stringify({ model: REMOTE_MODEL, input: String(text) }),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error(`embedding endpoint answered ${res.status}`)
      const arr = (await res.json())?.data?.[0]?.embedding
      if (!Array.isArray(arr) || !arr.length) throw new Error('embedding endpoint returned no vector')
      return { vector: unit(Float32Array.from(arr)), model: REMOTE_MODEL }
    } catch (e) { console.error('[cache] remote embedding failed, using the local one:', e.message) }
  }
  return { vector: localEmbed(text), model: LOCAL_MODEL }
}

export const toBuffer = vec => Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)
export const fromBuffer = buf => new Float32Array(Uint8Array.from(buf).buffer) // copy: a Buffer's offset may not be 4-byte aligned

/** Cosine similarity of two unit vectors (= dot product). Different sizes never match. */
export function dot(a, b) {
  if (a.length !== b.length) return -1
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}
