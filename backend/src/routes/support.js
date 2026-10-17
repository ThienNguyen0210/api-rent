// Support routes. requireAuth runs first and sets req.userId.
// The form is multipart/form-data (title, content, up to 10 files in "images"); multer keeps the files in memory,
// the service checks them and writes them to the upload folder.
import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { handler, parse, requireAuth, limiter, HttpError } from '../http.js'
import * as supportService from '../services/supportService.js'

const { MAX_IMAGES, MAX_IMAGE_BYTES } = supportService

const createSchema = z.object({
  title: z.string().trim().min(3).max(150),
  content: z.string().trim().min(10).max(5000),
})

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_IMAGES, fileSize: MAX_IMAGE_BYTES, fields: 4, fieldSize: 64 * 1024, parts: MAX_IMAGES + 4 },
}).array('images', MAX_IMAGES)

// Turns multer's errors into clean 4xx responses.
const receive = (req, res, next) => upload(req, res, err => {
  if (!err) return next()
  if (!(err instanceof multer.MulterError)) return next(err)
  const msg = {
    LIMIT_FILE_SIZE: `Each image must be ${MAX_IMAGE_BYTES / 1024 / 1024} MB or smaller.`,
    LIMIT_FILE_COUNT: `You can attach up to ${MAX_IMAGES} images.`,
    LIMIT_UNEXPECTED_FILE: `You can attach up to ${MAX_IMAGES} images.`,
  }[err.code] || 'Invalid upload.'
  next(new HttpError(400, msg))
})

const router = Router()
router.use(requireAuth)

// History of the user's requests, newest first.
router.get('/', handler(async (req, res) => {
  res.json(await supportService.listRequests(req.userId))
}))

router.post('/', limiter(5), receive, handler(async (req, res) => {
  res.status(201).json(await supportService.createRequest(req.userId, parse(createSchema, req.body), req.files ?? []))
}))

export default router
