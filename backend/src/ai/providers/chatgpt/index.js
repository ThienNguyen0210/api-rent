// ChatGPT provider. Served at POST /v1/chatgpt/chat/completions.
import { complete, closeBrowser, DEFAULT_MODEL } from './service.js'

export default { id: 'chatgpt', modelKey: 'chatgpt', defaultModel: DEFAULT_MODEL, complete, close: closeBrowser }
