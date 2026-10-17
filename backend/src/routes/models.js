// GET   /api/models        -> list all models (public)
// GET   /api/models/:key   -> one model (public)
// PATCH /api/models/:key   -> edit name / description { en, vi } / image / provider / category / capabilities /
//                             contextTokens / pricePer1k / status (admin only)
//
// Language (same codes as the frontend's LANGS = ['en', 'vi']), first match wins:
//   ?lang=  >  X-Lang header (the user's in-app choice)  >  Accept-Language (vi* -> vi)  >  en
// ?lang=all returns description as { en, vi } (for the admin editor).
import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { handler, parse, HttpError } from '../http.js'
import { LANGS, CATEGORIES, CAPABILITIES, STATUSES, listModels, findModel, updateModel } from '../services/modelsService.js'

// ADMIN GUARD: self-contained (header `x-admin-token` must equal env ADMIN_TOKEN).
// If your auth.js already has an admin check, replace this function with it.
function requireAdmin(req, _res, next) {
  const expected = process.env.ADMIN_TOKEN
  const got = req.get('x-admin-token') || ''
  const a = crypto.createHash('sha256').update(got).digest()
  const b = crypto.createHash('sha256').update(expected || '').digest()
  if (!expected || !crypto.timingSafeEqual(a, b)) return next(new HttpError(403, 'Admin access required.'))
  next()
}

const langOf = req => {
  const pick = v => {
    const l = String(v || '').trim().toLowerCase()
    return LANGS.includes(l) || l === 'all' ? l : null
  }
  return (
    pick(req.query.lang) ||
    pick(req.get('x-lang')) ||
    (/^\s*vi\b/i.test(req.get('accept-language') || '') ? 'vi' : 'en')
  )
}

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z
      .object({
        en: z.string().trim().max(1000).optional(),
        vi: z.string().trim().max(1000).optional(),
      })
      .strict()
      .refine(o => Object.keys(o).length > 0, 'Provide en and/or vi.')
      .optional(),
    image: z
      .string()
      .trim()
      .max(2048)
      .refine(v => v === '' || /^https?:\/\/\S+$/i.test(v), 'image must be an http(s) URL or empty')
      .optional(),
    provider: z.string().trim().max(60).optional(),
    category: z.array(z.enum(CATEGORIES)).max(CATEGORIES.length).optional(),
    capabilities: z.array(z.enum(CAPABILITIES)).max(CAPABILITIES.length).optional(),
    contextTokens: z.number().int().min(0).max(100_000_000).nullable().optional(),
    pricePer1k: z.number().min(0).max(100_000).nullable().optional(),
    status: z.enum(STATUSES).optional(),
  })
  .strict()
  .refine(o => Object.keys(o).length > 0, 'Provide at least one field to change.')

const router = Router()

router.use((_req, res, next) => { res.vary('Accept-Language'); res.vary('X-Lang'); next() })

router.get('/', handler(async (req, res) => res.json({ data: listModels(langOf(req)) })))

router.get('/:key', handler(async (req, res) => {
  const m = findModel(req.params.key, langOf(req))
  if (!m) throw new HttpError(404, 'Model not found.')
  res.json(m)
}))

router.patch('/:key', requireAdmin, handler(async (req, res) => {
  res.json(await updateModel(req.params.key, parse(patchSchema, req.body)))
}))

export default router
