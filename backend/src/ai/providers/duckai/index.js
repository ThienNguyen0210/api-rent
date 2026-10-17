// duck.ai provider (Claude Haiku 4.5). Served at POST /v1/duckai/chat/completions.
import { complete, closeBrowser, DEFAULT_MODEL } from './service.js'

export default { id: 'claude', modelKey: 'claude', defaultModel: DEFAULT_MODEL, complete, close: closeBrowser }
