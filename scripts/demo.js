/* One-command demo: opens a visible Chromium with Subtext loaded, serves the three fixture pages on realistic domains
   (the test shop, the hyperpartisan "institute", the clean Guardian recipe) in separate tabs, and stays open until you
   close the window. Normal browsing works in the same window, so you can also visit real sites.
   Usage: node scripts/demo.js            (or: npm run demo)
          node scripts/demo.js --ai       (also turn on Investigate with your Anthropic key, read from the file named in SUBTEXT_ANTHROPIC_KEY_FILE; or npm run demo:ai)
          node scripts/demo.js --real     (fixtures tab plus a few real sites to compare) */
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const EXT = path.resolve(__dirname, '..', 'extension'); const FIX = path.resolve(__dirname, '..', 'test', 'fixtures');
const FIXTURES = {
  'https://dealzone-shop.test/product/ultra-widget': 'shop.html',
  'https://citizens-for-truth-institute.org/report/2026/the-truth-about-the-economy': 'article.html',
  'https://www.theguardian.com/food/2026/nov/04/weeknight-pasta-lemon-peas': 'clean.html'
};
const POLICIES = [[/^https:\/\/dealzone-shop\.test\/(privacy|terms)/, 'privacy.html'], [/^https:\/\/www\.theguardian\.com\/info\/privacy/, 'privacy-clean.html']];
const REAL = ['https://www.bbc.com/news', 'https://www.dailymail.co.uk/news/index.html', 'https://www.amazon.com/', 'https://www.foxnews.com/', 'https://www.theguardian.com/international'];
(async () => {
  const userDataDir = path.join(os.homedir(), '.subtext-demo-profile');
  // The profile persists between runs and Chrome keeps the cached background worker when the extension version is unchanged
  // (content scripts are re-read from disk). Drop the worker script cache so the background matches the files on disk.
  for (const sub of ['Service Worker', 'Extension State', 'Extension Scripts', 'Extension Rules']) { try { fs.rmSync(path.join(userDataDir, 'Default', sub), { recursive: true, force: true }); } catch (e) { /* first run */ } }
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false, channel: 'chromium', viewport: null,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`].concat(process.env.SUBTEXT_DEBUG_PORT ? ['--remote-debugging-port=' + process.env.SUBTEXT_DEBUG_PORT] : [])
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  console.log('Subtext loaded (worker cache cleared). Extension id:', new URL(sw.url()).host + (process.env.SUBTEXT_DEBUG_PORT ? ' · debugging on 127.0.0.1:' + process.env.SUBTEXT_DEBUG_PORT : ''));
  // --ai: turn on the AI with your own Anthropic key from a local file. SUBTEXT_ANTHROPIC_KEY_FILE names the file; there is no default path.
  // The key goes straight into the extension's own storage through its worker; it is never printed and never sent anywhere but Anthropic, on a click.
  if (process.argv.includes('--ai')) {
    const keyFile = process.env.SUBTEXT_ANTHROPIC_KEY_FILE || '';
    let key = ''; try { if (keyFile) key = fs.readFileSync(keyFile, 'utf8').trim(); } catch (e) { /* reported below */ }
    if (!keyFile) console.log('AI not turned on: set SUBTEXT_ANTHROPIC_KEY_FILE to a file that holds your Anthropic key, or add the key in Settings instead.');
    else if (!key) console.log('AI not turned on: no key in ' + keyFile + '. Add one in Settings instead.');
    else { const r = await sw.evaluate(async (k) => { for (let i = 0; i < 40 && typeof handle !== 'function'; i++) await new Promise((res) => setTimeout(res, 100)); return handle({ type: 'saveSettings', settings: { aiProvider: 'anthropic', anthropicKey: k, anthropicModel: 'claude-sonnet-5-5', aiInvestigation: true } }, {}); }, key);
      console.log(r && r.ok ? 'AI turned on: Anthropic key loaded from ' + keyFile + '. Investigate runs only when you click it; the button shows the estimated cost.' : 'AI not turned on: ' + JSON.stringify(r)); }
  }
  // the demo shows a context chart on every page: "Load context automatically" is turned on here (Trends still waits for a click);
  // SUBTEXT_CONTEXT_AUTO=0 leaves the reader's default (off)
  if (process.env.SUBTEXT_CONTEXT_AUTO !== '0') { const r = await sw.evaluate(async () => { for (let i = 0; i < 40 && typeof handle !== 'function'; i++) await new Promise((res) => setTimeout(res, 100)); return handle({ type: 'saveSettings', settings: Object.assign({ contextAuto: true }, process.env.SUBTEXT_FEC_KEY ? { fecKey: process.env.SUBTEXT_FEC_KEY } : {}) }, {}); }); console.log(r && r.ok ? 'Context from public data loads on every page (demo setting; off by default for readers).' : 'Context auto-load not set: ' + JSON.stringify(r)); }
  sw.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[background ' + m.type() + ']', m.text()); });
  // serve fixtures on their fake domains; everything else goes to the real network
  await ctx.route((url) => /dealzone-shop\.test|citizens-for-truth-institute\.org|theguardian\.com\/(food\/2026\/nov\/04|info\/privacy)/.test(url.href), (route) => {
    const u = route.request().url();
    const fix = Object.keys(FIXTURES).find((k) => u.startsWith(k));
    // a fixture served under a real outlet's address (theguardian.com) must not pass for that site: label it on the page
    const SYNTH = '<div style="position:sticky;top:0;z-index:2147483646;background:#fff3cd;color:#5c4400;font:13px/1.4 system-ui,sans-serif;padding:6px 12px;border-bottom:1px solid #e0c97a">Synthetic test page served by the Subtext demo (' + FIXTURES[fix] + '), not the real site. Use it to see how Subtext reports; browse real sites in this window for real results.</div>';
    if (fix) { const html = fs.readFileSync(path.join(FIX, FIXTURES[fix]), 'utf8'); return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html.includes('data-subtext-fixture-note') ? html : html.replace(/<body([^>]*)>/i, (m) => m + SYNTH) }); } // fixtures under a real name carry their own banner
    const pol = POLICIES.find(([re]) => re.test(u));
    if (pol) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(FIX, pol[1]), 'utf8') });
    return route.abort();
  });
  const urls = Object.keys(FIXTURES).concat(process.argv.includes('--real') ? REAL : []);
  let first = true;
  for (const u of urls) { const page = first ? ctx.pages()[0] || await ctx.newPage() : await ctx.newPage(); first = false; page.goto(u).catch(() => {}); }
  console.log('\nTabs opened:\n  ' + urls.join('\n  '));
  console.log('\nWhat to try:\n  • Click the Subtext icon in the toolbar (puzzle-piece menu if hidden) to see the report.\n  • Click the small pill bottom-right, or the toolbar icon, for the report panel beside the page (drag its left edge to resize); rest the mouse on a flagged element for the reason.\n  • In the panel, hover a finding to see where it sits on the page; click a quote to scroll there.\n  • On the shop tab: scroll to the bottom (infinite scroll), move the mouse out of the page (exit-intent), reload (fake countdown).\n  • Press ⚙ in the panel or popup, paste an API key, then press "Deep analyze".\n  • Browse any real site in this window; the pill appears after ~1.5 s.\nClose the browser window to end the demo.');
  await new Promise((resolve) => ctx.on('close', resolve));
})().catch((e) => { console.error(e); process.exit(1); });
