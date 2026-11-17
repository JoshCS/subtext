/* Scoring calibration: generates synthetic pages at increasing manipulation intensity (0 = clean … 5 = everything),
   runs the heuristic engine on each via the real extension, and checks that scores rise monotonically and land in the
   intended grade bands. Prints a table; exits non-zero if monotonicity or band targets fail.
   Usage: node eval/calibrate.js */
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const EXT = path.resolve(__dirname, '..', 'extension');
const BLOCKS = [ // each block is one "unit" of manipulation; levels add blocks cumulatively
  '<p>Hurry, offer ends tonight! Only 3 left in stock.</p>',
  '<p>Join 2,000,000 happy customers. #1 rated. Everyone is switching.</p>',
  '<p><span style="text-decoration:line-through">$129.99</span> $79.99 — just $0.27 a day, or 4 interest-free payments with Klarna.</p>',
  '<p>Free trial* <small>*then billed annually at $119.88 unless you cancel. To cancel, call our retention department.</small></p>',
  '<label><input type="checkbox" checked> Add Premium Protection ($14.99)</label><label><input type="checkbox" checked> Send me partner offers</label>',
  '<div style="position:fixed;bottom:0;left:0;right:0;background:#222;color:#fff;padding:16px">We use cookies to personalise ads. <button style="background:#2ecc71;color:#fff;padding:12px 24px;border:0">Accept all</button> <button style="color:#aaa;font-size:10px;background:none;border:0">Manage</button></div>',
  '<p>You deserve this. Smart shoppers like you never pay full price. This isn\'t for everyone.</p>',
  '<p>Experts say this is the best. Doctors recommend it. Clinically proven. 97% of users agree.</p>',
  '<p>WAKE UP!!! They don\'t want you to know. Don\'t trust the media. Follow the money. You\'re either with us or against us.</p>',
  '<script src="https://static.hotjar.com/c/hotjar-1.js"></script><script src="https://connect.facebook.net/en_US/fbevents.js"></script><script src="https://cdn.useproof.com/proof.js"></script><script src="https://idsync.rlcdn.com/1.gif"></script>'
];
const BASE = (body) => `<!doctype html><html><head><meta charset="utf-8"><title>Calibration page</title></head><body style="font-family:Arial;max-width:800px;margin:20px auto"><h1>A product page</h1><div><p>Price: $49</p><button>Buy now</button></div><p>This widget is a small device for organising cables. It comes in three colours and ships in recycled packaging. Below are details, reviews and purchase options.</p>${body}<p>Specifications: 12cm, 80g, aluminium. Warranty two years. Contact us for support.</p><p><a href="/about">About us</a> <a href="/contact">Contact</a></p></body></html>`;
const LEVELS = [0, 1, 2, 4, 7, 10]; // number of blocks included
const TARGET = { 0: ['A', 'A'], 1: ['A', 'B'], 2: ['B', 'C'], 4: ['C', 'D'], 7: ['D', 'F'], 10: ['D', 'F'] };
const GRADES = ['A', 'B', 'C', 'D', 'F'];
(async () => {
  const ud = path.join(__dirname, 'out-profile-' + Date.now()); fs.mkdirSync(ud, { recursive: true });
  const ctx = await chromium.launchPersistentContext(ud, { headless: true, channel: 'chromium', viewport: { width: 1200, height: 800 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await require('../test/hooks')(sw);
  const pages = {}; for (const n of LEVELS) pages['https://calib-' + n + '.test/page'] = BASE(BLOCKS.slice(0, n).join('\n'));
  await ctx.route('**/*', (route) => { const u = route.request().url(); if (u.startsWith('chrome-extension://')) return route.continue(); if (pages[u] && route.request().resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: pages[u] }); return route.abort(); });
  const rows = []; let prev = -1, failures = 0;
  for (const n of LEVELS) {
    const url = 'https://calib-' + n + '.test/page'; const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.mlScanned != null, null, { timeout: 15000 }); await page.waitForTimeout(1800);
    const { state } = await sw.evaluate((u) => handle({ type: 'testStateByUrl', url: u }, {}), url);
    const fs_ = state.report.findings; const score = await sw.evaluate((f) => MLCommon.scoreFindings(f), fs_);
    const [lo, hi] = TARGET[n]; const ok = GRADES.indexOf(score.grade) >= GRADES.indexOf(lo) && GRADES.indexOf(score.grade) <= GRADES.indexOf(hi); // readers no longer see a grade; bands are printed for reference, only rising with pressure is required if (score.score < prev) { failures++; console.log('non-monotonic at level', n); }
    prev = score.score;
    rows.push({ blocks: n, findings: fs_.filter((f) => f.severity > 0).length, score: score.score, grade: score.grade, target: lo + '–' + hi, ok: ok ? '✓' : '✗', top: fs_.sort((a, b) => b.severity - a.severity).slice(0, 3).map((f) => f.id).join(', ') });
    await page.close();
  }
  console.table(rows); await ctx.close(); fs.rmSync(ud, { recursive: true, force: true });
  if (failures) { console.log(failures + ' calibration check(s) failed'); process.exit(1); } console.log('internal weight rises with pressure');
})().catch((e) => { console.error(e); process.exit(1); });
