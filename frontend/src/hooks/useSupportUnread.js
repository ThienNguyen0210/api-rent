import { useCallback, useEffect, useRef, useState } from 'react'
import { supportApi } from '../api/index.js'

/**
 * Number of admin messages the user has not opened yet. Refreshes on every navigation, once a minute while the tab
 * is visible, and when the Support page announces it marked messages as read (window event 'support-unread-changed').
 */
export function useSupportUnread(pathname) {
  const [count, setCount] = useState(0)
  const alive = useRef(true)

  const refresh = useCallback(() => {
    supportApi.unread()
      .then(r => { if (alive.current) setCount(Number(r?.count) || 0) })
      .catch(() => {}) // a failed badge refresh is not worth an error message
  }, [])

  useEffect(() => { refresh() }, [pathname, refresh])

  useEffect(() => {
    alive.current = true
    const timer = setInterval(() => { if (!document.hidden) refresh() }, 60_000)
    window.addEventListener('support-unread-changed', refresh)
    return () => {
      alive.current = false
      clearInterval(timer)
      window.removeEventListener('support-unread-changed', refresh)
    }
  }, [refresh])

  return count
}
