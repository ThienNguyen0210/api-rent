// The logged-in user's personal notes (at most MAX_NOTES each).
import { HttpError } from '../http.js'
import { notes } from '../db.js'

export const MAX_NOTES = 20

// Shape sent to the frontend. Never return a raw DB row.
const publicNote = n => ({ id: n.id, title: n.title, content: n.content, createdAt: n.created_at, updatedAt: n.updated_at })

const isEmpty = (title, content) => !title.trim() && !content.trim()

async function requireOwned(userId, id) {
  const n = await notes.findOwned(id, userId)
  if (!n) throw new HttpError(404, 'Note not found.')
  return n
}

export async function listNotes(userId) {
  const rows = await notes.listByUser(userId)
  return { items: rows.map(publicNote), max: MAX_NOTES }
}

export async function createNote(userId, { title, content }) {
  const row = await notes.createIfUnderLimit(userId, { title, content }, MAX_NOTES)
  if (!row) throw new HttpError(409, `You can have at most ${MAX_NOTES} notes. Delete one to add another.`)
  return publicNote(row)
}

export async function updateNote(userId, id, patch) {
  const current = await requireOwned(userId, id)
  const title = patch.title ?? current.title
  const content = patch.content ?? current.content
  if (isEmpty(title, content)) throw new HttpError(400, 'A note needs a title or some content.')
  await notes.update(current.id, userId, { title, content })
  return publicNote(await requireOwned(userId, id))
}

export async function deleteNote(userId, id) {
  if (!(await notes.remove(id, userId))) throw new HttpError(404, 'Note not found.')
}
