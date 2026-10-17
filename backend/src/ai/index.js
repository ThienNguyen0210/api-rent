// Single entry point for the AI API.
//
// To add a model: copy src/ai/providers/gemini/ to providers/<name>/ (browser.cjs, service.js, index.js),
// then add it to the PROVIDERS list below. It is mounted at /v1/<id> and closed on shutdown automatically.
// (Also add its entry to data/models.json under the same modelKey.)
import { Router } from 'express'
import { limiter } from '../http.js'
import { config } from '../config.js'
import { createCompletionsRouter } from './core/router.js'
import chatgpt from './providers/chatgpt/index.js'
import gemini from './providers/gemini/index.js'
import duckai from './providers/duckai/index.js'
import claude from './providers/claude/index.js'

export const PROVIDERS = [chatgpt, gemini, duckai, claude]

// The public, API-key-authenticated API. Mounted at /v1 in server.js (NOT under /api, which is for the website).
export function createV1Router() {
  const router = Router()
  router.use(limiter(config.ai.ratePerMinute, 1)) // also slows down key guessing
  for (const p of PROVIDERS) router.use(`/${p.id}`, createCompletionsRouter({ complete: p.complete, modelKey: p.modelKey }))
  return router
}

// Called on server shutdown.
export const closeAllBrowsers = () => Promise.allSettled(PROVIDERS.map(p => p.close()))
