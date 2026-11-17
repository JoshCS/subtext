/* Runs the extension on the scam test pages: listed pages and honest shops, each served from its archived copy at its original address, every other request aborted. No site is contacted.
   Usage: node eval/scam-run.js <label> <train|holdout>. Writes eval/out-corpus/<label>-scam-<split>.json. */
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..'); const EXT = path.join(ROOT, 'extension'); const OUT = path.join(__dirname, 'out-corpus'); require(path.join(EXT, 'common.js')); const labels = require(path.join(EXT, 'rules', 'labels.json'));
process.on('unhandledRejection', (e) => { if (!/ERR_ABORTED|ERR_FAILED|closed/.test(String(e && e.message))) { console.error(e); process.exit(1); } });
const SELLER = fs.existsSync(path.join(__dirname, 'corpus-seller', 'index.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus-seller', 'index.json'), 'utf8')) : {}; const label = process.argv[2] || 'scam'; const split = process.argv[3] || 'train'; const PAGES = JSON.parse(fs.readFileSync(path.join(OUT, 'scam-sets.json'), 'utf8')).filter((p) => p.split === split && (!process.env.ONLY || process.env.ONLY.split(',').includes(p.domain)));
async function one(p) {
  const ud = path.join(OUT, 'profile-' + label + '-' + p.domain); const r = { domain: p.domain, set: p.set, kind: p.kind, source: p.source, language: p.language };
  const ctx = await chromium.launchPersistentContext(ud, { headless: true, channel: 'chromium', viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  try {
    const html = fs.readFileSync(path.join(ROOT, p.file)); const start = new URL(p.original).href;
    // the shop's own contact, legal and terms pages, robots.txt and sitemap, archived by eval/seller-pages-fetch.py; everything else is aborted
    const norm = (u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + x.search; } catch (e) { return u; } };
    const missed = new Set(); const own = new Map(); for (const g of ((SELLER[p.domain] || {}).pages || [])) own.set(norm(g.url), g.file);
    await ctx.route(/^https?:/, (route) => { const req = route.request(); if (req.isNavigationRequest() && req.frame() === req.frame().page().mainFrame() && req.url().split('#')[0] === start) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      const f = own.get(norm(req.url())); if (f && !process.env.NO_SELLER_PAGES) return route.fulfill({ status: 200, contentType: /\.xml$/.test(f) ? 'application/xml' : /\.txt$/.test(f) ? 'text/plain' : 'text/html; charset=utf-8', body: fs.readFileSync(path.join(ROOT, 'eval', 'corpus-seller', f)) });
      try { const h = new URL(req.url()).hostname.replace(/^www\./, ''); if (h.split('.').slice(-2).join('.') === p.domain.replace(/^www\./, '').split('.').slice(-2).join('.') && req.url().split('#')[0] !== start && !/\.(js|css|png|jpe?g|gif|svg|webp|woff2?|ico|mp4)(\?|$)/i.test(req.url())) missed.add(req.url()); } catch (e) { /* ignore */ }
      return route.abort(); });
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); await require('../test/hooks')(sw);
    const page = await ctx.newPage(); await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.documentElement.dataset.mlScanned != null, null, { timeout: 20000 }); await page.waitForTimeout(own.size && !process.env.NO_SELLER_PAGES ? 7000 : 2500);
    const tabs = await sw.evaluate(() => chrome.tabs.query({})); const tab = tabs.find((t) => t.url === page.url()); const st = await sw.evaluate((id) => getState(id), tab.id);
    const all = st.report.findings.concat(st.report.held || [], st.outletFindings || []); const F = all.map((f) => Object.assign({}, f, MLCommon.labelFor(f, labels)));
    Object.assign(r, { title: await page.title(), chars: st.report.meta.textChars, sells: !!((st.report.meta.commerce || {}).sells), errorPage: !!st.report.meta.errorPage, shop: st.report.meta.shop || null, offPage: (st.report.provenance || {}).offPage || null, missed: Array.from(missed).slice(0, 30), seller: (F.find((f) => f.meta && f.meta.shop) || {}).why || null, sellerSev: (F.find((f) => f.meta && f.meta.shop) || {}).severity, hits: F.filter((f) => f.id !== 'source.listed_warning' && (f.severity > 0 || /thin_shop/.test(f.id))).map((f) => f.id), thin: (F.find((f) => f.id === 'source.thin_shop') || {}).why || null, reading: MLCommon.reading(st.report.findings.concat(st.outletFindings || []).filter((f) => f.id !== 'source.listed_warning').map((f) => Object.assign({}, f, MLCommon.labelFor(f, labels))), st).text });
  } catch (e) { r.error = String(e.message).split('\n')[0]; }
  await ctx.close().catch(() => {}); fs.rmSync(ud, { recursive: true, force: true }); return r;
}
(async () => {
  const q = PAGES.slice(); const res = []; await Promise.all(Array.from({ length: 4 }, async () => { while (q.length) res.push(await one(q.shift())); }));
  res.sort((a, b) => a.domain.localeCompare(b.domain)); fs.writeFileSync(path.join(OUT, label + '-scam-' + split + '.json'), JSON.stringify(res, null, 1));
  for (const set of ['bad', 'honest']) { const S = res.filter((r) => r.set === set && !r.error); const c = {}; for (const r of S) for (const h of new Set(r.hits)) c[h] = (c[h] || 0) + 1; const thin = S.filter((r) => r.sellerSev >= 2); const counted = S.filter((r) => r.sellerSev >= 2 || r.hits.some((h) => /^source\.(no_prescription|scare_support)$/.test(h))); console.log(set, 'pages', S.length, 'sells', S.filter((r) => r.sells).length, 'scam rules fired', counted.length, 'errors', res.filter((r) => r.set === set && r.error).length, '| top', Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ':' + v).join(' ')); if (set === 'honest') console.log(' honest hits:', thin.map((r) => r.domain + ' [' + r.seller + ']').join(' ; ').slice(0, 900)); }
})();
