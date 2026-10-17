// Builds an OpenAI-style POST /chat/completions router for ONE browser service.
// Authenticated with an NXR_ API key.
//
// The request body must contain a model that exactly matches the router's current model name
// (read from data/models.json on every request, so admin renames apply immediately).
// Errors use OpenAI's { error: { message, type, code } } shape so OpenAI SDKs can read them.

import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'

import { handler, parse, HttpError } from '../../http.js'
import { enforceAccess } from '../../keyAccess.js'
import { verifyKey } from '../../services/keysService.js'
import { assertHasTokens } from '../../services/billingService.js'
import { recordUsage } from '../../services/usageService.js'
import { getModel } from '../../services/modelsService.js'

const message = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.union([
    z.string(),
    z.array(
      z
        .object({
          type: z.string(),
          text: z.string().optional(),
        })
        .passthrough()
    ),
  ]),
})

const bodySchema = z
  .object({
    // model is required.
    // It must also exactly match the current model name (see modelsService).
    model: z.string().min(1),

    messages: z.array(message).min(1).max(100),

    stream: z.boolean().optional(),
  })
  .passthrough()
// temperature, max_tokens, top_p, etc. are accepted for OpenAI SDK compatibility
// but are intentionally ignored by this browser-backed service.

// "Authorization: Bearer <key>" like OpenAI clients send.
// A body field `api_key` works as a fallback.
const keyFrom = req => {
  const m = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '')
  return m ? m[1].trim() : req.body?.api_key
}

const BROWSER_STATUS = {
  not_logged_in: 503,
  challenge: 503,
  no_playwright: 503,
  browser_start: 503,
  timeout: 504,
}

function describe(e) {
  if (e?.name === 'BrowserError') {
    return {
      status: BROWSER_STATUS[e.code] ?? 502,
      message: e.message,
      type: 'upstream_error',
      code: e.code,
    }
  }

  if (e?.status === 503) {
    return {
      status: 503,
      message: e.message,
      type: 'upstream_error',
      code: 'busy',
    }
  }

  if (e?.status && e.status < 500) {
    const type =
      {
        401: 'authentication_error',
        402: 'insufficient_quota',
        403: 'permission_error',
        429: 'rate_limit_error',
      }[e.status] ?? 'invalid_request_error'

    return {
      status: e.status,
      message: e.message,
      type,
      code: { 402: 'insufficient_tokens', 403: 'access_denied', 429: 'rate_limit_exceeded' }[e.status] ?? null,
    }
  }

  console.error(e)

  return {
    status: 500,
    message: 'Something went wrong.',
    type: 'server_error',
    code: null,
  }
}

// USD cost of one request from the model's per-1k prices (data/models.json -> pricing).
// Unpriced sides count as 0. Cache hits report 0 tokens, so they cost 0.
function costOf(pricing, usage = {}) {
  const input = ((usage.prompt_tokens ?? 0) / 1000) * (pricing?.inputPer1k ?? 0)
  const output = ((usage.completion_tokens ?? 0) / 1000) * (pricing?.outputPer1k ?? 0)
  return Number((input + output).toFixed(8))
}

// Records the request once (success or failure) without ever delaying
// or breaking the response.
//
// res.locals.usage is populated immediately after the API key is verified.
// Requests rejected before key verification are therefore not recorded.
function track(res, status, usage = {}) {
  const u = res.locals.usage

  if (!u || u.done) return

  u.done = true

  recordUsage({
    id: u.id,
    userId: u.userId,
    keyId: u.keyId,
    modelId: u.modelId,
    status,
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    // Price of this request at the model's current rates (0 when the model has no price set or the request failed).
    costUsd: costOf(u.pricing, usage),
    latencyMs: Date.now() - u.started,
  }).catch(e => console.error('usage record failed', e))
}

export function createCompletionsRouter({ complete, modelKey }) {
  const router = Router()

  router.post(
    '/chat/completions',
    handler(async (req, res) => {
      const started = Date.now()
      const id = 'NXR-' + crypto.randomBytes(12).toString('hex')
      // Current public name + stable DB identity. Usage/cache rows use modelId so renames don't orphan history.
      const served = getModel(modelKey)

      // Authenticate API key first.
      // `access` = this key's IP / domain / rate rules (verifyKey must return it; see NOTES.md).
      const { userId, keyId, access, cache } = await verifyKey(keyFrom(req))

      // Usage is always associated with the actual model served by this router (stable modelId).
      // `pricing` is captured now so a price edit mid-request cannot change what this request is billed.
      res.locals.usage = {
        id,
        userId,
        keyId,
        modelId: served.modelId,
        pricing: served.pricing,
        started,
      }

      // Per-key rules. Runs after res.locals.usage is set, so denied requests (403/429) show up in usage too.
      enforceAccess(req, res, keyId, access)

      // Validate the request body.
      const { messages, stream, model } = parse(bodySchema, req.body)

      // The requested model MUST exactly match the model served by this router.
      if (model !== served.name) {
        throw new HttpError(
          400,
          `Model '${model}' is not supported. Use '${served.name}'.`
        )
      }

      // Admin can switch a model to 'maintenance' or 'disabled' in data/models.json.
      if (served.status !== 'active') {
        throw new HttpError(503, `Model '${served.name}' is temporarily unavailable (${served.status}).`)
      }

      // Check the token balance only for well-formed requests, right before the browser is used.
      await assertHasTokens(userId)

      const created = Math.floor(Date.now() / 1000)

      // Embedding cache context for this call. complete() sets `hit` when it answers from the cache.
      const cacheCtx = { keyId, userId, modelId: served.modelId, enabled: cache.enabled, threshold: cache.threshold, hit: false }

      const send = (delta, finish = null) =>
        res.write(
          `data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [
              {
                index: 0,
                delta,
                finish_reason: finish,
              },
            ],
          })}\n\n`
        )

      // Streaming callback.
      //
      // The stream is opened only when the first response chunk is available.
      // Therefore errors such as browser login failure or timeout can still
      // be returned as normal HTTP errors if no output has been sent yet.
      const onDelta = stream
        ? text => {
            if (res.destroyed) return

            if (!res.headersSent) {
              res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no',
                'X-NXR-Cache': cacheCtx.hit ? 'HIT' : 'MISS',
              })

              send({ role: 'assistant' })
            }

            send({ content: text })
          }
        : undefined

      // At this point:
      // - API key is valid
      // - billing check passed
      // - model exactly matches the current model name
      //
      // Only now is the browser AI service called.
      const { text, usage } = await complete({
        messages,
        onDelta,
        cache: cacheCtx,
      })

      track(res, 200, usage)

      if (stream) {
        // Gemini/non-streaming clients may return the entire response at once.
        if (!res.headersSent) {
          onDelta(text)
        }

        if (res.destroyed) return

        send({}, 'stop')
        res.write('data: [DONE]\n\n')

        return res.end()
      }

      // Normal non-streaming OpenAI-compatible response.
      res.set('X-NXR-Cache', cacheCtx.hit ? 'HIT' : 'MISS')
      return res.json({
        id,
        object: 'chat.completion',
        created,
        model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: text,
            },
            finish_reason: 'stop',
          },
        ],
        usage,
      })
    })
  )

  // OpenAI-compatible error handler.
  router.use((err, _req, res, _next) => {
    const e = describe(err)

    track(res, e.status)

    const body = {
      error: {
        message: e.message,
        type: e.type,
        code: e.code,
      },
    }

    // If streaming has already started, we cannot change the HTTP status.
    // Send the error as an SSE event and close the stream.
    if (res.headersSent) {
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify(body)}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      }

      return
    }

    return res.status(e.status).json(body)
  })

  return router
}
