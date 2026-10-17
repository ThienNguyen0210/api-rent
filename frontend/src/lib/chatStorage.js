// The conversation lives only in this browser (localStorage). The server never stores chat text.
// Only the last MAX_MESSAGES messages are kept.
const KEY = 'nxr.chat.v1'
export const MAX_MESSAGES = 5

// Set by sealChat() on logout. After that, nothing on this page may write the conversation back.
let sealed = false

const isMessage = m =>
  m && typeof m.id === 'string' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'

export function loadChat() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || 'null')
    return {
      modelKey: typeof data?.modelKey === 'string' ? data.modelKey : '',
      messages: Array.isArray(data?.messages) ? data.messages.filter(isMessage).slice(-MAX_MESSAGES) : [],
    }
  } catch {
    return { modelKey: '', messages: [] }
  }
}

export function saveChat({ modelKey, messages }) {
  if (sealed) return
  try {
    localStorage.setItem(KEY, JSON.stringify({ modelKey, messages: messages.slice(-MAX_MESSAGES) }))
  } catch {
    // Storage is full or disabled: the chat keeps working for this page visit.
  }
}

export function clearChat() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}

// Logout: wipe the conversation and block any later save from this page.
export function sealChat() {
  sealed = true
  clearChat()
}

// Called when the chat mounts, so a new sign-in can save again.
export function unsealChat() {
  sealed = false
}
