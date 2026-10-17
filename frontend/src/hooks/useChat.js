import { useEffect, useRef, useState } from 'react'
import { streamChat } from '../api/stream.js'
import { loadChat, saveChat, clearChat, unsealChat, MAX_MESSAGES } from '../lib/chatStorage.js'

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

// State of one chat conversation. The reply streams into the last assistant message as it arrives.
// Every change is saved to browser storage.
export function useChat({ url, headers }) {
  const [chat, setChat] = useState(loadChat)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef(null)

  useEffect(() => { unsealChat() }, []) // runs before the save effect below
  useEffect(() => { saveChat(chat) }, [chat])
  useEffect(() => () => abortRef.current?.abort(), [])

  // Logout ends the session: stop any reply still in progress.
  useEffect(() => {
    const end = () => abortRef.current?.abort()
    window.addEventListener('session-ended', end)
    return () => window.removeEventListener('session-ended', end)
  }, [])

  const setModelKey = modelKey => setChat(c => ({ ...c, modelKey }))

  const send = async text => {
    const content = text.trim()
    if (!content || busy || !chat.modelKey) return

    const user = { id: newId(), role: 'user', content }
    const bot = { id: newId(), role: 'assistant', content: '' }
    // The model only sees the last MAX_MESSAGES messages, ending with the new one.
    const history = [...chat.messages, user].slice(-MAX_MESSAGES)

    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setError('')
    setChat(c => ({ ...c, messages: [...history, bot] }))

    let reply = ''
    try {
      await streamChat({
        url,
        headers,
        signal: controller.signal,
        body: {
          modelKey: chat.modelKey,
          messages: history.map(({ role, content }) => ({ role, content })),
        },
        onDelta: piece => {
          reply += piece
          setChat(c => ({
            ...c,
            messages: c.messages.map(m => (m.id === bot.id ? { ...m, content: reply } : m)),
          }))
        },
      })
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || 'Something went wrong.')
    } finally {
      abortRef.current = null
      setBusy(false)
      // Drop an empty placeholder (failed before any text arrived) and keep only the last MAX_MESSAGES.
      setChat(c => ({
        ...c,
        messages: c.messages.filter(m => m.id !== bot.id || m.content).slice(-MAX_MESSAGES),
      }))
    }
  }

  const stop = () => abortRef.current?.abort()

  const clear = () => {
    abortRef.current?.abort()
    clearChat()
    setError('')
    setChat(c => ({ modelKey: c.modelKey, messages: [] }))
  }

  return { messages: chat.messages, modelKey: chat.modelKey, setModelKey, busy, error, send, stop, clear }
}
