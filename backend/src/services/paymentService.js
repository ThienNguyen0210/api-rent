// Payment provider adapter (Stripe Checkout over plain HTTPS, no SDK).
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, APP_URL (e.g. https://app.example.com)
import crypto from 'node:crypto'
import { HttpError } from '../http.js'

const env = k => process.env[k] || ''

export async function createCheckoutSession(order) {
  const key = env('STRIPE_SECRET_KEY')
  if (!key || !env('APP_URL')) throw new HttpError(503, 'Payments are not configured.')
  const back = `${env('APP_URL').replace(/\/$/, '')}/billing`
  const body = new URLSearchParams({
    mode: 'payment',
    client_reference_id: order.id,
    'metadata[order_id]': order.id,
    success_url: `${back}?order=${order.id}&status=success`,
    cancel_url: `${back}?order=${order.id}&status=cancelled`,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': order.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(order.amountCents),
    'line_items[0][price_data][product_data][name]': `${(order.tokens / 1e6).toLocaleString('en-US')}M API tokens`,
  })
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': order.id,
    },
    body,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) {
    console.error('stripe session failed', res.status, data?.error?.message)
    throw new HttpError(502, 'Could not start checkout. Please try again.')
  }
  return { providerRef: data.id, url: data.url }
}

/** Verifies the Stripe-Signature header against the RAW body. Returns the parsed event or throws 400. */
export function verifyWebhook(rawBody, header, toleranceSec = 300) {
  const secret = env('STRIPE_WEBHOOK_SECRET')
  if (!secret) throw new HttpError(503, 'Webhook not configured.')
  const parts = Object.fromEntries(String(header || '').split(',').map(s => s.split('=')))
  const t = Number(parts.t)
  if (!t || !parts.v1 || Math.abs(Date.now() / 1000 - t) > toleranceSec) throw new HttpError(400, 'Bad signature.')
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  const a = Buffer.from(expected), b = Buffer.from(parts.v1)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(400, 'Bad signature.')
  return JSON.parse(rawBody)
}
