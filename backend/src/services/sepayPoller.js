// DEPOSIT_MODE=poll|both: every DEPOSIT_POLL_INTERVAL_MS (default 10 s) ask the SePay API for new bank
// transactions and credit them through the SAME code path as the webhook (processSepayWebhook).
// WHO gets the money is decided there, not here: the user's transfer code (NAP + 8 chars) is read from the
// transfer content (transaction_content) and looked up in deposit_codes. See findCode() in depositService.js.
// Transfers with no valid code are stored as 'unmatched' and logged; fix them with scripts/deposits-admin.js.
// That path is idempotent (deposits.sepay_id is UNIQUE), so poll + webhook together, several server
// instances, or re-reading old transactions can never credit the same transfer twice.
import { processSepayWebhook, depositMode } from './depositService.js'

const API_URL = () => process.env.SEPAY_API_URL || 'https://my.sepay.vn/userapi/transactions/list'

// SePay filters dates in Vietnam time, "YYYY-MM-DD HH:mm:ss".
const vnTime = d => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).format(d)

// API row -> the shape the webhook handler already understands.
const normalize = t => {
  const inn = Math.round(Number(t.amount_in) || 0)
  const out = Math.round(Number(t.amount_out) || 0)
  return {
    id: t.id,
    transferType: inn > 0 ? 'in' : 'out',
    transferAmount: inn > 0 ? inn : out,
    // The API gives the main account (account_number) and the virtual one (sub_account); report whichever is configured.
    accountNumber: [t.sub_account, t.account_number].find(a => a && String(a) === process.env.DEPOSIT_ACCOUNT_NUMBER) ?? t.account_number,
    code: t.code,
    content: t.transaction_content,
    description: t.transaction_content,
    referenceCode: t.reference_number,
  }
}

async function fetchBatch(token, account, cursor, since) {
  const u = new URL(API_URL())
  // No account/date/since_id filters: the filtered request returned nothing even though the plain one lists the
  // transfers. Take the 50 most recent and filter by account and by id (cursor) here instead.
  u.searchParams.set('limit', String(Number(process.env.DEPOSIT_POLL_LIMIT) || 50))
  const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) })
  if (res.status === 429) { // limit is 3 req/s per token; honour the server's hint if it sends one
    const e = new Error('SePay API rate limited (429)')
    e.retryAfterMs = Math.min(Math.max(Number(res.headers.get('x-sepay-userapi-retry-after')) || 30, 1), 300) * 1000
    throw e
  }
  if (!res.ok) throw new Error(`SePay API HTTP ${res.status}`)
  const body = await res.json()
  return Array.isArray(body?.transactions) ? body.transactions : []
}

/** Starts the loop when DEPOSIT_MODE is poll/both. Returns a stop() function. Throws at boot on bad config. */
export function startSepayPoller() {
  if (!depositMode().poll) return () => {}
  const token = process.env.SEPAY_API_TOKEN
  const account = process.env.DEPOSIT_ACCOUNT_NUMBER
  if (!token || !account) throw new Error('DEPOSIT_MODE=poll|both needs SEPAY_API_TOKEN and DEPOSIT_ACCOUNT_NUMBER.')

  const interval = Math.max(Number(process.env.DEPOSIT_POLL_INTERVAL_MS) || 10_000, 3_000)
  const since = new Date(Date.now() - (Number(process.env.DEPOSIT_POLL_LOOKBACK_HOURS) || 24) * 3_600_000)
  let cursor = 0 // highest SePay id fully handled; first run looks back `since` to catch anything missed while down
  let stopped = false
  let timer

const tick = async () => {
  let delay = interval

  try {
    const txs = (await fetchBatch(token, account, cursor, since))
      .filter(t => Number(t.id) > cursor)
      .sort((a, b) => Number(a.id) - Number(b.id))

    // Chỉ log khi thực sự có giao dịch mới
    if (txs.length > 0) {
      console.log(
        `[sepay-poll] found ${txs.length} new transaction(s): ${txs.map(t => t.id).join(', ')}`
      )
    }

    for (const t of txs) {
      try {
        console.log(
          `[sepay-poll] processing ${t.id} in=${t.amount_in} content="${t.transaction_content}"`
        )

        const r = await processSepayWebhook(normalize(t))

        // Chỉ hiện kết quả giao dịch thành công
        if (r.status === 'completed') {
          console.log(
            `[sepay-poll] CREDITED transaction ${t.id} -> ${t.amount_in} VND`
          )
        }

        cursor = Math.max(cursor, Number(t.id))
      } catch (e) {
        if (!(e.status < 500)) throw e

        console.error(
          `[sepay-poll] skipped transaction ${t.id}: ${e.message}`
        )

        cursor = Math.max(cursor, Number(t.id))
      }
    }
  } catch (e) {
    console.error('[sepay-poll]', e.message)

    if (e.retryAfterMs) {
      delay = Math.max(delay, e.retryAfterMs)
    }
  }

  if (!stopped) {
    timer = setTimeout(tick, delay)
  }
}

  tick()
  console.log(`[sepay-poll] polling every ${interval / 1000}s`)
  return () => { stopped = true; clearTimeout(timer) }
}