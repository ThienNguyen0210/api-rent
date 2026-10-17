// Admin API. Uses its own fetch (not client.js) so a 401 here never triggers the app's "session expired" logout.
const BASE = import.meta.env.VITE_API_URL || '/api'
const KEY = 'admin_token'

export const adminToken = {
  get: () => sessionStorage.getItem(KEY),
  set: t => sessionStorage.setItem(KEY, t),
  clear: () => sessionStorage.removeItem(KEY),
}

async function call(path, { method = 'GET', body, query } = {}) {
  const qs = query
    ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== ''))
    : ''
  const token = adminToken.get()
  const res = await fetch(`${BASE}/admin${path}${qs}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export const adminApi = {
  login: password => call('/login', { method: 'POST', body: { password } }), // -> { token, expiresAt }
  // -> { items: [{ id, email, name, verified, createdAt, balance, tokens, tokensUsed }], nextCursor }
  users: ({ cursor, q } = {}) => call('/users', { query: { cursor, q, limit: 15 } }),
  // body: { amountCents, tokens }; negative = deduct. -> { balance, tokens }
  adjust: (id, body) => call(`/users/${id}/adjust`, { method: 'POST', body }),
  // -> { items: [{ id, title, content, images, createdAt, user: { id, email, name }, replies: [{ message, createdAt }] }], nextCursor }
  support: ({ cursor } = {}) => call('/support', { query: { cursor, limit: 15 } }),
  reply: (id, message) => call(`/support/${id}/reply`, { method: 'POST', body: { message } }), // -> { reply, emailed }
}
