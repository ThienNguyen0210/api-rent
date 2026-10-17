// Support requests: validate and store the images, save the request, email the admin, keep a history.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HttpError } from '../http.js'
import { config } from '../config.js'
import { users, support } from '../db.js'
import { sendSupportEmail } from '../mail.js'

export const MAX_IMAGES = 10
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const ADMIN_EMAIL = process.env.SUPPORT_ADMIN_EMAIL || 'thiennguyenchi235aa@gmail.com'
// Public base URL of THIS API: it is what the links in the admin email point to. Set PUBLIC_URL in production.
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${config.port}`).replace(/\/+$/, '')
// backend/upload (next to src/), whatever directory the server is started from.
export const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../upload')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const urlOf = filename => `${PUBLIC_URL}/upload/${filename}`

// Decide the type from the file's first bytes, never from the name or the browser's claim. SVG is excluded on purpose (it can carry scripts).
function sniffExt(b) {
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png'
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg'
  if (b.length > 6 && b.subarray(0, 4).toString('latin1') === 'GIF8') return '.gif'
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp'
  return null
}

async function requireUser(userId) {
  const u = await users.findById(userId)
  if (!u || !u.email_verified) throw new HttpError(401, 'Session expired. Please log in again.')
  return u
}

// One message of the conversation. `unread` = an admin message the user has not opened yet.
export const replyView = x => ({
  id: String(x.id), from: x.sender, message: x.message, createdAt: x.created_at, unread: x.sender === 'admin' && !x.read_at,
})

export const view = r => ({
  id: String(r.id), title: r.title, content: r.content, images: (r.images ?? []).map(urlOf), createdAt: r.created_at,
  replies: (r.replies ?? []).map(replyView),
})

export async function listRequests(userId) {
  await requireUser(userId)
  return { items: (await support.listByUser(userId)).map(view) }
}

/**
 * Saves the images, stores the request, emails the admin with a link to each image.
 * All or nothing: if anything fails (including the email), the row and the files are removed.
 */
export async function createRequest(userId, { title, content }, files) {
  const me = await requireUser(userId)

  const images = files.map((f, i) => {
    const ext = sniffExt(f.buffer)
    if (!ext) throw new HttpError(400, `Image ${i + 1} is not supported. Use PNG, JPG, GIF or WebP.`)
    return { filename: `${crypto.randomBytes(16).toString('hex')}${ext}`, buffer: f.buffer, size: f.size }
  })

  let id
  try {
    await Promise.all(images.map(i => fs.promises.writeFile(path.join(UPLOAD_DIR, i.filename), i.buffer, { flag: 'wx' })))
    id = await support.create(me.id, { title, content }, images.map(({ filename, size }) => ({ filename, size })))
    await sendSupportEmail(ADMIN_EMAIL, {
      id, name: me.name || me.email, email: me.email, title, content, imageUrls: images.map(i => urlOf(i.filename)),
    })
  } catch (e) {
    if (id) await support.remove(id).catch(() => {})
    await Promise.all(images.map(i => fs.promises.rm(path.join(UPLOAD_DIR, i.filename), { force: true })))
    console.error('Support request failed:', e.message)
    throw e instanceof HttpError ? e : new HttpError(502, 'Could not send your request. Please try again.')
  }

  return view({ id, title, content, images: images.map(i => i.filename), created_at: new Date().toISOString() })
}

const MAX_USER_REPLIES = 100

/** The user answers in an existing conversation. The admin is notified by email (best effort). */
export async function replyToRequest(userId, requestId, message) {
  const me = await requireUser(userId)
  if (!Number.isSafeInteger(requestId) || requestId <= 0) throw new HttpError(400, 'Invalid request.')
  const text = String(message ?? '').trim()
  if (text.length < 2 || text.length > 5000) throw new HttpError(400, 'Reply must be 2-5000 characters.')
  const req = await support.findOwned(requestId, me.id)
  if (!req) throw new HttpError(404, 'Support request not found.')
  if ((await support.countUserReplies(req.id)) >= MAX_USER_REPLIES) throw new HttpError(429, 'Too many replies on this request.')

  const id = await support.addUserReply(req.id, text)
  try {
    await sendSupportEmail(ADMIN_EMAIL, {
      id: req.id, name: me.name || me.email, email: me.email, title: `Re: ${req.title}`, content: text, imageUrls: [],
    })
  } catch (e) { console.error('Support reply notification failed:', e.message) }
  return replyView({ id, sender: 'user', message: text, created_at: new Date().toISOString(), read_at: new Date() })
}

/** Number of admin messages the user has not opened yet (the sidebar badge). */
export async function unreadCount(userId) {
  await requireUser(userId)
  return { count: await support.unreadCount(userId) }
}

/** The user opened the Support page: everything the admin sent so far counts as read. */
export async function markRead(userId) {
  await requireUser(userId)
  await support.markRead(userId)
  return { count: 0 }
}
