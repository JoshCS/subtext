/* Live-page check: runs the real extension on the pages in eval/real/pages.json (real network, registration lookup on) and
   writes what the panel says for each (reading, glance chips with evidence, source facts, purchase path, provenance) to
   eval/out-real/<name>.json plus a panel screenshot. Used for the adversarial passes on 4 Nov 2026; read the JSON and the PNGs,
   then attack every claim. Usage: node eval/real-pages.js [name,name]   (or: npm run eval:real) */
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const EXT = path.join(ROOT, 'extension');
require(path.join(ROOT, 'extension/common.js')); const labels = require(path.join(ROOT, 'extension/rules/labels.json'));
const OUT = path.join(ROOT, 'eval', 'out-real'); fs.mkdirSync(OUT, { recursive: true }); const PAGES = JSON.parse(fs.readFileSync(path.join(__dirname, 'real', 'pages.json'), 'utf8'));
const only = process.argv[2] ? process.argv[2].split(',') : null;
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(OUT, 'profile-' + Date.now()), { headless: true, channel: 'chromium', viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`], userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await require('../test/hooks')(sw);
  await sw.evaluate(async () => { const s = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: Object.assign({}, s.settings || {}, { rdapLookup: true, tosdrLookup: false, aiWebCheck: false }) }); });
  const results = [];
  for (const p of PAGES) {
    if (only && !only.includes(p.name)) continue;
    const page = await ctx.newPage(); const t0 = Date.now(); let note = '';
    try { await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 45000 }); } catch (e) { note = 'goto: ' + e.message.split('\n')[0]; }
    try { await page.waitForFunction(() => document.documentElement.dataset.mlScanned != null, null, { timeout: 25000 }); } catch (e) { note += ' no scan in 25s'; }
    await page.waitForTimeout(9000); // behaviour detectors, policy fetch, RDAP
    const tabs = await sw.evaluate(() => chrome.tabs.query({})); const tab = tabs.find((t) => t.url === page.url()) || tabs.find((t) => t.url && t.url.startsWith(p.url.split('?')[0].slice(0, 40)));
    let state = null; if (tab) state = await sw.evaluate(async (id) => { const st = await getState(id); return st; }, tab.id);
    const r = { name: p.name, url: page.url(), title: await page.title().catch(() => ''), note, ms: Date.now() - t0 };
    if (state && state.report) {
      const F = (state.report.findings || []).concat(state.outletFindings || []).map((f) => Object.assign({}, f, MLCommon.labelFor(f, labels), { weight: MLCommon.findingWeight(f) })).sort((a, b) => b.severity - a.severity || b.weight - a.weight);
      const score = MLCommon.scoreFindings(F);
      r.grade = score.grade + ' ' + score.score + ' (' + score.label + ')'; r.flags = F.filter((f) => f.severity > 0).length; r.serious = F.filter((f) => f.severity >= 3).length;
      r.reading = MLCommon.reading(F, state).text;
      r.chips = F.filter((f) => f.severity > 0).slice(0, 8).map((f) => f.label + ' [' + f.id + ' s' + f.severity + ' c' + f.confidence + ' ×' + f.count + '] ' + f.why + (f.evidence && f.evidence[0] ? ' ← "' + String(f.evidence[0].quote).slice(0, 120) + '"' : ''));
      r.outlet = state.outlet ? { name: state.outlet.entry.name, owners: state.outlet.entry.owners.map((o) => o.name), funding: state.outlet.entry.funding, funders: state.outlet.entry.funders || [] } : null;
      r.meta = state.report.meta; r.provenance = state.report.provenance; r.transaction = state.report.transaction;
      r.all = F.map((f) => f.id + '(' + f.severity + ')');
      r.bm = (F.find((f) => f.id === 'incentives.business_model') || {}).name || null;
      r.purchase = F.find((f) => f.id === 'incentives.purchase_path') || null; r.operator = F.find((f) => f.id === 'source.unknown_operator') || null;
      // panel screenshot
      try { await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'togglePanel', on: true }), tab.id); await page.waitForTimeout(700); await page.screenshot({ path: path.join(OUT, p.name + '.png') }); } catch (e) { r.note += ' shot: ' + e.message.split('\n')[0]; }
    } else r.note += ' no state';
    results.push(r); fs.writeFileSync(path.join(OUT, p.name + '.json'), JSON.stringify(r, null, 1));
    console.log(p.name.padEnd(12), (r.grade || '-').padEnd(26), 'flags', r.flags == null ? '-' : r.flags, '| outlet', r.outlet ? r.outlet.name : '-', '|', (r.reading || r.note || '').slice(0, 150));
    await page.close().catch(() => {});
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(results, null, 1));
  await ctx.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
