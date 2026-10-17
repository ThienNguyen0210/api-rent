# `src/ai/` — AI browser models

Each model is a **web chat page** (chatgpt.com, gemini.google.com, ...) driven by Playwright. A request to
`POST /v1/<id>/chat/completions` opens a fresh chat in a browser tab, types the prompt, waits for the reply, and returns it in
OpenAI format. No vendor API keys are used; the signed-in Chrome profile is the credential.

This file is the instruction sheet for adding a new model (= a new webpage). Follow it literally.

## Layout

```
src/ai/
├── index.js                  PROVIDERS list. The only registry. Builds the /v1 router, closes browsers on shutdown.
├── core/                     Shared. Do NOT put model-specific code here, and do not edit it just to add a model.
│   ├── router.js             POST /chat/completions: auth, key rules, billing, usage, streaming, OpenAI error shape.
│   ├── completion.js         createCompleter(getClient): prompt flattening, image refusal, cache, queue limit, token estimate.
│   ├── imageRules.js         Image-generation refusal rules.
│   ├── tabpool.cjs           Tab pool (N chats at once, FIFO) + "lean page" mode + Chrome launch args.
│   └── paths.cjs             DATA_DIR = <project root>/data (Chrome profiles, debug screenshots).
└── providers/
    ├── chatgpt/              ← one folder per model
    │   ├── browser.cjs       Page-specific code: selectors, login check, how to type/send/read. (CommonJS)
    │   ├── service.js        Wires browser.cjs into createCompleter. ~14 lines. (ESM)
    │   └── index.js          Provider descriptor. ~4 lines. (ESM)
    └── gemini/               same three files
```

Module systems matter: `browser.cjs` is **CommonJS** (it also runs standalone from the CLI); everything else is **ESM**.
`service.js` loads the `.cjs` file through `createRequire`.

## How to add a model (checklist)

Use `<id>` for a short lowercase slug (e.g. `claude`, `grok`). It becomes the URL segment `/v1/<id>` and the folder name.
Let `<ID>` be the same in UPPERCASE for env vars (`CLAUDE`, `GROK`).

1. **Copy the closest provider.** `cp -r src/ai/providers/gemini src/ai/providers/<id>` (use `chatgpt` if the page streams its
   reply token by token; `gemini` if it is simpler). Delete nothing; edit in place.

2. **Edit `providers/<id>/browser.cjs`** — this is where all the work is. Replace everything Gemini/ChatGPT-specific:
   - Rename env vars `GEMINI_*` → `<ID>_*`, the default URL, the profile folder (`<id>-profile`), the debug screenshot name
     (`<id>-debug.png`), log prefix, error messages, and the CLI usage text (`node src/ai/providers/<id>/browser.cjs ...`).
   - Update the selector lists for the new page (inspect it in a real browser):
     - `PROMPT_SELECTORS` – the input box (may be a `<textarea>` or a contenteditable div).
     - `RESPONSE_SELECTORS` – the newest assistant message (the **last** match is the current reply).
     - `SEND_SELECTORS` – send button (falls back to pressing Enter).
     - `STOP_SELECTORS` – "Stop generating" button; while it is visible the reply is still being written.
     - `IMAGE_SELECTORS` – elements that only appear when an image is being generated (the request is aborted if one appears).
     - `HIDE_SELECTORS` – sidebar/history element hidden in lean mode.
   - Update `checkUrl()` so it recognises this site's login page and challenge/captcha pages and throws
     `BrowserError(..., 'not_logged_in')` / `'challenge'`.
   - Adjust `fillPrompt()` if the input box needs a different way of receiving text (paste event vs `fill()` vs typing).
   - Keep the public contract unchanged (below).

3. **Edit `providers/<id>/service.js`** — set the comment, `DEFAULT_MODEL`, and the require path stays `./browser.cjs`:
   ```js
   import { createRequire } from 'node:module'
   import { createCompleter } from '../../core/completion.js'
   const require = createRequire(import.meta.url)
   export const DEFAULT_MODEL = '<Public Model Name>'
   let client = null
   const getClient = () => (client ??= require('./browser.cjs').createBrowserClient())
   export const complete = createCompleter(getClient)
   export const closeBrowser = () => client?.close()
   ```

4. **Edit `providers/<id>/index.js`:**
   ```js
   import { complete, closeBrowser, DEFAULT_MODEL } from './service.js'
   export default { id: '<id>', modelKey: '<id>', defaultModel: DEFAULT_MODEL, complete, close: closeBrowser }
   ```

5. **Register it in `src/ai/index.js`** (two lines):
   ```js
   import <id> from './providers/<id>/index.js'
   export const PROVIDERS = [chatgpt, gemini, <id>]
   ```
   Mounting at `/v1/<id>` and shutdown cleanup happen automatically from this list. Do not touch `server.js`.

6. **Add the model to `src/data/models.json`** with `"key": "<id>"` (must equal `modelKey`). Copy an existing entry. Fields:
   `key` (never changes), `modelId` (DB identity, never changes), `name` (public name; clients must send exactly this as `model`),
   `description {en, vi}`, `image`, `provider`, `category` (`chat|vision|code`),
   `capabilities` (`text|reasoning|vision|multimodal|code|fast|streaming`), `contextTokens`, `pricing {inputPer1k, outputPer1k}`,
   `status` (`active|maintenance|disabled`). The file is re-read when it changes; no restart is needed for edits.
   If `key` is missing from this file, requests fail with `Unknown model key`.

7. **Sign in once and test from the CLI** (from the project root; needs `npm install playwright`):
   ```
   node src/ai/providers/<id>/browser.cjs --login          # visible window: sign in, then close it
   node src/ai/providers/<id>/browser.cjs --ask "say hi"   # must print a reply; if not, fix the selectors
   ```
   Then test the API: `POST /v1/<id>/chat/completions` with `Authorization: Bearer NXR_...` and body
   `{"model":"<Public Model Name>","messages":[{"role":"user","content":"hi"}]}`.

## Contract `browser.cjs` must keep

```js
module.exports = { createBrowserClient, optionsFromEnv, BrowserError, PROMPT_SELECTORS, RESPONSE_SELECTORS }

createBrowserClient(opts = optionsFromEnv()) -> {
  ask(text, { timeoutMs, accept, onUpdate? }) -> Promise<{ text, blocks }>
  close() -> Promise<void>
  options, stats()
}
```
- `ask` opens a **new chat** for every call, sends `text`, and resolves with the final reply. `text` = reply as displayed,
  `blocks` = text of each code block in it.
- `onUpdate(replySoFar)` is optional: call it while the reply streams (see chatgpt). If a page cannot stream, ignore it;
  `completion.js` still delivers the whole reply at the end.
- Failures throw `BrowserError(message, code, retryable)`. Codes the core relies on: `image_blocked` (page started generating an
  image → request becomes a 400); others (`not_logged_in`, `challenge`, `no_prompt_box`, `timeout`, `browser_closed`, ...) are
  reported as errors.
- Use `createTabPool`, `applyLean`, `leanFromEnv`, `launchArgs`, `launchExtras`, `maskHeadless`, `tabsFromEnv` from
  `../../core/tabpool.cjs` and `DATA_DIR` from `../../core/paths.cjs`; keep the concurrency/idle-close behaviour.

## Rules

- A new model touches **only**: its own `providers/<id>/` folder, `src/ai/index.js` (import + list), `src/data/models.json`.
- Don't edit `core/` for one model's quirks. If something is genuinely shared, change it in `core/` and check that both existing
  providers still work.
- Keep per-model env vars prefixed `<ID>_` (`<ID>_WEB_URL`, `_PROFILE_DIR`, `_HEADLESS`, `_CDP_URL`, `_CHROME_CHANNEL`,
  `_BROWSER_TABS`, `_IDLE_CLOSE_MS`, `_LEAN`, `_PROMPT_SELECTOR`, `_RESPONSE_SELECTOR`, `_IMAGE_SELECTOR`, ...), so that an
  operator can override selectors without a code change when the site changes its markup.
- Each model has its own Chrome profile (`data/<id>-profile`) and its own queue limit, so one busy model never blocks another.
- Never commit `data/` (it holds signed-in sessions).
- Image generation must stay refused (core handles the prompt side; your `IMAGE_SELECTORS` handle the page side).
