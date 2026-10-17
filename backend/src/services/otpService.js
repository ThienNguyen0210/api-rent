// One-time email codes: 6 digits, HMAC-hashed at rest, single use, limited attempts,
// one live code per user, resend cooldown. Any feature that needs "send the user a code"
// should call sendOtp(user) instead of re-implementing this.
import crypto from 'node:crypto'
import { config } from '../config.js'
import { HttpError } from '../http.js'
import { otps } from '../db.js'
import { sendOtpEmail, sendPasswordResetEmail } from '../mail.js'

const { ttlMinutes, maxAttempts, resendCooldownSeconds } = config.otp
export const otpTtlSeconds = ttlMinutes * 60

const hashOtp = (userId, code) =>
  crypto.createHmac('sha256', config.jwtSecret).update(`otp:${userId}:${code}`).digest('hex')

const safeEqual = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

const senders = { verify: sendOtpEmail, reset: sendPasswordResetEmail }

// Creates a fresh code (replacing any older one), stores its hash, and emails it.
// purpose: 'verify' (sign-up email check) or 'reset' (forgot password) picks the email template.
export async function sendOtp(user, purpose = 'verify') {
  if (await otps.existsRecent(user.id, resendCooldownSeconds)) {
    throw new HttpError(429, `Please wait ${resendCooldownSeconds} seconds before requesting another code.`)
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  await otps.deleteForUser(user.id)
  const id = await otps.create({ userId: user.id, codeHash: hashOtp(user.id, code), ttlMinutes })
  try {
    await senders[purpose](user.email, user.name, code)
  } catch (err) {
    console.error('Resend error:', err.message)
    await otps.delete(id)
    throw new HttpError(502, 'Could not send the verification email. Please try again.')
  }
}

// Checks a submitted code against the user's live code and consumes it. Throws if wrong/expired/used.
export async function checkOtp(user, code) {
  const invalid = () => new HttpError(400, 'Invalid or expired code.')
  const row = await otps.latestForUser(user.id)
  if (!row || !row.live) throw new HttpError(400, 'This code has expired. Request a new one.')
  if (!(await otps.useAttempt(row.id, maxAttempts))) {
    await otps.delete(row.id)
    throw new HttpError(429, 'Too many wrong attempts. Request a new code.')
  }
  if (!safeEqual(row.code_hash, hashOtp(user.id, code))) throw invalid()
  if (!(await otps.delete(row.id))) throw invalid() // lost a race with another request: already used
}
