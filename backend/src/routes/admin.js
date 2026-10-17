import { Router } from 'express'
import * as admin from '../services/adminService.js'

const router = Router()

// JSON out, errors to the shared error middleware, never cached.
const h = fn => async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store')
    res.json(await fn(req))
  } catch (e) { next(e) }
}

router.post('/login', h(req => admin.login(req.body?.password, req.ip)))

// Everything below needs the admin token.
router.use((req, _res, next) => {
  try { admin.assertAdmin(req.headers.authorization); next() } catch (e) { next(e) }
})

router.get('/users', h(req => admin.listUsers(req.query)))                          // ?cursor=&limit=15&q=
router.post('/users/:id/adjust', h(req => admin.adjustBalance(Number(req.params.id), req.body ?? {})))
router.get('/support', h(req => admin.listSupport(req.query)))                      // ?cursor=&limit=15
router.post('/support/:id/reply', h(req => admin.replyToRequest(Number(req.params.id), req.body?.message)))

export default router
