// Mount: router.use('/deposits', depositsRouter)
//   GET  /api/deposits                -> deposit page data (logged-in user)
//   POST /api/deposits/sepay-webhook  -> called by SePay (API-key auth, NOT user auth)
import { Router } from 'express'
import { z } from 'zod'
import { HttpError, handler, parse, requireAuth } from '../http.js'
import * as deposits from '../services/depositService.js'

const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) })

// Only what we need; SePay may send extra fields, so no .strict() here.
const sepayBody = z.object({
  id: z.coerce.number().int().positive(),
  transferType: z.string(),
  transferAmount: z.coerce.number().int().positive(),
  accountNumber: z.coerce.string().optional(),
  code: z.string().nullish(),
  content: z.string().nullish(),
  description: z.string().nullish(),
  referenceCode: z.string().nullish(),
}).passthrough()

const router = Router()

router.post('/sepay-webhook', handler(async (req, res) => {
  if (!deposits.depositMode().webhook) throw new HttpError(404, 'Not found.') // DEPOSIT_MODE=poll: endpoint is off
  deposits.assertSepayAuth(req.get('authorization'))
  const body = parse(sepayBody, req.body)
  await deposits.processSepayWebhook(body)
  res.status(200).json({ success: true }) // SePay treats 200/201 + success:true as delivered
}))

router.get('/', requireAuth, handler(async (req, res) => {
  const { limit } = parse(q, req.query)
  res.json(await deposits.getDepositInfo(req.userId, limit))
}))

export default router
