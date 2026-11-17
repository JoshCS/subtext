/* Live run of "Show context" in the real extension on real pages (real network). Headless, with a normal Chrome user agent, so no
   window takes focus and sites answer as they would for a reader. For each page it runs the same worker function the button's
   message calls (loadContext, trigger 'click' or 'auto'), records what was chosen and why, and screenshots the panel and the card.
   Output: eval/out-context/<label>/ (git-ignored; third-party content).
   Usage: node eval/context-live.js <label> [pages.json] [--auto] [--repeat]
     pages.json: [{ id, url, ... }] (default: five pages, one per page group). --auto: the automatic trigger (no Google Trends).
     --repeat: run every page twice and report whether the leading chart is the same both times. */
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
const L = require('../test/ui/lib');
const EXT = path.join(__dirname, '..', 'extension');
const args = process.argv.slice(2); const flags = new Set(args.filter((a) => a.startsWith('--'))); const pos = args.filter((a) => !a.startsWith('--'));
const label = pos[0] || 'run';
const OUT = path.join(__dirname, 'out-context', label);
const PAGES = pos[1] ? JSON.parse(fs.readFileSync(pos[1], 'utf8')) : [
  { id: 'news', url: 'https://www.bostonglobe.com/2026/10/30/sports/boston-sports-owners-political-donations/' },
  { id: 'shop', url: 'https://www.allbirds.com/products/mens-wool-runners' },
  { id: 'evergreen', url: 'https://www.tomsguide.com/best-picks/the-best-robot-vacuums' },
  { id: 'organization', url: 'https://www.everytown.org/' },
  { id: 'other', url: 'https://www.notion.com/pricing' },
];
const trigger = flags.has('--auto') ? 'auto' : 'click';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const CONTEXT_HOSTS = /news\.google\.com|wikipedia\.org|wikidata\.org|wikimedia\.org|trends\.google\.com|web\.archive\.org|tranco-list\.eu|dns\.google|hn\.algolia\.com|propublica\.org|sec\.gov|api\.open\.fec\.gov|api\.bls\.gov|worldbank\.org|ourworldindata\.org|stlouisfed\.org|europa\.eu/;
const summarize = (c) => {
  const r = (c && c.result) || {};
  return { status: c && c.status, error: c && c.error, group: r.group, subject: r.subject, terms: r.terms && { entity: r.terms.entity, topic: r.terms.topic, query: r.terms.query }, requests: r.requests,
    charts: (r.charts || []).map((x) => ({ id: x.id, basis: x.basis, about: x.about, aboutLabel: x.aboutLabel, title: x.title, kind: x.kind, points: (x.points || []).length, missing: (x.points || []).filter((p) => p.v == null).length, sentence: x.sentence, note: x.note, source: x.source && x.source.name, rows: (x.rows || []).map((w) => w.t + ' ' + w.text) })),
    facts: (r.facts || []).map((x) => x.label + ': ' + x.text), ran: (r.ran || []).map((x) => x.id + (x.ok ? (x.chart ? ' chart' : ' ok') : x.error ? ' failed: ' + x.error : ' nothing') + ' | sent ' + x.sends) };
};
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.join(OUT, 'profile-' + Date.now());
  const context = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--user-agent=' + UA] });
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await require('../test/hooks')(sw); // test hooks: a fixed panel host tag, so the closed shadow root can be read through CDP
  const contextRequests = []; context.on('request', (r) => { if (CONTEXT_HOSTS.test(r.url())) contextRequests.push(r.url()); });
  const report = [];
  const runOnce = (tab, url) => sw.evaluate(async ([id, u, trig]) => { const s0 = await getState(id); if (s0) { delete s0.context; tabState.set(id, s0); } const r = await loadContext(id, u, trig).catch((e) => ({ error: String(e.message || e) })); const s = await getState(id); return { r, context: s && s.context }; }, [tab, url, trigger]);
  for (const pg of PAGES) {
    const row = { id: pg.id, url: pg.url };
    try {
      const page = await context.newPage();
      await page.goto(pg.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(() => document.documentElement.dataset.mlScanned != null, null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
      row.finalUrl = page.url(); row.title = await page.title();
      const tab = await L.tabId(sw, page.url());
      for (let i = 0; i < 40; i++) { if (await sw.evaluate((id) => getState(id).then((s) => !!(s && s.report)), tab)) break; await page.waitForTimeout(500); } // the worker's report can arrive well after the page's scan marker
      await page.waitForTimeout(4000); // as the product does before an automatic lookup: late footers and legal names have arrived
      const t0 = Date.now(); const a = await runOnce(tab, page.url()); row.ms = Date.now() - t0;
      Object.assign(row, summarize(a.context)); if (a.r && a.r.error) row.error = a.r.error;
      if (flags.has('--repeat')) { const b = summarize((await runOnce(tab, page.url())).context); row.repeatLead = (b.charts[0] || {}).id || null; row.stable = row.repeatLead === ((row.charts[0] || {}).id || null); }
      const cdp = await context.newCDPSession(page); await cdp.send('DOM.enable');
      await L.togglePanel(sw, page.url(), true).catch(() => {}); await page.waitForTimeout(1200);
      const card = await L.find(cdp, 'ctx').catch(() => null);
      if (card) { try { await cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId: card.nodeId }); } catch (e) { /* ignore */ } await page.waitForTimeout(300); const b = await L.box(cdp, card); if (b && b.bottom > b.top) await page.screenshot({ path: path.join(OUT, pg.id + '-card.png'), clip: { x: Math.max(0, b.left), y: Math.max(0, b.top), width: b.right - b.left, height: Math.min(860, b.bottom - b.top) } }).catch(() => {}); }
      const panel = (await L.rectOf(cdp, 'panel').catch(() => ({}))).rect;
      if (panel) await page.screenshot({ path: path.join(OUT, pg.id + '.png'), clip: { x: panel.left, y: panel.top, width: panel.right - panel.left, height: Math.min(900, panel.bottom - panel.top) } }).catch(() => {});
      await page.close();
    } catch (e) { row.crash = String(e).slice(0, 200); }
    report.push(row);
    const lead = (row.charts || [])[0];
    console.log(String(pg.id).padEnd(34), String(row.status || 'none').padEnd(6), lead ? (lead.basis + '/' + lead.id + ' about ' + lead.about + (lead.aboutLabel ? ' (' + lead.aboutLabel + ')' : '')) : 'NO CHART', '|', row.requests, 'req', row.ms, 'ms', flags.has('--repeat') ? (row.stable ? 'stable' : 'CHANGED') : '', row.crash || row.error || '');
  }
  // a muted site gets no context request at all
  const mutedUrl = PAGES[0].url; const host = new URL(mutedUrl).hostname.replace(/^www\./, '');
  await sw.evaluate((h) => handle({ type: 'muteSite', hostname: h }, {}), host);
  const before = contextRequests.length;
  const page = await context.newPage(); await page.goto(mutedUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}); await page.waitForTimeout(3000);
  const id = await L.tabId(sw, page.url());
  const res = await sw.evaluate(([i, u]) => loadContext(i, u, 'click').catch((e) => ({ error: String(e.message || e) })), [id, page.url()]);
  await page.waitForTimeout(1500);
  const muted = { result: res, newContextRequests: contextRequests.length - before };
  console.log('muted site:', JSON.stringify(muted));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), trigger, pages: report, muted }, null, 1));
  await context.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
})();
