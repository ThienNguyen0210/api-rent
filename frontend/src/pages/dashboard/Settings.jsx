import { useEffect, useState } from 'react'
import { useTheme } from '../../context/ThemeContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { accountApi } from '../../api/index.js'
import { tokenStore } from '../../api/client.js'
import Switch from '../../components/Switch.jsx'
import Button from '../../components/Button.jsx'
import LanguageSwitcher from '../../components/LanguageSwitcher.jsx'
import { useI18n } from '../../i18n/index.jsx'

// Rough "Browser on OS" label from a User-Agent string.
function deviceLabel(ua) {
  ua = ua || ''
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
  const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
  return b && o ? `${b} on ${o}` : b || o || '—'
}

const cell = { padding: '8px 12px 8px 0', textAlign: 'left', whiteSpace: 'nowrap' }
const EMPTY_PW = { currentPassword: '', newPassword: '', confirmPassword: '' }
const stack = { display: 'flex', flexDirection: 'column', gap: 12 }

export default function Settings() {
  const { theme, setTheme } = useTheme(); const { user, setUser } = useAuth(); const { t } = useI18n()
  const [f, setF] = useState({ name: user.name || '', email: user.email, preferences: { lowCreditAlerts: false, weeklyDigest: false, ...user.preferences } })
  const [msg, setMsg] = useState(null)
  const pref = k => v => setF({ ...f, preferences: { ...f.preferences, [k]: v } })
  const save = async () => { setMsg(null); try { setUser(await accountApi.update(f)); setMsg({ ok: true, t: t('settings.saved') }) } catch (e) { setMsg({ t: e.message }) } }

  // Login history: null while loading.
  const [history, setHistory] = useState(null)
  useEffect(() => { accountApi.loginHistory().then(r => setHistory(r.items)).catch(() => setHistory([])) }, [])

  // Password form: hidden until "Change password" is clicked.
  const [pwOpen, setPwOpen] = useState(false)
  const [pw, setPw] = useState(EMPTY_PW)
  const [logoutOthers, setLogoutOthers] = useState(true)
  const [pwMsg, setPwMsg] = useState(null)
  const pwField = k => e => setPw({ ...pw, [k]: e.target.value })
  const closePw = () => { setPwOpen(false); setPw(EMPTY_PW) }

  const changePw = async () => {
    setPwMsg(null)
    if (pw.newPassword.length < 8) return setPwMsg({ t: t('settings.passwordTooShort') })
    if (pw.newPassword !== pw.confirmPassword) return setPwMsg({ t: t('settings.passwordMismatch') })
    try {
      const r = await accountApi.changePassword({
        currentPassword: pw.currentPassword,
        newPassword: pw.newPassword,
        logoutOtherDevices: logoutOthers,
      })
      if (r.token) tokenStore.set(r.token) // fresh JWT so this device stays signed in
      closePw()
      setPwMsg({ ok: true, t: t('settings.passwordChanged') })
    } catch (e) { setPwMsg({ t: e.message }) }
  }

  return (
    <>
      <div className="card"><h3>{t('settings.appearance')}</h3><div className="seg">{['light', 'dark'].map(m => <button key={m} type="button" className={theme === m ? 'on' : ''} onClick={() => setTheme(m)}>{t('theme.' + m)}</button>)}</div>
        <h3 style={{ marginTop: 20 }}>{t('settings.language')}</h3><LanguageSwitcher /></div>
      <div className="card"><h3>{t('settings.profile')}</h3>
        <div className="grid2">
          <label>{t('settings.name')}<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
          <label>{t('settings.email')}<input type="email" value={f.email} readOnly /></label></div>
        <h3 style={{ marginTop: 20 }}>{t('settings.notifications')}</h3>
        <div className="row between"><span>{t('settings.lowCredit')}</span><Switch label={t('settings.lowCreditLabel')} checked={f.preferences.lowCreditAlerts} onChange={pref('lowCreditAlerts')} /></div>
        <div className="row between" style={{ marginTop: 12 }}><span>{t('settings.digest')}</span><Switch label={t('settings.digestLabel')} checked={f.preferences.weeklyDigest} onChange={pref('weeklyDigest')} /></div>
        <div className="row" style={{ marginTop: 16 }}><Button onClick={save}>{t('settings.save')}</Button>{msg && <span className={msg.ok ? 'muted' : 'alert'}>{msg.t}</span>}</div></div>

      <div className="card"><h3>{t('settings.password')}</h3>
        {!pwOpen ? (
          <div className="row">
            <Button onClick={() => { setPwMsg(null); setPwOpen(true) }}>{t('settings.changePassword')}</Button>
            {pwMsg && <span className={pwMsg.ok ? 'muted' : 'alert'}>{pwMsg.t}</span>}
          </div>
        ) : (
          <div style={stack}>
            <label>{t('settings.currentPassword')}<input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={pwField('currentPassword')} /></label>
            <label>{t('settings.newPassword')}<input type="password" autoComplete="new-password" value={pw.newPassword} onChange={pwField('newPassword')} /></label>
            <label>{t('settings.confirmPassword')}<input type="password" autoComplete="new-password" value={pw.confirmPassword} onChange={pwField('confirmPassword')} /></label>
            <div className="row between"><span>{t('settings.logoutOthers')}</span>
              <Switch label={t('settings.logoutOthers')} checked={logoutOthers} onChange={setLogoutOthers} /></div>
            <div className="row">
              <Button onClick={changePw}>{t('settings.updatePassword')}</Button>
              <button type="button" className="btn-ghost" onClick={closePw}>{t('settings.cancel')}</button>
              {pwMsg && <span className={pwMsg.ok ? 'muted' : 'alert'}>{pwMsg.t}</span>}
            </div>
          </div>
        )}
      </div>

      <div className="card"><h3>{t('settings.loginHistory')}</h3>
        <p className="muted">{t('settings.loginHistoryHint')}</p>
        {history && history.length === 0 && <p className="muted">{t('settings.loginHistoryEmpty')}</p>}
        {history && history.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={cell}>{t('settings.colTime')}</th><th style={cell}>{t('settings.colZone')}</th>
                <th style={cell}>{t('settings.colIp')}</th><th style={cell}>{t('settings.colDevice')}</th>
              </tr></thead>
              <tbody>{history.map(h => (
                <tr key={h.id}>
                  <td style={cell}>{new Date(h.createdAt).toLocaleString()}</td>
                  <td style={cell}>{h.timeZone || '—'}</td>
                  <td style={cell}>{h.ip || '—'}</td>
                  <td style={cell}>{deviceLabel(h.userAgent)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
