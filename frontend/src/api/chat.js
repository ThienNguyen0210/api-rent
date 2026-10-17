// Session-authenticated streaming chat (served by src/ai/sessionRouter.js).
import { request as r } from './client.js'

export const CHAT_STREAM_URL = '/api/chat/stream'

export const chatApi = {
  models: () => r('/chat/models'), // -> { data: [{ key, name }] } only models this chat can serve
}
