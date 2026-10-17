import { useEffect, useRef, useState } from 'react'
import { Outlet, NavLink, Link, useLocation } from 'react-router-dom'
import Logo from '../components/Logo.jsx'
import LanguageSwitcher from '../components/LanguageSwitcher.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { sealChat } from '../lib/chatStorage.js'
import { useApplyTheme, useTheme } from '../context/ThemeContext.jsx'
import { useI18n } from '../i18n/index.jsx'
import { useApi } from '../hooks/useApi.js'
import { billingApi } from '../api/index.js'
import { useSupportUnread } from '../hooks/useSupportUnread.js'
import { fmtMoney } from '../lib/format.js'
import '../styles/user-menu.css'
import '../styles/dashboard-layout.css'

// SVG paths (24x24 stroke icons).
const ICONS = {
  overview: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  keys: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 11-7.8 7.8 5.5 5.5 0 017.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  cache: 'M12 2C6.5 2 3 3.8 3 6v12c0 2.2 3.5 4 9 4s9-1.8 9-4V6c0-2.2-3.5-4-9-4zM3 6c0 2.2 3.5 4 9 4s9-1.8 9-4M3 12c0 2.2 3.5 4 9 4s9-1.8 9-4',
  models: 'M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4a2 2 0 001-1.7zM3.3 7L12 12l8.7-5M12 22V12',
  chat: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  billing: 'M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0',
  deposit: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  referral: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 110-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 100-5C13 2 12 7 12 7z',
  support: 'M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8v.5z',
  notes: 'M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6zM14 3v6h6M8 13h8M8 17h5',
  bell: 'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M18 6L6 18M6 6l12 12',
  chevron: 'M6 9l6 6 6-6',
}
const Icon = ({ name, className = 'ic' }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={ICONS[name]} /></svg>
)

const links = [
  ['/dashboard', 'dash.overview', true, 'overview'],
  ['/dashboard/keys', 'dash.keys', false, 'keys'],
  ['/dashboard/cache', 'dash.cache', false, 'cache', 'AI Cache'],
  ['/dashboard/models', 'dash.models', false, 'models'],
  ['/dashboard/chat', 'dash.chat', false, 'chat', 'Chat'],
  ['/dashboard/billing', 'dash.billing', false, 'billing'],
  ['/dashboard/deposit', 'dash.deposit', false, 'deposit'],
  ['/dashboard/referral', 'dash.referral', false, 'referral'],
  ['/dashboard/support', 'dash.support', false, 'support'],
  ['/dashboard/notes', 'dash.notes', false, 'notes'],
  ['/dashboard/notifications', 'dash.notifications', false, 'bell'],
  ['/dashboard/settings', 'dash.settings', false, 'settings'],
]

export default function DashboardLayout() {
  useApplyTheme()

  const { t } = useI18n()
  const { pathname } = useLocation()
  const { user, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const nextTheme = theme === 'light' ? 'dark' : 'light'
  const themeLabel = t(nextTheme === 'dark' ? 'theme.toDark' : 'theme.toLight')

  const [menuOpen, setMenuOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const menuRef = useRef(null)

  const unread = useSupportUnread(pathname)
  const bill = useApi(billingApi.get)
  const b = bill.data
  const balanceText = b ? fmtMoney(b.balance, b?.currency) : null

  const current = links.find(l => l[0] === pathname.replace(/(.)\/$/, '$1')) || links[0]
  const tr = (k, fb) => { const v = t(k); return !v || v === k ? (fb ?? v) : v }
  const title = tr(current[1], current[4])
  const avatarInitial = user?.email?.trim().charAt(0).toUpperCase() || '?'

  // Signing out: stop any chat reply in progress, wipe the stored conversation, then sign out as before.
  const handleLogout = async () => {
    window.dispatchEvent(new Event('session-ended'))
    sealChat()
    await logout()
  }

  useEffect(() => {
    setMenuOpen(false)
    setNavOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = e => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    const onKeyDown = e => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!navOpen) return
    const onKeyDown = e => { if (e.key === 'Escape') setNavOpen(false) }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navOpen])

  return (
    <div className="dash" data-theme={theme}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

        /* ===== Sidebar: matches the HTML dashboard (Tailwind) ===== */
        .dash .side {
          width: 256px;                      /* w-64 */
          font-family: 'Inter', sans-serif !important;
          box-shadow: 0 20px 25px -5px rgba(0,0,0,.1), 0 8px 10px -6px rgba(0,0,0,.1); /* shadow-xl */
        }

        /* Light theme: blue gradient (#1e40af -> #1d4ed8) */
        .dash[data-theme="light"] .side {
          background: linear-gradient(180deg, #1e40af 0%, #1d4ed8 100%) !important;
          color: #ffffff !important;
          border-color: rgba(37, 99, 235, 0.4) !important;
        }

        /* Dark theme: keep the darker sidebar, same typography */
        .dash[data-theme="dark"] .side {
          background-color: #161f30 !important;
          border-color: #212e45 !important;
        }

        /* Brand / logo area: h-16, px-6, border-b border-blue-600/40 */
        .dash .side-brand {
          height: 64px;
          padding: 0 24px !important;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 20px;                   /* text-xl */
          font-weight: 700;
          letter-spacing: 0.05em;            /* tracking-wider */
          border-bottom: 1px solid rgba(37, 99, 235, 0.4);
        }
        .dash .side-brand,
        .dash .side-brand * {
          color: #ffffff !important;
        }
        .dash .side-close {
          color: #ffffff !important;
        }

        /* Nav container: px-3 py-4, gap 6px (space-y-1.5) */
        .dash .side-nav {
          padding: 16px 12px !important;
          display: flex;
          flex-direction: column;
          gap: 6px;
          overflow-y: auto;
        }

        /* Nav links: gap-3.5 px-3.5 py-3 rounded-xl text-sm font-medium */
        .dash .side-nav a {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 12px 14px;
          border-radius: 12px;
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          line-height: 20px;
          font-weight: 500;
          border: 1px solid transparent;
          text-decoration: none;
          transition: all 0.2s;
        }
        .dash[data-theme="light"] .side-nav a {
          color: #dbeafe !important;         /* text-blue-100 */
        }
        .dash[data-theme="light"] .side-nav a:hover {
          background-color: rgba(255, 255, 255, 0.1) !important;  /* hover:bg-white/10 */
          color: #dbeafe !important;
        }
        /* Active: font-semibold bg-white/20 text-white shadow-md border-white/10 */
        .dash[data-theme="light"] .side-nav a.active {
          background-color: rgba(255, 255, 255, 0.2) !important;
          border-color: rgba(255, 255, 255, 0.1);
          color: #ffffff !important;
          font-weight: 600;
          box-shadow: 0 4px 6px -1px rgba(0,0,0,.1), 0 2px 4px -2px rgba(0,0,0,.1);
        }

        /* Dark theme nav: same shape/typography, neutral colors */
        .dash[data-theme="dark"] .side-nav a:hover {
          background-color: rgba(255, 255, 255, 0.08);
        }
        .dash[data-theme="dark"] .side-nav a.active {
          border-color: rgba(255, 255, 255, 0.1);
          font-weight: 600;
        }

        /* SVG icons: w-5 (20px), centered, blue-300; active = cyan-300 */
        .dash .side-nav .nav-ic {
          width: 20px !important;
          height: 20px !important;
          flex-shrink: 0;
          fill: none !important;
          stroke: #93c5fd !important;        /* text-blue-300 */
          stroke-width: 2;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .dash .side-nav a.active .nav-ic {
          stroke: #67e8f9 !important;        /* text-cyan-300 */
        }

        /* Hide the sidebar scrollbar; the menu still scrolls with wheel/touch/keyboard */
        .dash .side,
        .dash .side-nav {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .dash .side::-webkit-scrollbar,
        .dash .side-nav::-webkit-scrollbar {
          display: none;
        }

        /* Unread support messages */
        .dash .side-nav .nav-badge {
          margin-left: auto;
          min-width: 20px;
          height: 20px;
          padding: 0 6px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: #ef4444;
          color: #ffffff;
          font-size: 12px;
          font-weight: 700;
          line-height: 1;
        }

        /* Topbar balance */
        .topbar-balance {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          font-size: 13px;
          font-weight: 600;
          border-radius: 6px;
          background: var(--bg-subtle, rgba(0,0,0,0.04));
          border: 1px solid var(--border-color, rgba(0,0,0,0.08));
          text-decoration: none;
          color: inherit;
          transition: background-color 0.2s, border-color 0.2s;
        }
        .topbar-balance:hover {
          background: var(--bg-hover, rgba(0,0,0,0.08));
        }
        .dash[data-theme="dark"] .topbar-balance {
          background: rgba(255, 255, 255, 0.05);
          border-color: rgba(255, 255, 255, 0.1);
        }
        .dash[data-theme="dark"] .topbar-balance:hover {
          background: rgba(255, 255, 255, 0.1);
        }
      `}</style>

      <div className={`dash-scrim${navOpen ? ' open' : ''}`} onClick={() => setNavOpen(false)} aria-hidden="true" />

      <aside className={`side${navOpen ? ' open' : ''}`}>
        <div className="side-brand">
          <Logo />
          <button type="button" className="side-close" aria-label={t('nav.closeMenu')} onClick={() => setNavOpen(false)}>
            <Icon name="close" />
          </button>
        </div>

        <nav className="side-nav" aria-label={t('nav.main')}>
          {links.map(([to, key, end, icon, fb]) => (
            <NavLink key={to} to={to} end={end}>
              <Icon name={icon} className="ic nav-ic" />
              <span>{tr(key, fb)}</span>
              {to === '/dashboard/support' && unread > 0 && (
                <span className="nav-badge" role="status" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="dash-col">
        <header className="topbar">
          <div className="topbar-title">
            <button type="button" className="topbar-burger" aria-label={t('nav.openMenu')} aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
              <Icon name="menu" />
            </button>
            <span className="topbar-chip" aria-hidden="true"><Icon name={current[3]} /></span>
            <strong>{title}</strong>
          </div>

          <div className="row">
            {balanceText && (
              <Link to="/dashboard/deposit" className="topbar-balance" title={t('overview.remainingCredits')}>
                {balanceText}
              </Link>
            )}
            {user?.plan && <span className="pill">{user.plan}</span>}

            <div className="user-menu" ref={menuRef}>
              <button
                type="button"
                className="avatar"
                title={user?.email || ''}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(o => !o)}
              >
                {avatarInitial}
              </button>

              {menuOpen && (
                <div className="user-menu-pop" role="menu" data-theme={theme}>
                  {user?.email && <div className="user-menu-email">{user.email}</div>}

                  <button type="button" role="menuitem" className="user-menu-theme" onClick={() => setTheme(nextTheme)}>
                    <Icon name={theme === 'light' ? 'moon' : 'sun'} />
                    {themeLabel}
                  </button>

                  <div className="user-menu-item">
                    <span className="user-menu-label">{t('lang.label')}</span>
                    <LanguageSwitcher />
                  </div>

                  <button type="button" role="menuitem" className="btn btn-ghost user-menu-logout" onClick={handleLogout}>
                    <Icon name="logout" />
                    {t('nav.logout')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="dash-main">
          <Outlet />
        </section>
      </div>
    </div>
  )
}