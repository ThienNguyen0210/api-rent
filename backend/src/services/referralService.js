// Refer a Friend: each user has a code; a friend who enters it once gets tokens, and so does the code's owner.
import crypto from 'node:crypto'
import { HttpError } from '../http.js'
import { users, referrals, withTransaction } from '../db.js'

export const REFERRAL_BONUS_TOKENS = 1_000_000

// No 0/O/1/I so codes survive being read aloud or typed from a screenshot. 32^8 ≈ 1.1e12 combinations.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const newCode = () => Array.from({ length: 8 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')

const fail = (status, message, code) => Object.assign(new HttpError(status, message), { code })

async function requireUser(userId) {
  const u = await users.findById(userId)
  if (!u || !u.email_verified) throw new HttpError(401, 'Session expired. Please log in again.')
  return u
}

// Returns the user's code, creating one the first time it is needed.
export async function ensureCode(userId) {
  for (let i = 0; i < 5; i++) {
    const existing = await referrals.codeOf(userId)
    if (existing) return existing
    await referrals.assignCode(userId, newCode()) // false = collision or a parallel request won; the loop re-reads
  }
  throw new HttpError(500, 'Could not create a referral code. Please try again.')
}

// j***@gmail.com: enough to recognise a friend, not enough to expose their address.
const maskEmail = e => {
  const [name = '', domain = ''] = String(e).split('@')
  return `${name.slice(0, 1)}***@${domain}`
}

export async function getReferral(userId) {
  await requireUser(userId)
  const [code, claim, invited] = await Promise.all([
    ensureCode(userId), referrals.findClaimBy(userId), referrals.listByReferrer(userId),
  ])
  const completed = invited.filter(r => r.status === 'completed')
  return {
    code,
    bonusTokens: REFERRAL_BONUS_TOKENS,
    // The user's own claim: null until they enter someone's code.
    claim: claim && { status: claim.status, tokens: Number(claim.tokens_each), completedAt: claim.completed_at },
    invited: invited.map(r => ({ id: String(r.id), email: maskEmail(r.email), status: r.status, tokens: Number(r.tokens_each), completedAt: r.completed_at })),
    totalEarned: completed.reduce((s, r) => s + Number(r.tokens_each), 0),
  }
}

/**
 * Enter a friend's code. One transaction: lock both users, record the claim, credit both, mark it completed.
 * A user can claim once, ever (UNIQUE referee_id); the same code can be used by many different friends.
 */
export async function claimReferral(userId, rawCode) {
  const me = await requireUser(userId)
  const code = rawCode.toUpperCase()

  if (await referrals.findClaimBy(me.id)) throw fail(409, 'You have already used a referral code.', 'already_claimed')
  const owner = await referrals.findOwnerByCode(code)
  if (!owner) throw fail(404, 'Referral code not found. Check it and try again.', 'invalid_code')
  if (owner.id === me.id) throw fail(400, 'You cannot use your own referral code.', 'own_code')

  try {
    return await withTransaction(async tx => {
      await referrals.lockUsers(tx, me.id, owner.id)
      // Blocks "you use mine, I use yours" swaps that would pay both sides twice.
      if (await referrals.reverseExists(tx, me.id, owner.id))
        throw fail(409, 'This user has already used your referral code.', 'mutual_referral')

      const id = await referrals.insertPending(tx, { referrerId: owner.id, refereeId: me.id, code, tokens: REFERRAL_BONUS_TOKENS })
      const tokenBalance = await referrals.creditTokens(tx, me.id, REFERRAL_BONUS_TOKENS)
      await referrals.creditTokens(tx, owner.id, REFERRAL_BONUS_TOKENS)
      if (!(await referrals.markCompleted(tx, id))) throw new HttpError(500, 'Could not complete the referral.')

      return { status: 'completed', tokensAwarded: REFERRAL_BONUS_TOKENS, tokenBalance }
    })
  } catch (e) {
    // Two requests from the same user raced past the check above: the unique key rolled the loser back, nobody is paid twice.
    if (e.code === 'ER_DUP_ENTRY') throw fail(409, 'You have already used a referral code.', 'already_claimed')
    throw e
  }
}
