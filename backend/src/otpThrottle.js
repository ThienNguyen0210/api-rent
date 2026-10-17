// Per-IP throttle for wrong OTP codes when revealing a key.
//   - 3 wrong codes in a round trigger a lockout.
//   - Lockouts escalate: 1, 5, 15, 30 minutes, then 1, 6, 12, 24 hours.
//   - 3 more wrong codes after the 24-hour lockout ban the IP (until someone clears its row in otp_attempts).
//   - A correct code clears the IP's history. A row untouched for STALE_DAYS starts over.
import { HttpError } from './http.js'
import { otpAttempts, withTransaction } from './db.js'

export const MAX_TRIES = 3
export const LOCK_MINUTES = [1, 5, 15, 30, 60, 360, 720, 1440]
const STALE_DAYS = 7

const BANNED = 'Too many wrong OTP codes from this IP address. It has been banned from entering OTP codes. Please contact support.'

const wait = ms => {
  const m = Math.ceil(ms / 60000)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`
  const h = Math.ceil(m / 60)
  return `${h} hour${h === 1 ? '' : 's'}`
}
const lockedError = until => new HttpError(429, `Too many wrong OTP codes. Try again in ${wait(until - Date.now())}.`)

const fresh = () => ({ fails: 0, stage: 0, locked_until: null, banned: 0 })
const current = row => {
  if (!row) return fresh()
  const stale = !row.banned && Date.now() - new Date(row.updated_at).getTime() > STALE_DAYS * 86400000
  return stale ? fresh() : row
}

export const otpThrottle = {
  // Call before checking a code: throws if the IP is banned or still locked out.
  async assertAllowed(ip) {
    const row = current(await otpAttempts.get(ip))
    if (row.banned) throw new HttpError(403, BANNED)
    const until = row.locked_until ? new Date(row.locked_until).getTime() : 0
    if (until > Date.now()) throw lockedError(until)
  },

  // Call after a wrong code. Returns the HttpError to throw.
  recordFail: ip => withTransaction(async tx => {
    const row = current(await otpAttempts.lock(tx, ip))
    if (row.banned) return new HttpError(403, BANNED)
    const until = row.locked_until ? new Date(row.locked_until).getTime() : 0
    if (until > Date.now()) return lockedError(until) // a parallel request got here first; don't double-count

    const fails = row.fails + 1
    if (fails < MAX_TRIES) {
      await otpAttempts.save(tx, ip, { fails, stage: row.stage, lockedUntil: row.locked_until, banned: false })
      const left = MAX_TRIES - fails
      return new HttpError(403, `Incorrect OTP code. ${left} attempt${left === 1 ? '' : 's'} left.`)
    }
    const stage = row.stage + 1
    if (stage > LOCK_MINUTES.length) {
      await otpAttempts.save(tx, ip, { fails: 0, stage, lockedUntil: null, banned: true })
      return new HttpError(403, BANNED)
    }
    const lockedUntil = new Date(Date.now() + LOCK_MINUTES[stage - 1] * 60000)
    await otpAttempts.save(tx, ip, { fails: 0, stage, lockedUntil, banned: false })
    return lockedError(lockedUntil.getTime())
  }),

  clear: ip => otpAttempts.clear(ip),
}
