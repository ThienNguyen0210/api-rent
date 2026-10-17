// All email: the Resend client, the shared branded layout, and every template.
// To add an email: write a template function below, add a send<Name>Email() next to sendOtpEmail(),
// and call it from services.js. Keep this the only file that imports `resend`.
import { Resend } from 'resend'
import { config } from './config.js'

const resend = new Resend(config.resendApiKey)

async function sendEmail({ to, subject, text, html, replyTo }) {
  const { error } = await resend.emails.send({ from: config.mailFrom, to: [to], subject, text, html, ...(replyTo && { replyTo }) })
  if (error) throw new Error(error.message || 'Resend failed')
}

// Escape anything user-supplied before putting it in HTML.
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ---- Look & feel: one restrained palette (navy on white), system fonts, no imagery, so it renders the same everywhere ----
const BRAND = 'Nexora'
const FONT = "'Segoe UI',Helvetica,Arial,sans-serif"
const MONO = "'SFMono-Regular',Consolas,'Liberation Mono','Courier New',monospace"
const C = { navy: '#0b1f3a', text: '#1f2933', muted: '#5f6b7a', faint: '#8b95a3', line: '#dde2ea', panel: '#f6f8fb', page: '#eef1f5' }

// Building blocks (inline styles only: Outlook and Gmail ignore most <style> rules).
const heading = t => `<h1 style="margin:0 0 20px;font-family:${FONT};font-size:21px;font-weight:600;line-height:1.3;color:${C.navy};">${esc(t)}</h1>`
const para = (html, { bottom = 16, size = 15, color = C.text } = {}) =>
  `<p style="margin:0 0 ${bottom}px;font-family:${FONT};font-size:${size}px;line-height:1.65;color:${color};">${html}</p>`

// The one-time code, set apart in a bordered panel.
const codeBlock = (code, label) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid ${C.line};background-color:${C.panel};border-radius:6px;">
    <tr><td align="center" style="padding:20px 16px;">
      <div style="margin:0 0 8px;font-family:${FONT};font-size:13px;color:${C.muted};">${esc(label)}</div>
      <div style="font-family:${MONO};font-size:32px;font-weight:700;letter-spacing:9px;color:${C.navy};">${esc(code)}</div>
    </td></tr>
  </table>`

// Security / information note with a navy rule on the left.
const notice = (title, html) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr>
      <td width="3" style="background-color:${C.navy};font-size:0;line-height:0;">&nbsp;</td>
      <td style="padding:12px 16px;background-color:${C.panel};">
        <div style="margin:0 0 4px;font-family:${FONT};font-size:13px;font-weight:600;color:${C.navy};">${esc(title)}</div>
        <div style="font-family:${FONT};font-size:13px;line-height:1.6;color:${C.muted};">${html}</div>
      </td>
    </tr>
  </table>`

const signoff = `
  <p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.65;color:${C.text};">Sincerely,<br>The ${BRAND} Team</p>`

// Shared HTML shell: white card with a navy top rule, wordmark header, formal footer. Table-based for Outlook/Gmail.
function emailLayout({ preheader = '', bodyHtml, footerNote = 'This is an automated message. Please do not reply to this email.' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${BRAND}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.page};">
  <span style="display:none;font-size:1px;color:${C.page};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.page};padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid ${C.line};border-top:4px solid ${C.navy};border-radius:4px;">
          <tr>
            <td style="padding:28px 40px 20px;border-bottom:1px solid ${C.line};">
              <span style="font-family:${FONT};font-size:20px;font-weight:700;letter-spacing:1px;color:${C.navy};">${BRAND}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px 40px;">${bodyHtml}</td>
          </tr>
          <tr>
            <td style="padding:24px 40px;border-top:1px solid ${C.line};background-color:${C.panel};">
              <p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted};">${esc(footerNote)}</p>
              <p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted};">You are receiving this email because you have an account with ${BRAND}.</p>
              <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.faint};">&copy; ${new Date().getFullYear()} ${BRAND}. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ---- Templates: each returns { subject, text, html } ----

// The three one-time-code emails share one structure; only the wording differs.
function codeEmail({ subject, preheader, name, title, intro, code, ttlMinutes, ignoreNote }) {
  const security = `Never share this code with anyone. ${BRAND} will never ask you for it by email, phone or chat.`
  const text = [
    `Dear ${name},`,
    '',
    intro,
    '',
    `Verification code: ${code}`,
    `This code is valid for ${ttlMinutes} minutes.`,
    '',
    security,
    ignoreNote,
    '',
    'Sincerely,',
    `The ${BRAND} Team`,
  ].join('\n')
  const bodyHtml = [
    heading(title),
    para(`Dear ${esc(name)},`),
    para(esc(intro), { bottom: 24 }),
    codeBlock(code, 'Verification code'),
    para(`This code is valid for <strong>${ttlMinutes} minutes</strong>.`, { bottom: 24 }),
    notice('Security notice', `${esc(security)}<br>${esc(ignoreNote)}`),
    signoff,
  ].join('')
  return { subject, text, html: emailLayout({ preheader, bodyHtml }) }
}

const otpEmail = ({ name, code, ttlMinutes }) => codeEmail({
  subject: `${code} is your ${BRAND} verification code`,
  preheader: `Your verification code is ${code}`,
  name, code, ttlMinutes,
  title: 'Verify your email address',
  intro: `Please use the verification code below to complete your ${BRAND} verification.`,
  ignoreNote: 'If you did not make this request, no action is required and you may disregard this message.',
})

const passwordResetEmail = ({ name, code, ttlMinutes }) => codeEmail({
  subject: `${code} is your ${BRAND} password reset code`,
  preheader: `Your password reset code is ${code}`,
  name, code, ttlMinutes,
  title: 'Reset your password',
  intro: `We received a request to reset the password for your ${BRAND} account. Please enter the code below to continue.`,
  ignoreNote: 'If you did not make this request, you may disregard this message. Your password will not be changed.',
})

const keyOtpResetEmail = ({ name, code, ttlMinutes }) => codeEmail({
  subject: `${code} is your ${BRAND} OTP reset code`,
  preheader: `Your OTP reset code is ${code}`,
  name, code, ttlMinutes,
  title: 'Reset your API key OTP code',
  intro: 'We received a request to reset the OTP code that protects your API keys. Please enter the code below to continue.',
  ignoreNote: 'If you did not make this request, you may disregard this message. Your OTP code will not be changed.',
})

// Sent to the admin when a user submits a support request. Every image is a link to the stored file.
function supportRequestEmail({ id, name, email, title, content, imageUrls }) {
  const subject = `[Support #${id}] ${String(title).replace(/\s+/g, ' ').slice(0, 150)}`
  const text = [
    `New support request #${id}`,
    `From: ${name} <${email}>`,
    '',
    `Title: ${title}`,
    '',
    content,
    '',
    imageUrls.length ? `Images (${imageUrls.length}):` : 'No images attached.',
    ...imageUrls.map((u, i) => `${i + 1}. ${u}`),
  ].join('\n')

  const row = (label, valueHtml, last) => `
    <tr>
      <td width="110" style="padding:10px 14px;${last ? '' : `border-bottom:1px solid ${C.line};`}font-family:${FONT};font-size:13px;color:${C.muted};">${label}</td>
      <td style="padding:10px 14px;${last ? '' : `border-bottom:1px solid ${C.line};`}font-family:${FONT};font-size:14px;color:${C.text};">${valueHtml}</td>
    </tr>`
  const bodyHtml = [
    heading(`Support request #${id}`),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid ${C.line};border-radius:4px;">
      ${row('Request ID', `#${esc(id)}`)}
      ${row('From', `${esc(name)}`)}
      ${row('Email', `<a href="mailto:${esc(email)}" style="color:${C.navy};">${esc(email)}</a>`)}
      ${row('Subject', `<strong>${esc(title)}</strong>`, true)}
    </table>`,
    `<div style="margin:0 0 6px;font-family:${FONT};font-size:13px;font-weight:600;color:${C.navy};">Message</div>`,
    `<div style="margin:0 0 24px;padding:16px 18px;background-color:${C.panel};border:1px solid ${C.line};border-radius:4px;font-family:${FONT};font-size:14px;line-height:1.7;color:${C.text};">${esc(content).replace(/\r?\n/g, '<br>')}</div>`,
    imageUrls.length
      ? `<div style="margin:0 0 6px;font-family:${FONT};font-size:13px;font-weight:600;color:${C.navy};">Attachments (${imageUrls.length})</div>
         <ol style="margin:0;padding-left:20px;font-family:${FONT};font-size:13px;line-height:1.9;">
           ${imageUrls.map(u => `<li><a href="${esc(u)}" style="color:${C.navy};word-break:break-all;">${esc(u)}</a></li>`).join('')}
         </ol>`
      : para('No attachments.', { size: 13, color: C.muted, bottom: 0 }),
  ].join('')
  return {
    subject, text,
    html: emailLayout({
      preheader: `${name}: ${title}`, bodyHtml,
      footerNote: 'Internal notification. Replying to this email will reach the customer directly.',
    }),
  }
}

// ---- Senders (what services.js calls) ----

export const sendOtpEmail = (to, name, code) =>
  sendEmail({ to, ...otpEmail({ name, code, ttlMinutes: config.otp.ttlMinutes }) })

export const sendPasswordResetEmail = (to, name, code) =>
  sendEmail({ to, ...passwordResetEmail({ name, code, ttlMinutes: config.otp.ttlMinutes }) })

export const sendKeyOtpResetEmail = (to, name, code) =>
  sendEmail({ to, ...keyOtpResetEmail({ name, code, ttlMinutes: config.otp.ttlMinutes }) })

// Replies go straight to the user.
export const sendSupportEmail = (to, req) =>
  sendEmail({ to, replyTo: req.email, ...supportRequestEmail(req) })
