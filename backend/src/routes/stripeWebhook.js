// Mount BEFORE express.json():  app.use('/api/billing/webhook', stripeWebhookRouter)
// (needs the raw body for signature checks; no requireAuth, the signature is the authentication)
import express, { Router } from 'express'
import { handler } from '../http.js'
import { verifyWebhook } from '../services/paymentService.js'
import { fulfillOrder } from '../services/checkoutService.js'

const router = Router()

router.post('/', express.raw({ type: '*/*', limit: '1mb' }), handler(async (req, res) => {
  const event = verifyWebhook(req.body.toString('utf8'), req.headers['stripe-signature'])
  const s = event.data?.object
  const done = event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded'
  if (done && s?.payment_status === 'paid' && s.client_reference_id) {
    await fulfillOrder({ orderId: s.client_reference_id, amountCents: s.amount_total, currency: s.currency, providerRef: s.id })
  }
  res.json({ received: true })
}))

export default router
