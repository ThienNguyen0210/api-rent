import { t, getLang } from '../i18n/index.jsx'
const BASE = import.meta.env.VITE_API_URL || '/api'
const LEGACY_KEY = 'NEXORA_token'

// The session now lives in an HttpOnly cookie that JavaScript cannot read.
// This stub keeps old imports working and removes any token left in localStorage by the previous version.
export const tokenStore = {
  get() { return null },
  set() {},
  clearLegacy() { try { localStorage.removeItem(LEGACY_KEY) } catch {} },
}
tokenStore.clearLegacy()

const timeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' } }

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

export async function request(path, { method = 'GET', body, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(query) : ''
  // FormData (file uploads) is sent as is: the browser adds the multipart Content-Type with its boundary.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  let res
  try {
    res = await fetch(BASE + path + qs, {
      method,
      credentials: 'include', // send/receive the HttpOnly session cookie
      headers: {
        ...(!isForm && { 'Content-Type': 'application/json' }),
        'Accept-Language': getLang(),
        'X-Timezone': timeZone(),
        'X-Requested-With': 'XMLHttpRequest', // CSRF guard: the server requires this on non-GET requests
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, t('errors.network'))
  }
  // A 401 on a normal API call means the session cookie expired. Auth routes (login etc.) are excluded
  // so a wrong password doesn't look like an expired session.
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('auth:expired'))
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.message || t('errors.request', { status: res.status }))
  return data
}