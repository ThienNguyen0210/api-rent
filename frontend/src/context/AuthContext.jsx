import { createContext, useContext, useEffect, useState } from 'react'
import { authApi, accountApi } from '../api/index.js'
import { request } from '../api/client.js'
import { sealChat } from '../lib/chatStorage.js'

// Ends the chat for this browser: stop any reply in progress and wipe the stored conversation.
const endChat = () => {
  window.dispatchEvent(new Event('session-ended'))
  sealChat()
}
const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  // The session is an HttpOnly cookie we can't read, so ask the server who we are on every page load.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    accountApi.get().then(setUser).catch(() => setUser(null)).finally(() => setReady(true))
    const expired = () => { endChat(); setUser(null) }
    window.addEventListener('auth:expired', expired)
    return () => window.removeEventListener('auth:expired', expired)
  }, [])
  // The server has already set the session cookie; the response only carries the user.
  const start = ({ user }) => setUser(user)
  const value = {
    user, ready, setUser,
    login: async (email, pw) => start(await authApi.login(email, pw)),
    register: (email, pw, confirm) => authApi.register(email, pw, confirm), // emails an OTP; no session yet
    verifyOtp: async (email, otp) => start(await authApi.verifyOtp(email, otp)),
    resendOtp: email => authApi.resendOtp(email),
    loginWithGoogle: async credential => start(await authApi.google(credential)),
    // Only the server can delete an HttpOnly cookie. Sign out locally even if the request fails.
    logout: async () => {
      endChat()
      try { await request('/auth/logout', { method: 'POST', body: {} }) } catch { /* ignore */ }
      setUser(null)
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}