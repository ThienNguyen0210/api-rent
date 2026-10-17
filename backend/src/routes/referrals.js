// Refer a Friend routes. requireAuth runs first and sets req.userId.
import { Router } from 'express'
import { z } from 'zod'
import { handler, parse, requireAuth, limiter } from '../http.js'
import * as referralService from '../services/referralService.js'

const claimSchema = z.object({
  code: z.string().trim().min(4).max(12).regex(/^[A-Za-z0-9]+$/, 'Invalid referral code.'),
})

const router = Router()
router.use(requireAuth)

// Own code, friends who used it, and this user's own claim status.
router.get('/', handler(async (req, res) => {
  res.json(await referralService.getReferral(req.userId))
}))

// Enter a friend's code. Rate limited so codes can't be guessed in bulk.
router.post('/claim', limiter(10), handler(async (req, res) => {
  res.json(await referralService.claimReferral(req.userId, parse(claimSchema, req.body).code))
}))

export default router
