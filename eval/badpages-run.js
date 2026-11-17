/* Runs the extension on the archived known-bad pages (eval/corpus-bad). Each page is served by this script at its original address, every other request is aborted,
   so no listed site is ever contacted. Writes eval/out-corpus/<label>-bad.json in the same shape as corpus-run.js. Usage: node eval/badpages-run.js <label> */
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const EXT = path.join(ROOT, 'extension'); const DIR = path.join(__dirname, 'corpus-bad'); const OUT = path.join(__dirname, 'out-corpus');
require(path.join(EXT, 'common.js')); const labels = require(path.join(EXT, 'rules', 'labels.json'));
process.on('unhandledRejection', (e) => { if (!/ERR_ABORTED|ERR_FAILED/.test(String(e && e.message))) { console.error(e); process.exit(1); } });
const label = process.argv[2] || 'bad'; const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
async function one(p) {
  const ud = path.join(OUT, 'profile-' + label + '-' + p.domain); const r = { name: p.domain, group: p.source, split: 'bad', url: p.original, listed: p.listed, capture: p.capture };
  const ctx = await chromium.launchPersistentContext(ud, { headless: true, channel: 'chromium', viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  try {
    const html = fs.readFileSync(path.join(DIR, p.domain + '.html')); const start = new URL(p.original).href;
    await ctx.route(/^https?:/, (route) => { const req = route.request(); if (req.isNavigationRequest() && req.frame() === req.frame().page().mainFrame() && req.url().split('#')[0] === start) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }); return route.abort(); });
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); await require('../test/hooks')(sw);
    const page = await ctx.newPage(); await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.documentElement.dataset.mlScanned != null, null, { timeout: 20000 }); await page.waitForTimeout(2500);
    const tabs = await sw.evaluate(() => chrome.tabs.query({})); const tab = tabs.find((t) => t.url === page.url()); const st = await sw.evaluate((id) => getState(id), tab.id);
    const F = st.report.findings.concat(st.outletFindings || []).map((f) => Object.assign({}, f, MLCommon.labelFor(f, labels)));
    const withoutList = F.filter((f) => f.id !== 'source.listed_warning');
    Object.assign(r, { title: await page.title(), chars: st.report.meta.textChars, meta: st.report.meta, reading: MLCommon.reading(F, st).text, readingOwn: MLCommon.reading(withoutList, st).text, held: (st.report.held || []).map((f) => f.id), findings: F.map((f) => ({ id: f.id, category: f.category, label: f.label, why: f.why, severity: f.severity, count: f.count, evidence: (f.evidence || []).slice(0, 3).map((e) => ({ quote: String(e.quote || '').slice(0, 300), match: e.match })) })) });
  } catch (e) { r.error = String(e.message).split('\n')[0]; }
  await ctx.close().catch(() => {}); fs.rmSync(ud, { recursive: true, force: true }); return r;
}
(async () => {
  const q = index.slice(); const res = [];
  await Promise.all(Array.from({ length: 4 }, async () => { while (q.length) res.push(await one(q.shift())); }));
  res.sort((a, b) => a.name.localeCompare(b.name)); fs.writeFileSync(path.join(OUT, label + '-bad.json'), JSON.stringify(res, null, 1));
  console.log(label + '/bad: ' + res.filter((r) => !r.error).length + ' pages, ' + res.filter((r) => r.error).length + ' errors');
})();
