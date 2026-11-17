/* Fingerprint gate: with no test hooks, a scanned and flagged page must show no trace of the extension to page scripts,
   and extension files must not be reachable from the page. Usage: node test/fingerprint.js */
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const EXT = path.resolve(__dirname, '..', 'extension'); const FIX = path.resolve(__dirname, 'fixtures'); const URL_ = 'https://dealzone-shop.test/product/ultra-widget';
(async () => {
  const ud = path.join(__dirname, 'out', 'profile-fp-' + Date.now());
  const ctx = await chromium.launchPersistentContext(ud, { headless: true, channel: 'chromium', viewport: { width: 1200, height: 800 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); const extId = new URL(sw.url()).host;
  await ctx.route('**/*', (route) => { const r = route.request(); const u = r.url(); if (u.startsWith('chrome-extension://')) return route.continue(); if (u.startsWith(URL_) && r.resourceType() === 'document') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(FIX, 'shop.html'), 'utf8') }); return route.abort(); });
  const page = await ctx.newPage(); await page.goto(URL_, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(5000);
  const { state } = await sw.evaluate((u) => handle({ type: 'testStateByUrl', url: u }, {}), URL_);
  const problems = []; if (!state || !state.report || state.report.findings.length < 20) problems.push('the scan did not run');
  const trace = await page.evaluate(async (id) => {
    const out = {}; out.attrs = document.querySelectorAll('[data-ml-id],[data-ml-fids],[data-ml-scanned],.ml-flag').length; out.scanned = document.documentElement.getAttribute('data-ml-scanned');
    out.globals = ['ML', 'MLCommon', 'SubtextView', '__ML_LAST', '__ML_RUN'].filter((k) => k in window);
    out.named = document.querySelectorAll('[id^="ml-"],[class^="ml-"]').length + Array.from(document.body.children).filter((e) => /subtext/i.test(e.tagName)).length; out.host = Array.from(document.body.children).filter((e) => e.tagName.includes('-')).map((e) => ({ tag: e.tagName, open: !!e.shadowRoot }));
    try { const r = await fetch('chrome-extension://' + id + '/rules/text-rules.json'); out.fetched = r.ok; } catch (e) { out.fetched = false; }
    return out;
  }, extId);
  if (trace.named) problems.push('a stable name is visible to the page: ' + trace.named); if (trace.attrs) problems.push('page-visible marks: ' + trace.attrs); if (trace.scanned != null) problems.push('data-ml-scanned present'); if (trace.globals.length) problems.push('page globals: ' + trace.globals); if (trace.fetched) problems.push('rule files reachable from the page'); if (trace.host.some((h) => h.open)) problems.push('shadow root is open');
  await ctx.close(); fs.rmSync(ud, { recursive: true, force: true });
  console.log(problems.length ? '✗ fingerprint: ' + problems.join(' | ') : '✓ fingerprint: no attributes, no globals, no reachable files, closed shadow root (host element remains: ' + JSON.stringify(trace.host) + ')');
  if (problems.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
