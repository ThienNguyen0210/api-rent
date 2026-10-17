// One object per backend resource. Contracts are documented in docs/API.md.
import { request as r } from './client.js'

export const authApi = {
  login: (email, password) => r('/auth/login', { method: 'POST', body: { email, password } }),
  register: (email, password, confirmPassword) => r('/auth/register', { method: 'POST', body: { email, password, confirmPassword } }),
  verifyOtp: (email, otp) => r('/auth/verify-otp', { method: 'POST', body: { email, otp } }),
  resendOtp: email => r('/auth/resend-otp', { method: 'POST', body: { email } }),
  forgotPassword: email => r('/auth/forgot-password', { method: 'POST', body: { email } }),
  verifyResetOtp: (email, otp) => r('/auth/verify-reset-otp', { method: 'POST', body: { email, otp } }), // -> { resetToken }
  resetPassword: (resetToken, password, confirmPassword) => r('/auth/reset-password', { method: 'POST', body: { resetToken, password, confirmPassword } }),
  google: credential => r('/auth/google', { method: 'POST', body: { credential } }),
}

export const keysApi = {
  list: () => r('/keys'),
  otpStatus: () => r('/keys/otp-status'), // -> { registered: boolean }
  // Forgot OTP: 1) forgotOtp() emails a 6-digit code -> { email (masked), expiresInMinutes }; 429 if asked again within 60 s.
  forgotOtp: () => r('/keys/otp/forgot', { method: 'POST', body: {} }),
  // 2) verifyOtpReset(code) -> { resetToken } (valid 10 min); 5 wrong codes cancel the emailed code.
  verifyOtpReset: code => r('/keys/otp/verify', { method: 'POST', body: { code } }),
  // 3) body: { resetToken, newOtp, confirmNewOtp } -> { message, unrecoverableKeys }. The user's keys move to the new OTP and stay viewable;
  // unrecoverableKeys counts the ones that couldn't be moved (they still work for API calls but can't be viewed).
  resetOtp: body => r('/keys/otp/reset', { method: 'POST', body }),
  // First key only (otpStatus().registered === false): send otp + confirmOtp (same 1-6 digits) to register the user's single OTP code.
  // Later keys: just the name. -> key + { secret } (shown once)
  create: (name, otp, confirmOtp) => r('/keys', { method: 'POST', body: { name, otp, confirmOtp } }),
  // -> { secret }. 403 wrong code or banned IP, 429 IP locked out after 3 wrong codes, 409 key was created before OTP protection.
  reveal: (id, otp) => r(`/keys/${id}/reveal`, { method: 'POST', body: { otp } }),
  rename: (id, name) => r(`/keys/${id}`, { method: 'PATCH', body: { name } }),
  setStatus: (id, status) => r(`/keys/${id}`, { method: 'PATCH', body: { status } }),
  remove: id => r(`/keys/${id}`, { method: 'DELETE' }),
  // body: { ips: string[] | null, domains: string[] | null, rateLimitPerMin: number | null } (null = any / unlimited).
  // Full replacement. 400 with a readable message if an entry is invalid.
  setAccess: (id, access) => r(`/keys/${id}/access`, { method: 'PUT', body: access }),
  // ---- embedding cache of a key. threshold = similarity 0.5-1 (higher = stricter); on a pair, null = use the key's global one ----
  cache: id => r(`/keys/${id}/cache`), // -> { enabled, threshold, max, items: [{ id, modelId, input, output, threshold|null, manual, hits, lastHitAt, createdAt, updatedAt }] }
  setCacheSettings: (id, body) => r(`/keys/${id}/cache/settings`, { method: 'PUT', body }), // body: { enabled?, threshold? } -> same as cache()
  createCacheEntry: (id, body) => r(`/keys/${id}/cache/entries`, { method: 'POST', body }), // body: { input, output, threshold? } -> entry; 400 when 300 are stored
  updateCacheEntry: (id, entryId, body) => r(`/keys/${id}/cache/entries/${entryId}`, { method: 'PATCH', body }), // body: { input?, output?, threshold? (number | null) }
  removeCacheEntry: (id, entryId) => r(`/keys/${id}/cache/entries/${entryId}`, { method: 'DELETE' }),
  clearCache: id => r(`/keys/${id}/cache`, { method: 'DELETE' }),
}

export const notesApi = {
  list: () => r('/notes'), // -> { items: [{ id, title, content, createdAt, updatedAt }], max }
  create: note => r('/notes', { method: 'POST', body: note }), // body: { title, content } -> note; 409 when the limit is reached
  update: (id, patch) => r(`/notes/${id}`, { method: 'PATCH', body: patch }), // body: { title?, content? } -> note
  remove: id => r(`/notes/${id}`, { method: 'DELETE' }), // -> null (204)
}

export const accountApi = {
  get: () => r('/account'),
  update: patch => r('/account', { method: 'PATCH', body: patch }),
  loginHistory: () => r('/account/login-history'), // -> { items: [{ id, ip, timeZone, userAgent, createdAt }] }
  // body: { currentPassword, newPassword, logoutOtherDevices } -> { message, token? }
  changePassword: body => r('/account/password', { method: 'POST', body }),
}

export const referralsApi = {
  get: () => r('/referrals'), // -> { code, bonusTokens, claim: { status, tokens, completedAt } | null, invited: [{ id, email, status, tokens, completedAt }], totalEarned }
  claim: code => r('/referrals/claim', { method: 'POST', body: { code } }), // -> { status, tokensAwarded, tokenBalance }; 404 invalid_code, 409 already_claimed | mutual_referral, 400 own_code
}

export const supportApi = {
  list: () => r('/support'), // -> { items: [{ id, title, content, images: [url], createdAt }] }
  // body is a FormData: title, content, images (up to 10 files). client.js must send FormData untouched (see README).
  create: formData => r('/support', { method: 'POST', body: formData }),
  // list() items also carry replies: [{ id, from: 'admin' | 'user', message, createdAt, unread }]
  reply: (id, message) => r(`/support/${id}/reply`, { method: 'POST', body: { message } }), // -> the new reply
  unread: () => r('/support/unread'), // -> { count } admin messages not opened yet
  markRead: () => r('/support/read', { method: 'POST', body: {} }), // -> { count: 0 }
}

export const notificationsApi = {
  list: () => r('/notifications'), // -> { items: [{ id, date, type, title: { en, vi }, body: { en, vi } | null, url | null }] }
}

export const modelsApi = {
  // -> { data: [{ key, name, description: { en, vi }, image, provider, category[], capabilities[], contextTokens|null, pricePer1k|null, status, endpoint }] }
  // lang=all returns every language so the UI can switch without refetching.
  list: () => r('/models', { query: { lang: 'all' } }),
  setAccess: (id, enabled) => r(`/models/${id}/access`, { method: 'PUT', body: { enabled } }),
}

export const plansApi = { list: () => r('/plans') }

export const usageApi = {
  summary: (days = 7) => r('/usage/summary', { query: { days } }),
  requests: (limit = 10) => r('/usage/requests', { query: { limit } }),
  status: () => r('/usage/status'),
}

export const billingApi = {
  get: () => r('/billing'),
  invoices: () => r('/billing/invoices'),
  pricing: () => r('/billing/pricing'), // -> { currency, baseCentsPerMillion, min/max/stepTokens, packages[] }
  // body: ({ packageId } | { tokens }) + { expectedAmountCents, idempotencyKey? }. NEVER send a price to be trusted.
  // Pays with the USD balance. -> { orderId, tokens, amountCents, currency, balanceAfter, tokenBalance }
  // 409 price_changed if expectedAmountCents is stale; 402 insufficient_funds.
  purchase: body => r('/billing/purchase', { method: 'POST', body }),
  transactions: (limit = 20) => r('/billing/transactions', { query: { limit } }),
}

export const depositsApi = {
  // -> { code, bank, accountNumber, accountName, qrUrl, rate, minVnd, items: [{ id, amountVnd, amountUsd, status, createdAt }] }
  get: () => r('/deposits'),
}