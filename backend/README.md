# Rentapi backend

Express + MySQL API: email-OTP signup, password login, Google login, account profile.
Stack: `express`, `mysql2`, `zod`, `jsonwebtoken`, `bcryptjs`, `resend`, `google-auth-library`, `express-rate-limit`.

## Layout

```
src/
  config.js                 env vars, validated at startup (the only file that reads process.env)
  server.js                 app wiring: middleware, error handler, OTP cleanup job
  http.js                   HttpError, parse(), handler(), limiter(), signToken()/requireAuth
  db.js                     MySQL pool + ALL SQL (users.*, otps.*)
  mail.js                   Resend client + email layout + templates
  initDb.js                 one-off script that creates the DB from schema.sql
  routes/
    index.js                mounts the routers under /api (+ /health)
    auth.js                 /api/auth/*     (schemas + routes)
    account.js              /api/account    (schemas + routes, requireAuth)
  services/
    authService.js          register, verifyOtp, resendOtp, login, loginWithGoogle
    otpService.js           sendOtp / checkOtp (the one-time-code rules)
    accountService.js       getAccount, updateProfile, publicUser
schema.sql
```

Data flows one way: **routes → services → db** (services also call mail).

- **routes/**: parse the request with a zod schema, call one service function, send JSON. No SQL, no business rules.
- **services/**: the rules (cooldowns, limits, what triggers an email). Never touches `req`/`res`.
- **db.js**: SQL only. Plain values in, plain rows out.

## Conventions

- Fail with `throw new HttpError(status, 'User-facing message')`. Anything else thrown becomes a hidden 500.
- Validate every body with `parse(schema, req.body)`; keep the zod schema at the top of that route file.
- Wrap async route handlers in `handler(...)` (already done for every route).
- All env vars go through `config.js`. Required: `JWT_SECRET` (32+ chars), `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`. See `.env.example`.
- Only `mail.js` imports `resend`; only `db.js` touches `pool`.
- Public, abuse-prone routes get `limiter(max, windowMinutes)`. Behind a reverse proxy set `TRUST_PROXY_HOPS`.

## Adding a feature (e.g. "change email")

1. `db.js`: add the query to `users` (or a new export for a new table); update `schema.sql`.
2. `services/`: add the rule to the matching service (or a new `<name>Service.js`), calling `db.js` (and `mail.js` if it sends an email).
3. `routes/`: add the zod schema and route to the matching router (or a new file, mounted in `routes/index.js`). Use `requireAuth` if it needs a logged-in user.

New email: add a template function + `send<Name>Email` in `mail.js`, and call it from a service.

## Auth notes

- Sessions are JWTs sent as `Authorization: Bearer <token>`; `requireAuth` sets `req.userId`.
- Signup: `/auth/register` emails a 6-digit code → `/auth/verify-otp` signs the user in. Codes are HMAC-hashed, single-use, 5 attempts, 60 s resend cooldown.
- Google: the browser sends a Google ID token to `/auth/google`; the server verifies it against `GOOGLE_CLIENT_ID`. Same email as an existing account → the accounts are linked.

## Running

```
npm install
node src/initDb.js
node src/server.js
```
