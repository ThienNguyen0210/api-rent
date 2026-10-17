// Notifications for the logged-in user. requireAuth runs first.
import { Router } from 'express'
import { handler, requireAuth } from '../http.js'
import * as notificationService from '../services/notificationService.js'

const router = Router()
router.use(requireAuth)

// -> { items: [{ id, date, type, title: { en, vi, ... }, body: { ... } | null, url | null }] }
// Text is returned in every language the admin wrote; the app picks the one the user selected.
router.get('/', handler(async (_req, res) => {
  res.json(await notificationService.listNotifications())
}))

export default router
