/* Replays the recorded corpus through the current extension (offline, from the HARs) and writes eval/out-corpus/<label>.json:
   for each page the reading, grade, findings with evidence and block context. Registration lookups and AI are off, so runs are comparable.
   Usage: node eval/corpus-run.js <label> [train|holdout|all] [name,name] */
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const EXT = path.join(ROOT, 'extension'); const DIR = process.env.CORPUS_DIR ? path.resolve(process.env.CORPUS_DIR) : path.join(__dirname, 'corpus'); const OUT = path.join(__dirname, 'out-corpus'); fs.mkdirSync(OUT, { recursive: true });
require(path.join(EXT, 'common.js')); const labels = require(path.join(EXT, 'rules', 'labels.json'));
const label = process.argv[2] || 'run'; const split = process.argv[3] || 'train'; const only = process.argv[4] ? process.argv[4].split(',') : null;
const PAGES = JSON.parse(fs.readFileSync(process.env.CORPUS_PAGES ? path.resolve(process.env.CORPUS_PAGES) : path.join(__dirname, 'real', 'corpus-pages.json'), 'utf8')).filter((p) => (split === 'all' || p.split === split) && (!only || only.includes(p.name)) && fs.existsSync(path.join(DIR, p.name + '.har')));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
// an ad iframe whose recording is missing aborts in Playwright with no awaiter; that is the replay, not the extension, and must not end the run
const replayNoise = (e) => /ERR_ABORTED|ERR_FAILED|closed|Target page|redirectNavigation/i.test(String(e && (e.message || e)) + String(e && e.type));
process.on('unhandledRejection', (e) => { if (!replayNoise(e)) { console.error(e); process.exit(1); } });
process.on('uncaughtException', (e) => { if (!replayNoise(e)) { console.error(e); process.exit(1); } });
async function one(p) {
  const ud = path.join(OUT, 'profile-' + label + '-' + p.name); const r = { name: p.name, group: p.group, split: p.split, url: p.url };
  const ctx = await chromium.launchPersistentContext(ud, { headless: true, channel: 'chromium', viewport: { width: 1280, height: 900 }, userAgent: UA, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  try {
    await ctx.routeFromHAR(path.join(DIR, p.name + '.har'), { notFound: 'abort', url: /^https?:/ });
    // recorded before Subtext read ads.txt: served from a copy so the replay can see it. A later route wins over the HAR.
    if (!process.env.CORPUS_DIR) await ctx.route(/\/ads\.txt(\?|$)/, (route) => { const h = new URL(route.request().url()).hostname.replace(/^www\./, ''); const f = path.join(__dirname, 'corpus-ads', h + '.txt'); return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/plain', body: fs.readFileSync(f) }) : route.fulfill({ status: 404, body: '' }); });
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    await require('../test/hooks')(sw);
    const page = await ctx.newPage(); const errs = []; page.on('console', (m) => { if (/\[Subtext\].*fail/i.test(m.text())) errs.push(m.text().slice(0, 240)); });
    await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => document.documentElement.dataset.mlScanned != null, null, { timeout: 25000 });
    await page.mouse.wheel(0, 2500); await page.waitForTimeout(6000);
    const cur = page.url(); const tabs = await sw.evaluate(() => chrome.tabs.query({})); const tab = tabs.find((t) => t.url === cur);
    const st = tab ? await sw.evaluate((id) => getState(id), tab.id) : null;
    if (!st || !st.report) throw new Error('no state');
    const F = st.report.findings.concat(st.outletFindings || []).map((f) => Object.assign({}, f, MLCommon.labelFor(f, labels), { weight: MLCommon.findingWeight(f) })).sort((a, b) => b.severity - a.severity || b.weight - a.weight);
    const score = MLCommon.scoreFindings(F);
    Object.assign(r, { title: await page.title(), finalUrl: cur, errs, grade: score.grade, score: score.score, flags: F.filter((f) => f.severity > 0).length, serious: F.filter((f) => f.severity >= 3).length, reading: MLCommon.reading(F, st).text, owner: st.owner || null, chars: st.report.meta.textChars, meta: st.report.meta, outlet: st.outlet ? st.outlet.entry.name : null, provenance: st.report.provenance, transaction: st.report.transaction,
      held: (st.report.held || []).map((f) => ({ id: f.id, severity: f.severity, count: f.count, evidence: (f.evidence || []).slice(0, 3).map((e) => ({ quote: String(e.quote || '').slice(0, 300), match: e.match })) })), findings: F.map((f) => ({ id: f.id, category: f.category, label: f.label, why: f.why, severity: f.severity, confidence: f.confidence, count: f.count, source: f.source, evidence: (f.evidence || []).slice(0, 3).map((e) => ({ quote: e.quote, match: e.match, url: e.url })) })) });
  } catch (e) { r.error = e.message.split('\n')[0]; }
  await ctx.close().catch(() => {}); fs.rmSync(ud, { recursive: true, force: true });
  return r;
}
(async () => {
  const q = PAGES.slice(); const res = [];
  await Promise.all(Array.from({ length: +(process.env.CORPUS_WORKERS || 4) }, async () => { while (q.length) { const p = q.shift(); const r = await one(p); res.push(r); } }));
  res.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(OUT, label + '-' + split + '.json'), JSON.stringify(res, null, 1));
  const ok = res.filter((r) => !r.error), errs = res.filter((r) => r.error);
  console.log(`${label}/${split}: ${ok.length} pages, ${errs.length} errors` + (errs.length ? ' (' + errs.map((e) => e.name).join(', ') + ')' : ''));
  const swallowed = ok.filter((r) => r.errs && r.errs.length); if (swallowed.length) console.log('SWALLOWED ERRORS on: ' + swallowed.map((r) => r.name + ': ' + r.errs[0]).join(' | '));
  if (split !== 'holdout') for (const r of ok) console.log(`${r.name.padEnd(20)} ${r.grade} ${String(r.score).padStart(3)} f${String(r.flags).padStart(3)} s${r.serious} | ${r.reading.slice(0, 150)}`);
})();
