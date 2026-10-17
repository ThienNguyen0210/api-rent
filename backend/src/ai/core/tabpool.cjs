'use strict';
/**
 * Shared by chatgpt/browser.cjs and gemini/browser.cjs.
 *
 * 1. createTabPool(): the "N chats at once, one tab each" pool.
 *      - up to maxTabs requests run at once; the rest wait in arrival order (strict FIFO: a freed tab is handed
 *        directly to the longest-waiting caller, so a brand-new caller can never jump the queue).
 *      - maxTabs may be Infinity (env value 0 / "unlimited" / "inf" / "max" / "*", see tabsFromEnv): every request then
 *        gets its own tab immediately and nothing ever queues. Slots that lose their tab are dropped from the pool, so
 *        it does not grow forever after a burst.
 *      - a tab that finishes and is not reused within idleCloseMs (default 60 s) is closed; with a finite pool the slot is
 *        kept (the next request just opens a fresh tab), with an unlimited pool the slot is dropped too.
 *      - new tabs are opened staggered (staggerMs apart) so many simultaneous first requests do not all load a heavy
 *        web app at the same instant and starve each other of CPU. Set the stagger to 0 for an unlimited pool if the
 *        machine can take the burst.
 *
 * 2. applyLean() / leanFromEnv() / launchArgs() / launchExtras(): "lean page" mode. We only ever read text out of the
 *    page, so each tab is told not to download or render what a person would want to see but we do not need.
 *    <PREFIX>_LEAN selects the level (default 1; level 2 is opt-in because blocking stylesheets was not safe on every page):
 *      0            off.
 *      1 / basic    (default) images, media and fonts aborted at the network layer; known analytics hosts aborted; CSS animations
 *                   and transitions collapsed to ~0 ms; the conversation sidebar hidden; Chrome started without
 *                   extensions/sync/background networking.
 *      2 / max      everything in level 1, plus:
 *                     - stylesheets, manifests, text tracks, pings and CSP reports are never downloaded,
 *                     - an injected stylesheet strips shadows, filters, blur, gradients/background images, and hides
 *                       video/audio/canvas/picture/object/embed (nothing is painted that we do not read),
 *                     - prefers-reduced-motion is emulated, so apps that honour it stop their own JS animations,
 *                     - a smaller viewport (default 1100x700, <PREFIX>_VIEWPORT=WxH) means fewer pixels to lay out,
 *                     - service workers are blocked (they could answer requests behind the route() rules),
 *                     - Chrome is started without GPU/WebGL/remote fonts/images, with crash reporting, hang monitor,
 *                       phishing checks, notifications and default apps off, and with background-tab throttling
 *                       turned off so a tab nobody looks at still polls at full speed.
 *    If a site change ever breaks under it, <PREFIX>_LEAN=1 (or 0) goes back to the lighter behaviour.
 *
 * 3. RAM (level 2): Chrome is also told to run in low-end-device mode, to discard caches aggressively, to keep no disk/media
 *    cache, and to skip site isolation (fewer processes). Optional extras, all off unless set:
 *      <PREFIX>_RENDERERS=N     --renderer-process-limit=N: at most N renderer processes, so many tabs of the same site share
 *                               them. Biggest RAM saving, but tabs then share a main thread (slower under load) and one
 *                               renderer crash takes its tabs with it.
 *      <PREFIX>_JS_HEAP_MB=N    caps every page's V8 heap (min 64). Too low and the web app itself runs out of memory.
 *      <PREFIX>_NO_SANDBOX=1    --no-sandbox, needed when Chrome runs as root (typical Docker/VPS). Only on a server you trust.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** "0" / "unlimited" / "inf" / "infinity" / "max" / "*" -> Infinity; a positive integer -> that many; anything else -> def. */
function tabsFromEnv(v, def) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (/^(?:0|inf|infinity|unlimited|max|\*)$/.test(s)) return Infinity;
  if (/^\d+$/.test(s)) return Math.max(1, Number(s));
  return def;
}

function createTabPool({ maxTabs, idleCloseMs = 60000, staggerMs = 150, openPage, log = () => {} }) {
  const unlimited = !Number.isFinite(maxTabs);
  let slots = []; // { id, page, busy, promptCount, idleTimer }
  let waiters = []; // FIFO of { resolve, reject }
  let openChain = Promise.resolve();
  let nextId = 1;

  const take = (s) => {
    if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; }
    s.busy = true;
    return s;
  };
  const drop = (s) => { slots = slots.filter((x) => x !== s); };

  /** Resolves with a slot: a free one, a new one (while under maxTabs), or - when all are busy - the next one released. */
  function acquire() {
    const free = slots.find((s) => !s.busy);
    if (free) return Promise.resolve(take(free));
    if (unlimited || slots.length < maxTabs) {
      const s = { id: nextId++, page: null, busy: false, promptCount: 0, idleTimer: null };
      slots.push(s);
      return Promise.resolve(take(s));
    }
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  }

  function closeIdle(s) {
    s.idleTimer = null;
    if (s.busy || !s.page) return;
    const p = s.page;
    s.page = null;
    s.promptCount = 0;
    if (unlimited) drop(s);
    log(`tab ${s.id} unused for ${idleCloseMs} ms, closed`);
    try { Promise.resolve(p.close()).catch(() => {}); } catch { /* already gone */ }
  }

  /** Hands the slot straight to the next waiting caller (it stays busy); with nobody waiting, arms the idle-close timer. */
  function release(s) {
    if (!slots.includes(s)) return; // the pool was reset while this request was running
    const w = waiters.shift();
    if (w) { w.resolve(s); return; }
    s.busy = false;
    if (unlimited && !s.page) { drop(s); return; } // nothing left to keep warm
    if (idleCloseMs > 0 && s.page) {
      s.idleTimer = setTimeout(() => closeIdle(s), idleCloseMs);
      if (s.idleTimer.unref) s.idleTimer.unref(); // never keeps the process alive on its own
    }
  }

  /** The slot's open tab, creating one (staggered) if it has none. */
  async function page(s) {
    if (s.page && !s.page.isClosed()) return s.page;
    const run = openChain.then(() => openPage(s));
    openChain = run.then(() => sleep(staggerMs), () => sleep(staggerMs));
    const p = await run;
    s.page = p;
    return p;
  }

  /** Throws the slot's tab away; the next request on this slot gets a clean one. */
  async function discard(s) {
    const p = s.page;
    s.page = null;
    s.promptCount = 0;
    if (p) { try { await p.close(); } catch { /* already gone */ } }
  }

  /** Forget every slot (browser closed). Callers still waiting for a tab are rejected instead of hanging forever. */
  function reset(err) {
    for (const s of slots) if (s.idleTimer) clearTimeout(s.idleTimer);
    const w = waiters;
    slots = [];
    waiters = [];
    for (const x of w) x.reject(err);
  }

  return {
    acquire, release, page, discard, reset,
    unlimited,
    owns: (p) => slots.some((s) => s.page === p),
    anyBusy: () => slots.some((s) => s.busy),
    busyCount: () => slots.filter((s) => s.busy).length,
    stats: () => ({
      tabs: slots.length,
      open: slots.filter((s) => s.page && !s.page.isClosed()).length,
      busy: slots.filter((s) => s.busy).length,
      queued: waiters.length,
    }),
  };
}

// ---- lean page ---------------------------------------------------------------------------------------------------------
const BLOCKED_TYPES = new Set(['image', 'media', 'font']);
// Level 2 also refuses these. Scripts, xhr/fetch, websocket and eventsource are never blocked: the reply streams through them.
const BLOCKED_TYPES_MAX = new Set([...BLOCKED_TYPES, 'stylesheet', 'manifest', 'texttrack', 'ping', 'cspviolationreport']);
// Host-anchored on purpose: a loose word match could abort one of the app's own script chunks.
const TELEMETRY = new RegExp(
  '^https?://(?:[^/]+\\.)?(?:google-analytics\\.com|googletagmanager\\.com|doubleclick\\.net|sentry\\.io|datadoghq\\.com|hotjar\\.com|clarity\\.ms|segment\\.io|intercom\\.io|fullstory\\.com|mixpanel\\.com|amplitude\\.com|posthog\\.com)/' +
  '|^https?://chatgpt\\.com/ces/' +
  '|^https?://play\\.google\\.com/log', 'i');
// 0.001s (not 0) so animationend/transitionend still fire for any code that waits on them.
const LEAN_CSS = '*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;transition-duration:.001s!important;transition-delay:0s!important;scroll-behavior:auto!important}';
// Nothing below changes layout (so isVisible()/clicks behave the same); it only removes paint work. svg and button are left alone:
// the send button is an icon-only svg and would otherwise have an empty box.
const MAX_CSS = '*,*::before,*::after{box-shadow:none!important;text-shadow:none!important;filter:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background-image:none!important;will-change:auto!important;caret-color:auto!important}\n' +
  'video,audio,canvas,picture,object,embed{display:none!important}';
const LEAN_ARGS = [
  '--disable-blink-features=AutomationControlled', '--disable-extensions', '--disable-sync', '--disable-component-update', '--disable-background-networking',
  '--mute-audio', '--no-first-run', '--disable-dev-shm-usage', '--disable-features=Translate,MediaRouter',
];
// Only one --disable-features flag takes effect, so the level-2 list repeats the level-1 entries and adds to them.
const MAX_ARGS = [
  ...LEAN_ARGS.filter((a) => !a.startsWith('--disable-features=')),
  '--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication,InterestFeedContentSuggestions,CalculateNativeWinOcclusion,IsolateOrigins,site-per-process',
  '--disable-site-isolation-trials', '--enable-low-end-device-mode', '--aggressive-cache-discard',
  '--disk-cache-size=1', '--media-cache-size=1',
  '--disable-gpu', '--disable-software-rasterizer', '--disable-webgl', '--disable-accelerated-2d-canvas',
  '--blink-settings=imagesEnabled=false', '--disable-remote-fonts',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--disable-ipc-flooding-protection',
  '--disable-breakpad', '--disable-hang-monitor', '--disable-client-side-phishing-detection', '--disable-domain-reliability',
  '--disable-default-apps', '--disable-notifications', '--metrics-recording-only', '--no-default-browser-check',
  '--password-store=basic', '--use-mock-keychain',
];
const MAX_VIEWPORT = { width: 1100, height: 700 }; // still a "desktop" layout for the apps, but far fewer pixels than 1280x900

function leanFromEnv(prefix, env, defaults) {
  const raw = String(env[prefix + '_LEAN'] || '').trim().toLowerCase();
  let level = 1;
  if (/^(?:0|false|no|off)$/.test(raw)) level = 0;
  else if (/^(?:2|max|full|ultra)$/.test(raw)) level = 2;
  const extra = String(env[prefix + '_HIDE_SELECTOR'] || '').trim();
  let viewport = null;
  if (level >= 2) {
    const m = /^(\d{3,4})\s*[x*,]\s*(\d{3,4})$/i.exec(String(env[prefix + '_VIEWPORT'] || '').trim());
    viewport = m ? { width: Number(m[1]), height: Number(m[2]) } : MAX_VIEWPORT;
  }
  const extraArgs = [];
  const num = (k) => { const n = Number(String(env[prefix + k] || '').trim()); return Number.isFinite(n) ? Math.floor(n) : 0; };
  if (level >= 2 && num('_RENDERERS') >= 1) extraArgs.push(`--renderer-process-limit=${num('_RENDERERS')}`);
  if (level >= 2 && num('_JS_HEAP_MB') >= 64) extraArgs.push(`--js-flags=--max-old-space-size=${num('_JS_HEAP_MB')}`);
  if (/^(?:1|true|yes|on)$/i.test(String(env[prefix + '_NO_SANDBOX'] || '').trim())) extraArgs.push('--no-sandbox', '--disable-setuid-sandbox');
  return { enabled: level > 0, level, viewport, extraArgs, hide: [...(extra ? [extra] : []), ...defaults.hide] };
}

const launchArgs = (lean) => [...(!lean.enabled ? [] : lean.level >= 2 ? MAX_ARGS : LEAN_ARGS), ...(lean.extraArgs || [])];
/** Extra launchPersistentContext options for the level (merge with the base options). */
const launchExtras = (lean) => (lean.enabled && lean.level >= 2 ? { serviceWorkers: 'block' } : {});

/** Per-page (not per-context) so that, when attached to the user's own Chrome, their other tabs are left alone. */
async function applyLean(page, lean) {
  if (!lean.enabled) return;
  const blocked = lean.level >= 2 ? BLOCKED_TYPES_MAX : BLOCKED_TYPES;
  await page.route('**/*', (route) => {
    let block = false;
    try { const r = route.request(); block = blocked.has(r.resourceType()) || TELEMETRY.test(r.url()); } catch { /* let it through */ }
    return (block ? route.abort() : route.continue()).catch(() => {});
  });
  if (lean.level >= 2) {
    try { await page.emulateMedia({ reducedMotion: 'reduce' }); } catch { /* best effort */ }
    if (lean.viewport) { try { await page.setViewportSize(lean.viewport); } catch { /* best effort */ } }
  }
  // One rule per selector: a single invalid selector must not void the others.
  const css = [LEAN_CSS, ...(lean.level >= 2 ? [MAX_CSS] : []), ...lean.hide.map((s) => `${s}{display:none!important}`)].join('\n');
  await page.addInitScript((c) => {
    const add = () => { const st = document.createElement('style'); st.textContent = c; (document.head || document.documentElement).appendChild(st); };
    if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
  }, css);
}

/**
 * Headless Chrome announces itself as "HeadlessChrome" in its user agent, which makes sites show a check page or a reduced UI.
 * Present the normal Chrome UA instead (same version). Best effort; the CDP session is kept open so the override stays.
 */
async function maskHeadless(context, page) {
  try {
    const cdp = await context.newCDPSession(page);
    const { userAgent } = await cdp.send('Browser.getVersion');
    if (/HeadlessChrome/.test(userAgent)) await cdp.send('Emulation.setUserAgentOverride', { userAgent: userAgent.replace('HeadlessChrome', 'Chrome') });
  } catch { /* not Chromium, or the browser refused: carry on */ }
}

module.exports = { maskHeadless, createTabPool, tabsFromEnv, applyLean, leanFromEnv, launchArgs, launchExtras, BLOCKED_TYPES, BLOCKED_TYPES_MAX, TELEMETRY };
