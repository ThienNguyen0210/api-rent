// The logged-in user's own account.
import bcrypt from 'bcryptjs'
import { HttpError, signToken } from '../http.js'
import { users, loginHistory } from '../db.js'

const BCRYPT_ROUNDS = 12

// Shape sent to the frontend. Never return a raw DB row.
export const publicUser = u => ({
  name: u.name,
  email: u.email,
  preferences: typeof u.preferences === 'string' ? JSON.parse(u.preferences) : u.preferences || {},
})

async function requireUser(userId) {
  const u = await users.findById(userId)
  if (!u || !u.email_verified) throw new HttpError(401, 'Session expired. Please log in again.')
  return u
}

export async function getAccount(userId) {
  return publicUser(await requireUser(userId))
}

export async function updateProfile(userId, { name, email, preferences }) {
  const user = await requireUser(userId)
  if (email && email !== user.email) throw new HttpError(400, 'Changing your email address is not supported yet.')

  await users.updateProfile(user.id, {
    name: name ?? user.name,
    preferences: { ...publicUser(user).preferences, ...preferences },
  })
  return publicUser(await users.findById(user.id))
}

// The user's most recent sign-ins (the DB keeps at most 20 per user).
export async function getLoginHistory(userId) {
  const rows = await loginHistory.listByUser(userId)
  return {
    items: rows.map(r => ({ id: r.id, ip: r.ip, timeZone: r.time_zone, userAgent: r.user_agent, createdAt: r.created_at })),
  }
}

// Changes the password. With logoutOtherDevices, every existing session is revoked and the
// caller receives a fresh token so this device stays signed in.
export async function changePassword(userId, { currentPassword, newPassword, logoutOtherDevices }) {
  const user = await requireUser(userId)
  if (!user.password_hash) throw new HttpError(400, 'This account signs in with Google and has no password.')
  // 403, not 401: the frontend may treat 401 as "session expired" and log the user out.
  if (!(await bcrypt.compare(currentPassword, user.password_hash)))
    throw new HttpError(403, 'Current password is incorrect.')
  if (currentPassword === newPassword)
    throw new HttpError(400, 'New password must be different from the current one.')

  await users.setPassword(user.id, await bcrypt.hash(newPassword, BCRYPT_ROUNDS), logoutOtherDevices)

  const out = { message: 'Password updated.' }
  if (logoutOtherDevices) out.token = signToken(user.id, user.token_version + 1)
  return out
}
