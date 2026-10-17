// Notifications: the admin edits backend/data/notifications.json, users read it through GET /api/notifications.
// The file is re-read whenever it changes (checked by modification time), so edits need no restart.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = process.env.NOTIFICATIONS_FILE
  ? path.resolve(process.env.NOTIFICATIONS_FILE)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/notifications.json')

const TYPES = new Set(['info', 'update', 'warning', 'success'])
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/
const MAX_ITEMS = 100

// { "en": "...", "vi": "..." } -> only non-empty strings under valid language codes. A plain string counts as English.
function localized(v, max) {
  if (typeof v === 'string') v = { en: v }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out = {}
  for (const [lang, s] of Object.entries(v))
    if (LANG.test(lang) && typeof s === 'string' && s.trim()) out[lang] = s.trim().slice(0, max)
  return Object.keys(out).length ? out : null
}

// Only http(s) links or paths inside the app ("/dashboard/billing"); never javascript: and friends.
const safeUrl = u => {
  const s = typeof u === 'string' ? u.trim() : ''
  return /^https?:\/\/\S+$/i.test(s) || /^\/(?!\/)\S*$/.test(s) ? s : null
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id).trim() : ''
  const date = new Date(raw.date)
  const title = localized(raw.title, 200)
  if (!id || Number.isNaN(date.getTime()) || !title) return null
  return { id, date, type: TYPES.has(raw.type) ? raw.type : 'info', title, body: localized(raw.body, 2000), url: safeUrl(raw.url) }
}

let cache = { mtimeMs: -1, items: [] }

async function load() {
  let st
  try { st = await fs.promises.stat(FILE) } catch { cache = { mtimeMs: -1, items: [] }; return cache.items } // no file = no notifications
  if (st.mtimeMs === cache.mtimeMs) return cache.items
  const mtimeMs = st.mtimeMs
  try {
    const raw = JSON.parse(await fs.promises.readFile(FILE, 'utf8'))
    if (!Array.isArray(raw)) throw new Error('the file must contain an array')
    const seen = new Set()
    const items = []
    raw.forEach((r, i) => {
      const n = normalize(r)
      if (!n) return console.warn(`notifications.json: entry #${i + 1} skipped (needs id, date and title)`)
      if (seen.has(n.id)) return console.warn(`notifications.json: entry #${i + 1} skipped (duplicate id "${n.id}")`)
      seen.add(n.id); items.push(n)
    })
    cache = { mtimeMs, items }
  } catch (e) {
    // A typo while editing must not wipe the list: keep serving the last good version.
    console.error('notifications.json could not be read:', e.message)
    cache = { mtimeMs, items: cache.items }
  }
  return cache.items
}

/** Published notifications, newest first. An entry whose date is in the future stays hidden until then. */
export async function listNotifications() {
  const now = Date.now()
  const items = (await load())
    .filter(n => n.date.getTime() <= now)
    .sort((a, b) => b.date - a.date)
    .slice(0, MAX_ITEMS)
    .map(n => ({ ...n, date: n.date.toISOString() }))
  return { items }
}
