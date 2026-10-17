// API keys: generation, limits, rename/disable/delete, and verifying a key on incoming API calls.
import crypto from 'node:crypto'
import { HttpError } from '../http.js'
import { keys, users, keyOtpResets } from '../db.js'
import { config } from '../config.js'
import { sendKeyOtpResetEmail } from '../mail.js'
import { accessOf, toColumns } from '../keyAccess.js'
import { PREFIX_LEN, registerOtp, unlock, encryptSuffix, decryptSuffix, escrowEncrypt, escrowDecrypt } from '../keyVault.js'
import { otpThrottle } from '../otpThrottle.js'
import { DEFAULT_THRESHOLD } from './cacheService.js'

export const MAX_KEYS = 15
export const KEY_PREFIX = 'NXR_'

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex')

export const publicKey = k => ({
  id: String(k.id),
  name: k.name,
  prefix: k.prefix,
  status: k.status,
  requestCount: Number(k.request_count),
  promptTokens: Number(k.prompt_tokens ?? 0),
  completionTokens: Number(k.completion_tokens ?? 0),
  tokensUsed: Number(k.prompt_tokens ?? 0) + Number(k.completion_tokens ?? 0), // total consumed by this key
  createdAt: k.created_at,
  lastUsedAt: k.last_used_at,
  access: accessOf(k), // { ips, domains, rateLimitPerMin }; null = any / unlimited
  cacheEnabled: !!k.cache_enabled, // embedding cache (see cacheService.js)
  cacheThreshold: Number(k.cache_threshold ?? DEFAULT_THRESHOLD),
  canReveal: !!k.secret_enc, // false for keys created before OTP protection: they can never be shown again
  // Nếu bạn muốn lưu trữ tạm hoặc hiển thị hint, có thể truyền thêm thuộc tính nếu DB hỗ trợ
})

async function requireOwned(userId, id) {
  const k = await keys.findOwned(id, userId)
  if (!k) throw new HttpError(404, 'API key not found.')
  return k
}

export async function listKeys(userId) {
  return (await keys.listByUser(userId)).map(publicKey)
}

// Has this user registered an OTP code yet? The UI uses it to decide whether creating a key needs the registration form.
export async function otpStatus(userId) {
  return { registered: !!(await keys.getOtpKey(userId)) }
}

// The user's single OTP code covers every key. It is registered once (with double confirmation) on their first key.
// After that, every new key still requires the correct OTP: it is verified here (same throttle/ban as revealKey)
// before anything is generated, even though encrypting the suffix itself only needs the stored public key.
export async function createKey(userId, { name, otp, confirmOtp }, ip) {
  const trimmedName = name.trim()

  // 1. Kiểm tra xem tên key đã tồn tại chưa
  const existingKeys = await keys.listByUser(userId)
  const isDuplicate = existingKeys.some(k => k.name.toLowerCase() === trimmedName.toLowerCase())
  if (isDuplicate) {
    throw new HttpError(400, 'An API key with this name already exists.')
  }

  // 2. OTP: register it on the first key, otherwise the user must prove they know it
  let otpKey = await keys.getOtpKey(userId)
  if (!otpKey) {
    if (!otp || otp !== confirmOtp) throw new HttpError(400, 'The two OTP codes do not match.')
    const fresh = await registerOtp(otp)
    otpKey = (await keys.setOtpKeyIfUnset(userId, fresh)) ? fresh : await keys.getOtpKey(userId) // lost a race: use the winner's
  } else {
    if (!otp) throw new HttpError(400, 'Enter your OTP code to create a key.')
    await otpThrottle.assertAllowed(ip) // 403 if the IP is banned, 429 while it is locked out
    const priv = await unlock(otp, otpKey)
    if (!priv) throw await otpThrottle.recordFail(ip) // 403 "Incorrect OTP code" (+ attempts left), or the lockout / ban error
    await otpThrottle.clear(ip)
  }

  // 3. Generate; only the prefix stays readable, the rest is encrypted so only the OTP can open it
  const secret = KEY_PREFIX + crypto.randomBytes(24).toString('base64url') // 4 + 32 chars
  const suffix = secret.slice(PREFIX_LEN)
  const secretEnc = encryptSuffix(otpKey, suffix)
  const secretEscrow = escrowEncrypt(suffix) // lets "Forgot OTP" move this key to a new OTP later
  const row = await keys.createIfUnderLimit(userId, { name: trimmedName, prefix: secret.slice(0, PREFIX_LEN), hash: sha256(secret), secretEnc, secretEscrow }, MAX_KEYS)
  if (!row) throw new HttpError(400, `You can have up to ${MAX_KEYS} API keys. Delete one to create another.`)

  return { ...publicKey(row), secret } // Shown once here; afterwards only revealKey() with the OTP can return it
}

// ---------------------------------------------------------------------------
// Forgot OTP: email a 6-digit code -> verify it (-> resetToken) -> change the OTP with old + new codes.
// ---------------------------------------------------------------------------
const RESET_RESEND_SECONDS = 60
const RESET_MAX_ATTEMPTS = 5
const RESET_TOKEN_MINUTES = 10

const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
const maskEmail = e => { const [l, d] = String(e).split('@'); return `${l.slice(0, 1)}***@${d}` }
const expired = d => !d || new Date(d).getTime() < Date.now()

async function requireOtpUser(userId) {
  const u = await users.findById(userId)
  if (!u || !u.email_verified) throw new HttpError(401, 'Session expired. Please log in again.')
  if (!(await keys.getOtpKey(userId))) throw new HttpError(400, 'You have not created an OTP code yet.')
  return u
}

// Step 1: email a 6-digit code to the account's address.
export async function forgotOtp(userId) {
  const u = await requireOtpUser(userId)
  const row = await keyOtpResets.get(userId)
  if (row) {
    const wait = RESET_RESEND_SECONDS * 1000 - (Date.now() - new Date(row.sent_at).getTime())
    if (wait > 0) throw new HttpError(429, `Please wait ${Math.ceil(wait / 1000)} seconds before requesting another code.`)
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0')
  await keyOtpResets.start(userId, sha256(code), new Date(Date.now() + config.otp.ttlMinutes * 60000))
  try {
    await sendKeyOtpResetEmail(u.email, u.name, code)
  } catch (e) {
    await keyOtpResets.remove(userId) // don't make the user wait out the resend delay for an email that never left
    throw e
  }
  return { email: maskEmail(u.email), expiresInMinutes: config.otp.ttlMinutes }
}

// Step 2: check the emailed code. 5 wrong codes cancel it. Returns a short-lived token for step 3.
export async function verifyResetCode(userId, code) {
  await requireOtpUser(userId)
  const row = await keyOtpResets.get(userId)
  if (!row || !row.code_hash || expired(row.expires_at)) throw new HttpError(400, 'This code has expired. Request a new one.')
  if (row.attempts >= RESET_MAX_ATTEMPTS) {
    await keyOtpResets.remove(userId)
    throw new HttpError(400, 'Too many wrong codes. Request a new one.')
  }
  if (!sameHash(sha256(code), row.code_hash)) {
    await keyOtpResets.addAttempt(userId)
    throw new HttpError(400, 'Incorrect code.')
  }
  const resetToken = crypto.randomBytes(32).toString('base64url')
  await keyOtpResets.setToken(userId, sha256(resetToken), new Date(Date.now() + RESET_TOKEN_MINUTES * 60000))
  return { resetToken }
}

// Step 3: set the new OTP. The emailed code already proved who the user is. Every key is re-encrypted for the new OTP
// using its recovery copy (the old OTP is not needed), so all of the user's keys stay viewable with the new code.
// A key that can't be moved (no recovery copy, or one that no longer decrypts, e.g. because KEY_ESCROW_SECRET changed)
// loses its viewable copy but keeps working for API calls; it must not block the others, so it is only counted and logged.
export async function resetOtp(userId, { resetToken, newOtp, confirmNewOtp }) {
  await requireOtpUser(userId)
  if (newOtp !== confirmNewOtp) throw new HttpError(400, 'The two new OTP codes do not match.')

  const row = await keyOtpResets.get(userId)
  if (!row || !row.token_hash || expired(row.token_expires_at) || !sameHash(sha256(resetToken), row.token_hash))
    throw new HttpError(400, 'Reset session expired. Request a new code.')

  const newKey = await registerOtp(newOtp)
  let lost = 0
  await keys.rekey(userId, newKey, k => {
    let suffix = null
    if (!k.secret_escrow) {
      console.warn(`[otp-reset] key ${k.id}: no recovery copy`)
    } else {
      try { suffix = escrowDecrypt(k.secret_escrow) }
      catch { console.warn(`[otp-reset] key ${k.id}: recovery copy can't be decrypted (was KEY_ESCROW_SECRET changed since the key was created?)`) }
      if (suffix !== null && sha256(k.prefix + suffix) !== k.key_hash) {
        console.warn(`[otp-reset] key ${k.id}: decrypted suffix does not match the key's hash`)
        suffix = null
      }
    }
    if (suffix === null) { lost++; return null }
    return encryptSuffix(newKey, suffix)
  })
  await keyOtpResets.remove(userId)
  return { message: 'OTP code updated.', unrecoverableKeys: lost }
}

// Returns the full key if `otp` is right. Rebuilds prefix + decrypted suffix and checks it against the stored hash.
export async function revealKey(userId, id, otp, ip) {
  const k = await requireOwned(userId, id)
  if (!k.secret_enc) throw new HttpError(409, 'This key was created before OTP protection and cannot be shown again.')
  const otpKey = await keys.getOtpKey(userId)
  if (!otpKey) throw new HttpError(409, 'No OTP code registered.')

  await otpThrottle.assertAllowed(ip) // 403 if the IP is banned, 429 while it is locked out
  const priv = await unlock(otp, otpKey)
  if (!priv) throw await otpThrottle.recordFail(ip) // 403 "Incorrect OTP code" (+ attempts left), or the lockout / ban error
  await otpThrottle.clear(ip)

  let secret
  try { secret = k.prefix + decryptSuffix(priv, k.secret_enc) } catch { secret = null }
  if (!secret || sha256(secret) !== k.key_hash) throw new HttpError(500, 'Could not decrypt this key.')
  return { secret }
}

export async function updateKey(userId, id, patch) {
  await requireOwned(userId, id)

  // Nếu có cập nhật tên, kiểm tra trùng lặp
  if (patch.name) {
    const trimmedName = patch.name.trim()
    const existingKeys = await keys.listByUser(userId)
    const isDuplicate = existingKeys.some(k => k.id !== Number(id) && k.name.toLowerCase() === trimmedName.toLowerCase())
    if (isDuplicate) {
      throw new HttpError(400, 'An API key with this name already exists.')
    }
    patch.name = trimmedName
  }

  await keys.update(id, userId, patch)
  return publicKey(await requireOwned(userId, id))
}

// Replaces the key's IP / domain / rate rules. `input` is already shape-checked by the route;
// toColumns() validates the entries themselves (400 with the offending values) and serialises them.
export async function setAccess(userId, id, input) {
  const cols = toColumns(input)
  await requireOwned(userId, id)
  await keys.setAccess(id, userId, cols)
  return publicKey(await requireOwned(userId, id))
}

export async function deleteKey(userId, id) {
  await requireOwned(userId, id)
  await keys.remove(id, userId)
}

// Use from the middleware that authenticates public API calls. Returns the key's owner and its access rules.
export async function verifyKey(raw) {
  if (typeof raw !== 'string' || !raw.startsWith(KEY_PREFIX)) throw new HttpError(401, 'Invalid API key.')
  const k = await keys.findActiveByHash(sha256(raw))
  if (!k) throw new HttpError(401, 'Invalid or disabled API key.')
  await keys.touch(k.id)
  return { userId: k.user_id, keyId: k.id, access: accessOf(k), cache: { enabled: !!k.cache_enabled, threshold: Number(k.cache_threshold ?? DEFAULT_THRESHOLD) } }
}