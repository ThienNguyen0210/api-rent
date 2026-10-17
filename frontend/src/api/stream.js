// Reads a streamed chat reply (OpenAI-style server-sent events) and passes each piece of text to onDelta as it arrives.
// Resolves with the full reply. Rejects with an Error whose message is safe to show to the user.
export async function streamChat({ url, body, headers = {}, signal, onDelta }) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Requested-With': 'XMLHttpRequest', // required by the server's CSRF guard for cookie sessions
      ...headers,
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  if (!res.ok) throw new Error(await readError(res))
  if (!res.body) throw new Error('Streaming is not supported by this browser.')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  // Returns true when the server has sent [DONE].
  const handleLine = line => {
    if (!line.startsWith('data:')) return false
    const data = line.slice(5).trim()
    if (data === '[DONE]') return true
    let json
    try { json = JSON.parse(data) } catch { return false }
    if (json.error) throw new Error(json.error.message || 'The reply failed.')
    const piece = json.choices?.[0]?.delta?.content
    if (piece) {
      full += piece
      onDelta?.(piece)
    }
    return false
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, '')
      buffer = buffer.slice(nl + 1)
      if (handleLine(line)) {
        await reader.cancel().catch(() => {})
        return full
      }
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) handleLine(buffer.trim())
  return full
}

async function readError(res) {
  try {
    const body = await res.json()
    return body?.error?.message || `Request failed (${res.status})`
  } catch {
    return `Request failed (${res.status})`
  }
}
