import { lazy, Suspense, useEffect } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import Logo from '../components/Logo.jsx'
import Button from '../components/Button.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useI18n } from '../i18n/index.jsx'
import '../styles/background.css'

// Three.js is heavy: load it after first paint so the page content appears immediately
const ThreeBackground = lazy(() => import('../components/ThreeBackground.jsx'))

export default function MarketingLayout() {
  const { user, ready } = useAuth()
  const { t } = useI18n()
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname]) // the background reacts to scroll, so start each page at the top
  return (
    <div className="mk">
      <div className="mk-bg" aria-hidden="true"><Suspense fallback={null}><ThreeBackground /></Suspense></div>
      <header className="nav"><div className="container nav-in">
        <Logo />
        <nav><NavLink to="/pricing">{t('nav.pricing')}</NavLink></nav>
        <div className="nav-cta">
          {!ready ? null : user
            ? <Button to="/dashboard">{t('nav.dashboard')}</Button>
            : <><Button to="/login" variant="ghost">{t('nav.login')}</Button><Button to="/login?mode=register">{t('nav.getStarted')}</Button></>}
        </div>
      </div></header>
      <main><Outlet /></main>
      <footer className="footer"><div className="container">© 2026 NEXORA</div></footer>
    </div>
  )
}