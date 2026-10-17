// Routes for the logged-in user's API keys. Mount in routes/index.js: router.use('/keys', keysRouter)
import { Router } from 'express'
import { z } from 'zod'
import { handler, parse, requireAuth, limiter } from '../http.js'
import * as keysService from '../services/keysService.js'
import { accessSchema } from '../keyAccess.js'
import * as cacheService from '../services/cacheService.js'

const name = z.string().trim().min(1).max(100)
const idParams = z.object({ id: z.string().regex(/^\d+$/) })
const otp = z.string().regex(/^\d{1,6}$/, 'OTP code must be 1 to 6 digits.')
// otp is required on every key. confirmOtp is only sent (and checked) on the user's first key, when they register their OTP code.
const createSchema = z.object({ name, otp, confirmOtp: z.string().optional() })
const revealSchema = z.object({ otp })
const verifyResetSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'The code must be 6 digits.') })
const resetOtpSchema = z.object({ resetToken: z.string().min(20).max(100), newOtp: otp, confirmNewOtp: z.string() })
const updateSchema = z
  .object({ name: name.optional(), status: z.enum(['active', 'disabled']).optional() })
  .refine(v => v.name !== undefined || v.status !== undefined, { message: 'Nothing to update.' })

// Embedding cache. threshold = cosine similarity 0.5 - 1 (higher = stricter). On a pair, null = "use the key's global threshold".
const threshold = z.number().min(cacheService.MIN_THRESHOLD).max(1)
const entryParams = z.object({ id: z.string().regex(/^\d+$/), entryId: z.string().regex(/^\d+$/) })
const cacheSettingsSchema = z
  .object({ enabled: z.boolean().optional(), threshold: threshold.optional() })
  .refine(v => v.enabled !== undefined || v.threshold !== undefined, { message: 'Nothing to update.' })
const entryText = max => z.string().trim().min(1).max(max)
const entryCreateSchema = z.object({
  input: entryText(cacheService.MAX_INPUT_CHARS),
  output: entryText(cacheService.MAX_OUTPUT_CHARS),
  threshold: threshold.nullable().optional(),
  modelId: z.string().trim().min(1).max(100).optional(), // omitted = any model
})
const entryUpdateSchema = z
  .object({ input: entryText(cacheService.MAX_INPUT_CHARS).optional(), output: entryText(cacheService.MAX_OUTPUT_CHARS).optional(), threshold: threshold.nullable().optional() })
  .refine(v => v.input !== undefined || v.output !== undefined || v.threshold !== undefined, { message: 'Nothing to update.' })

// Behind a reverse proxy/CDN, set app.set('trust proxy', ...) so req.ip is the real client and not the proxy.
const clientIp = req => (req.ip || '').replace(/^::ffff:/, '')

const router = Router()
router.use(requireAuth)

router.get('/', handler(async (req, res) => {
  res.json(await keysService.listKeys(req.userId))
}))

// Must stay above the '/:id' routes.
router.get('/otp-status', handler(async (req, res) => {
  res.json(await keysService.otpStatus(req.userId))
}))

// Forgot OTP (all above the '/:id' routes): 1) email a code  2) verify it -> resetToken  3) set a new OTP (new + confirm).
router.post('/otp/forgot', limiter(5), handler(async (req, res) => {
  res.json(await keysService.forgotOtp(req.userId))
}))
router.post('/otp/verify', limiter(10), handler(async (req, res) => {
  res.json(await keysService.verifyResetCode(req.userId, parse(verifyResetSchema, req.body).code))
}))
router.post('/otp/reset', limiter(10), handler(async (req, res) => {
  res.json(await keysService.resetOtp(req.userId, parse(resetOtpSchema, req.body)))
}))

// Needs the correct OTP code: 403 wrong code or banned IP, 429 locked out (same throttle as /:id/reveal).
router.post('/', handler(async (req, res) => {
  res.status(201).json(await keysService.createKey(req.userId, parse(createSchema, req.body), clientIp(req)))
}))

router.patch('/:id', handler(async (req, res) => {
  const { id } = parse(idParams, req.params)
  res.json(await keysService.updateKey(req.userId, id, parse(updateSchema, req.body)))
}))

// Full replacement of the key's rules; a missing/null field means "any" / "unlimited".
router.put('/:id/access', handler(async (req, res) => {
  const { id } = parse(idParams, req.params)
  res.json(await keysService.setAccess(req.userId, id, parse(accessSchema, req.body)))
}))

// Full key, only with the right OTP code. 403 wrong code or banned IP, 429 locked out, 409 key predates OTP protection.
router.post('/:id/reveal', handler(async (req, res) => {
  const { id } = parse(idParams, req.params)
  res.json(await keysService.revealKey(req.userId, id, parse(revealSchema, req.body).otp, clientIp(req)))
}))

// ---- embedding cache of one key (paths end in /cache..., so they never collide with the plain '/:id' routes) ----
router.get('/:id/cache', handler(async (req, res) => {
  const { id } = parse(idParams, req.params)
  res.json(await cacheService.overview(req.userId, id))
}))
router.put('/:id/cache/settings', handler(async (req, res) => {
  const { id } = parse(idParams, req.params)
  res.json(await cacheService.setSettings(req.userId, id, parse(cacheSettingsSchema, req.body)))
}))
router.post('/:id/cache/entries', handler(async (req, res) => {
  const { id } = parse(idParams, req.params)
  res.status(201).json(await cacheService.createEntry(req.userId, id, parse(entryCreateSchema, req.body)))
}))
router.patch('/:id/cache/entries/:entryId', handler(async (req, res) => {
  const { id, entryId } = parse(entryParams, req.params)
  res.json(await cacheService.updateEntry(req.userId, id, entryId, parse(entryUpdateSchema, req.body)))
}))
router.delete('/:id/cache/entries/:entryId', handler(async (req, res) => {
  const { id, entryId } = parse(entryParams, req.params)
  await cacheService.removeEntry(req.userId, id, entryId)
  res.status(204).end()
}))
router.delete('/:id/cache', handler(async (req, res) => {
  const { id } = parse(idParams, req.params)
  await cacheService.clear(req.userId, id)
  res.status(204).end()
}))

router.delete('/:id', handler(async (req, res) => {
  const { id } = parse(idParams, req.params)
  await keysService.deleteKey(req.userId, id)
  res.status(204).end()
}))

export default router
