// Mounts every router under /api. To add a route group: create routes/<name>.js and mount it here.
import { Router } from 'express'
import authRouter from './auth.js'
import accountRouter from './account.js'
import keysRouter from './keys.js'
import billingRouter from './billing.js'
import usageRouter from './usage.js'     
import referralsRouter from './referrals.js'
import supportRouter from './support.js'
import supportThreadRouter from './supportThread.js'
import notificationsRouter from './notifications.js'
import notesRouter from './notes.js'
import depositsRouter from './deposits.js'
import modelsRouter from './models.js'
import adminRouter from './admin.js'

const router = Router()
router.get('/health', (_req, res) => res.json({ ok: true }))
router.use('/auth', authRouter)
router.use('/account', accountRouter)
router.use('/keys', keysRouter)
router.use('/billing', billingRouter) 
router.use('/usage', usageRouter)     
router.use('/referrals', referralsRouter)
router.use('/support', supportRouter)
router.use('/support', supportThreadRouter) // GET /unread, POST /read, POST /:id/reply
router.use('/notifications', notificationsRouter)
router.use('/notes', notesRouter)
router.use('/deposits', depositsRouter) // POST /sepay-webhook is public (API-key auth); GET / needs a login
router.use('/models', modelsRouter) // GET is public; PATCH needs the admin token
router.use('/admin', adminRouter) // POST /login is public (ADMIN_PASSWORD); everything else needs the admin session token
export default router