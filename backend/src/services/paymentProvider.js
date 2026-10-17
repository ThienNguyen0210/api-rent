// STUB so the server boots before a payment provider is chosen.
// Replace both functions with your provider's SDK (Stripe, PayOS, VNPay, MoMo, ...).
import { HttpError } from '../http.js'

/**
 * Create a hosted checkout session for one of OUR orders.
 * Must charge exactly `amountCents` and carry `orderId` so the webhook can find the order.
 * @returns {{ checkoutUrl: string, providerRef: string }}  providerRef = the provider's session/payment id
 */
export async function createCheckoutSession({ orderId, amountCents, currency, description }) {
  throw new HttpError(501, 'Payments are not configured yet.')
}

/**
 * Verify the webhook signature over the RAW body (Buffer) and normalise the event.
 * Must THROW if the signature is invalid.
 * @returns {{ type: 'payment.succeeded' | string, orderId: string, amountCents: number, currency: string }}
 */
export function verifyWebhook(rawBody, headers) {
  throw new Error('Webhook verification not configured')
}
