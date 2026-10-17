// Session-authenticated streaming chat for the website dashboard.
// Same providers and the same OpenAI-style SSE output as the public /v1 API, but the caller is signed in with the
// website session instead of an NXR_ API key. The conversation is kept in the browser and is not stored here; each request is
// answered on its own: the AI sees only the newest user message (plus the optional system prompt), never the earlier history.
// Website chats are free: they never check or deduct the token balance and are not written to usage history.
// Mounted in server.js behind requireAuth:  app.use('/api/chat', express.json({ limit: '150kb' }), requireAuth, createChatRouter())

import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'

import { handler, parse, HttpError } from '../http.js'
import { getModel } from '../services/modelsService.js'
import { PROVIDERS } from './index.js'

// The browser keeps at most the 100 most recent messages (MAX_MESSAGES in frontend/src/lib/chatStorage.js, keep in step).
// Only the last one is ever sent to the AI; the cap just bounds what a client may post.
const MAX_MESSAGES = 100

const bodySchema = z
  .object({
    modelKey: z.string().min(1),
    system: z.string().max(8000).optional(), // optional system prompt; line breaks may be real or written as \n
    messages: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(200000) }))
      .min(1)
      .max(MAX_MESSAGES),
  })
  .refine(b => b.messages[b.messages.length - 1].role === 'user', {
    message: 'The last message must come from the user.',
  })

// A system prompt may arrive with real line breaks or with the two characters "\\n"; both become real line breaks.
const cleanSystem = s => String(s ?? '').replace(/\r\n?/g, '\n').replace(/\\n/g, '\n').trim()

export function createChatRouter() {
  const router = Router()

  // Models this chat can actually serve: one entry per provider, active only. Keys are unique by construction.
  router.get(
    '/models',
    handler(async (_req, res) => {
      const data = []
      for (const p of PROVIDERS) {
        try {
          const m = getModel(p.modelKey)
          if (m?.status === 'active') data.push({ key: p.modelKey, name: m.name, image: m.image ?? null })
        } catch { /* provider has no entry in models.json */ }
      }
      res.json({ data })
    })
  )

  router.post(
    '/stream',
    handler(async (req, res) => {
      // requireAuth (mounted in server.js) has already verified the session cookie and set req.userId.
      const userId = req.userId
      if (!userId) throw new HttpError(401, 'Sign in to use the chat.')

      const { modelKey, messages, system } = parse(bodySchema, req.body)

      const provider = PROVIDERS.find(p => p.modelKey === modelKey)
      if (!provider) throw new HttpError(400, 'Unknown model.')

      const served = getModel(provider.modelKey)
      if (served?.status !== 'active') {
        throw new HttpError(503, `${served?.name ?? 'This model'} is temporarily unavailable.`)
      }

      const id = 'CHAT-' + crypto.randomBytes(12).toString('hex')
      const created = Math.floor(Date.now() / 1000)
      const chunk = (delta, finish = null) =>
        res.write(
          `data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model: served.name,
            choices: [{ index: 0, delta, finish_reason: finish }],
          })}\n\n`
        )

      // The stream opens with the first text, so an early failure still arrives as a normal JSON error.
      const onDelta = text => {
        if (res.destroyed) return
        if (!res.headersSent) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          })
          chunk({ role: 'assistant' })
        }
        chunk({ content: text })
      }

      // Every exchange is independent: only the newest user message (and the optional system prompt) reaches the AI.
      // Earlier messages in the request are ignored, so an older client that still sends its history behaves the same.
      const sys = cleanSystem(system)
      const question = { role: 'user', content: messages[messages.length - 1].content }
      const result = await provider.complete({
        messages: sys ? [{ role: 'system', content: sys }, question] : [question],
        onDelta,
        markdown: true,
      })

      if (!res.headersSent) onDelta(result.text) // non-streaming providers deliver the whole reply at once
      if (res.destroyed) return
      chunk({}, 'stop')
      res.write('data: [DONE]\n\n')
      res.end()
    })
  )

  // Errors: a JSON error before the stream opens, an SSE error event after it has started.
  router.use((err, _req, res, _next) => {
    const known = err?.status < 500 || err?.name === 'BrowserError'
    if (!known) console.error(err)
    const status = known ? (err.status ?? 503) : 500
    const body = { error: { message: known ? err.message : 'Something went wrong.' } }

    if (res.headersSent) {
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify(body)}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      }
      return
    }
    return res.status(status).json(body)
  })

  return router
}