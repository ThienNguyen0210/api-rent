import { getLang } from '../i18n/index.jsx'
const loc = () => (getLang() === 'vi' ? 'vi-VN' : 'en-US')
const valid = iso => iso && !isNaN(new Date(iso))
export const fmtNum = n => new Intl.NumberFormat(loc()).format(n ?? 0)
export const fmtCompact = n => new Intl.NumberFormat(loc(), { notation: 'compact' }).format(n ?? 0)
export const fmtMoney = (n, currency = 'USD') => new Intl.NumberFormat(loc(), { style: 'currency', currency }).format(n ?? 0)
export const fmtDate = iso => valid(iso) ? new Intl.DateTimeFormat(loc(), { dateStyle: 'medium' }).format(new Date(iso)) : '–'
export const fmtDateTime = iso => valid(iso) ? new Intl.DateTimeFormat(loc(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '–'
