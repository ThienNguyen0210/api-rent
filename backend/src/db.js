// The connection pool and ALL SQL. Nothing else in the app writes queries.
// Functions take plain values and return plain rows; no business rules live here.
import mysql from 'mysql2/promise'
import { config } from './config.js'

export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z',
})

const one = async (sql, params) => (await pool.query(sql, params))[0][0] || null

const shape = r => (Array.isArray(r) ? { rows: r } : { rows: [], affectedRows: r.affectedRows, insertId: r.insertId })

/**
 * Query helper returning { rows } (or { rows: [], affectedRows, insertId } for writes).
 * Converts $1, $2 placeholders to ? for MySQL. Only use $n when each is used once, in order.
 */
export async function query(sql, params) {
  const [r] = await pool.query(sql.replace(/\$\d+/g, '?'), params)
  return shape(r)
}

/** Runs fn(tx) on one connection inside a transaction; commits on success, rolls back on error. */
export async function withTransaction(fn) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const tx = { query: async (sql, params) => shape((await conn.query(sql, params))[0]) }
    const out = await fn(tx)
    await conn.commit()
    return out
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

export const usageRequests = {
  // Deletes in batches so the table isn't locked for long. Returns the number of rows removed.
  async purgeOlderThan(days, batch = 5000) {
    let total = 0
    for (;;) {
      const [r] = await pool.query(
        'DELETE FROM usage_requests WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY) LIMIT ?', [days, batch])
      total += r.affectedRows
      if (r.affectedRows < batch) return total
    }
  },
}

export const orders = {
  findByKey: (userId, key) => one('SELECT * FROM orders WHERE user_id = ? AND idempotency_key = ? LIMIT 1', [userId, key]),
  async listByUser(userId, limit = 50) {
    const [rows] = await pool.query('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', [userId, limit])
    return rows
  },
}

// Column of `models` that holds the public model name (e.g. 'GPT-5.6-Luna'); it is UNIQUE.
export const MODEL_NAME_COL = 'model_id'

export const keys = {
  async listByUser(userId) {
    const [rows] = await pool.query('SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC, id DESC', [userId])
    return rows
  },
  async findOwned(id, userId) {
    const [rows] = await pool.query('SELECT * FROM api_keys WHERE id = ? AND user_id = ?', [id, userId])
    return rows[0] || null
  },
  // Locks the user row so two parallel requests can't both slip past the limit.
  async createIfUnderLimit(userId, { name, prefix, hash, secretEnc, secretEscrow }, max) {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId])
      const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ?', [userId])
      if (n >= max) { await conn.rollback(); return null }
      const [r] = await conn.query('INSERT INTO api_keys (user_id, name, prefix, key_hash, secret_enc, secret_escrow) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, name, prefix, hash, secretEnc, secretEscrow])
      await conn.commit()
      const [rows] = await pool.query('SELECT * FROM api_keys WHERE id = ?', [r.insertId])
      return rows[0]
    } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
  },
  async update(id, userId, { name, status }) {
    await pool.query('UPDATE api_keys SET name = COALESCE(?, name), status = COALESCE(?, status) WHERE id = ? AND user_id = ?',
      [name ?? null, status ?? null, id, userId])
  },
  // Replaces a key's access rules. null = unrestricted. Values arrive validated/serialised by keyAccess.toColumns().
  // (update() can't do this: its COALESCE treats null as "leave unchanged".)
  async setAccess(id, userId, { ips, domains, rateLimitPerMin }) {
    await pool.query('UPDATE api_keys SET allowed_ips = ?, allowed_domains = ?, rate_limit_per_min = ? WHERE id = ? AND user_id = ?',
      [ips, domains, rateLimitPerMin, id, userId])
  },
  async remove(id, userId) {
    const [r] = await pool.query('DELETE FROM api_keys WHERE id = ? AND user_id = ?', [id, userId])
    if (r.affectedRows) await pool.query('DELETE FROM cache_entries WHERE key_id = ?', [id])
  },
  // Cache switch + global similarity threshold. Either may be omitted (null = leave unchanged).
  async setCache(id, userId, { enabled, threshold }) {
    await pool.query('UPDATE api_keys SET cache_enabled = COALESCE(?, cache_enabled), cache_threshold = COALESCE(?, cache_threshold) WHERE id = ? AND user_id = ?',
      [enabled === undefined || enabled === null ? null : (enabled ? 1 : 0), threshold ?? null, id, userId])
  },
  // The user's OTP key ("salt.publicKey"), or null if they haven't registered an OTP code yet.
  async getOtpKey(userId) {
    const [rows] = await pool.query('SELECT key_otp_pub FROM users WHERE id = ? LIMIT 1', [userId])
    return rows[0]?.key_otp_pub ?? null
  },
  // Sets it only if none exists. Returns false when one was already set (e.g. a parallel request won).
  async setOtpKeyIfUnset(userId, value) {
    const [r] = await pool.query('UPDATE users SET key_otp_pub = ? WHERE id = ? AND key_otp_pub IS NULL', [value, userId])
    return r.affectedRows === 1
  },
  // Switches the user to a new OTP key and re-encrypts every protected key's suffix, all in one transaction.
  // transform(row) gets { id, prefix, key_hash, secret_enc, secret_escrow } and returns the new secret_enc (throw to abort everything).
  // Locks the user row, so a key being created at the same moment waits for the switch.
  rekey: (userId, newOtpKey, transform) => withTransaction(async tx => {
    await tx.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId])
    const { rows } = await tx.query('SELECT id, prefix, key_hash, secret_enc, secret_escrow FROM api_keys WHERE user_id = ? AND secret_enc IS NOT NULL', [userId])
    for (const k of rows)
      await tx.query('UPDATE api_keys SET secret_enc = ? WHERE id = ? AND user_id = ?', [transform(k), k.id, userId])
    await tx.query('UPDATE users SET key_otp_pub = ? WHERE id = ?', [newOtpKey, userId])
  }),
  async findActiveByHash(hash) {
    const [rows] = await pool.query("SELECT * FROM api_keys WHERE key_hash = ? AND status = 'active'", [hash])
    return rows[0] || null
  },
  // Adds one request's tokens to the key's running totals. `db` is the pool, or the tx of withTransaction()
  // so the update commits or rolls back together with the rest of the request's accounting.
  addTokens: (db, id, promptTokens, completionTokens) =>
    db.query('UPDATE api_keys SET prompt_tokens = prompt_tokens + ?, completion_tokens = completion_tokens + ? WHERE id = ?',
      [promptTokens, completionTokens, id]),
  async touch(id) {
    await pool.query('UPDATE api_keys SET request_count = request_count + 1, last_used_at = NOW() WHERE id = ?', [id])
  },
}

// "Forgot OTP" state: one row per user (emailed code, then the reset token). Rules live in keysService.
export const keyOtpResets = {
  async get(userId) {
    const [rows] = await pool.query('SELECT * FROM key_otp_resets WHERE user_id = ?', [userId])
    return rows[0] || null
  },
  // New code: replaces any earlier code/token for this user.
  async start(userId, codeHash, expiresAt) {
    await pool.query(
      `INSERT INTO key_otp_resets (user_id, code_hash, attempts, sent_at, expires_at, token_hash, token_expires_at)
       VALUES (?, ?, 0, UTC_TIMESTAMP(), ?, NULL, NULL)
       ON DUPLICATE KEY UPDATE code_hash = VALUES(code_hash), attempts = 0, sent_at = UTC_TIMESTAMP(),
                               expires_at = VALUES(expires_at), token_hash = NULL, token_expires_at = NULL`,
      [userId, codeHash, expiresAt])
  },
  async addAttempt(userId) {
    await pool.query('UPDATE key_otp_resets SET attempts = attempts + 1 WHERE user_id = ?', [userId])
  },
  // Code verified: drop the code, keep only the token's hash.
  async setToken(userId, tokenHash, expiresAt) {
    await pool.query('UPDATE key_otp_resets SET code_hash = NULL, token_hash = ?, token_expires_at = ? WHERE user_id = ?',
      [tokenHash, expiresAt, userId])
  },
  async remove(userId) {
    await pool.query('DELETE FROM key_otp_resets WHERE user_id = ?', [userId])
  },
}

// Wrong-OTP throttle rows, one per IP. Rules live in otpThrottle.js; these are plain reads/writes.
export const otpAttempts = {
  async get(ip) {
    const [rows] = await pool.query('SELECT * FROM otp_attempts WHERE ip = ?', [ip])
    return rows[0] || null
  },
  // Inside withTransaction: locks the row so parallel guesses from one IP are counted one by one.
  async lock(tx, ip) {
    const { rows } = await tx.query('SELECT * FROM otp_attempts WHERE ip = ? FOR UPDATE', [ip])
    return rows[0] || null
  },
  save: (tx, ip, { fails, stage, lockedUntil, banned }) => tx.query(
    `INSERT INTO otp_attempts (ip, fails, stage, locked_until, banned, updated_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE fails = VALUES(fails), stage = VALUES(stage), locked_until = VALUES(locked_until),
                             banned = VALUES(banned), updated_at = UTC_TIMESTAMP()`,
    [ip, fails, stage, lockedUntil, banned ? 1 : 0]),
  // A correct code wipes the IP's history (banned IPs are never reached, so they stay banned).
  async clear(ip) {
    await pool.query('DELETE FROM otp_attempts WHERE ip = ? AND banned = 0', [ip])
  },
}

export const users = {
  findByEmail: email => one('SELECT * FROM users WHERE email = ? LIMIT 1', [email]),
  findById: id => one('SELECT * FROM users WHERE id = ? LIMIT 1', [id]),
  findByGoogleId: googleId => one('SELECT * FROM users WHERE google_id = ? LIMIT 1', [googleId]),

  // Current session version, or null if the user no longer exists. Checked on every authenticated request.
  tokenVersion: async id => (await one('SELECT token_version FROM users WHERE id = ? LIMIT 1', [id]))?.token_version ?? null,

  async create({ name, email, passwordHash }) {
    const [r] = await pool.query(
      'INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP())',
      [name, email, passwordHash],
    )
    return { id: r.insertId, name, email }
  },

  async createFromGoogle({ name, email, googleId }) {
    const [r] = await pool.query(
      `INSERT INTO users (name, email, google_id, email_verified, created_at)
       VALUES (?, ?, ?, 1, UTC_TIMESTAMP())`,
      [name, email, googleId],
    )
    return users.findById(r.insertId)
  },

  // Re-registering an email that was never verified: replace the pending name/password.
  setNameAndPassword: (id, { name, passwordHash }) =>
    pool.query('UPDATE users SET name = ?, password_hash = ? WHERE id = ?', [name, passwordHash, id]),

  // bump = true invalidates every existing session (all JWTs carry the old version).
  setPassword: (id, passwordHash, bump) =>
    pool.query('UPDATE users SET password_hash = ?, token_version = token_version + ? WHERE id = ?',
      [passwordHash, bump ? 1 : 0, id]),

  markVerified: id => pool.query('UPDATE users SET email_verified = 1 WHERE id = ?', [id]),

  // Attach a Google identity to an existing row. Google has proven the email is theirs, so if the
  // account was still unverified, drop its password (it was set by whoever pre-registered the email)
  // and revoke any sessions that password may have created.
  // password_hash must be assigned BEFORE email_verified: MySQL applies SET clauses left to right.
  async linkGoogle(id, googleId) {
    await pool.query(
      `UPDATE users
          SET token_version = IF(email_verified = 0, token_version + 1, token_version),
              password_hash = IF(email_verified = 0, NULL, password_hash),
              google_id = ?,
              email_verified = 1
        WHERE id = ?`,
      [googleId, id],
    )
    return users.findById(id)
  },

  updateProfile: (id, { name, preferences }) =>
    pool.query('UPDATE users SET name = ?, preferences = ? WHERE id = ?', [name, JSON.stringify(preferences), id]),
}

export const loginHistory = {
  // Records a sign-in, then deletes everything older than the user's newest `keep` rows.
  async record(userId, { ip, userAgent, timeZone }, keep = 20) {
    await pool.query(
      'INSERT INTO login_history (user_id, ip, user_agent, time_zone, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())',
      [userId, ip ?? null, userAgent ?? null, timeZone ?? null],
    )
    await pool.query(
      `DELETE FROM login_history
        WHERE user_id = ?
          AND id < (SELECT MIN(id) FROM (SELECT id FROM login_history WHERE user_id = ? ORDER BY id DESC LIMIT ?) newest)`,
      [userId, userId, keep],
    )
  },
  async listByUser(userId, limit = 20) {
    const [rows] = await pool.query(
      'SELECT id, ip, user_agent, time_zone, created_at FROM login_history WHERE user_id = ? ORDER BY id DESC LIMIT ?',
      [userId, limit],
    )
    return rows
  },
}

export const otps = {
  async existsRecent(userId, seconds) {
    return !!(await one(
      `SELECT 1 AS x FROM email_otps
        WHERE user_id = ? AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND) LIMIT 1`,
      [userId, seconds],
    ))
  },

  async create({ userId, codeHash, ttlMinutes }) {
    const [r] = await pool.query(
      `INSERT INTO email_otps (user_id, code_hash, created_at, expires_at)
       VALUES (?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))`,
      [userId, codeHash, ttlMinutes],
    )
    return r.insertId
  },

  latestForUser: userId =>
    one(
      `SELECT id, code_hash, expires_at > UTC_TIMESTAMP() AS live
         FROM email_otps WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [userId],
    ),

  // Atomically counts one guess. Returns false once the row has used up its attempts, so
  // parallel guesses can't sneak past the limit the way a read-then-write check could.
  async useAttempt(id, maxAttempts) {
    const [r] = await pool.query('UPDATE email_otps SET attempts = attempts + 1 WHERE id = ? AND attempts < ?', [id, maxAttempts])
    return r.affectedRows > 0
  },

  async delete(id) {
    const [r] = await pool.query('DELETE FROM email_otps WHERE id = ?', [id])
    return r.affectedRows > 0
  },
  deleteForUser: userId => pool.query('DELETE FROM email_otps WHERE user_id = ?', [userId]),
  purgeExpired: () => pool.query('DELETE FROM email_otps WHERE expires_at < UTC_TIMESTAMP()'),
}

export const referrals = {
  // Returns the user's code, or null if they don't have one yet.
  async codeOf(userId) {
    return (await one('SELECT referral_code FROM users WHERE id = ? LIMIT 1', [userId]))?.referral_code ?? null
  },
  // Sets the code only if none exists. Returns false if the code is taken (UNIQUE) so the caller can retry.
  async assignCode(userId, code) {
    try {
      await pool.query('UPDATE users SET referral_code = ? WHERE id = ? AND referral_code IS NULL', [code, userId])
      return true
    } catch (e) { if (e.code === 'ER_DUP_ENTRY') return false; throw e }
  },
  findOwnerByCode: code => one('SELECT id FROM users WHERE referral_code = ? LIMIT 1', [code]),

  // The user's own claim (as the invited friend), or null.
  findClaimBy: refereeId => one('SELECT id, status, tokens_each, completed_at FROM referrals WHERE referee_id = ? LIMIT 1', [refereeId]),

  // Friends who used this user's code, newest first. Email is masked in the service layer.
  async listByReferrer(referrerId, limit = 50) {
    const [rows] = await pool.query(
      `SELECT r.id, r.status, r.tokens_each, r.completed_at, u.email
         FROM referrals r JOIN users u ON u.id = r.referee_id
        WHERE r.referrer_id = ? ORDER BY r.id DESC LIMIT ?`, [referrerId, limit])
    return rows
  },

  // ---- inside a transaction (tx comes from withTransaction) ----
  // Locks both user rows in id order so two opposite claims (A->B and B->A) can't interleave.
  lockUsers: (tx, a, b) => tx.query('SELECT id FROM users WHERE id IN (?, ?) ORDER BY id FOR UPDATE', [a, b]),
  // Has `referrerId` already claimed a code belonging to `refereeId`? (blocks A<->B swaps)
  async reverseExists(tx, referrerId, refereeId) {
    const { rows } = await tx.query('SELECT 1 AS x FROM referrals WHERE referrer_id = ? AND referee_id = ? LIMIT 1', [referrerId, refereeId])
    return rows.length > 0
  },
  // Throws ER_DUP_ENTRY if this referee has already claimed.
  async insertPending(tx, { referrerId, refereeId, code, tokens }) {
    const r = await tx.query(
      `INSERT INTO referrals (referrer_id, referee_id, code, status, tokens_each, created_at)
       VALUES (?, ?, ?, 'pending', ?, UTC_TIMESTAMP())`, [referrerId, refereeId, code, tokens])
    return r.insertId
  },
  async markCompleted(tx, id) {
    const r = await tx.query("UPDATE referrals SET status = 'completed', completed_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'pending'", [id])
    return r.affectedRows === 1
  },
  // Adds tokens to a user's balance and writes the ledger row. Returns the new token balance.
  async creditTokens(tx, userId, tokens) {
    await tx.query(
      `INSERT INTO balances (user_id, balance, tokens_granted) VALUES (?, 0, ?)
       ON DUPLICATE KEY UPDATE tokens_granted = tokens_granted + VALUES(tokens_granted), updated_at = UTC_TIMESTAMP()`,
      [userId, tokens])
    const { rows: [b] } = await tx.query('SELECT balance, tokens_granted FROM balances WHERE user_id = ?', [userId])
    await tx.query(
      "INSERT INTO balance_transactions (user_id, reason, amount, tokens, balance_after) VALUES (?, 'referral', 0, ?, ?)",
      [userId, tokens, b.balance])
    return Number(b.tokens_granted)
  },
}

export const support = {
  // Saves a request and its image rows together. Returns the new request id.
  create: (userId, { title, content }, images) => withTransaction(async tx => {
    const r = await tx.query(
      'INSERT INTO support_requests (user_id, title, content, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP())',
      [userId, title, content])
    if (images.length)
      await tx.query('INSERT INTO support_images (request_id, filename, size) VALUES ?', [images.map(i => [r.insertId, i.filename, i.size])])
    return r.insertId
  }),
  // Images go with it (ON DELETE CASCADE).
  async remove(id) {
    await pool.query('DELETE FROM support_requests WHERE id = ?', [id])
  },
  // The user's requests, newest first, each with `images: [filename, ...]`.
  async listByUser(userId, limit = 50) {
    const [rows] = await pool.query(
      'SELECT id, title, content, created_at FROM support_requests WHERE user_id = ? ORDER BY id DESC LIMIT ?', [userId, limit])
    if (!rows.length) return []
    const [imgs] = await pool.query(
      'SELECT request_id, filename FROM support_images WHERE request_id IN (?) ORDER BY id', [rows.map(r => r.id)])
    const byReq = new Map()
    for (const i of imgs) byReq.set(i.request_id, [...(byReq.get(i.request_id) ?? []), i.filename])
    const [reps] = await pool.query(
      'SELECT id, request_id, sender, message, read_at, created_at FROM support_replies WHERE request_id IN (?) ORDER BY id', [rows.map(r => r.id)])
    const byRep = new Map()
    for (const x of reps) byRep.set(x.request_id, [...(byRep.get(x.request_id) ?? []), x])
    return rows.map(r => ({ ...r, images: byReq.get(r.id) ?? [], replies: byRep.get(r.id) ?? [] }))
  },

  // ---- conversation: replies in support_replies (sender 'admin' | 'user'; read_at = when the USER saw an admin message) ----
  async findOwned(id, userId) {
    const [rows] = await pool.query('SELECT id, title FROM support_requests WHERE id = ? AND user_id = ?', [id, userId])
    return rows[0] || null
  },
  async countUserReplies(requestId) {
    const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM support_replies WHERE request_id = ? AND sender = 'user'", [requestId])
    return n
  },
  // The user's own message: already "read" by definition.
  async addUserReply(requestId, message) {
    const [r] = await pool.query(
      "INSERT INTO support_replies (request_id, sender, message, read_at, created_at) VALUES (?, 'user', ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())",
      [requestId, message])
    return r.insertId
  },
  // Admin messages this user has not opened yet.
  async unreadCount(userId) {
    const [[{ n }]] = await pool.query(
      `SELECT COUNT(*) AS n FROM support_replies r JOIN support_requests s ON s.id = r.request_id
        WHERE s.user_id = ? AND r.sender = 'admin' AND r.read_at IS NULL`, [userId])
    return n
  },
  async markRead(userId) {
    await pool.query(
      `UPDATE support_replies r JOIN support_requests s ON s.id = r.request_id
          SET r.read_at = UTC_TIMESTAMP()
        WHERE s.user_id = ? AND r.sender = 'admin' AND r.read_at IS NULL`, [userId])
  },
}

// Admin panel: reads across ALL users, balance adjustments, support replies. Rules live in adminService.
export const admin = {
  // Newest first. cursor = last id already shown; fetches limit + 1 so the caller can tell if another page exists.
  // `like` is a ready-made LIKE pattern (or null).
  async listUsers({ cursor, like, limit }) {
    const where = [], args = []
    if (cursor) { where.push('u.id < ?'); args.push(cursor) }
    if (like) { where.push('(u.email LIKE ? OR u.name LIKE ?)'); args.push(like, like) }
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.name, u.email_verified, u.created_at, b.balance, b.tokens_granted, b.tokens_consumed
         FROM users u LEFT JOIN balances b ON b.user_id = u.id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY u.id DESC LIMIT ?`, [...args, limit + 1])
    return rows
  },

  // Adds (+) or deducts (-) USD and/or tokens: balance row + ledger row, one transaction.
  // The guard in the UPDATE keeps either value from going below zero, even with parallel requests.
  // Returns { balance, tokens }, or null when the guard refused the change.
  adjustBalance: (userId, usd, tokens) => withTransaction(async tx => {
    await tx.query(
      'INSERT INTO balances (user_id, balance, tokens_granted) VALUES (?, 0, 0) ON DUPLICATE KEY UPDATE user_id = user_id', [userId])
    const upd = await tx.query(
      `UPDATE balances SET balance = balance + ?, tokens_granted = tokens_granted + ?, updated_at = UTC_TIMESTAMP()
        WHERE user_id = ? AND balance + ? >= 0 AND tokens_granted + ? >= 0`,
      [usd, tokens, userId, usd, tokens])
    if (upd.affectedRows !== 1) return null
    const { rows: [b] } = await tx.query('SELECT balance, tokens_granted FROM balances WHERE user_id = ?', [userId])
    await tx.query(
      "INSERT INTO balance_transactions (user_id, reason, amount, tokens, balance_after) VALUES (?, 'adjustment', ?, ?, ?)",
      [userId, usd, tokens, b.balance])
    return { balance: Number(b.balance), tokens: Number(b.tokens_granted) }
  }),

  // Every user's support requests, newest first, with the sender, `images: [filename]` and `replies: [{ message, created_at }]`.
  async listSupport({ cursor, limit }) {
    const [rows] = await pool.query(
      `SELECT s.id, s.title, s.content, s.created_at, u.id AS user_id, u.email, u.name
         FROM support_requests s JOIN users u ON u.id = s.user_id
        ${cursor ? 'WHERE s.id < ?' : ''} ORDER BY s.id DESC LIMIT ?`,
      cursor ? [cursor, limit + 1] : [limit + 1])
    const page = rows.slice(0, limit)
    if (!page.length) return rows
    const ids = page.map(r => r.id)
    const [imgs] = await pool.query('SELECT request_id, filename FROM support_images WHERE request_id IN (?) ORDER BY id', [ids])
    const [reps] = await pool.query('SELECT id, request_id, sender, message, read_at, created_at FROM support_replies WHERE request_id IN (?) ORDER BY id', [ids])
    const group = (list, pick) => {
      const m = new Map()
      for (const x of list) m.set(x.request_id, [...(m.get(x.request_id) ?? []), pick(x)])
      return m
    }
    const im = group(imgs, i => i.filename)
    const rp = group(reps, r => r)
    // Keep the extra row (if any) at the end so the caller can see there is a next page.
    return [...page.map(r => ({ ...r, images: im.get(r.id) ?? [], replies: rp.get(r.id) ?? [] })), ...rows.slice(limit)]
  },
  async findSupportWithUser(id) {
    const [rows] = await pool.query(
      'SELECT s.id, s.title, u.email, u.name FROM support_requests s JOIN users u ON u.id = s.user_id WHERE s.id = ?', [id])
    return rows[0] || null
  },
  async addReply(requestId, message) {
    const [r] = await pool.query(
      "INSERT INTO support_replies (request_id, sender, message, created_at) VALUES (?, 'admin', ?, UTC_TIMESTAMP())", [requestId, message])
    return r.insertId
  },
}

export const notes = {
  async listByUser(userId) {
    const [rows] = await pool.query('SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC, id DESC', [userId])
    return rows
  },
  async findOwned(id, userId) {
    const [rows] = await pool.query('SELECT * FROM notes WHERE id = ? AND user_id = ?', [id, userId])
    return rows[0] || null
  },
  // Locks the user row so two parallel requests can't both slip past the limit. Returns null when full.
  async createIfUnderLimit(userId, { title, content }, max) {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId])
      const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM notes WHERE user_id = ?', [userId])
      if (n >= max) { await conn.rollback(); return null }
      const [r] = await conn.query(
        'INSERT INTO notes (user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
        [userId, title, content])
      await conn.commit()
      const [rows] = await pool.query('SELECT * FROM notes WHERE id = ?', [r.insertId])
      return rows[0]
    } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
  },
  // Callers pass both fields (already merged with the stored values), so there is no "null = unchanged" ambiguity.
  async update(id, userId, { title, content }) {
    await pool.query('UPDATE notes SET title = ?, content = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ?',
      [title, content, id, userId])
  },
  async remove(id, userId) {
    const [r] = await pool.query('DELETE FROM notes WHERE id = ? AND user_id = ?', [id, userId])
    return r.affectedRows > 0
  },
}

export const deposits = {
  codeOf: async userId => (await one('SELECT code FROM deposit_codes WHERE user_id = ? LIMIT 1', [userId]))?.code ?? null,
  // INSERT IGNORE: returns false if this user already has a code OR the random code is taken; the caller re-reads / retries.
  async insertCode(userId, code) {
    const [r] = await pool.query('INSERT IGNORE INTO deposit_codes (user_id, code, created_at) VALUES (?, ?, UTC_TIMESTAMP())', [userId, code])
    return r.affectedRows === 1
  },
  async listByUser(userId, limit = 20) {
    const [rows] = await pool.query(
      'SELECT id, amount_vnd, amount_usd, status, created_at FROM deposits WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      [userId, limit])
    return rows
  },

  // ---- inside a transaction (tx comes from withTransaction) ----
  async findUserByCode(tx, code) {
    const { rows: [r] } = await tx.query('SELECT user_id FROM deposit_codes WHERE code = ? LIMIT 1', [code])
    return r?.user_id ?? null
  },
  // Throws ER_DUP_ENTRY if this SePay transaction was already recorded (retry / parallel delivery).
  insert: (tx, d) => tx.query(
    `INSERT INTO deposits (sepay_id, user_id, code, amount_vnd, amount_usd, rate_vnd_per_usd, status, reference_code, content, raw, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
    [d.sepayId, d.userId, d.code, d.amountVnd, d.amountUsd, d.rate, d.status, d.referenceCode, d.content, JSON.stringify(d.raw)]),
  // Atomic `balance = balance + ?` plus ledger row. Concurrent credits for one user queue on the row lock.
  async creditUsd(tx, userId, usd) {
    await tx.query(
      `INSERT INTO balances (user_id, balance) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance), updated_at = UTC_TIMESTAMP()`,
      [userId, usd])
    const { rows: [b] } = await tx.query('SELECT balance FROM balances WHERE user_id = ?', [userId])
    await tx.query(
      "INSERT INTO balance_transactions (user_id, reason, amount, tokens, balance_after) VALUES (?, 'topup', ?, 0, ?)",
      [userId, usd, b.balance])
    return Number(b.balance)
  },
}

// Embedding cache: stored input/output pairs of an API key (max 300). Rules (limits, thresholds) live in cacheService.
export const cacheEntries = {
  // Everything except the vectors, newest first.
  async listByKey(keyId) {
    const [rows] = await pool.query(
      `SELECT id, model_id, input_text, output_text, threshold, manual, hits, last_hit_at, created_at, updated_at
         FROM cache_entries WHERE key_id = ? ORDER BY id DESC`, [keyId])
    return rows
  },
  // Candidates for a lookup: this model's entries plus the '*' (any model) ones, made by the same embedding model.
  async vectors(keyId, modelId, embeddingModel) {
    const [rows] = await pool.query(
      "SELECT id, embedding, threshold FROM cache_entries WHERE key_id = ? AND model_id IN (?, '*') AND embedding_model = ?",
      [keyId, modelId, embeddingModel])
    return rows
  },
  async get(keyId, id) {
    const [rows] = await pool.query('SELECT * FROM cache_entries WHERE id = ? AND key_id = ?', [id, keyId])
    return rows[0] || null
  },
  async findByHash(keyId, modelId, hash) {
    const [rows] = await pool.query('SELECT id, manual FROM cache_entries WHERE key_id = ? AND model_id = ? AND input_hash = ?', [keyId, modelId, hash])
    return rows[0] || null
  },
  // Inserts one entry while holding the key's row lock, so parallel requests can't pass the limit.
  // When full: evict = true drops the least recently used NON-manual entry; evict = false just refuses.
  // -> { id } | { full: true } | { dup: true }
  async insertIfRoom(keyId, e, max, { evict }) {
    try {
      return await withTransaction(async tx => {
        await tx.query('SELECT id FROM api_keys WHERE id = ? FOR UPDATE', [keyId])
        const { rows: [{ n }] } = await tx.query('SELECT COUNT(*) AS n FROM cache_entries WHERE key_id = ?', [keyId])
        if (n >= max) {
          if (!evict) return { full: true }
          const { rows: [old] } = await tx.query(
            'SELECT id FROM cache_entries WHERE key_id = ? AND manual = 0 ORDER BY COALESCE(last_hit_at, created_at) ASC, id ASC LIMIT 1', [keyId])
          if (!old) return { full: true }
          await tx.query('DELETE FROM cache_entries WHERE id = ?', [old.id])
        }
        const r = await tx.query(
          `INSERT INTO cache_entries (key_id, user_id, model_id, input_text, output_text, input_hash, embedding, embedding_model, threshold, manual, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
          [keyId, e.userId, e.modelId, e.input, e.output, e.hash, e.embedding, e.embeddingModel, e.threshold ?? null, e.manual ? 1 : 0])
        return { id: r.insertId }
      })
    } catch (err) { if (err.code === 'ER_DUP_ENTRY') return { dup: true }; throw err }
  },
  // Callers pass every field already merged with the stored values.
  async update(keyId, id, e) {
    try {
      const [r] = await pool.query(
        `UPDATE cache_entries SET input_text = ?, output_text = ?, input_hash = ?, embedding = ?, embedding_model = ?, threshold = ?, manual = 1, updated_at = UTC_TIMESTAMP()
          WHERE id = ? AND key_id = ?`,
        [e.input, e.output, e.hash, e.embedding, e.embeddingModel, e.threshold ?? null, id, keyId])
      return r.affectedRows > 0 ? 'ok' : 'missing'
    } catch (err) { if (err.code === 'ER_DUP_ENTRY') return 'dup'; throw err }
  },
  // A fresh answer for an input that is already stored (auto entries only).
  async setOutput(id, output) {
    await pool.query('UPDATE cache_entries SET output_text = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND manual = 0', [output, id])
  },
  async hit(id) {
    await pool.query('UPDATE cache_entries SET hits = hits + 1, last_hit_at = UTC_TIMESTAMP() WHERE id = ?', [id])
  },
  async remove(keyId, id) {
    const [r] = await pool.query('DELETE FROM cache_entries WHERE id = ? AND key_id = ?', [id, keyId])
    return r.affectedRows > 0
  },
  async clear(keyId) {
    await pool.query('DELETE FROM cache_entries WHERE key_id = ?', [keyId])
  },
}
