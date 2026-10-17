// Balance, pricing, purchases and ledger for the logged-in user. Mount: router.use('/billing', billingRouter)
import { Router } from 'express'
import { z } from 'zod'
import { handler, parse, requireAuth } from '../http.js'
import * as billingService from '../services/billingService.js'
import { getPricing } from '../services/pricingService.js'

const txQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) })

// Exactly one of packageId / tokens, plus the price the user saw. .strict() rejects any other field
// (e.g. a client-supplied price/amount is an error, not silently ignored).
const purchaseBody = z.object({
  packageId: z.string().regex(/^[a-z0-9_-]{1,32}$/).optional(),
  tokens: z.number().int().positive().optional(),
  expectedAmountCents: z.number().int().positive(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
}).strict().refine(b => (b.packageId !== undefined) !== (b.tokens !== undefined), 'Provide either packageId or tokens.')

const router = Router()
router.use(requireAuth)

router.get('/', handler(async (req, res) => {
  res.json(await billingService.getBilling(req.userId))
}))

router.get('/pricing', handler(async (_req, res) => {
  res.json(getPricing())
}))

router.get('/invoices', handler(async (req, res) => {
  res.json(await billingService.invoices(req.userId))
}))

router.post('/purchase', handler(async (req, res) => {
  const body = parse(purchaseBody, req.body)
  res.json(await billingService.purchaseTokens(req.userId, body))
}))

router.get('/transactions', handler(async (req, res) => {
  const { limit } = parse(txQuery, req.query)
  res.json(await billingService.transactions(req.userId, limit))
}))

export default router
