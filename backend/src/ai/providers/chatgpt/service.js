// ChatGPT browser: its own Playwright client (profile CHATGPT_PROFILE_DIR, tab pool CHATGPT_TABS).
import { createRequire } from 'node:module'
import { createCompleter } from '../../core/completion.js'

// The browser transport is CommonJS (.cjs) inside an ES-module project, so it is loaded with require.
const require = createRequire(import.meta.url)

export const DEFAULT_MODEL = 'GPT-6'

let client = null
const getClient = () => (client ??= require('./browser.cjs').createBrowserClient())

export const complete = createCompleter(getClient)
export const closeBrowser = () => client?.close() // called on server shutdown
