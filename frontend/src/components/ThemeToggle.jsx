import { useTheme } from '../context/ThemeContext.jsx'
import { useI18n } from '../i18n/index.jsx'
export default function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const { t } = useI18n()
  const next = theme === 'light' ? 'dark' : 'light'
  const label = t(next === 'dark' ? 'theme.toDark' : 'theme.toLight')
  return <button className="icon-btn" onClick={() => setTheme(next)} aria-label={label} title={label}>{theme === 'light' ? '☾' : '☀'}</button>
}
