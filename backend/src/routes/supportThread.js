// Conversation endpoints for the logged-in user (routes/support.js keeps list + create).
// requireAuth (from http.js) reads the session cookie, runs the CSRF check and sets req.userId.
import { Router } from 'express'
import { handler, requireAuth } from '../http.js'
import * as support from '../services/supportService.js'

const router = Router()

// JSON out, never cached; errors go to the shared error handler.
const send = fn => handler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await fn(req))
})

router.use(requireAuth)

router.get('/unread', send(req => support.unreadCount(req.userId)))
router.post('/read', send(req => support.markRead(req.userId)))
router.post('/:id/reply', send(req => support.replyToRequest(req.userId, Number(req.params.id), req.body?.message)))

export default router