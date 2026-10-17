'use strict';
/**
 * Browser transport for gemini.js's GEMINI_TRANSPORT=chatgpt: drives the real chatgpt.com web app (Playwright, in Node) the
 * way a person would, the same approach as geminibrowser.js but pointed at ChatGPT and shaped for many callers sharing a
 * small pool of tabs, with the specific rules asked for:
 *   - up to CHATGPT_TABS (default 10; 0/"unlimited" = no limit) requests run at once, one tab each; further concurrent requests
 *     queue and are given the next tab to become free, in the order it arrived (the pool lives in tabpool.cjs, shared with
 *     gemini/browser.cjs). With no limit every request opens its own tab at once and nothing queues.
 *   - lean mode (on by default at level 1; CHATGPT_LEAN=2 is the maximum level, 0 turns it off): images/media/fonts/telemetry
 *     are not downloaded, animations are collapsed, the sidebar is hidden, Chrome starts without extensions - so many parallel
 *     tabs stay light. Level 2 also blocks stylesheets, strips paint effects and disables the GPU. See tabpool.cjs.
 *   - image generation is refused: if a reply starts producing an image, Stop is pressed and ask() fails with code 'image_blocked'.
 *   - a tab that finishes and sits unused for CHATGPT_IDLE_CLOSE_MS (default 60000 = 60s) has its page closed to free the
 *     memory; the slot itself is kept, so the next request to land on it just opens a fresh tab.
 *   - a tab that has carried CHATGPT_MAX_PROMPTS_PER_TAB (default 40) prompts is reloaded (like pressing F5) before the
 *     next request uses it (ChatGPT's own page slows down the longer one tab stays open; this is applied to every tab in
 *     the pool, not only the first one, since all tabs are equivalent workers here - see the module notes in the project
 *     chat if a single designated "main" tab was meant instead). A reload clears its accumulated state without the cost
 *     of tearing the tab down and recreating it; only a tab that fails to come back from the reload is closed and
 *     replaced with a fresh one.
 *   - ask() can stream: pass onUpdate(text) and it is called with the reply-so-far roughly every CHATGPT_POLL_MS (default
 *     100ms = the "every 0.1s" update rate), not just once at the end.
 *
 * Sign-in works exactly like geminibrowser.js: CHATGPT_PROFILE_DIR (own persistent Chrome profile, sign in once with
 * `node src/ai/providers/chatgpt/browser.cjs --login`) or CHATGPT_CDP_URL (attach to a Chrome you started and signed into yourself).
 *
 * Environment (all optional):
 *   CHATGPT_WEB_URL            default https://chatgpt.com/. Opened before every request - that is what starts a fresh chat
 *                               (a fresh chat per request also keeps one user's conversation from bleeding into another's).
 *   CHATGPT_PROFILE_DIR        default "<this folder>/data/chatgpt-profile".
 *   CHATGPT_HEADLESS            default ON: no window at all (saves the compositor/GPU/UI memory). "0" shows the window. The profile
 *                               must already be signed in: run `--login` once (it always opens a visible window).
 *   CHATGPT_RENDERERS / CHATGPT_JS_HEAP_MB / CHATGPT_NO_SANDBOX   optional extra RAM savers, see tabpool.cjs.
 *   CHATGPT_CDP_URL             attach to a running Chrome instead of starting one.
 *   CHATGPT_CHROME_CHANNEL      default "chrome" (the installed Chrome). Empty = Playwright's bundled Chromium.
 *   CHATGPT_TABS                default 10. Chats that can run at the same time (one tab each); more callers queue.
 *                               0, "unlimited", "inf" or "max" = no limit (one new tab per concurrent request, nothing queues).
 *   CHATGPT_LEAN                default 1 = basic lean (no images/media/fonts/telemetry, no animations, hidden sidebar). "0" = off.
 *                               "2" = max: also blocks stylesheets, strips paint effects, shrinks the viewport, disables GPU (opt-in).
 *   CHATGPT_VIEWPORT            level 2 only, "WIDTHxHEIGHT", default 1100x700.
 *   CHATGPT_HIDE_SELECTOR       extra CSS selector(s) hidden in lean mode (the built-in ones cover the sidebar).
 *   CHATGPT_IMAGE_SELECTOR      CSS selector(s) that mean "an image is being generated", tried in addition to the built-in ones.
 *   CHATGPT_OPEN_STAGGER_MS     default 150. Minimum gap between opening two new tabs.
 *   CHATGPT_IDLE_CLOSE_MS       default 60000. A free tab unused for this long has its page closed.
 *   CHATGPT_MAX_PROMPTS_PER_TAB default 40. A tab is reloaded (like F5) after this many prompts went through it.
 *   CHATGPT_POLL_MS             default 100. How often the reply is re-read while streaming (and how often onUpdate fires).
 *   CHATGPT_PROMPT_SELECTOR / CHATGPT_RESPONSE_SELECTOR  one CSS selector tried before the built-in ones, for when OpenAI
 *                               changes the page and the built-in ones stop matching.
 *
 * Command line:
 *   node src/ai/providers/chatgpt/browser.cjs --login          open the browser so you can sign in, close the window when done
 *   node src/ai/providers/chatgpt/browser.cjs --ask "text"     send one prompt and print the reply (a quick check that the selectors still work)
 *
 * Playwright itself is not bundled: `npm install playwright` (or playwright-core with CHATGPT_CHROME_CHANNEL=chrome).
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../../core/paths.cjs');
const { createTabPool, maskHeadless, tabsFromEnv, applyLean, leanFromEnv, launchArgs, launchExtras } = require('../../core/tabpool.cjs');

const DEFAULT_URL = 'https://chatgpt.com/';
const STABLE_POLLS_ACCEPTED = 2;    // reply unchanged this many polls AND accepted by the caller (a complete JSON answer) -> done
const STABLE_POLLS_UNACCEPTED = 20; // reply unchanged this many polls but not accepted (refusal, error text) -> hand it back anyway
const PROMPT_WAIT_MS = 20000;
const DEFAULT_TABS = 10;
const DEFAULT_IDLE_CLOSE_MS = 60000;
const DEFAULT_MAX_PROMPTS_PER_TAB = 40;
const DEFAULT_POLL_MS = 100;
const DEFAULT_OPEN_STAGGER_MS = 150; // new tabs are opened this far apart, so a burst of first requests does not load N heavy pages at once
const MAX_POLL_MS = 500;             // under load the 100ms poll is stretched (see pollDelay in createBrowserClient), never beyond this
const MAX_POLL_MS_UNLIMITED = 1500; // same, when the pool has no tab limit and dozens of tabs can be polling at once

// ChatGPT's prompt box is a contenteditable ProseMirror element (id="prompt-textarea"); older/alternate builds used a plain
// <textarea> with the same id, so both are covered. OpenAI also ships a "mobile composer" markup - a real
// <textarea id="mobile-composer-prompt"> with a <label for="mobile-composer-prompt"> sitting on top as the actual hit
// area - which can be what's on the page even at desktop sizes. The label is matched here too (see findPromptBox,
// which redirects a matched <label> to its `for` target) so we don't fall through to the generic contenteditable
// selector and grab an unrelated element. Tried in order.
const PROMPT_SELECTORS = [
  '#prompt-textarea[contenteditable="true"]',
  'textarea#prompt-textarea',
  'div[contenteditable="true"]#prompt-textarea',
  '#mobile-composer-prompt',
  'textarea#mobile-composer-prompt',
  'label[for="mobile-composer-prompt"]',
  '[data-mobile-composer-prompt-hit-area]',
  'form [contenteditable="true"]',
  '[contenteditable="true"]',
];
// The newest match on the page is the newest reply. ChatGPT's current frontend uses hashed/atomic CSS class names
// (no literal "markdown" class exists any more), so the class-based selector below can silently never match; the
// data-assistant-stream-block attribute is what actually marks a message's content blocks on the page today and is
// tried first. The rest are kept as fallbacks for older/alternate builds. Tried in order.
const RESPONSE_SELECTORS = [
  '[data-assistant-markdown]', // current markup: <div data-assistant-markdown> holds the reply text (the placeholder-slot span next to it is hidden)
  '[data-assistant-stream-block]',
  'div[data-message-author-role="assistant"] .markdown',
  'article[data-testid^="conversation-turn-"] div[data-message-author-role="assistant"]',
  'div[data-message-author-role="assistant"]',
];
// The composer's current markup is ONE button that is the send button while idle (aria-label "Send message") and turns into the
// stop button while generating (aria-label "Stop generating"), so matching on the label keeps the two states apart.
const SEND_SELECTORS = ['button[data-composer-submit][aria-label*="Send" i]', 'button[data-testid="send-button"]', 'button[aria-label="Send prompt"]', 'button[aria-label*="Send" i]'];
const STOP_SELECTORS = ['button[data-testid="stop-button"]', 'button[data-composer-submit][aria-label*="Stop" i]', 'button[aria-label*="Stop" i]', 'button[aria-label*="streaming" i]'];
// Elements that only exist when ChatGPT is producing an image. Best effort: they follow OpenAI's markup (override with CHATGPT_IMAGE_SELECTOR).
// Every request runs in a fresh chat, so a match anywhere on the page belongs to this reply.
const IMAGE_SELECTORS = ['img[alt*="Generated image" i]', 'img[src*="oaiusercontent"]', 'img[src*="/backend-api/estuary/"]'];
// Sidebar / chat-history list: hidden (display:none) in lean mode. Override or extend with CHATGPT_HIDE_SELECTOR.
const HIDE_SELECTORS = ['#stage-slideover-sidebar', 'nav[aria-label*="history" i]'];

class BrowserError extends Error {
  constructor(message, code, retryable = false) {
    super(message);
    this.name = 'BrowserError';
    this.code = code;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isMac = process.platform === 'darwin';

function optionsFromEnv(env = process.env) {
  const one = (v) => (v && String(v).trim() ? [String(v).trim()] : []);
  const int = (v, d, min, max) => {
    const n = Number(String(v == null ? '' : v).trim());
    return Number.isFinite(n) && n >= min ? Math.min(max == null ? n : max, n) : d;
  };
  return {
    url: env.CHATGPT_WEB_URL || DEFAULT_URL,
    profileDir: env.CHATGPT_PROFILE_DIR ? path.resolve(env.CHATGPT_PROFILE_DIR) : path.join(DATA_DIR, 'chatgpt-profile'),
    headless: !/^(?:0|false|no|off)$/i.test(String(env.CHATGPT_HEADLESS || '').trim()), // default: hidden
    cdpUrl: String(env.CHATGPT_CDP_URL || '').trim(),
    channel: env.CHATGPT_CHROME_CHANNEL == null ? 'chrome' : String(env.CHATGPT_CHROME_CHANNEL).trim(),
    tabs: tabsFromEnv(env.CHATGPT_TABS, DEFAULT_TABS), // Infinity = unlimited
    idleCloseMs: int(env.CHATGPT_IDLE_CLOSE_MS, DEFAULT_IDLE_CLOSE_MS, 0),
    maxPromptsPerTab: int(env.CHATGPT_MAX_PROMPTS_PER_TAB, DEFAULT_MAX_PROMPTS_PER_TAB, 1),
    pollMs: int(env.CHATGPT_POLL_MS, DEFAULT_POLL_MS, 30),
    openStaggerMs: int(env.CHATGPT_OPEN_STAGGER_MS, DEFAULT_OPEN_STAGGER_MS, 0),
    lean: leanFromEnv('CHATGPT', env, { hide: HIDE_SELECTORS }),
    imageSelectors: [...one(env.CHATGPT_IMAGE_SELECTOR), ...IMAGE_SELECTORS],
    promptSelectors: [...one(env.CHATGPT_PROMPT_SELECTOR), ...PROMPT_SELECTORS],
    responseSelectors: [...one(env.CHATGPT_RESPONSE_SELECTOR), ...RESPONSE_SELECTORS],
  };
}

let pw = null;
function loadPlaywright() {
  if (pw) return pw;
  for (const name of ['playwright', 'playwright-core']) {
    try { pw = require(name); return pw; } catch (e) { if (e && e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
  throw new BrowserError('Playwright is not installed. Run: npm install playwright', 'no_playwright');
}

/** OpenAI sends the tab somewhere else when the session is gone or it wants a check; neither can be fixed by retrying. */
function checkUrl(page, opts) {
  const u = page.url();
  if (/auth0\.openai\.com|auth\.openai\.com|\/auth\/login/i.test(u)) {
    throw new BrowserError(`The ChatGPT browser is not signed in (${opts.cdpUrl ? 'attached Chrome' : 'profile ' + opts.profileDir}). Sign in there first (node src/ai/providers/chatgpt/browser.cjs --login).`, 'not_logged_in');
  }
  if (/challenge|cloudflare|\/cdn-cgi\//i.test(u)) {
    throw new BrowserError(`OpenAI is showing a check page instead of ChatGPT (${u.slice(0, 120)}). Open the browser window and complete it.`, 'challenge');
  }
}

function createBrowserClient(opts = optionsFromEnv()) {
  let starting = null;
  let context = null;
  let browser = null;
  let ownsBrowser = true;
  // Up to opts.tabs chats run at once (one tab each); more callers wait FIFO; a tab unused for opts.idleCloseMs is closed.
  const pool = createTabPool({
    maxTabs: opts.tabs, idleCloseMs: opts.idleCloseMs, staggerMs: opts.openStaggerMs,
    openPage: (slot) => openPage(slot), log: (m) => console.log('[chatgpt-browser] ' + m),
  });
  // Poll every pollMs while few chats run; with many at once each poll costs the page main thread (innerText forces layout), so back off.
  const pollCap = Number.isFinite(opts.tabs) ? MAX_POLL_MS : MAX_POLL_MS_UNLIMITED;
  const pollDelay = () => Math.min(pollCap, opts.pollMs * Math.max(1, Math.ceil(pool.busyCount() / 3)));

  async function start() {
    const { chromium } = loadPlaywright();
    if (opts.cdpUrl) {
      browser = await chromium.connectOverCDP(opts.cdpUrl);
      context = browser.contexts()[0] || await browser.newContext();
      ownsBrowser = false;
    } else {
      fs.mkdirSync(opts.profileDir, { recursive: true });
      const launch = { headless: opts.headless, viewport: opts.lean.viewport || { width: 1280, height: 900 }, args: launchArgs(opts.lean), ...launchExtras(opts.lean) };
      try {
        context = await chromium.launchPersistentContext(opts.profileDir, opts.channel ? { ...launch, channel: opts.channel } : launch);
      } catch (first) {
        if (!opts.channel) throw first;
        context = await chromium.launchPersistentContext(opts.profileDir, launch); // installed Chrome missing: bundled Chromium
      }
    }
    context.on('close', () => { starting = null; context = null; pool.reset(new BrowserError('The ChatGPT browser was closed.', 'browser_closed', true)); });
  }
  const ensure = () => starting || (starting = start().catch((e) => {
    starting = null;
    if (e instanceof BrowserError) throw e;
    throw new BrowserError(`Could not start the ChatGPT browser: ${e && e.message ? String(e.message).split('\n')[0] : e}${opts.cdpUrl ? '' : ` (is another Chrome already using ${opts.profileDir}?)`}`, 'browser_start', true);
  }));

  /** Opens the tab for a slot (called by the pool, staggered). Lean-mode rules are attached before anything loads. */
  async function openPage() {
    // Always open our own tab. The blank tab Chrome starts with is still running its own startup navigation and
    // would interrupt our goto() ("interrupted by another navigation to about:blank"), so it is not reused.
    const page = await context.newPage();
    try { await applyLean(page, opts.lean); } catch (e) { await page.close().catch(() => {}); throw e; }
    if (opts.headless && !opts.cdpUrl) await maskHeadless(context, page);
    if (ownsBrowser) {
      for (const p of context.pages()) { // close the leftover startup tab(s) once a real tab exists
        if (p === page || p.isClosed() || pool.owns(p)) continue;
        if (/^(about:blank|chrome:\/\/newtab\/?)$/i.test(p.url())) p.close().catch(() => {});
      }
    }
    return page;
  }

  /** goto() that survives Chrome's own competing navigation (startup blank page, redirects): retried a few times. */
  async function gotoWithRetry(page, deadline) {
    for (let attempt = 0; ; attempt++) {
      try {
        await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: Math.max(5000, Math.min(60000, deadline - Date.now())) });
        return;
      } catch (e) {
        const interrupted = /interrupted by another navigation|ERR_ABORTED/i.test(String(e && e.message));
        if (!interrupted || attempt >= 3 || Date.now() > deadline) throw e;
        await sleep(600 * (attempt + 1));
      }
    }
  }

  /**
   * Send one prompt in a fresh chat and return the reply.
   * @param opt.timeoutMs  whole request, page load included
   * @param opt.accept     (reply) => boolean. Tells the wait loop the reply is complete (e.g. it holds a full JSON answer).
   * @param opt.onUpdate   (text) => void. Called with the reply text so far roughly every CHATGPT_POLL_MS, for streaming.
   * @returns { text, blocks }  text = the reply as shown; blocks = the text of each code block inside it
   */
  async function ask(text, { timeoutMs = 120000, accept = () => false, onUpdate } = {}) {
    await ensure();
    const slot = await pool.acquire();
    const deadline = Date.now() + timeoutMs;
    try {
      const page = await pool.page(slot);
      await gotoWithRetry(page, deadline);
      const box = await findPromptBox(page, opts, deadline);
      await fillPrompt(page, box, text);
      await sleep(300);
      await submit(page, opts, box);
      const result = await waitForReply(page, opts, deadline, accept, onUpdate, pollDelay);
      slot.promptCount += 1;
      if (slot.promptCount >= opts.maxPromptsPerTab) {
        console.log(`[chatgpt-browser] a tab reached ${slot.promptCount} prompts; reloading it before its next use`);
        // A plain reload (the same thing pressing F5 does) clears ChatGPT's own accumulated JS state just as
        // effectively as closing the tab, without paying the cost of tearing it down and spinning up a new one.
        // Only fall back to a genuinely fresh tab if the page itself won't come back from a reload.
        try { await slot.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); }
        catch {
          try { await slot.page.close(); } catch { /* already gone */ }
          slot.page = null;
        }
        slot.promptCount = 0;
      }
      return result;
    } catch (e) {
      // whatever went wrong, the next request starts on a clean tab
      await pool.discard(slot);
      throw e instanceof BrowserError ? e : new BrowserError(`Browser error: ${e && e.message ? String(e.message).split('\n')[0] : e}`, 'browser', true);
    } finally { pool.release(slot); }
  }

  /**
   * Tears the whole browser down. Skipped as a no-op while any slot is still busy (a request in flight on that
   * tab) - closing the browser mid-answer would cut the request off, so nothing is closed, not the browser and
   * not any other tab, until every request has finished. Returns true if it actually closed, false if it was
   * skipped because a request was still active (the caller can retry once that request is done).
   */
  async function close() {
    if (pool.anyBusy()) {
      console.log('[chatgpt-browser] close() skipped: a request is still active, leaving the browser and its tabs alone');
      return false;
    }
    starting = null;
    pool.reset(new BrowserError('The ChatGPT browser was closed.', 'browser_closed', true));
    const c = context; const b = browser;
    context = null; browser = null;
    try {
      if (ownsBrowser) { if (c) await c.close(); }
      else if (c) { for (const p of c.pages()) { void p; } if (b) await b.close(); } // close() on a CDP browser only disconnects
    } catch { /* already closed */ }
    return true;
  }

  return { ask, close, options: opts, stats: () => pool.stats() };
}

async function findPromptBox(page, opts, deadline) {
  const until = Math.min(deadline, Date.now() + PROMPT_WAIT_MS);
  while (Date.now() < until) {
    checkUrl(page, opts);
    for (const sel of opts.promptSelectors) {
      try {
        const loc = page.locator(sel).last();
        if (!(await loc.isVisible())) continue;
        // A matched element can be a <label for="..."> hit-area rather than the real input (this is how the
        // "mobile composer" markup exposes itself). Clicking/typing into the label directly does nothing, so
        // resolve it to its real target here and hand that back instead - everything downstream (fillPrompt,
        // the filled() check, etc.) then operates on the actual textarea/contenteditable.
        const forId = await loc.evaluate((el) => (el.tagName === 'LABEL' ? el.getAttribute('for') : null)).catch(() => null);
        if (forId) {
          const escaped = forId.replace(/([^a-zA-Z0-9_-])/g, '\\$1'); // CSS.escape() is a browser global, unavailable here
          const target = page.locator(`#${escaped}`).last();
          if (await target.isVisible().catch(() => false)) return target;
          continue; // label found but its target isn't visible/attached yet - keep waiting
        }
        return loc;
      } catch { /* selector not usable yet */ }
    }
    await sleep(400);
  }
  checkUrl(page, opts);
  // Say what the tab is actually showing: a screenshot (overwritten each time) plus URL, title and the first visible words.
  const shot = path.join(DATA_DIR, 'chatgpt-debug.png');
  const seen = await page.evaluate(() => ({ title: document.title, text: (document.body && document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 120) })).catch(() => ({ title: '', text: '' }));
  const saved = await page.screenshot({ path: shot, timeout: 5000 }).then(() => shot, () => 'not saved');
  throw new BrowserError(`Could not find the ChatGPT prompt box. The page layout may have changed (set CHATGPT_PROMPT_SELECTOR), or the page did not finish loading. Tab shows: url=${page.url().slice(0, 100)} title="${seen.title}" text="${seen.text}" screenshot=${saved}`, 'no_prompt_box', true);
}

const squash = (s) => String(s || '').replace(/\s+/g, '');

/**
 * Put `text` into the prompt box. Typing thousands of characters key by key is slow and turns every newline into a submit, so
 * the text is inserted in one go, trying progressively more manual techniques until one actually lands: a direct
 * value-set/execCommand('insertText') first (what ChatGPT's current composer actually reacts to), then a synthetic paste
 * event, then the browser's own insertText, and only as a last resort typed line by line with Shift+Enter. Each step is
 * checked against what the box now holds.
 */
async function fillPrompt(page, box, text) {
  // A real <textarea>/<input> (e.g. the mobile-composer markup) reports its content via .value, not innerText.
  const filled = async () => {
    const current = await box.evaluate((el) => (el.value != null ? el.value : el.innerText) || '').catch(() => '');
    return squash(current).length >= squash(text).length * 0.98;
  };
  await box.click();
  await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');

  // Primary path: set a real textarea/input's value directly, or use execCommand('insertText') on a
  // contenteditable ProseMirror box. This mirrors the approach confirmed to work against ChatGPT's current
  // composer (see gemini_bubble_tool.py) - a raw value assignment or a real editing command, rather than a
  // synthetic paste event, is what ChatGPT's own input handling actually reacts to.
  await box.evaluate((el, t) => {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // React tracks a controlled input's value through its own property setter; assigning el.value directly makes React
      // think nothing changed, so the send button stays disabled. The prototype's native setter bypasses that tracker.
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, t);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    const ok = document.execCommand('insertText', false, t);
    if (!ok) el.innerText = t;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: t }));
  }, text);
  if (await filled()) return;

  // Fallback: a synthetic paste event, for composers whose paste handler doesn't go through execCommand.
  await box.evaluate((el, t) => {
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
  if (await filled()) return;

  await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(text);
  if (await filled()) return;

  await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.insertText(lines[i]);
    if (i < lines.length - 1) await page.keyboard.press('Shift+Enter'); // one atomic combo: a bare Enter would submit
  }
  if (!(await filled())) throw new BrowserError('The prompt could not be entered into the ChatGPT prompt box.', 'input', true);
}

/** True once the prompt has left the box (sent) or ChatGPT already shows its stop button (generating). */
async function wasSent(page, box) {
  const generating = await page.evaluate((stop) => {
    const visible = (b) => !!b && (b.offsetParent !== null || getComputedStyle(b).display !== 'none');
    return stop.some((s) => { try { return visible(document.querySelector(s)); } catch { return false; } });
  }, STOP_SELECTORS).catch(() => false);
  if (generating) return true;
  // If the box itself is gone (the page moved on to the new chat) the prompt was sent, so a failed lookup counts as sent:
  // a false "not sent" would make the next strategy send it a second time.
  return box.evaluate((el) => !(((el.value != null ? el.value : el.innerText) || '').trim()), undefined, { timeout: 1000 }).catch(() => true);
}

async function sentWithin(page, box, ms) {
  const until = Date.now() + ms;
  do {
    if (await wasSent(page, box)) return true;
    await sleep(150);
  } while (Date.now() < until);
  return false;
}

/** The visible send button, waiting for it to appear and to become enabled (React enables it a moment after the text lands). */
async function findSendButton(page, timeoutMs = 6000) {
  const until = Date.now() + timeoutMs;
  let found = null;
  while (Date.now() < until) {
    for (const sel of SEND_SELECTORS) {
      try {
        const btn = page.locator(sel).last();
        if (!(await btn.isVisible())) continue;
        found = btn;
        const disabled = await btn.evaluate((el) => el.disabled || el.getAttribute('aria-disabled') === 'true').catch(() => false);
        if (!disabled) return btn;
      } catch { /* try the next one */ }
    }
    await sleep(150);
  }
  return found; // visible but still disabled (or null): the strategies below get one go at it anyway
}

/**
 * Sends the prompt. Each strategy is followed by a check that the prompt really left the box; only if it did not is the
 * next one tried: real click -> forced click -> DOM click() -> form.requestSubmit() -> Enter -> Ctrl/Cmd+Enter.
 */
async function submit(page, opts, box) {
  const btn = await findSendButton(page);
  const strategies = [];
  if (btn) {
    strategies.push(
      () => btn.click({ timeout: 3000 }),
      () => btn.click({ timeout: 3000, force: true }),
      () => btn.evaluate((el) => el.click()),
      () => btn.evaluate((el) => { const f = el.closest('form'); if (f) f.requestSubmit(); else el.click(); }),
    );
  }
  strategies.push(
    async () => { await box.focus(); await page.keyboard.press('Enter'); },
    async () => { await box.focus(); await page.keyboard.press(isMac ? 'Meta+Enter' : 'Control+Enter'); },
  );
  for (const run of strategies) {
    try { await run(); } catch { /* try the next one */ }
    if (await sentWithin(page, box, 1500)) return;
  }
  console.warn('[chatgpt-browser] the prompt may not have been sent: no submit strategy emptied the prompt box');
}

/** Stops ChatGPT's current generation (best effort) - used when it starts producing an image. */
async function stopGeneration(page) {
  for (const sel of STOP_SELECTORS) {
    try {
      const btn = page.locator(sel).last();
      if (await btn.isVisible()) { await btn.click({ timeout: 2000 }); return; }
    } catch { /* try the next one */ }
  }
}

/** Newest reply on the page, whether ChatGPT still shows a "stop" button (= still writing), and whether it is making an image. */
function snapshot(page, opts) {
  return page.evaluate(({ resp, stop, img }) => {
    const visible = (b) => !!b && (b.offsetParent !== null || getComputedStyle(b).display !== 'none');
    const busy = stop.some((s) => { try { return visible(document.querySelector(s)); } catch { return false; } });
    const image = img.some((s) => { try { return !!document.querySelector(s); } catch { return false; } });
    let el = null;
    for (const s of resp) {
      let all; try { all = document.querySelectorAll(s); } catch { continue; }
      if (all.length) { el = all[all.length - 1]; break; }
    }
    if (!el) return { text: '', blocks: [], busy, image };
    return { text: (el.innerText || '').trim(), blocks: [...el.querySelectorAll('pre')].map((p) => (p.innerText || '').trim()), busy, image };
  }, { resp: opts.responseSelectors, stop: STOP_SELECTORS, img: opts.imageSelectors });
}

async function waitForReply(page, opts, deadline, accept, onUpdate, pollDelay = () => opts.pollMs) {
  await sleep(300); // a new reply bubble needs a moment to appear
  let prev = null; let stable = 0; let last = null;
  while (Date.now() < deadline) {
    checkUrl(page, opts);
    let snap;
    try { snap = await snapshot(page, opts); } catch (e) { if (page.isClosed()) throw e; snap = null; }
    if (snap && snap.image) { // image generation is not allowed: stop it, fail the request (the tab is discarded by ask())
      await stopGeneration(page);
      throw new BrowserError('Image generation is not allowed.', 'image_blocked', false);
    }
    if (!snap || !snap.text) { prev = null; stable = 0; await sleep(pollDelay()); continue; }
    last = snap;
    if (onUpdate) { try { onUpdate(snap.text); } catch { /* a bad listener must not break the request */ } }
    if (snap.text === prev && !snap.busy) stable++; else stable = 0;
    prev = snap.text;
    if (stable >= STABLE_POLLS_UNACCEPTED || (stable >= STABLE_POLLS_ACCEPTED && accept(snap))) return { text: snap.text, blocks: snap.blocks };
    await sleep(pollDelay());
  }
  if (last && accept(last)) return { text: last.text, blocks: last.blocks }; // deadline hit right after a complete answer
  throw new BrowserError('ChatGPT did not finish answering within the time limit.', 'timeout', true);
}

// ---- command line ------------------------------------------------------------------------------------------------------
async function cli(argv) {
  const opts = optionsFromEnv();
  if (argv[0] === '--login') {
    if (opts.cdpUrl) { console.log('CHATGPT_CDP_URL is set: sign in inside the Chrome you started with --remote-debugging-port. Nothing to do here.'); return; }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(opts.profileDir, { recursive: true });
    const launch = { headless: false, viewport: null };
    let ctx;
    try { ctx = await chromium.launchPersistentContext(opts.profileDir, opts.channel ? { ...launch, channel: opts.channel } : launch); }
    catch { ctx = await chromium.launchPersistentContext(opts.profileDir, launch); }
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(opts.url).catch(() => {});
    console.log(`Sign in to OpenAI in the window that opened (profile: ${opts.profileDir}). Close the window when you are done.`);
    await new Promise((r) => ctx.on('close', r));
    return;
  }
  if (argv[0] === '--ask' && argv[1]) {
    const client = createBrowserClient(opts);
    try {
      const r = await client.ask(argv.slice(1).join(' '), { accept: () => true, onUpdate: (t) => process.stdout.write('\r' + t.slice(-80).replace(/\n/g, ' ')) });
      console.log('\n' + r.text);
    } finally { await client.close(); }
    return;
  }
  console.log('Usage: node src/ai/providers/chatgpt/browser.cjs --login | --ask "your prompt"');
}

if (require.main === module) {
  cli(process.argv.slice(2)).then(() => process.exit(0), (e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
}

module.exports = { createBrowserClient, optionsFromEnv, BrowserError, PROMPT_SELECTORS, RESPONSE_SELECTORS };
