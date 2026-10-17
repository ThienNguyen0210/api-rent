import { useEffect, useRef, useState } from 'react'

// Floating contact bubble, mounted once in App.jsx so it shows on every page.
// - Drag it anywhere; the position is saved in localStorage and restored on the next visit.
// - The bubble and menu follow the site theme (see the THEME note in CSS below).
// - Click (or press Enter/Space) to open the two contact options; click outside or press Escape to close.
// The position is stored as distances from the right/bottom edges, so an untouched bubble stays in the
// bottom-right corner when the window is resized, and a moved one is just kept on screen.

const STORAGE_KEY = 'contact-bubble-pos'
const SIZE = 56 // bubble diameter, px
const EDGE = 8 // minimum gap to the window edge
const DEFAULT_POS = { right: 20, bottom: 20 }
const DRAG_THRESHOLD = 5 // px of movement before a press counts as a drag instead of a click

const ZALO_PHONE = '0896445411'
const ZALO_URL = `https://zalo.me/${ZALO_PHONE}`
const FACEBOOK_URL = 'https://www.facebook.com/tnc.021006'

const CSS = `
  /* THEME: light by default. Dark applies when the OS prefers dark, or the page sets <html data-theme="dark"> / class="dark".
     An explicit <html data-theme="light"> / class="light" wins over the OS setting. Override any --cb-* variable to restyle. */
  .cb-root{
    --cb-fab-bg:#1F1E1D;--cb-fab-fg:#FAF9F5;--cb-fab-ring:rgba(250,249,245,.18);
    --cb-menu-bg:#FFFFFF;--cb-menu-fg:#1F1E1D;--cb-menu-border:rgba(31,30,29,.12);--cb-hover:rgba(31,30,29,.07);
    position:fixed;z-index:1000;width:${SIZE}px;height:${SIZE}px;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .cb-fab{display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:0;border:0;border-radius:50%;
    background:var(--cb-fab-bg);color:var(--cb-fab-fg);box-shadow:0 0 0 1px var(--cb-fab-ring),0 6px 20px rgba(0,0,0,.25);cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;
    transition:transform .15s,box-shadow .15s,background-color .2s,color .2s}
  .cb-fab:hover{transform:scale(1.06)}
  .cb-fab.cb-dragging{cursor:grabbing;transform:scale(1.1);box-shadow:0 0 0 1px var(--cb-fab-ring),0 10px 28px rgba(0,0,0,.35);transition:none}
  .cb-fab:focus-visible{outline:2px solid var(--cb-fab-fg);outline-offset:-5px}
  .cb-fab svg{width:30px;height:30px;pointer-events:none}
  .cb-menu{position:absolute;display:flex;flex-direction:column;gap:4px;min-width:210px;padding:6px;border-radius:14px;
    background:var(--cb-menu-bg);color:var(--cb-menu-fg);border:1px solid var(--cb-menu-border);box-shadow:0 10px 32px rgba(0,0,0,.22);animation:cb-pop .14s ease-out}
  .cb-menu.cb-up{bottom:${SIZE + 10}px}.cb-menu.cb-down{top:${SIZE + 10}px}
  .cb-menu.cb-end{right:0}.cb-menu.cb-start{left:0}
  .cb-item{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;color:inherit;text-decoration:none;font-size:15px;line-height:1.25}
  .cb-item:hover,.cb-item:focus-visible{background:var(--cb-hover);outline:0}
  .cb-item small{display:block;margin-top:2px;font-size:12.5px;opacity:.65}
  .cb-ico{display:inline-flex;align-items:center;justify-content:center;flex:none;width:36px;height:36px;border-radius:10px;color:#fff;font-weight:700}
  .cb-zalo{background:#0068FF;font-size:12px;letter-spacing:-.2px}
  .cb-fb{background:#1877F2}
  .cb-fb svg{width:20px;height:20px}
  @keyframes cb-pop{from{opacity:0;transform:translateY(4px) scale(.97)}to{opacity:1;transform:none}}
  @media (prefers-color-scheme:dark){
    html:not([data-theme="light"]):not(.light) .cb-root{
      --cb-fab-bg:#FAF9F5;--cb-fab-fg:#1F1E1D;--cb-fab-ring:rgba(31,30,29,.18);
      --cb-menu-bg:#30302E;--cb-menu-fg:#FAF9F5;--cb-menu-border:rgba(222,220,209,.18);--cb-hover:rgba(250,249,245,.09)
    }
  }
  html[data-theme="dark"] .cb-root,html.dark .cb-root{
    --cb-fab-bg:#FAF9F5;--cb-fab-fg:#1F1E1D;--cb-fab-ring:rgba(31,30,29,.18);
    --cb-menu-bg:#30302E;--cb-menu-fg:#FAF9F5;--cb-menu-border:rgba(222,220,209,.18);--cb-hover:rgba(250,249,245,.09)
  }
  @media (prefers-reduced-motion:reduce){.cb-menu{animation:none}.cb-fab{transition:none}}
`

const viewport = () => ({ w: document.documentElement.clientWidth, h: window.innerHeight })

// Keeps the whole bubble inside the window.
function clamp({ right, bottom }) {
  const { w, h } = viewport()
  return {
    right: Math.min(Math.max(EDGE, right), Math.max(EDGE, w - SIZE - EDGE)),
    bottom: Math.min(Math.max(EDGE, bottom), Math.max(EDGE, h - SIZE - EDGE)),
  }
}

function loadPos() {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (p && Number.isFinite(p.right) && Number.isFinite(p.bottom)) return clamp(p)
  } catch { /* storage unavailable or corrupt: use the default */ }
  return clamp(DEFAULT_POS)
}

function savePos(p) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)) } catch { /* private mode / quota: position just isn't remembered */ }
}

export default function ContactBubble() {
  const [pos, setPos] = useState(loadPos)
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [, setTick] = useState(0) // re-render on resize so the menu opens toward the free side
  const posRef = useRef(pos)
  const drag = useRef(null)
  const rootRef = useRef(null)

  const move = p => { posRef.current = p; setPos(p) }

  // Keep the bubble on screen when the window changes size.
  useEffect(() => {
    const onResize = () => {
      const c = clamp(posRef.current)
      if (c.right !== posRef.current.right || c.bottom !== posRef.current.bottom) move(c)
      setTick(n => n + 1)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = e => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onPointerDown = e => {
    if (e.button !== 0) return
    drag.current = { sx: e.clientX, sy: e.clientY, start: posRef.current, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = e => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      d.moved = true
      setOpen(false)
      setDragging(true)
    }
    // Moving right/down shrinks the distance to the right/bottom edge.
    move(clamp({ right: d.start.right - dx, bottom: d.start.bottom - dy }))
  }

  const endPress = (e, cancelled) => {
    const d = drag.current
    drag.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d) return
    if (d.moved) {
      setDragging(false)
      savePos(posRef.current)
    } else if (!cancelled) {
      setOpen(o => !o)
    }
  }

  // Keyboard activation (Enter/Space) arrives as a click with detail 0; mouse/touch clicks are handled on pointer up.
  const onClick = e => { if (e.detail === 0) setOpen(o => !o) }

  // Open the menu toward the side of the window that has room.
  const { w, h } = viewport()
  const centerX = w - pos.right - SIZE / 2
  const centerY = h - pos.bottom - SIZE / 2
  const menuClass = `cb-menu ${centerY > h / 2 ? 'cb-up' : 'cb-down'} ${centerX > w / 2 ? 'cb-end' : 'cb-start'}`

  return (
    <div className="cb-root" ref={rootRef} style={{ right: pos.right, bottom: pos.bottom }}>
      <style>{CSS}</style>

      {open && (
        <div className={menuClass} role="menu" aria-label="Contact options">
          <a className="cb-item" role="menuitem" href={ZALO_URL} target="_blank" rel="noopener noreferrer">
            <span className="cb-ico cb-zalo" aria-hidden="true">Zalo</span>
            <span>Zalo<small>0896 445 411</small></span>
          </a>
          <a className="cb-item" role="menuitem" href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer">
            <span className="cb-ico cb-fb" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 22v-8.2h2.8l.5-3.3h-3.3V8.4c0-.9.3-1.6 1.7-1.6H17V4c-.3 0-1.3-.1-2.4-.1-2.5 0-4.1 1.5-4.1 4.2v2.4H7.7v3.3h2.8V22h3z" /></svg>
            </span>
            <span>Facebook<small>tnc.021006</small></span>
          </a>
        </div>
      )}

      <button
        type="button"
        className={`cb-fab${dragging ? ' cb-dragging' : ''}`}
        aria-label="Contact us"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Contact (drag to move)"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={e => endPress(e, false)}
        onPointerCancel={e => endPress(e, true)}
        onClick={onClick}
      >
        {/* Support agent: a person wearing headphones */}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.8 12.5V12a7.2 7.2 0 0 1 14.4 0v.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <rect x="3" y="11.6" width="3.6" height="6" rx="1.6" fill="currentColor" />
          <rect x="17.4" y="11.6" width="3.6" height="6" rx="1.6" fill="currentColor" />
          <circle cx="12" cy="11" r="3.4" fill="currentColor" />
          <path d="M6.8 22c0-3.4 2.3-5.4 5.2-5.4s5.2 2 5.2 5.4z" fill="currentColor" />
        </svg>
      </button>
    </div>
  )
}