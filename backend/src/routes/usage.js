// Usage numbers for the logged-in user. Mount in routes/index.js: router.use('/usage', usageRouter)
import { Router } from 'express'
import { z } from 'zod'
import { handler, parse, requireAuth } from '../http.js'
import * as usageService from '../services/usageService.js'

const summaryQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) })
const requestsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(10) })

const router = Router()
router.use(requireAuth)

router.get('/summary', handler(async (req, res) => {
  const { days } = parse(summaryQuery, req.query)
  res.json(await usageService.summary(req.userId, days))
}))

router.get('/requests', handler(async (req, res) => {
  const { limit } = parse(requestsQuery, req.query)
  res.json(await usageService.recentRequests(req.userId, limit))
}))

router.get('/status', handler(async (_req, res) => {
  res.json(await usageService.apiStatus())
}))

export default router
