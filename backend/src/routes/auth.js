// Public auth routes. Each handler: parse the body → call ONE service function → send JSON.
// Abuse-prone routes get a limiter(). Request schemas live at the top of the file.
import { Router } from 'express'
import { z } from 'zod'
import { handler, parse, limiter, clientInfo, setSessionCookie, clearSessionCookie, csrfGuard } from '../http.js'
import * as authService from '../services/authService.js'

const email = z.string().trim().toLowerCase().email().max(255)

const registerSchema = z
  .object({
    email,
    password: z.string().min(8).max(72), // bcrypt ignores bytes past 72
    confirmPassword: z.string(),
  })
  .refine(d => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })
const loginSchema = z.object({ email, password: z.string().min(1).max(72) })
const verifyOtpSchema = z.object({ email, otp: z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits') })
const resendOtpSchema = z.object({ email })
const forgotSchema = z.object({ email })
const verifyResetSchema = z.object({ email, otp: z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits') })
const resetSchema = z
  .object({
    resetToken: z.string().min(20).max(2048),
    password: z.string().min(8).max(72),
    confirmPassword: z.string(),
  })
  .refine(d => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })
const googleSchema = z.object({ credential: z.string().min(20).max(4096) })

const router = Router()

// Sends a sign-in result: the session token goes into the HttpOnly cookie and is
// removed from the JSON body, so the browser's JavaScript never sees it.
function sendSession(res, result) {
  const { token, ...rest } = result
  if (token) setSessionCookie(res, token)
  res.json(rest)
}

// Step 1: create (or refresh) an unverified account and email a code.
router.post('/register', limiter(10), handler(async (req, res) => {
  const result = await authService.register(parse(registerSchema, req.body))
  res.status(202).json({ message: 'Verification code sent.', ...result })
}))

// Step 2: verify the code, mark the email verified, and sign the user in.
router.post('/verify-otp', limiter(30), handler(async (req, res) => {
  sendSession(res, await authService.verifyOtp(parse(verifyOtpSchema, req.body), clientInfo(req)))
}))

router.post('/resend-otp', limiter(10), handler(async (req, res) => {
  res.json(await authService.resendOtp(parse(resendOtpSchema, req.body)))
}))

router.post('/login', limiter(20), handler(async (req, res) => {
  sendSession(res, await authService.login(parse(loginSchema, req.body), clientInfo(req)))
}))

// Sign out: clears the session cookie (JavaScript can't, because it is HttpOnly).
router.post('/logout', csrfGuard, handler(async (_req, res) => {
  clearSessionCookie(res)
  res.json({ message: 'Logged out.' })
}))

// Forgot password: 1) email a code  2) verify it -> reset token  3) set the new password.
router.post('/forgot-password', limiter(10), handler(async (req, res) => {
  res.json(await authService.forgotPassword(parse(forgotSchema, req.body)))
}))

router.post('/verify-reset-otp', limiter(30), handler(async (req, res) => {
  res.json(await authService.verifyResetOtp(parse(verifyResetSchema, req.body)))
}))

router.post('/reset-password', limiter(10), handler(async (req, res) => {
  res.json(await authService.resetPassword(parse(resetSchema, req.body)))
}))

router.post('/google', limiter(20), handler(async (req, res) => {
  sendSession(res, await authService.loginWithGoogle(parse(googleSchema, req.body), clientInfo(req)))
}))

export default router