import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { config } from './config.js'
import { HttpError, requireAuth } from './http.js'
import { otps } from './db.js'
import routes from './routes/index.js'
import { createV1Router, closeAllBrowsers } from './ai/index.js'
import { createChatRouter } from './ai/sessionRouter.js'
import { UPLOAD_DIR } from './services/supportService.js'
import { startSepayPoller } from './services/sepayPoller.js'

const app = express()
if (config.trustProxyHops) app.set('trust proxy', config.trustProxyHops)
app.use(helmet())

// CORS with credentials (cookies). Browsers reject `Access-Control-Allow-Origin: *` when credentials are
// included, so config.corsOrigin must be explicit origin(s), e.g. "http://localhost:5173".
// A comma-separated string is split into a list of allowed origins.
const corsOrigin = Array.isArray(config.corsOrigin)
  ? config.corsOrigin
  : String(config.corsOrigin).split(',').map(s => s.trim()).filter(Boolean)
app.use(cors({ origin: corsOrigin, credentials: true }))

// Support-request images. Random unguessable file names; CORP is relaxed so the dashboard (another origin) can show them.
app.use('/upload', (_req, res, next) => { res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); next() },
  express.static(UPLOAD_DIR, { index: false, dotfiles: 'ignore', maxAge: '7d' }))
// Public AI API. Mounted before the 10kb parser below because chat prompts are larger (AI_BODY_LIMIT).
app.use('/v1', express.json({ limit: config.ai.bodyLimit }), createV1Router())

// Dashboard chat: signed-in users only (cookie session, requireAuth also enforces the CSRF header).
// Its message history can be larger than the 10kb default, so it gets its own limit and is mounted before the global parser.
app.use('/api/chat', express.json({ limit: '150kb' }), requireAuth, createChatRouter())

// Access rules can hold up to 1,000 IPs + 1,000 domains (~300 KB worst case), more than the 10kb default below.
// body-parser skips a request that is already parsed, so this must stay ABOVE the global parser.
app.put('/api/keys/:id/access', express.json({ limit: '512kb' }))
app.use(express.json({ limit: '10kb' }))

app.use('/api', routes)

app.use((_req, _res, next) => next(new HttpError(404, 'Not found.')))
app.use((err, _req, res, _next) => {
  // HttpError and body-parser errors (bad JSON, too large) carry a safe 4xx; anything else is a bug.
  const status = err instanceof HttpError || err.status < 500 ? err.status : 500
  if (status === 500) console.error(err)
  res.status(status).json({ message: status === 500 ? 'Something went wrong.' : err.message })
})

// Background job: delete expired one-time codes. unref() so it never keeps the process alive.
setInterval(() => otps.purgeExpired().catch(e => console.error('OTP purge failed:', e.message)), 10 * 60_000).unref()

const server = app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`))

// DEPOSIT_MODE=poll|both: background loop that pulls SePay history and credits balances (no-op in webhook mode).
const stopSepayPoller = startSepayPoller()

// Close the Chrome windows the AI browsers opened before exiting.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => {
    stopSepayPoller()
    server.close()
    await closeAllBrowsers()
    process.exit(0)
  })
}