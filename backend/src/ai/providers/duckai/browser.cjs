'use strict';
/**
 * Browser transport for duckai/service.js: drives the real https://duck.ai/ web app (Playwright, inside Node) the way a person
 * would: open a NEW chat, put the prompt into the prompt box, send it, wait until the streamed reply stops changing, read it back.
 * The model served is Claude Haiku 4.5.
 *
 * duck.ai needs no account, so there is nothing to sign in to. What it does need, stored in the page's localStorage:
 *   preferredDuckaiModel   = "1"      selects Claude Haiku (DUCKAI_MODEL_INDEX overrides the value)
 *   duckaiHasAgreedToTerms = "true"   skips the terms dialog
 * After the page loads, both are checked; if either is missing or different they are written and the page is RELOADED so the
 * app starts with them. localStorage lives in the Chrome profile (DUCKAI_PROFILE_DIR), so this happens once, not on every
 * request. The model picker is then checked to still say "Haiku" (DUCKAI_MODEL_MATCH); if not, the request fails with
 * 'model_not_selected' rather than silently answering from another model.
 *
 * Two ways to get a Chrome:
 *   1. Own profile (default). Playwright starts Chrome with a persistent profile folder (DUCKAI_PROFILE_DIR).
 *   2. Attach (DUCKAI_CDP_URL=http://127.0.0.1:9222) to a Chrome you started with --remote-debugging-port. It is never closed
 *      by this code; only the tabs it opened are.
 *
 * Environment (all optional):
 *   DUCKAI_WEB_URL         default https://duck.ai/. Opened before every request (that is what starts a fresh chat).
 *   DUCKAI_PROFILE_DIR     default "<project root>/data/duckai-profile".
 *   DUCKAI_HEADLESS        default ON (no window). "0" shows the window.
 *   DUCKAI_MODEL_INDEX     default "1". Value written to localStorage preferredDuckaiModel.
 *   DUCKAI_MODEL_MATCH     default "haiku". Case-insensitive regex the model picker text must match after setup.
 *   DUCKAI_RENDERERS / DUCKAI_JS_HEAP_MB / DUCKAI_NO_SANDBOX   optional extra RAM savers, see core/tabpool.cjs.
 *   DUCKAI_CDP_URL         attach to a running Chrome instead of starting one.
 *   DUCKAI_CHROME_CHANNEL  default "chrome" (installed Chrome). Empty = Playwright's bundled Chromium.
 *   DUCKAI_BROWSER_TABS    default 10. Chats that can run at once (one tab each); more callers queue, FIFO. 0/"unlimited" = no limit.
 *   DUCKAI_IDLE_CLOSE_MS   default 60000. A free tab unused for this long is closed (0 = never).
 *   DUCKAI_LEAN            default 1 (basic lean). "0" = off, "2" = max (see core/tabpool.cjs).
 *   DUCKAI_VIEWPORT        level 2 only, "WIDTHxHEIGHT".
 *   DUCKAI_HIDE_SELECTOR   extra CSS selector(s) hidden in lean mode.
 *   DUCKAI_IMAGE_SELECTOR  CSS selector(s) meaning "an image is being generated"; on a match Stop is pressed, ask() fails 'image_blocked'.
 *   DUCKAI_OPEN_STAGGER_MS default 150. Minimum gap between opening two new tabs.
 *   DUCKAI_POLL_MS         default 300. How often the reply is re-read (and onUpdate fires).
 *   DUCKAI_PROMPT_SELECTOR / DUCKAI_RESPONSE_SELECTOR   one CSS selector tried first, for when duck.ai changes its markup.
 *
 * Command line:
 *   node src/ai/providers/duckai/browser.cjs --login          open a visible window with the settings applied (no sign-in needed)
 *   node src/ai/providers/duckai/browser.cjs --ask "text"     send one prompt and print the reply (checks the selectors still work)
 *
 * Playwright itself is not bundled: `npm install playwright` (or playwright-core with DUCKAI_CHROME_CHANNEL=chrome).
 *
 * Note: duck.ai's CSS class names are generated hashes that change; only stable hooks are used here (name="user-prompt",
 * aria-labels, data-testid, data-streamdown).
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../../core/paths.cjs');
const { createTabPool, maskHeadless, tabsFromEnv, applyLean, leanFromEnv, launchArgs, launchExtras } = require('../../core/tabpool.cjs');

const DEFAULT_URL = 'https://duck.ai/';
const DEFAULT_POLL_MS = 300;
const STABLE_POLLS_ACCEPTED = 3;    // reply unchanged this many polls AND accepted by the caller -> done
const STABLE_POLLS_UNACCEPTED = 10; // reply unchanged this many polls but not accepted -> hand it back anyway
const PROMPT_WAIT_MS = 20000;
const DEFAULT_TABS = 10;
const DEFAULT_IDLE_CLOSE_MS = 60000;
const DEFAULT_OPEN_STAGGER_MS = 150;

const LS_MODEL_KEY = 'preferredDuckaiModel';
const LS_TERMS_KEY = 'duckaiHasAgreedToTerms';
const LS_TERMS_VALUE = 'true';

const PROMPT_SELECTORS = ['textarea[name="user-prompt"]', 'textarea[aria-label*="Ask anything" i]', 'textarea'];
// The newest match on the page is the newest reply (streamdown renders the assistant message inside this div).
const RESPONSE_SELECTORS = ['div.space-y-4.whitespace-normal', 'div:has(> p > span[data-sd-animate])', '[data-streamdown]'];
const SEND_SELECTORS = ['button[type="submit"][aria-label="Send"]', 'button[aria-label="Send"]'];
// The Stop button is always in the DOM but disabled when idle: "busy" means it is present AND enabled.
const STOP_SELECTORS = ['button[aria-label="Stop generating"]'];
const MODEL_PICKER_SELECTOR = '[data-testid="model-picker-button"]';
const IMAGE_SELECTORS = [];  // none known for duck.ai text chat; add with DUCKAI_IMAGE_SELECTOR
const HIDE_SELECTORS = [];   // nothing to hide; add with DUCKAI_HIDE_SELECTOR

class BrowserError extends Error {
  constructor(message, code, retryable = false) {
    super(message);
    this.name = 'BrowserError';
    this.code = code;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function optionsFromEnv(env = process.env) {
  const one = (v) => (v && String(v).trim() ? [String(v).trim()] : []);
  const ms = (v, d) => (/^\d+$/.test(String(v == null ? '' : v).trim()) ? Number(v) : d);
  return {
    url: env.DUCKAI_WEB_URL || DEFAULT_URL,
    profileDir: env.DUCKAI_PROFILE_DIR ? path.resolve(env.DUCKAI_PROFILE_DIR) : path.join(DATA_DIR, 'duckai-profile'),
    headless: !/^(?:0|false|no|off)$/i.test(String(env.DUCKAI_HEADLESS || '').trim()), // default: hidden
    cdpUrl: String(env.DUCKAI_CDP_URL || '').trim(),
    channel: env.DUCKAI_CHROME_CHANNEL == null ? 'chrome' : String(env.DUCKAI_CHROME_CHANNEL).trim(),
    tabs: tabsFromEnv(env.DUCKAI_BROWSER_TABS, DEFAULT_TABS), // Infinity = unlimited
    idleCloseMs: ms(env.DUCKAI_IDLE_CLOSE_MS, DEFAULT_IDLE_CLOSE_MS),
    openStaggerMs: ms(env.DUCKAI_OPEN_STAGGER_MS, DEFAULT_OPEN_STAGGER_MS),
    pollMs: Math.max(50, ms(env.DUCKAI_POLL_MS, DEFAULT_POLL_MS)),
    modelIndex: String(env.DUCKAI_MODEL_INDEX || '1').trim(),
    modelMatch: String(env.DUCKAI_MODEL_MATCH || 'haiku').trim(),
    lean: leanFromEnv('DUCKAI', env, { hide: HIDE_SELECTORS }),
    imageSelectors: [...one(env.DUCKAI_IMAGE_SELECTOR), ...IMAGE_SELECTORS],
    promptSelectors: [...one(env.DUCKAI_PROMPT_SELECTOR), ...PROMPT_SELECTORS],
    responseSelectors: [...one(env.DUCKAI_RESPONSE_SELECTOR), ...RESPONSE_SELECTORS],
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

/** The tab ended up somewhere other than duck.ai (a bot check, a redirect): retrying will not fix it. */
function checkUrl(page, opts) {
  const u = page.url();
  let want = '';
  try { want = new URL(opts.url).hostname; } catch { /* custom URL without host: skip the check */ }
  if (!u || u === 'about:blank' || !want) return;
  let have = '';
  try { have = new URL(u).hostname; } catch { return; }
  if (have !== want) {
    throw new BrowserError(`duck.ai sent the tab to ${u.slice(0, 120)} instead of ${opts.url}. Open the browser window (DUCKAI_HEADLESS=0) and complete any check it shows.`, 'challenge');
  }
}

/** Reads the picker label and the stored model value (for the checks and for error messages). */
const modelState = async (page) => ({
  label: String(await page.locator(MODEL_PICKER_SELECTOR).first().innerText({ timeout: 1000 }).catch(() => '')).trim(),
  stored: await page.evaluate((k) => localStorage.getItem(k), LS_MODEL_KEY).catch(() => null),
});

/**
 * localStorage must say the terms are agreed, and must hold a model choice. The terms flag is always enforced; the model key is
 * written only when it is missing, or with force=true (the picker did not show the wanted model). Whenever something is written
 * the page is RELOADED so the app starts with it. The profile keeps localStorage, so normally this is a single cheap read.
 */
async function ensureSettings(page, opts, deadline, force = false) {
  const apply = () => page.evaluate(({ mk, mv, tk, tv, force }) => {
    let changed = false;
    if (localStorage.getItem(tk) !== tv) { localStorage.setItem(tk, tv); changed = true; }
    if (force ? localStorage.getItem(mk) !== mv : localStorage.getItem(mk) === null) { localStorage.setItem(mk, mv); changed = true; }
    return changed;
  }, { mk: LS_MODEL_KEY, mv: opts.modelIndex, tk: LS_TERMS_KEY, tv: LS_TERMS_VALUE, force });
  if (await apply()) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: Math.max(5000, Math.min(60000, deadline - Date.now())) });
  }
}

/** Waits (briefly) for the model picker to show the wanted model. */
async function pickerMatches(page, opts, ms = 5000) {
  const re = new RegExp(opts.modelMatch, 'i');
  const until = Date.now() + ms;
  do {
    if (re.test((await modelState(page)).label)) return true;
    await sleep(300);
  } while (Date.now() < until);
  return false;
}

/** Last resort: open the model picker and click the entry whose text matches. Returns the entries it saw. */
async function selectModelInUi(page, opts) {
  const re = new RegExp(opts.modelMatch, 'i');
  await page.locator(MODEL_PICKER_SELECTOR).first().click({ timeout: 3000 }).catch(() => {});
  const items = page.locator('[role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"], [role="menu"] button, [role="listbox"] button');
  await items.first().waitFor({ timeout: 3000 }).catch(() => {});
  const seen = (await items.allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const hit = items.filter({ hasText: re }).first();
  if (await hit.count().catch(() => 0)) await hit.click({ timeout: 3000 }).catch(() => {});
  else await page.keyboard.press('Escape').catch(() => {});
  return seen;
}

/**
 * After setup the model picker must show the wanted model; never answer from a different one silently.
 * Order: as is -> write preferredDuckaiModel=<modelIndex> and reload -> pick it in the menu (the app then stores its own value).
 */
async function checkModel(page, opts, deadline) {
  if (await pickerMatches(page, opts)) return;
  await ensureSettings(page, opts, deadline, true);
  await page.locator(MODEL_PICKER_SELECTOR).first().waitFor({ timeout: 10000 }).catch(() => {});
  if (await pickerMatches(page, opts)) return;
  const seen = await selectModelInUi(page, opts);
  if (await pickerMatches(page, opts)) return;
  const st = await modelState(page);
  throw new BrowserError(`duck.ai is not using the expected model: picker shows "${st.label}", localStorage ${LS_MODEL_KEY}=${JSON.stringify(st.stored)} (we set "${opts.modelIndex}"), expected /${opts.modelMatch}/i. Menu entries seen: ${JSON.stringify(seen)}. Set DUCKAI_MODEL_INDEX / DUCKAI_MODEL_MATCH accordingly.`, 'model_not_selected', true);
}

function createBrowserClient(opts = optionsFromEnv()) {
  let starting = null;
  let context = null;
  let browser = null;
  let ownsBrowser = true;
  const pool = createTabPool({
    maxTabs: opts.tabs, idleCloseMs: opts.idleCloseMs, staggerMs: opts.openStaggerMs,
    openPage: () => openPage(), log: (m) => console.log('[duckai-browser] ' + m),
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
    context.on('close', () => { starting = null; context = null; pool.reset(new BrowserError('The duck.ai browser was closed.', 'browser_closed', true)); });
  }
  const ensure = () => starting || (starting = start().catch((e) => {
    starting = null;
    if (e instanceof BrowserError) throw e;
    throw new BrowserError(`Could not start the duck.ai browser: ${e && e.message ? String(e.message).split('\n')[0] : e}${opts.cdpUrl ? '' : ` (is another Chrome already using ${opts.profileDir}?)`}`, 'browser_start', true);
  }));

  /** Opens the tab for a slot (called by the pool, staggered). Lean-mode rules are attached before anything loads. */
  async function openPage() {
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
   * @param opt.accept     (reply) => boolean. Tells the wait loop that the reply is complete.
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
      checkUrl(page, opts);
      await ensureSettings(page, opts, deadline);
      const box = await findPromptBox(page, opts, deadline);
      await checkModel(page, opts, deadline);
      await fillPrompt(page, box, text);
      await sleep(200);
      await submit(page, box);
      return await waitForReply(page, opts, deadline, accept, onUpdate);
    } catch (e) {
      await pool.discard(slot); // whatever went wrong, the next request starts on a clean tab
      throw e instanceof BrowserError ? e : new BrowserError(`Browser error: ${e && e.message ? String(e.message).split('\n')[0] : e}`, 'browser', true);
    } finally { pool.release(slot); }
  }

  async function close() {
    starting = null;
    pool.reset(new BrowserError('The duck.ai browser was closed.', 'browser_closed', true));
    const c = context; const b = browser;
    context = null; browser = null;
    try {
      if (ownsBrowser) { if (c) await c.close(); }
      else if (b) await b.close(); // close() on a CDP browser only disconnects
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
  const shot = path.join(DATA_DIR, 'duckai-debug.png');
  const seen = await page.evaluate(() => ({ title: document.title, text: (document.body && document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 120) })).catch(() => ({ title: '', text: '' }));
  const saved = await page.screenshot({ path: shot, timeout: 5000 }).then(() => shot, () => 'not saved');
  throw new BrowserError(`Could not find the duck.ai prompt box. The page layout may have changed (set DUCKAI_PROMPT_SELECTOR), or the page did not finish loading. Tab shows: url=${page.url().slice(0, 100)} title="${seen.title}" text="${seen.text}" screenshot=${saved}`, 'no_prompt_box', true);
}

const squash = (s) => String(s || '').replace(/\s+/g, '');

/** The prompt box is a plain <textarea>: fill() sets the whole text at once and fires the input event the app listens to. */
async function fillPrompt(page, box, text) {
  const filled = async () => squash(await box.inputValue().catch(() => '')).length >= squash(text).length * 0.98;
  await box.click();
  await box.fill(text);
  if (await filled()) return;
  await box.fill('');
  await page.keyboard.insertText(text); // fallback: insert as if pasted
  if (!(await filled())) throw new BrowserError('The prompt could not be entered into the duck.ai prompt box.', 'input', true);
}

async function submit(page, box) {
  for (const sel of SEND_SELECTORS) {
    try {
      const btn = page.locator(sel).last();
      if (await btn.isVisible() && await btn.isEnabled()) { await btn.click({ timeout: 3000 }); return; }
    } catch { /* try the next one */ }
  }
  await box.press('Enter');
}

/** Stops the current generation (best effort) - used when it starts producing an image. */
async function stopGeneration(page) {
  for (const sel of STOP_SELECTORS) {
    try {
      const btn = page.locator(sel).last();
      if (await btn.isVisible() && await btn.isEnabled()) { await btn.click({ timeout: 2000 }); return; }
    } catch { /* try the next one */ }
  }
}

/** Newest reply on the page, whether the app is still writing (Stop button enabled), and whether it is making an image. */
function snapshot(page, opts) {
  return page.evaluate(({ resp, stop, img }) => {
    const shown = (b) => !!b && b.getClientRects().length > 0 && getComputedStyle(b).visibility !== 'hidden';
    const busy = stop.some((s) => { try { const b = document.querySelector(s); return shown(b) && !b.disabled; } catch { return false; } });
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
  await sleep(800); // a new reply bubble needs a moment to appear
  let prev = null; let stable = 0; let last = null;
  while (Date.now() < deadline) {
    checkUrl(page, opts);
    let snap;
    try { snap = await snapshot(page, opts); } catch (e) { if (page.isClosed()) throw e; snap = null; }
    if (snap && snap.image) { // image generation is not allowed: stop it, fail the request (the tab is discarded by ask())
      await stopGeneration(page);
      throw new BrowserError('Image generation is not allowed.', 'image_blocked', false);
    }
    if (!snap || !snap.text) { prev = null; stable = 0; await sleep(opts.pollMs); continue; }
    last = snap;
    if (snap.text !== prev && onUpdate) { try { onUpdate(snap.text); } catch { /* a bad listener must not break the request */ } }
    if (snap.text === prev && !snap.busy) stable++; else stable = 0;
    prev = snap.text;
    if (stable >= STABLE_POLLS_UNACCEPTED || (stable >= STABLE_POLLS_ACCEPTED && accept(snap))) return { text: snap.text, blocks: snap.blocks };
    await sleep(opts.pollMs);
  }
  if (last && accept(last)) return { text: last.text, blocks: last.blocks }; // deadline hit right after a complete answer
  throw new BrowserError('duck.ai did not finish answering within the time limit.', 'timeout', true);
}

// ---- command line ------------------------------------------------------------------------------------------------------
async function cli(argv) {
  const opts = optionsFromEnv();
  if (argv[0] === '--login') {
    if (opts.cdpUrl) { console.log('DUCKAI_CDP_URL is set: the attached Chrome is used as is. Nothing to do here.'); return; }
    const { chromium } = loadPlaywright();
    fs.mkdirSync(opts.profileDir, { recursive: true });
    const launch = { headless: false, viewport: null };
    let ctx;
    try { ctx = await chromium.launchPersistentContext(opts.profileDir, opts.channel ? { ...launch, channel: opts.channel } : launch); }
    catch { ctx = await chromium.launchPersistentContext(opts.profileDir, launch); }
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(opts.url).catch(() => {});
    await ensureSettings(page, opts, Date.now() + 60000).catch((e) => console.log('Could not apply settings: ' + e.message));
    console.log(`No sign-in is needed. Model and terms settings were saved in the profile (${opts.profileDir}). Close the window when you are done.`);
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
  console.log('Usage: node src/ai/providers/duckai/browser.cjs --login | --ask "your prompt"');
}

if (require.main === module) {
  cli(process.argv.slice(2)).then(() => process.exit(0), (e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
}

module.exports = { createBrowserClient, optionsFromEnv, BrowserError, PROMPT_SELECTORS, RESPONSE_SELECTORS };
