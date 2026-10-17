// Sign-up, login and Google sign-in. Every function returns { token, user } or a small status object.
import bcrypt from 'bcryptjs'
import { OAuth2Client } from 'google-auth-library'
import { config } from '../config.js'
import { HttpError, signToken, signResetToken, verifyResetToken, RESET_TTL_SECONDS } from '../http.js'
import { users, loginHistory } from '../db.js'
import { publicUser } from './accountService.js'
import { sendOtp, checkOtp, otpTtlSeconds } from './otpService.js'

const BCRYPT_ROUNDS = 12

// ───────────── Input limits ─────────────
// Checked before any DB or bcrypt work, so oversized input costs almost nothing.
const MAX_EMAIL = 64
const MAX_PASSWORD = 64
const MAX_PASSWORD_BYTES = 72 // bcrypt ignores everything after 72 bytes; non-ASCII chars take 2-4 bytes each

function assertInput({ email, password, otp, credential, resetToken }) {
  const bad = msg => { throw new HttpError(400, msg) }
  if (email !== undefined && (typeof email !== 'string' || email.length > MAX_EMAIL))
    bad(`Email must be at most ${MAX_EMAIL} characters.`)
  if (password !== undefined && (typeof password !== 'string' || password.length > MAX_PASSWORD || Buffer.byteLength(password) > MAX_PASSWORD_BYTES))
    bad(`Password must be at most ${MAX_PASSWORD} characters (${MAX_PASSWORD_BYTES} bytes).`)
  if (otp !== undefined && !/^\d{6}$/.test(String(otp))) bad('Invalid or expired code.')
  if (credential !== undefined && (typeof credential !== 'string' || credential.length > 4096)) bad('Invalid request.')
  if (resetToken !== undefined && (typeof resetToken !== 'string' || resetToken.length > 1024)) bad('Invalid request.')
}
// Builds the login response and records the sign-in (ctx = clientInfo(req)). A history failure never blocks login.
async function session(user, ctx) {
  if (ctx) await loginHistory.record(user.id, ctx).catch(e => console.error('login history:', e.message))
  return { token: signToken(user.id, user.token_version), user: publicUser(user) }
}

// Login compares against this when the email is unknown or has no password (Google-only account),
// so the response time is the same either way.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS)

// ───────────── Email + password ─────────────

// Step 1: create (or refresh) an unverified account and email a code.
export async function register(arg) {
  assertInput(arg)
  const { email, password } = arg
  const name = email.split('@')[0].slice(0, 100) // no name field at sign-up; default to the email prefix
  const existing = await users.findByEmail(email)
  if (existing?.email_verified) throw new HttpError(409, 'An account with this email already exists.')

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
  let user
  if (existing) {
    await users.setNameAndPassword(existing.id, { name, passwordHash })
    user = { ...existing, name }
  } else {
    user = await users.create({ name, email, passwordHash })
  }
  await sendOtp(user)
  return { email, expiresIn: otpTtlSeconds }
}

// Step 2: verify the code, mark the email verified, and sign the user in.
export async function verifyOtp(arg, ctx) {
  assertInput(arg)
  const { email, otp } = arg
  const user = await users.findByEmail(email)
  if (!user) throw new HttpError(400, 'Invalid or expired code.')
  if (user.email_verified) throw new HttpError(409, 'Email already verified. Please log in.')

  await checkOtp(user, otp)
  await users.markVerified(user.id)
  return session(user, ctx)
}

export async function resendOtp(arg) {
  assertInput(arg)
  const { email } = arg
  const user = await users.findByEmail(email)
  if (user && !user.email_verified) {
    try { await sendOtp(user) } catch (e) { if (e.status !== 429) throw e } // cooldown must not reveal the account exists
  }
  // Same response either way so this can't be used to probe which emails exist.
  return { message: 'If that email is awaiting verification, a new code has been sent.', expiresIn: otpTtlSeconds }
}

export async function login(arg, ctx) {
  assertInput(arg)
  const { email, password } = arg
  const user = await users.findByEmail(email)
  const hash = user?.password_hash
  const passwordOk = await bcrypt.compare(password, hash || DUMMY_HASH)
  // `!hash` matters: without it, a Google-only account would accept the dummy password.
  if (!user || !hash || !passwordOk) throw new HttpError(401, 'Incorrect email or password.')
  if (!user.email_verified) throw new HttpError(403, 'Please verify your email to continue.')
  return session(user, ctx)
}

// ───────────── Forgot password ─────────────
// 3 steps: (1) email a code, (2) exchange the code for a short-lived reset token, (3) set the new password.

// Step 1. Always answers the same way, whether or not the email exists.
export async function forgotPassword(arg) {
  assertInput(arg)
  const { email } = arg
  const user = await users.findByEmail(email)
  if (user?.email_verified) {
    // Not awaited on purpose: the response time must not reveal that the account exists.
    // sendOtp already logs email failures; a resend-cooldown 429 is expected and ignored.
    sendOtp(user, 'reset').catch(e => { if (!(e instanceof HttpError)) console.error('forgot-password:', e) })
  }
  return { message: 'If that email exists, a verification code has been sent.', expiresIn: otpTtlSeconds }
}

// Step 2. Consumes the code and returns a reset token (valid 10 minutes, dies once the password changes).
export async function verifyResetOtp(arg) {
  assertInput(arg)
  const { email, otp } = arg
  const bad = () => new HttpError(400, 'Invalid or expired code.')
  const user = await users.findByEmail(email)
  if (!user || !user.email_verified) throw bad()
  try { await checkOtp(user, otp) } catch (e) { throw e.status === 400 ? bad() : e } // same message for every 400
  return { resetToken: signResetToken(user.id, user.token_version), expiresIn: RESET_TTL_SECONDS }
}

// Step 3. Sets the new password and signs out every existing session (token_version bump).
export async function resetPassword(arg) {
  assertInput(arg)
  const { resetToken, password } = arg
  const { userId, tv } = verifyResetToken(resetToken)
  const user = await users.findById(userId)
  if (!user || !user.email_verified || user.token_version !== tv)
    throw new HttpError(400, 'Reset session expired. Please start again.')
  await users.setPassword(user.id, await bcrypt.hash(password, BCRYPT_ROUNDS), true)
  return { message: 'Password updated. Please log in.' }
}

// ───────────── Google ─────────────

const googleClient = new OAuth2Client()

// Verifies the ID token Google gave the browser (signature, expiry, and that it was issued for OUR client ID).
async function verifyGoogleCredential(credential) {
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: config.googleClientId })
    const p = ticket.getPayload()
    if (!p?.sub || !p.email || !p.email_verified) throw new Error('unverified')
    return { googleId: p.sub, email: p.email.toLowerCase(), name: (p.name || p.email.split('@')[0]).slice(0, 100) }
  } catch {
    throw new HttpError(401, 'Google sign-in failed. Please try again.')
  }
}

// Signs in, creates the account, or links Google to an existing account with the same email.
export async function loginWithGoogle(arg, ctx) {
  assertInput(arg)
  const { credential } = arg
  const { googleId, email, name } = await verifyGoogleCredential(credential)

  let user = await users.findByGoogleId(googleId)
  if (!user) {
    const existing = await users.findByEmail(email)
    if (existing?.google_id) throw new HttpError(409, 'This email is linked to a different Google account.')
    user = existing ? await users.linkGoogle(existing.id, googleId) : await users.createFromGoogle({ name, email, googleId })
  }
  return session(user, ctx)
}