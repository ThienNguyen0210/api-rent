import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react'
const Ctx = createContext({ theme: 'dark', setTheme: () => {} })
export const useTheme = () => useContext(Ctx)

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => { try { const t = localStorage.getItem('theme'); return t === 'light' ? 'light' : 'dark' } catch { return 'dark' } })
  useEffect(() => { try { localStorage.setItem('theme', theme) } catch {} }, [theme])
  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>
}

// Call this only inside the dashboard: the chosen theme is applied while it is mounted
// and removed on the way out, so public pages never inherit it.
export function useApplyTheme() {
  const { theme } = useTheme()
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    return () => { delete document.documentElement.dataset.theme }
  }, [theme])
}
