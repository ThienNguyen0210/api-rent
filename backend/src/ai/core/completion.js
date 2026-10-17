// Helpers shared by the two AI services. No browser is created here; each service owns its own.
import { HttpError } from '../../http.js'
import { config } from '../../config.js'
import { augmentPrompt, isImageGenerationRequest, toSingleParagraph, toMarkdown, WEB_CHAT_RULES } from './imageRules.js'
import * as cacheService from '../../services/cacheService.js'

const textOf = c =>
  typeof c === 'string' ? c : (c || []).filter(p => p.type === 'text').map(p => p.text ?? '').join('\n')

// The web apps take a single prompt, so the message list is flattened into one.
export function buildPrompt(messages) {
  if (messages.length === 1 && messages[0].role === 'user') return textOf(messages[0].content)
  const label = { system: 'System', assistant: 'Assistant' }
  const lines = messages.map(m => `${label[m.role] ?? 'User'}: ${textOf(m.content)}`)
  return `Continue this conversation. Reply only with the assistant's next message, without a speaker label.\n\n${lines.join('\n\n')}`
}

const IMAGE_REFUSAL = 'Image generation is not supported.'
// The latest user turn is what the rules are matched against.
const lastUserText = messages => textOf([...messages].reverse().find(m => m.role === 'user')?.content)

// What the cache keys on: the caller's own text (system + user messages), never the rules augmentPrompt() adds.
// Multi-turn conversations (any assistant message) are not cached: the same last message means different things in different contexts.
export function cacheInputOf(messages) {
  if (messages.some(m => m.role === 'assistant')) return null
  const part = role => messages.filter(m => m.role === role).map(m => textOf(m.content)).join('\n').trim()
  const sys = part('system')
  const user = part('user')
  return user ? (sys ? `System: ${sys}\n\n${user}` : user) : null
}

const estimateTokens = s => Math.ceil(String(s).length / 4) // the web apps report no token counts

// Billable input = only what the caller sent (their system/user/assistant messages).
// The rules block added by augmentPrompt() and the "Continue this conversation..." wrapper from buildPrompt() are ours, so they are not billed.
const callerInputOf = messages => messages.map(m => textOf(m.content)).join('\n')

/**
 * Builds complete({ messages, onDelta }) for ONE browser client (getClient returns it, created on first use).
 * onDelta(chunk) is called as the reply grows (ChatGPT streams; Gemini delivers one final chunk).
 * Each completer counts its own waiting requests, so a busy ChatGPT browser never blocks Gemini.
 * Image generation is refused in three layers (see core/imageRules.js): here up front, in the prompt itself, and by the browser transport.
 */
export function createCompleter(getClient) {
  let pending = 0
  // `cache` (optional) = { keyId, userId, modelId, enabled, threshold, hit } from the router; `hit` is set here when the answer came from the cache.
  // `markdown: true` (website chat) keeps line breaks and Markdown instead of forcing one paragraph.
  return async function complete({ messages, onDelta, cache, markdown = false }) {
    const shape = markdown ? toMarkdown : toSingleParagraph
    const userText = lastUserText(messages)
    // Refused before it takes a queue place or a browser tab, so it costs no RAM.
    if (isImageGenerationRequest(userText)) throw new HttpError(400, IMAGE_REFUSAL)

    // Embedding cache: answered from a similar earlier input, with no queue place, no browser tab and no tokens billed.
    const cacheInput = cache ? cacheInputOf(messages) : null
    if (cacheInput && cache.enabled) {
      let hit = null
      try { hit = await cacheService.lookup({ keyId: cache.keyId, modelId: cache.modelId, input: cacheInput, threshold: cache.threshold }) }
      catch (e) { console.error('[cache] lookup failed', e) } // a broken cache must never break the API
      if (hit) {
        cache.hit = true
        if (onDelta) onDelta(hit.output)
        return { text: hit.output, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }
      }
    }
    if (pending >= config.ai.maxPending) throw new HttpError(503, 'Too many requests are waiting for this model. Try again shortly.')
    pending++
    try {
      const prompt = augmentPrompt(buildPrompt(messages), userText, markdown ? { rules: WEB_CHAT_RULES } : undefined) // retrieved rules (no image generation) go in front
      let sent = ''
      const emit = (raw, final = false) => {
        const text = shape(raw, { final }) // the reply is delivered as one continuous paragraph, whatever the web app rendered
        if (onDelta && text.length > sent.length && text.startsWith(sent)) {
          onDelta(text.slice(sent.length))
          sent = text
        }
      }
      // accept: () => true, because free text has no "complete JSON" marker; the transport still waits for the stop button to vanish.
      let r
      try {
        r = await getClient().ask(prompt, { timeoutMs: config.ai.timeoutMs, accept: () => true, onUpdate: emit })
      } catch (e) {
        // the transport saw the web app start producing an image and stopped it
        if (e && e.code === 'image_blocked') throw new HttpError(400, IMAGE_REFUSAL)
        throw e
      }
      const reply = shape(r.text)
      emit(r.text, true) // flush what the last poll missed (and the whole reply for Gemini)

      // Store the pair (input as the caller wrote it, not the augmented prompt). Fire and forget: it never delays the reply.
      if (cacheInput && reply) {
        cacheService.record({ keyId: cache.keyId, userId: cache.userId, modelId: cache.modelId, input: cacheInput, output: reply })
          .catch(e => console.error('[cache] store failed', e))
      }

      // prompt_tokens counts the caller's own messages only, NOT the injected rules (see callerInputOf).
      const p = estimateTokens(callerInputOf(messages))
      const c = estimateTokens(reply)
      return { text: reply, usage: { prompt_tokens: p, completion_tokens: c, total_tokens: p + c } }
    } finally { pending-- }
  }
}
