import 'dotenv/config'

const need = key => {
  const v = process.env[key]
  if (!v) throw new Error(`Missing required env var: ${key}`)
  return v
}

const jwtSecret = need('JWT_SECRET')
if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters')

// The only file that reads process.env. Add new vars here so a bad setup fails at startup.
export const config = {
  port: Number(process.env.PORT) || 4000,
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim()),
  // Set to the number of reverse proxies in front of the app (e.g. 1 behind nginx/Cloudflare)
  // so rate limiting sees real client IPs instead of the proxy's.
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS) || 0,
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'rentapi',
  },
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  googleClientId: need('GOOGLE_CLIENT_ID'), // public client ID only; the client secret is not used
  resendApiKey: need('RESEND_API_KEY'),
  mailFrom: process.env.MAIL_FROM || 'Rentapi <onboarding@resend.dev>',
  otp: { ttlMinutes: 5, maxAttempts: 5, resendCooldownSeconds: 60 },
  // Public /v1 API. The two browsers (ai/chatgpt/browser.cjs, ai/gemini/browser.cjs) read their own
  // CHATGPT_* / GEMINI_* vars (profile dir, tabs, headless, ...) because they also run standalone from the CLI.
  ai: {
    bodyLimit: process.env.AI_BODY_LIMIT || '1mb', // max request body; chat prompts are larger than the 10kb default
    ratePerMinute: Number(process.env.AI_RATE_PER_MINUTE) || 30, // per IP, across /v1
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 120_000, // one reply, page load included
    maxPending: Number(process.env.AI_MAX_PENDING) || 20, // requests allowed to wait on one browser before 503
  },
}
