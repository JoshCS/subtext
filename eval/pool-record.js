/* Records the frozen pool (eval/pool/frozen-pool-2026-11-05.json) into eval/pool/har/, with a screenshot of each page for the human labellers. Takes domains in frozen order inside each stratum and stops at the target,
   so nobody chooses which sites survive. A site is skipped, and the reason recorded, if a family-safe DNS filter blocks it, if it fails to load, or if it has under 300 characters of text. Half the sites use the home page and half one
   inner page picked by a hash of the domain, so product pages and articles are in the sample. No scoring or judging happens here. Never print or read the results while tuning.
   Usage: node eval/pool-record.js [how many per stratum, for a trial]. Third-party content: gitignored, never publish. */
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs'); const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..'); const EXT = path.join(ROOT, 'extension'); const DIR = path.join(__dirname, 'pool'); const HAR = path.join(DIR, 'har'); fs.mkdirSync(HAR, { recursive: true });
const POOL = JSON.parse(fs.readFileSync(path.join(DIR, 'frozen-pool-2026-11-05.json'), 'utf8')); const trial = +process.argv[2] || 0;
const LOG = path.join(DIR, 'recorded.json'); const done = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : {};
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const h = (s) => crypto.createHash('sha256').update(s).digest();
async function unsafe(domain) { // Cloudflare's family resolver answers 0.0.0.0 for malware and adult sites. It sees the pool's domains only, not anyone's browsing.
  try { const r = await fetch('https://family.cloudflare-dns.com/dns-query?type=A&name=' + encodeURIComponent(domain), { headers: { accept: 'application/dns-json' } }); const j = await r.json(); return (j.Answer || []).some((a) => a.data === '0.0.0.0') ? 'filtered' : j.Answer ? null : 'no-dns'; } catch (e) { return 'dns-error'; }
}
async function record(p) {
  const bad = await unsafe(p.domain); if (bad) return { status: bad };
  const name = 'pool-' + p.domain.replace(/[^a-z0-9.-]/g, '_'); const ud = path.join(HAR, 'profile-' + name); const out = { name, status: 'ok' }; const inner = h(p.domain)[0] % 2 === 1;
  const ctx = await chromium.launchPersistentContext(ud, { headless: true, channel: 'chromium', viewport: { width: 1280, height: 900 }, userAgent: UA, acceptDownloads: false, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  try {
    await ctx.routeFromHAR(path.join(HAR, name + '.har'), { update: true, updateContent: 'embed', updateMode: 'minimal', url: /^https?:/ });
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'); await require('../test/hooks')(sw);
    const page = await ctx.newPage(); await page.goto('https://' + p.domain + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);
    if (inner) {
      const links = await page.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll('a[href]')).map((a) => a.href))).filter((u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') === location.hostname.replace(/^www\./, '') && x.pathname.length > 1 && !/login|signin|sign-in|account|cart|checkout|register|privacy|terms|cookie|contact/i.test(x.pathname) && !/\.(pdf|zip|exe|dmg|png|jpe?g)$/i.test(x.pathname); } catch (e) { return false; } }).sort());
      if (links.length) { const u = links[h(p.domain + 'inner').readUInt32BE(0) % links.length]; await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 }); out.kind = 'inner'; }
    }
    out.kind = out.kind || 'home';
    await page.waitForFunction(() => document.documentElement.dataset.mlScanned != null, null, { timeout: 25000 }).catch(() => { out.status = 'no-scan'; });
    await page.mouse.wheel(0, 2500); await page.waitForTimeout(9000); await page.mouse.wheel(0, -2500); await page.waitForTimeout(2000);
    const chars = await page.evaluate(() => (document.body.innerText || '').length); if (chars < 300) out.status = 'thin';
    out.url = page.url(); out.title = await page.title(); out.chars = chars;
    await page.screenshot({ path: path.join(HAR, name + '.jpg'), type: 'jpeg', quality: 60, fullPage: false, timeout: 15000 }).catch(() => {});
  } catch (e) { out.status = 'error'; out.note = String(e.message).split('\n')[0].slice(0, 120); }
  await ctx.close().catch(() => {}); fs.rmSync(ud, { recursive: true, force: true });
  if (out.status !== 'ok') { fs.rmSync(path.join(HAR, name + '.har'), { force: true }); fs.rmSync(path.join(HAR, name + '.jpg'), { force: true }); }
  return out;
}
(async () => {
  for (const s of POOL.strata) {
    const target = trial || POOL.targets[s]; const list = POOL.pool.filter((p) => p.stratum === s).sort((a, b) => a.order - b.order); let i = 0, good = list.filter((p) => (done[p.domain] || {}).status === 'ok').length;
    await Promise.all(Array.from({ length: 4 }, async () => { while (i < list.length && good < target) { const p = list[i++]; if (done[p.domain]) continue; const r = await Promise.race([record(p).catch((e) => ({ status: 'error', note: String(e.message).slice(0, 120) })), new Promise((res) => setTimeout(() => res({ status: 'timeout' }), 180000))]); done[p.domain] = Object.assign({ stratum: s, rank: p.rank, order: p.order }, r); if (r.status === 'ok') good++; fs.writeFileSync(LOG, JSON.stringify(done)); } }));
    console.log(s, 'kept', good, 'tried', i); // counts only
  }
  process.exit(0); // a site that timed out may have left a browser open
})();
