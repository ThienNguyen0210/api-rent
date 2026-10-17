// Claude browser (claude.ai): its own Playwright client (profile CLAUDE_PROFILE_DIR, tab pool CLAUDE_TABS).
// One public model, "claude-haiku-4.5", answered by whatever model the signed-in claude.ai account uses (no API key).
import { createRequire } from 'node:module'
import { createCompleter } from '../../core/completion.js'

// The browser transport is CommonJS (.cjs) inside an ES-module project, so it is loaded with require.
const require = createRequire(import.meta.url)

export const DEFAULT_MODEL = 'claude-haiku-4.5'

let client = null
const getClient = () => (client ??= require('./browser.cjs').createBrowserClient())

export const complete = createCompleter(getClient)
export const closeBrowser = () => client?.close() // called on server shutdown
