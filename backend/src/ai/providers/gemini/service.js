// Gemini browser: its own Playwright client (profile GEMINI_PROFILE_DIR, tab pool GEMINI_BROWSER_TABS).
import { createRequire } from 'node:module'
import { createCompleter } from '../../core/completion.js'

// The browser transport is CommonJS (.cjs) inside an ES-module project, so it is loaded with require.
const require = createRequire(import.meta.url)

export const DEFAULT_MODEL = 'Gemini-3.5-Flash'

let client = null
const getClient = () => (client ??= require('./browser.cjs').createBrowserClient())

export const complete = createCompleter(getClient)
export const closeBrowser = () => client?.close() // called on server shutdown
