// Gemini provider. Served at POST /v1/gemini/chat/completions.
import { complete, closeBrowser, DEFAULT_MODEL } from './service.js'

export default { id: 'gemini', modelKey: 'gemini', defaultModel: DEFAULT_MODEL, complete, close: closeBrowser }
