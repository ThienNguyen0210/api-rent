// The logged-in user's notes. requireAuth runs first and sets req.userId.
import { Router } from 'express'
import { z } from 'zod'
import { handler, parse, requireAuth, limiter } from '../http.js'
import * as notesService from '../services/notesService.js'

const idSchema = z.object({ id: z.coerce.number().int().positive() })

const title = z.string().trim().max(150)
const content = z.string().max(10000)

const createSchema = z
  .object({ title: title.default(''), content: content.default('') })
  .refine(n => n.title || n.content.trim(), { message: 'A note needs a title or some content.' })

const updateSchema = z
  .object({ title: title.optional(), content: content.optional() })
  .refine(n => n.title !== undefined || n.content !== undefined, { message: 'Nothing to update.' })

const router = Router()
router.use(requireAuth)

router.get('/', handler(async (req, res) => {
  res.json(await notesService.listNotes(req.userId))
}))

router.post('/', limiter(30), handler(async (req, res) => {
  res.status(201).json(await notesService.createNote(req.userId, parse(createSchema, req.body)))
}))

router.patch('/:id', limiter(60), handler(async (req, res) => {
  const { id } = parse(idSchema, req.params)
  res.json(await notesService.updateNote(req.userId, id, parse(updateSchema, req.body)))
}))

router.delete('/:id', limiter(60), handler(async (req, res) => {
  const { id } = parse(idSchema, req.params)
  await notesService.deleteNote(req.userId, id)
  res.status(204).end()
}))

export default router
