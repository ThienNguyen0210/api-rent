// Routes for the logged-in user. requireAuth runs first and sets req.userId.
import { Router } from 'express'
import { z } from 'zod'
import { handler, parse, requireAuth, limiter, setSessionCookie } from '../http.js'
import * as accountService from '../services/accountService.js'

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  preferences: z
    .object({ lowCreditAlerts: z.boolean().optional(), weeklyDigest: z.boolean().optional() })
    .passthrough()
    .optional(),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: z.string().min(8).max(72), // bcrypt ignores bytes past 72
  logoutOtherDevices: z.boolean().default(false),
})

const router = Router()
router.use(requireAuth)

router.get('/', handler(async (req, res) => {
  res.json(await accountService.getAccount(req.userId))
}))

router.patch('/', handler(async (req, res) => {
  res.json(await accountService.updateProfile(req.userId, parse(updateProfileSchema, req.body)))
}))

router.get('/login-history', handler(async (req, res) => {
  res.json(await accountService.getLoginHistory(req.userId))
}))

// Change password; optionally sign out every other device.
// If the service bumps token_version it must return a fresh `token`, otherwise this device's own
// cookie would be revoked too. We swap the cookie here and keep the token out of the JSON.
router.post('/password', limiter(10), handler(async (req, res) => {
  const { token, ...rest } = await accountService.changePassword(req.userId, parse(changePasswordSchema, req.body))
  if (token) setSessionCookie(res, token)
  res.json(rest)
}))

export default router