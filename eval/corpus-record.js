/* Records each corpus page once into a HAR (eval/corpus/<name>.har, gitignored: third-party content, never commit or publish), with the real
   extension loaded so its policy-page fetches are captured too. Replay with eval/corpus-run.js gives before/after numbers free of site drift.
   Usage: node eval/corpus-record.js [name,name]   Skips pages already recorded. */
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const EXT = path.join(ROOT, 'extension'); const OUT = path.join(__dirname, 'corpus'); fs.mkdirSync(OUT, { recursive: true });
const PAGES = JSON.parse(fs.readFileSync(path.join(__dirname, 'real', 'corpus-pages.json'), 'utf8'));
const only = process.argv[2] ? process.argv[2].split(',') : null; const WORKERS = 4;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
async function record(p) {
  const har = path.join(OUT, p.name + '.har'); if (fs.existsSync(har) && !only) return 'skip';
  const ud = path.join(OUT, 'profile-' + p.name); let note = 'ok';
  const ctx = await chromium.launchPersistentContext(ud, { headless: true, channel: 'chromium', viewport: { width: 1280, height: 900 }, userAgent: UA, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  try {
    await ctx.routeFromHAR(har, { update: true, updateContent: 'embed', updateMode: 'minimal', url: /^https?:/ });
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); await require('../test/hooks')(sw);
    const page = await ctx.newPage();
    await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => document.documentElement.dataset.mlScanned != null, null, { timeout: 25000 }).catch(() => { note = 'no-scan'; });
    await page.mouse.wheel(0, 2500); await page.waitForTimeout(9000); await page.mouse.wheel(0, -2500); await page.waitForTimeout(2000);
    fs.writeFileSync(path.join(OUT, p.name + '.meta.json'), JSON.stringify({ finalUrl: page.url(), title: await page.title(), recorded: new Date().toISOString() }));
  } catch (e) { note = 'error: ' + e.message.split('\n')[0]; }
  await ctx.close().catch(() => {}); fs.rmSync(ud, { recursive: true, force: true });
  return note;
}
(async () => {
  const q = PAGES.filter((p) => !only || only.includes(p.name)); let done = 0;
  await Promise.all(Array.from({ length: WORKERS }, async () => { while (q.length) { const p = q.shift(); const n = await record(p).catch((e) => 'error: ' + e.message.split('\n')[0]); done++; console.log(done, p.name.padEnd(22), n); } }));
})();
