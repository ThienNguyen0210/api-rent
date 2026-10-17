// Usage tracking: records finished API calls and reads the numbers shown on the Overview page.
import { query, withTransaction, usageRequests, keys, MODEL_NAME_COL } from '../db.js'

const num = v => Number(v ?? 0)

// Percent change vs the previous period. null when there is nothing to compare against.
const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null)

/** Request history is kept for this many days, then deleted. Daily totals, balance and ledger are kept. */
export const HISTORY_DAYS = 30
export const purgeOldRequests = () => usageRequests.purgeOlderThan(HISTORY_DAYS)

/**
 * Returns the models row for a public model name (e.g. 'GPT-5.6-Luna'), creating it the first time
 * the endpoint is used. New models are free (price 0) until you set prices on the row.
 */
async function ensureModel(tx, name) {
  const key = String(name ?? '').trim().slice(0, 150)
  if (!key) return null
  await tx.query(
    `INSERT INTO models (name, ${MODEL_NAME_COL}) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [key.slice(0, 100), key])
  const { rows: [m] } = await tx.query(
    `SELECT id, price_prompt_per_1m AS p, price_completion_per_1m AS c FROM models WHERE ${MODEL_NAME_COL} = ? LIMIT 1`, [key])
  return m || null
}

/**
 * Record one finished request atomically: model + history row + daily totals + balance + ledger.
 * `modelId` is the public model name used by the endpoint (e.g. 'GPT-5.6-Luna').
 * `id` is optional: omit it to let the database assign usage_requests.id. When given, a retry with the
 * same id is skipped instead of double-counted. Returns { id, status, tokens, cost, balanceAfter, ... }.
 */
export async function recordUsage({ id, userId, keyId, modelId, status, promptTokens = 0, completionTokens = 0, latencyMs = 0 }) {
  const tokens = promptTokens + completionTokens
  const latency = Math.max(0, Math.round(latencyMs))
  const ok = status < 400

  return withTransaction(async tx => {
    // The model is saved the first time an endpoint uses it, then priced from its row
    // (failed calls are logged but not billed).
    const m = await ensureModel(tx, modelId)
    const cost = ok && m ? (promptTokens * num(m.p) + completionTokens * num(m.c)) / 1e6 : 0

    // 1) Per-request history with the model details.
    const cols = ['user_id', 'key_id', 'model_id', 'status', 'prompt_tokens', 'completion_tokens', 'tokens', 'cost', 'latency_ms']
    const vals = [userId, keyId ?? null, m?.id ?? null, status, promptTokens, completionTokens, tokens, cost, latency]
    if (id != null) { cols.unshift('id'); vals.unshift(id) }
    let reqId = id
    try {
      const ins = await tx.query(
        `INSERT INTO usage_requests (${cols.join(', ')}, created_at)
         VALUES (${cols.map(() => '?').join(', ')}, UTC_TIMESTAMP())`, vals)
      reqId = id ?? ins.insertId
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY' && id != null) return { id, status, duplicate: true }
      throw e
    }

    // 2) Daily aggregate (Overview chart and change vs previous period).
    await tx.query(
      `INSERT INTO usage_daily (user_id, day, requests, tokens, spend) VALUES (?, UTC_DATE(), 1, ?, ?)
       ON DUPLICATE KEY UPDATE requests = requests + 1, tokens = tokens + VALUES(tokens), spend = spend + VALUES(spend)`,
      [userId, tokens, cost])

    // 2b) Running token totals of the API key that made the call (the same tokens that are deducted below).
    if (keyId != null && tokens > 0) await keys.addTokens(tx, keyId, promptTokens, completionTokens)

    // 3) Balance and lifetime totals (Overview balance card).
    // tokens_granted is the CURRENT token balance: each request's total tokens are deducted from it
    // (floored at 0, so an UNSIGNED column never goes out of range) and added to tokens_consumed.
    // A brand-new row starts with 0 granted tokens; only addCredit() ever increases tokens_granted.
    await tx.query(
      `INSERT INTO balances (user_id, balance, tokens_granted, tokens_consumed, total_requests, total_spend) VALUES (?, ?, 0, ?, 1, ?)
       ON DUPLICATE KEY UPDATE balance = balance - VALUES(total_spend),
         tokens_granted = GREATEST(CAST(tokens_granted AS SIGNED) - CAST(VALUES(tokens_consumed) AS SIGNED), 0),
         tokens_consumed = tokens_consumed + VALUES(tokens_consumed),
         total_requests = total_requests + 1, total_spend = total_spend + VALUES(total_spend)`,
      [userId, -cost, tokens, cost])

    const { rows: [b] } = await tx.query('SELECT balance FROM balances WHERE user_id = ?', [userId])

    // 4) Ledger entry linked to the request.
    if (cost > 0 || tokens > 0) {
      await tx.query(
        `INSERT INTO balance_transactions (user_id, reason, amount, tokens, balance_after, request_id)
         VALUES (?, 'usage', ?, ?, ?, ?)`,
        [userId, -cost, tokens, num(b.balance), reqId])
    }

    return { id: reqId, status, tokens, promptTokens, completionTokens, cost, balanceAfter: num(b.balance) }
  })
}

/** Totals for the last `days` days, the change vs the `days` before, and one point per day for the chart. */
export async function summary(userId, days = 7) {
  const { rows: [t] } = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN day > DATE_SUB(UTC_DATE(), INTERVAL ? DAY) THEN requests ELSE 0 END), 0) AS requests,
       COALESCE(SUM(CASE WHEN day > DATE_SUB(UTC_DATE(), INTERVAL ? DAY) THEN tokens ELSE 0 END), 0) AS tokens,
       COALESCE(SUM(CASE WHEN day > DATE_SUB(UTC_DATE(), INTERVAL ? DAY) THEN spend ELSE 0 END), 0) AS spend,
       COALESCE(SUM(CASE WHEN day <= DATE_SUB(UTC_DATE(), INTERVAL ? DAY) THEN requests ELSE 0 END), 0) AS prev_requests,
       COALESCE(SUM(CASE WHEN day <= DATE_SUB(UTC_DATE(), INTERVAL ? DAY) THEN tokens ELSE 0 END), 0) AS prev_tokens,
       COALESCE(SUM(CASE WHEN day <= DATE_SUB(UTC_DATE(), INTERVAL ? DAY) THEN spend ELSE 0 END), 0) AS prev_spend
     FROM usage_daily
     WHERE user_id = ? AND day > DATE_SUB(UTC_DATE(), INTERVAL (? * 2) DAY)`,
    [days, days, days, days, days, days, userId, days]
  )

  // Recursive CTE to generate series of dates in MySQL without gaps
  const { rows: daily } = await query(
    `WITH RECURSIVE s(day) AS (
       SELECT CAST(DATE_SUB(UTC_DATE(), INTERVAL ? - 1 DAY) AS DATE)
       UNION ALL
       SELECT DATE_ADD(day, INTERVAL 1 DAY) FROM s WHERE day < UTC_DATE()
     )
     SELECT DATE_FORMAT(s.day, '%Y-%m-%d') AS date,
            COALESCE(SUM(u.requests), 0) AS requests,
            COALESCE(SUM(u.tokens), 0)   AS tokens,
            COALESCE(SUM(u.spend), 0)    AS spend
     FROM s
     LEFT JOIN usage_daily u ON u.user_id = ? AND u.day = s.day
     GROUP BY s.day ORDER BY s.day`,
    [days, userId]
  )

  // Per-model breakdown for the same window as `totals` (today and the previous days-1 days).
  // Note: built from usage_requests, which is purged after HISTORY_DAYS, so windows longer than that are truncated.
  const { rows: models } = await query(
    `SELECT m.${MODEL_NAME_COL} AS model_name, r.model_id,
            COUNT(*) AS requests, COALESCE(SUM(r.tokens), 0) AS tokens, COALESCE(SUM(r.cost), 0) AS spend
     FROM usage_requests r LEFT JOIN models m ON m.id = r.model_id
     WHERE r.user_id = ? AND r.created_at >= DATE_SUB(UTC_DATE(), INTERVAL ? DAY)
     GROUP BY r.model_id, m.${MODEL_NAME_COL}
     ORDER BY tokens DESC`,
    [userId, days - 1]
  )

  // Daily input/output token split (from usage_requests, so it covers HISTORY_DAYS at most).
  const { rows: io } = await query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS date,
            COALESCE(SUM(prompt_tokens), 0) AS input_tokens, COALESCE(SUM(completion_tokens), 0) AS output_tokens
     FROM usage_requests
     WHERE user_id = ? AND created_at >= DATE_SUB(UTC_DATE(), INTERVAL ? DAY)
     GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')`,
    [userId, days - 1]
  )
  const ioByDate = new Map(io.map(r => [r.date, r]))

  const totals = { requests: num(t.requests), tokens: num(t.tokens), spend: num(t.spend) }
  const prev = { requests: num(t.prev_requests), tokens: num(t.prev_tokens), spend: num(t.prev_spend) }
  return {
    days,
    totals,
    change: { requests: pct(totals.requests, prev.requests), tokens: pct(totals.tokens, prev.tokens), spend: pct(totals.spend, prev.spend) },
    byModel: models.map(m => ({
      modelId: m.model_name ?? (m.model_id != null ? String(m.model_id) : '–'),
      requests: num(m.requests), tokens: num(m.tokens), spend: num(m.spend),
    })),
    daily: daily.map(d => ({
      date: d.date, requests: num(d.requests), tokens: num(d.tokens), spend: num(d.spend),
      inputTokens: num(ioByDate.get(d.date)?.input_tokens), outputTokens: num(ioByDate.get(d.date)?.output_tokens),
    })),
  }
}

/** Most recent requests, newest first. `modelId` is the model's public name (e.g. 'GPT-5.6-Luna'). */
export async function recentRequests(userId, limit = 10) {
  const { rows } = await query(
    `SELECT r.id, r.key_id, r.model_id, m.${MODEL_NAME_COL} AS model_name, r.status, r.prompt_tokens, r.completion_tokens,
            r.tokens, r.cost, r.latency_ms, r.created_at
     FROM usage_requests r LEFT JOIN models m ON m.id = r.model_id
     WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT ?`,
    [userId, Number(limit)]
  )
  return rows.map(r => ({
    id: r.id, keyId: r.key_id != null ? String(r.key_id) : null, modelId: r.model_name ?? (r.model_id != null ? String(r.model_id) : '–'),
    status: Number(r.status), tokens: num(r.tokens),
    promptTokens: num(r.prompt_tokens), completionTokens: num(r.completion_tokens), cost: num(r.cost),
    latencyMs: num(r.latency_ms), createdAt: r.created_at,
  }))
}

/**
 * Health of the platform, as codes ('ok' | 'degraded' | 'down') that the frontend translates.
 */
export async function apiStatus() {
  const out = { api: 'down', models: 'down', gateway: 'ok' }
  try {
    await query('SELECT 1')
    out.api = 'ok'
    const { rows: [m] } = await query('SELECT count(*) AS n FROM models WHERE active = 1')
    out.models = Number(m.n) > 0 ? 'ok' : 'down'
    const { rows: [g] } = await query(
      `SELECT count(*) AS total, SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS failed
       FROM usage_requests WHERE created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE)`
    )
    const total = Number(g.total || 0)
    const failed = Number(g.failed || 0)
    if (total >= 5) {
      const rate = failed / total
      out.gateway = rate >= 0.5 ? 'down' : rate >= 0.2 ? 'degraded' : 'ok'
    }
  } catch (e) {
    console.error('status check failed', e)
  }
  return out
}