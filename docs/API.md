# Backend contract

The frontend calls these endpoints (base URL `VITE_API_URL`, default `/api`). JSON everywhere; authenticated routes send `Authorization: Bearer <token>`. Errors: non-2xx with `{ "message": "..." }`. A `401` logs the user out.

| Method & path | Body / query | Response |
|---|---|---|
| POST `/auth/login` | `{email, password}` | `{token, user}` |
| POST `/auth/register` | `{name, email, password}` | `{token, user}` |
| GET `/account` | | `{id, name, email, plan, preferences:{lowCreditAlerts, weeklyDigest}}` |
| PATCH `/account` | `{name, email, preferences}` | updated account |
| GET `/plans` (public) | | `[{id, name, price, priceNote, features[], featured}]` |
| GET `/models` (public; `enabled` only when authed) | | `[{id, name, kind, contextWindow, inputPricePer1M, outputPricePer1M, enabled}]` |
| PUT `/models/:id/access` | `{enabled}` | 204 |
| GET `/keys` | | `[{id, name, prefix, permission, createdAt, lastUsedAt}]` |
| POST `/keys` | `{name, permission: full\|read\|embeddings}` | key + `secret` (returned once) |
| DELETE `/keys/:id` | | 204 |
| GET `/usage` | `?days=7` | `{totals:{requests, tokens, spend}, daily:[{date, tokens}], byModel:[{modelId, tokens}]}` |
| GET `/usage/requests` | `?limit=10` | `[{id, modelId, status, tokens, latencyMs, createdAt}]` |
| GET `/billing` | | `{balance, currency}` |
| POST `/billing/topups` | `{amount}` | `{checkoutUrl}` |
| GET `/billing/invoices` | | `[{id, createdAt, amount, currency, status}]` |
