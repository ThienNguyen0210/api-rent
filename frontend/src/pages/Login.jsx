import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useI18n } from '../i18n/index.jsx'
import { authApi } from '../api/index.js'
import GoogleButton from '../components/GoogleButton.jsx'

// Password input with its own show/hide toggle.
function PasswordField({ label, value, onChange, autoComplete }) {
  const [shown, setShown] = useState(false)
  return (
    <label>{label}
      <div className="password-wrapper" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input
          required
          type={shown ? 'text' : 'password'}
          minLength={8}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          style={{ width: '100%', paddingRight: '40px' }}
        />
        <button
          type="button"
          onClick={() => setShown(s => !s)}
          style={{ position: 'absolute', right: '10px', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', fontSize: '14px' }}
          tabIndex={-1}
        >
          {shown ? '👁️‍🗨️' : '👁️'}
        </button>
      </div>
    </label>
  )
}

const linkBtn = { alignSelf: 'flex-end', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textDecoration: 'underline', fontSize: 13 }

export default function Login() {
  const [params, setParams] = useSearchParams()
  const register = params.get('mode') === 'register'
  const { user, login, register: signUp, verifyOtp, resendOtp, loginWithGoogle } = useAuth()
  const nav = useNavigate()
  const { t } = useI18n()
  const [f, setF] = useState({ email: '', password: '', confirm: '' })
  // 'form' | 'otp' (verify email after sign-up)
  // 'forgot' -> 'resetOtp' -> 'newPassword' (forgot-password flow)
  const [step, setStep] = useState('form')
  const [code, setCode] = useState(''); const [cooldown, setCooldown] = useState(0); const [info, setInfo] = useState('')
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('') // success message shown on the login form (e.g. after a reset)
  const [resetToken, setResetToken] = useState('')
  const [agreed, setAgreed] = useState(false) // must accept the Terms to register

  const set = k => e => { const v = e.target.value; setF(prev => ({ ...prev, [k]: v })) }
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const goForm = () => { setStep('form'); setCode(''); setError(''); setInfo('') }

  const submit = async e => {
    e.preventDefault(); setError(''); setNotice('')
    if (register && f.password !== f.confirm) return setError(t('login.mismatch'))
    if (register && !agreed) return setError(t('login.mustAgree'))
    setBusy(true)
    try {
      if (register) { await signUp(f.email, f.password, f.confirm); setInfo(t('login.sentCode', { email: f.email })); setCooldown(60); setStep('otp') }
      else { await login(f.email, f.password); nav('/dashboard') }
    } catch (err) {
      if (!register && err.status === 403) { // correct password, but email not verified yet
        setStep('otp'); setInfo(t('login.notVerified'))
        try { await resendOtp(f.email); setInfo(t('login.sentNew', { email: f.email })); setCooldown(60) }
        catch (e2) { setError(e2.message) }
      } else setError(err.message)
    } finally { setBusy(false) }
  }
  const verify = async e => {
    e.preventDefault(); setBusy(true); setError('')
    try { await verifyOtp(f.email, code); nav('/dashboard') }
    catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const resend = async () => {
    setError('')
    try { await resendOtp(f.email); setInfo(t('login.newCode')); setCooldown(60) }
    catch (err) { setError(err.message) }
  }
  const google = async credential => {
    setError(''); setBusy(true)
    try { await loginWithGoogle(credential); nav('/dashboard') }
    catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  // ---- Forgot password ----
  // Step 1: ask for the email, answer immediately (the server never says whether it exists), open the code form.
  const forgot = async e => {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      await authApi.forgotPassword(f.email)
      setInfo(t('login.forgotSent', { email: f.email })); setCode(''); setCooldown(60); setStep('resetOtp')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  // Step 2: a correct code unlocks the new-password form.
  const verifyReset = async e => {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      const r = await authApi.verifyResetOtp(f.email, code)
      setResetToken(r.resetToken); setCode(''); setF(p => ({ ...p, password: '', confirm: '' })); setStep('newPassword')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const resendReset = async () => {
    setError('')
    try { await authApi.forgotPassword(f.email); setInfo(t('login.newCode')); setCooldown(60) }
    catch (err) { setError(err.message) }
  }
  // Step 3: set + confirm the new password, then send the user back to log in.
  const resetPw = async e => {
    e.preventDefault(); setError('')
    if (f.password !== f.confirm) return setError(t('login.mismatch'))
    setBusy(true)
    try {
      await authApi.resetPassword(resetToken, f.password, f.confirm)
      setResetToken(''); setF(p => ({ ...p, password: '', confirm: '' })); setNotice(t('login.resetDone')); goForm()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  if (user) return <Navigate to="/dashboard" replace />

  if (step === 'forgot') return (
    <form className="auth" onSubmit={forgot}>
      <h1 className="h1">{t('login.forgotTitle')}</h1>
      <p className="muted">{t('login.forgotHint')}</p>
      <label>{t('login.email')}<input required type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
      {error && <div className="alert">{error}</div>}
      <button className="btn btn-primary" disabled={busy}>{busy ? t('login.wait') : t('login.sendResetCode')}</button>
      <button type="button" className="btn btn-ghost" onClick={goForm}>{t('login.backToLogin')}</button>
    </form>
  )

  if (step === 'resetOtp') return (
    <form className="auth" onSubmit={verifyReset}>
      <h1 className="h1">{t('login.otpTitle')}</h1>
      <p className="muted">{info}</p>
      <label>{t('login.otpCode')}<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label>
      {error && <div className="alert">{error}</div>}
      <button className="btn btn-primary" disabled={busy || code.length !== 6}>{busy ? t('login.wait') : t('login.verify')}</button>
      <button type="button" className="btn btn-ghost" disabled={cooldown > 0} onClick={resendReset}>{cooldown > 0 ? t('login.resendIn', { n: cooldown }) : t('login.resend')}</button>
      <button type="button" className="btn btn-ghost" onClick={() => { setStep('forgot'); setCode(''); setError('') }}>{t('login.back')}</button>
    </form>
  )

  if (step === 'newPassword') return (
    <form className="auth" onSubmit={resetPw}>
      <h1 className="h1">{t('login.resetTitle')}</h1>
      <PasswordField label={t('login.newPassword')} value={f.password} onChange={set('password')} autoComplete="new-password" />
      <PasswordField label={t('login.confirm')} value={f.confirm} onChange={set('confirm')} autoComplete="new-password" />
      {error && <div className="alert">{error}</div>}
      <button className="btn btn-primary" disabled={busy}>{busy ? t('login.wait') : t('login.resetSubmit')}</button>
      <button type="button" className="btn btn-ghost" onClick={() => { setResetToken(''); goForm() }}>{t('login.backToLogin')}</button>
    </form>
  )

  if (step === 'otp') return (
    <form className="auth" onSubmit={verify}>
      <h1 className="h1">{t('login.otpTitle')}</h1>
      <p className="muted">{info}</p>
      <label>{t('login.otpCode')}<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label>
      {error && <div className="alert">{error}</div>}
      <button className="btn btn-primary" disabled={busy || code.length !== 6}>{busy ? t('login.wait') : t('login.verify')}</button>
      <button type="button" className="btn btn-ghost" disabled={cooldown > 0} onClick={resend}>{cooldown > 0 ? t('login.resendIn', { n: cooldown }) : t('login.resend')}</button>
      <button type="button" className="btn btn-ghost" onClick={goForm}>{t('login.back')}</button>
    </form>
  )

  return (
    <form className="auth" onSubmit={submit}>
      <h1 className="h1">{register ? t('login.registerTitle') : t('login.title')}</h1>
      {notice && <div className="muted">{notice}</div>}
      <label>{t('login.email')}<input required type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
      <PasswordField label={t('login.password')} value={f.password} onChange={set('password')} autoComplete={register ? 'new-password' : 'current-password'} />
      {!register && (
        <button type="button" style={linkBtn} onClick={() => { setError(''); setNotice(''); setStep('forgot') }}>{t('login.forgot')}</button>
      )}
      {register && <PasswordField label={t('login.confirm')} value={f.confirm} onChange={set('confirm')} autoComplete="new-password" />}
      {register && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: 1.5 }}>
          <input
            required
            type="checkbox"
            checked={agreed}
            onChange={e => setAgreed(e.target.checked)}
            style={{ width: 'auto', marginTop: 3, flexShrink: 0 }}
          />
          <span>
            {t('login.agreeText')}{' '}
            {/* New tab so the half-filled form isn't lost */}
            <Link to="/terms" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>{t('login.agreeLink')}</Link>
          </span>
        </label>
      )}

      {error && <div className="alert">{error}</div>}
      <button className="btn btn-primary" disabled={busy}>{busy ? t('login.wait') : register ? t('login.sendCode') : t('login.submit')}</button>
      {import.meta.env.VITE_GOOGLE_CLIENT_ID && <div className="divider">{t('login.or')}</div>}
      <GoogleButton onCredential={google} onError={() => setError(t('login.googleFail'))} />
      <button type="button" className="btn btn-ghost" onClick={() => { setError(''); setNotice(''); setParams(register ? {} : { mode: 'register' }) }}>{register ? t('login.haveAccount') : t('login.create')}</button>
    </form>
  )
}