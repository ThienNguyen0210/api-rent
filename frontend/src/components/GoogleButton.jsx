import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n/index.jsx'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const SRC = 'https://accounts.google.com/gsi/client'

// Loads Google Identity Services once, even if several buttons mount.
let gsiPromise
const loadGsi = () => {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (!gsiPromise) {
    gsiPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = SRC; s.async = true
      s.onload = resolve
      s.onerror = () => { gsiPromise = null; reject(new Error('gsi')) }
      document.head.appendChild(s)
    })
  }
  return gsiPromise
}

// "Continue with Google" button. Calls onCredential(idToken); the backend verifies it.
// Renders nothing if VITE_GOOGLE_CLIENT_ID isn't set, so the rest of the login form still works.
export default function GoogleButton({ onCredential, onError }) {
  const box = useRef(null)
  const cb = useRef({ onCredential, onError })
  cb.current = { onCredential, onError } // always call the latest handlers
  const { lang } = useI18n()

  useEffect(() => {
    if (!CLIENT_ID) return
    let dead = false
    loadGsi().then(() => {
      if (dead || !box.current) return
      window.google.accounts.id.initialize({ client_id: CLIENT_ID, callback: r => cb.current.onCredential(r.credential) })
      box.current.innerHTML = ''
      const width = Math.min(400, Math.max(200, Math.round(box.current.offsetWidth) || 320)) // Google allows 200–400
      window.google.accounts.id.renderButton(box.current, { theme: 'outline', size: 'large', width, locale: lang })
    }).catch(() => cb.current.onError?.())
    return () => { dead = true }
  }, [lang])

  if (!CLIENT_ID) return null
  return <div ref={box} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />
}
