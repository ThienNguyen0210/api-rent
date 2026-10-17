// One OTP code per user protects all of their API keys.
//
// Registration turns the OTP into an X25519 key pair (private key = scrypt(otp, salt)) and stores only the
// salt + PUBLIC key. Any later key's suffix is encrypted to that public key (ECIES: ephemeral X25519 + HKDF
// + AES-256-GCM), so creating a key never needs the OTP. Decrypting needs the private key, which exists only
// when the user types the OTP. Nothing here touches the database.
import crypto from 'node:crypto'

export const OTP_RE = /^\d{1,6}$/ // 1 to 6 digits (raise the minimum here if you want a floor)
export const PREFIX_LEN = 12 // the part of the key that stays readable (matches keysService: secret.slice(0, 12))

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const scrypt = (pw, salt) =>
  new Promise((res, rej) => crypto.scrypt(pw, salt, 32, SCRYPT, (e, k) => (e ? rej(e) : res(k))))

// Raw 32-byte X25519 keys <-> KeyObjects (fixed DER prefixes).
const PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex')
const SPKI = Buffer.from('302a300506032b656e032100', 'hex')
const privFromSeed = seed => crypto.createPrivateKey({ key: Buffer.concat([PKCS8, seed]), format: 'der', type: 'pkcs8' })
const pubFromRaw = raw => crypto.createPublicKey({ key: Buffer.concat([SPKI, raw]), format: 'der', type: 'spki' })
const rawPub = pubKey => pubKey.export({ format: 'der', type: 'spki' }).subarray(-32)
const b64 = b => b.toString('base64url')
const unb64 = s => Buffer.from(s, 'base64url')

// Value for users.key_otp_pub.
export async function registerOtp(otp) {
  const salt = crypto.randomBytes(16)
  const priv = privFromSeed(await scrypt(otp, salt))
  return `${b64(salt)}.${b64(rawPub(crypto.createPublicKey(priv)))}`
}

// Returns the user's private key if `otp` is right, else null. Right = it derives the stored public key.
export async function unlock(otp, stored) {
  const [salt, pub] = String(stored).split('.')
  const priv = privFromSeed(await scrypt(otp, unb64(salt)))
  const got = rawPub(crypto.createPublicKey(priv))
  const want = unb64(pub)
  return got.length === want.length && crypto.timingSafeEqual(got, want) ? priv : null
}

const aesKey = shared => Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), 'api-key-suffix', 32))

// No OTP needed: encrypts to the stored public key.
export function encryptSuffix(stored, suffix) {
  const userPub = pubFromRaw(unb64(String(stored).split('.')[1]))
  const eph = crypto.generateKeyPairSync('x25519')
  const key = aesKey(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: userPub }))
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(suffix, 'utf8'), c.final()])
  return [rawPub(eph.publicKey), iv, c.getAuthTag(), ct].map(b64).join('.')
}

// ---- Recovery copy (api_keys.secret_escrow): AES-256-GCM under a server secret, independent of the user's OTP.
// It lets "Forgot OTP" re-encrypt every key for the new OTP when the old one is gone. Set KEY_ESCROW_SECRET to
// a long random string (e.g. `openssl rand -base64 48`) and never change or lose it, or the recovery copies become unreadable.
let escrowKey
const escrow = () => {
  if (escrowKey) return escrowKey
  const secret = process.env.KEY_ESCROW_SECRET
  if (!secret || secret.length < 32) throw new Error('KEY_ESCROW_SECRET must be set to at least 32 characters.')
  return (escrowKey = Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.alloc(0), 'api-key-escrow', 32)))
}

export function escrowEncrypt(suffix) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', escrow(), iv)
  const ct = Buffer.concat([c.update(suffix, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), ct].map(b64).join('.')
}

export function escrowDecrypt(blob) {
  const [iv, tag, ct] = String(blob).split('.').map(unb64)
  const d = crypto.createDecipheriv('aes-256-gcm', escrow(), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
}

// `priv` comes from unlock(). Throws if the data was tampered with (GCM tag mismatch).
export function decryptSuffix(priv, blob) {
  const [eph, iv, tag, ct] = String(blob).split('.').map(unb64)
  const key = aesKey(crypto.diffieHellman({ privateKey: priv, publicKey: pubFromRaw(eph) }))
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
}
