// Claude provider. Served at POST /v1/claude/chat/completions.
import { complete, closeBrowser, DEFAULT_MODEL } from './service.js'

export default { id: 'claude', modelKey: 'claude', defaultModel: DEFAULT_MODEL, complete, close: closeBrowser }
