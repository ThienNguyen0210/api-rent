'use strict';
/**
 * Browser transport for gemini.js: instead of calling the Gemini API with a key, this drives the real gemini.google.com web
 * app (Playwright, running inside Node) the way a person would: open a NEW chat, put the prompt into the prompt box, send it,
 * wait until the streamed reply stops changing, read it back.
 *
 * gemini.js decides WHAT is sent and how the reply is turned into JSON; this file only moves text in and out of the page.
 *
 * Two ways to get a signed-in Chrome:
 *   1. Own profile (default). Playwright starts Chrome with a persistent profile folder (GEMINI_PROFILE_DIR). Sign in to Google
 *      once with `node src/ai/providers/gemini/browser.cjs --login`; the session stays in that folder. Google may refuse a sign-in inside an
 *      automated browser; if it does, use way 2.
 *   2. Attach (GEMINI_CDP_URL=http://127.0.0.1:9222). You start Chrome yourself, sign in normally, and Playwright attaches to it:
 *        chrome --remote-debugging-port=9222 --user-data-dir=/some/profile        (then open gemini.google.com and sign in)
 *      Attached Chrome is never closed by this code; only the tabs it opened are.
 *
 * Environment (all optional):
 *   GEMINI_WEB_URL         default https://gemini.google.com/app. Opened before every request (that is what starts a fresh chat).
 *   GEMINI_PROFILE_DIR     default "<this folder>/data/gemini-profile".
 *   GEMINI_HEADLESS        default ON: no window at all (saves the compositor/GPU/UI memory). "0" shows the window. The profile must
 *                          already be signed in: run `--login` once (it always opens a visible window). Google may refuse sign-in in
 *                          an automated browser; then use GEMINI_CDP_URL.
 *   GEMINI_RENDERERS / GEMINI_JS_HEAP_MB / GEMINI_NO_SANDBOX   optional extra RAM savers, see tabpool.cjs.
 *   GEMINI_CDP_URL         attach to a running Chrome instead of starting one.
 *   GEMINI_CHROME_CHANNEL  default "chrome" (the installed Chrome). Empty = Playwright's bundled Chromium.
 *   GEMINI_BROWSER_TABS    default 10. Chats that can run at the same time (one tab each); more callers queue, FIFO.
 *                          0, "unlimited", "inf" or "max" = no limit (one new tab per concurrent request, nothing queues).
 *   GEMINI_IDLE_CLOSE_MS   default 60000. A free tab unused for this long is closed (0 = never); the next request opens a fresh one.
 *   GEMINI_LEAN            default 1 = basic lean (no images/media/fonts/telemetry, no animations, hidden sidebar). "0" = off.
 *                          "2" = max: also blocks stylesheets, strips paint effects, shrinks the viewport, disables GPU (opt-in; see tabpool.cjs).
 *   GEMINI_VIEWPORT        level 2 only, "WIDTHxHEIGHT", default 1100x700.
 *   GEMINI_HIDE_SELECTOR   extra CSS selector(s) hidden in lean mode.
 *   GEMINI_IMAGE_SELECTOR  CSS selector(s) that mean "an image is being generated"; on a match Stop is pressed and ask() fails with 'image_blocked'.
 *   GEMINI_OPEN_STAGGER_MS default 150. Minimum gap between opening two new tabs.
 *   GEMINI_PROMPT_SELECTOR / GEMINI_RESPONSE_SELECTOR  one CSS selector tried before the built-in ones, for when Google changes
 *                          the page and the built-in ones stop matching.
 *
 * Command line:
 *   node src/ai/providers/gemini/browser.cjs --login          open the browser so you can sign in, close the window when done
 *   node src/ai/providers/gemini/browser.cjs --ask "text"     send one prompt and print the reply (a quick check that the selectors still work)
 *
 * Playwright itself is not bundled: `npm install playwright` (or playwright-core with GEMINI_CHROME_CHANNEL=chrome).
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../../core/paths.cjs');
const { createTabPool, maskHeadless, tabsFromEnv, applyLean, leanFromEnv, launchArgs, launchExtras } = require('../../core/tabpool.cjs');

const DEFAULT_URL = 'https://gemini.google.com/app';
const POLL_MS = 700;
const STABLE_POLLS_ACCEPTED = 2;   // reply unchanged this many polls AND accepted by the caller (a complete JSON answer) -> done
const STABLE_POLLS_UNACCEPTED = 12; // reply unchanged this many polls but not accepted (refusal, error text) -> hand it back anyway
const PROMPT_WAIT_MS = 20000;
const DEFAULT_TABS = 10;
const DEFAULT_IDLE_CLOSE_MS = 60000;
const DEFAULT_OPEN_STAGGER_MS = 150;

// Gemini's prompt box is a contenteditable rich-text element, not a <textarea>. Tried in order.
const PROMPT_SELECTORS = [
  'div.ql-editor[contenteditable="true"]',
  'rich-textarea div[contenteditable="true"]',
  '[aria-label*="Enter a prompt" i]',
  '[contenteditable="true"]',
];
// The newest match on the page is the newest reply. Tried in order.
const RESPONSE_SELECTORS = ['message-content .markdown', 'model-response .markdown', '[data-response-index]', 'model-response'];
const SEND_SELECTORS = ['button[aria-label*="Send message" i]', 'button.send-button', 'button[aria-label="Send" i]'];
const STOP_SELECTORS = ['button[aria-label*="Stop" i]', 'button.stop'];
// Elements that only exist when Gemini is producing an image. Best effort: they follow Google's markup (override with GEMINI_IMAGE_SELECTOR).
// Every request runs in a fresh chat, so a match anywhere on the page belongs to this reply.
const IMAGE_SELECTORS = ['generated-image', 'single-image', 'model-response img[alt*="generated" i]'];
// Sidebar / chat-history list: hidden (display:none) in lean mode. Override or extend with GEMINI_HIDE_SELECTOR.
const HIDE_SELECTORS = ['bard-sidenav'];

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
  const ms = (v, d) => (/^\d+$/.test(String(v == null ? '' : v).trim()) ? Number(v) : d);
  return {
    url: env.GEMINI_WEB_URL || DEFAULT_URL,
    profileDir: env.GEMINI_PROFILE_DIR ? path.resolve(env.GEMINI_PROFILE_DIR) : path.join(DATA_DIR, 'gemini-profile'),
    headless: !/^(?:0|false|no|off)$/i.test(String(env.GEMINI_HEADLESS || '').trim()), // default: hidden
    cdpUrl: String(env.GEMINI_CDP_URL || '').trim(),
    channel: env.GEMINI_CHROME_CHANNEL == null ? 'chrome' : String(env.GEMINI_CHROME_CHANNEL).trim(),
    tabs: tabsFromEnv(env.GEMINI_BROWSER_TABS, DEFAULT_TABS), // Infinity = unlimited
    idleCloseMs: ms(env.GEMINI_IDLE_CLOSE_MS, DEFAULT_IDLE_CLOSE_MS), // 0 = never close idle tabs
    openStaggerMs: ms(env.GEMINI_OPEN_STAGGER_MS, DEFAULT_OPEN_STAGGER_MS),
    lean: leanFromEnv('GEMINI', env, { hide: HIDE_SELECTORS }),
    imageSelectors: [...one(env.GEMINI_IMAGE_SELECTOR), ...IMAGE_SELECTORS],
    promptSelectors: [...one(env.GEMINI_PROMPT_SELECTOR), ...PROMPT_SELECTORS],
    responseSelectors: [...one(env.GEMINI_RESPONSE_SELECTOR), ...RESPONSE_SELECTORS],
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

/** Google sends the tab somewhere else when the session is gone or it wants a check; neither can be fixed by retrying. */
function checkUrl(page, opts) {
  const u = page.url();
  if (/accounts\.google\.com/i.test(u)) {
    throw new BrowserError(`The Gemini browser is not signed in to Google (${opts.cdpUrl ? 'attached Chrome' : 'profile ' + opts.profileDir}). Sign in there first (node src/ai/providers/gemini/browser.cjs --login).`, 'not_logged_in');
  }
  if (/google\.com\/sorry|consent\.google\.com/i.test(u)) {
    throw new BrowserError(`Google is showing a check page instead of Gemini (${u.slice(0, 120)}). Open the browser window and complete it.`, 'challenge');
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
    openPage: (slot) => openPage(slot), log: (m) => console.log('[gemini-browser] ' + m),
  });

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
    context.on('close', () => { starting = null; context = null; pool.reset(new BrowserError('The Gemini browser was closed.', 'browser_closed', true)); });
  }
  const ensure = () => starting || (starting = start().catch((e) => {
    starting = null;
    if (e instanceof BrowserError) throw e;
    throw new BrowserError(`Could not start the Gemini browser: ${e && e.message ? String(e.message).split('\n')[0] : e}${opts.cdpUrl ? '' : ` (is another Chrome already using ${opts.profileDir}?)`}`, 'browser_start', true);
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
   * @param opt.accept     (reply) => boolean. Tells the wait loop that the reply is complete (e.g. it holds a full JSON answer).
   * @param opt.onUpdate   (text) => void. Called with the reply so far whenever it changes (streaming).
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
      await submit(page, opts);
      return await waitForReply(page, opts, deadline, accept, onUpdate);
    } catch (e) {
      // whatever went wrong, the next request starts on a clean tab
      await pool.discard(slot);
      throw e instanceof BrowserError ? e : new BrowserError(`Browser error: ${e && e.message ? String(e.message).split('\n')[0] : e}`, 'browser', true);
    } finally { pool.release(slot); }
  }

  async function close() {
    starting = null;
    pool.reset(new BrowserError('The Gemini browser was closed.', 'browser_closed', true));
    const c = context; const b = browser;
    context = null; browser = null;
    try {
      if (ownsBrowser) { if (c) await c.close(); }
      else if (c) { for (const p of c.pages()) { /* tabs opened by us are closed in ask(); the user's own tabs stay */ void p; } if (b) await b.close(); } // close() on a CDP browser only disconnects
    } catch { /* already closed */ }
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
        if (await loc.isVisible()) return loc;
      } catch { /* selector not usable yet */ }
    }
    await sleep(400);
  }
  checkUrl(page, opts);
  // Say what the tab is actually showing: a screenshot (overwritten each time) plus URL, title and the first visible words.
  const shot = path.join(DATA_DIR, 'gemini-debug.png');
  const seen = await page.evaluate(() => ({ title: document.title, text: (document.body && document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 120) })).catch(() => ({ title: '', text: '' }));
  const saved = await page.screenshot({ path: shot, timeout: 5000 }).then(() => shot, () => 'not saved');
  throw new BrowserError(`Could not find the Gemini prompt box. The page layout may have changed (set GEMINI_PROMPT_SELECTOR), or the page did not finish loading. Tab shows: url=${page.url().slice(0, 100)} title="${seen.title}" text="${seen.text}" screenshot=${saved}`, 'no_prompt_box', true);
}

const squash = (s) => String(s || '').replace(/\s+/g, '');

/**
 * Put `text` into the prompt box. Typing thousands of characters key by key is slow and turns every newline into a submit, so
 * the text is inserted in one go: a paste event first (what Gemini's editor understands), then the browser's insertText,
 * and only as a last resort typed line by line with Shift+Enter. Each step is checked against what the box now holds.
 */
async function fillPrompt(page, box, text) {
  const filled = async () => squash(await box.innerText().catch(() => '')).length >= squash(text).length * 0.98;
  await box.click();
  await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');

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
  if (!(await filled())) throw new BrowserError('The prompt could not be entered into the Gemini prompt box.', 'input', true);
}

async function submit(page, opts) {
  for (const sel of SEND_SELECTORS) {
    try {
      const btn = page.locator(sel).last();
      if (await btn.isVisible() && await btn.isEnabled()) { await btn.click({ timeout: 3000 }); return; }
    } catch { /* try the next one */ }
  }
  await page.keyboard.press('Enter');
}

/** Stops Gemini's current generation (best effort) - used when it starts producing an image. */
async function stopGeneration(page) {
  for (const sel of STOP_SELECTORS) {
    try {
      const btn = page.locator(sel).last();
      if (await btn.isVisible()) { await btn.click({ timeout: 2000 }); return; }
    } catch { /* try the next one */ }
  }
}

/** Newest reply on the page, whether Gemini still shows a "stop" button (= still writing), and whether it is making an image. */
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

async function waitForReply(page, opts, deadline, accept, onUpdate) {
  await sleep(1000); // a new reply bubble needs a moment to appear
  let prev = null; let stable = 0; let last = null;
  while (Date.now() < deadline) {
    checkUrl(page, opts);
    let snap;
    try { snap = await snapshot(page, opts); } catch (e) { if (page.isClosed()) throw e; snap = null; }
    if (snap && snap.image) { // image generation is not allowed: stop it, fail the request (the tab is discarded by ask())
      await stopGeneration(page);
      throw new BrowserError('Image generation is not allowed.', 'image_blocked', false);
    }
    if (!snap || !snap.text) { prev = null; stable = 0; await sleep(POLL_MS); continue; }
    last = snap;
    if (snap.text !== prev && onUpdate) { try { onUpdate(snap.text); } catch { /* a bad listener must not break the request */ } }
    if (snap.text === prev && !snap.busy) stable++; else stable = 0;
    prev = snap.text;
    if (stable >= STABLE_POLLS_UNACCEPTED || (stable >= STABLE_POLLS_ACCEPTED && accept(snap))) return { text: snap.text, blocks: snap.blocks };
    await sleep(POLL_MS);
  }
  if (last && accept(last)) return { text: last.text, blocks: last.blocks }; // deadline hit right after a complete answer
  throw new BrowserError('Gemini did not finish answering within the time limit.', 'timeout', true);
}

// ---- command line ------------------------------------------------------------------------------------------------------
async function cli(argv) {
  const opts = optionsFromEnv();
  if (argv[0] === '--login') {
    if (opts.cdpUrl) { console.log(`GEMINI_CDP_URL is set: sign in inside the Chrome you started with --remote-debugging-port. Nothing to do here.`); return; }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(opts.profileDir, { recursive: true });
    const launch = { headless: false, viewport: null };
    let ctx;
    try { ctx = await chromium.launchPersistentContext(opts.profileDir, opts.channel ? { ...launch, channel: opts.channel } : launch); }
    catch { ctx = await chromium.launchPersistentContext(opts.profileDir, launch); }
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(opts.url).catch(() => {});
    console.log(`Sign in to Google in the window that opened (profile: ${opts.profileDir}). Close the window when you are done.`);
    await new Promise((r) => ctx.on('close', r));
    return;
  }
  if (argv[0] === '--ask' && argv[1]) {
    const client = createBrowserClient(opts);
    try {
      const r = await client.ask(argv.slice(1).join(' '), { accept: () => true });
      console.log(r.text);
    } finally { await client.close(); }
    return;
  }
  console.log('Usage: node src/ai/providers/gemini/browser.cjs --login | --ask "your prompt"');
}

if (require.main === module) {
  cli(process.argv.slice(2)).then(() => process.exit(0), (e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
}

module.exports = { createBrowserClient, optionsFromEnv, BrowserError, PROMPT_SELECTORS, RESPONSE_SELECTORS };
