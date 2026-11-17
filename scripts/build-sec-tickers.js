/* Builds extension/data/sec-tickers.json from the SEC's public list of company tickers (public domain).
   Used only when a company's Wikidata item gives a ticker but no SEC number: the ticker AND the company name must both match.
   Usage: node scripts/build-sec-tickers.js   (run at release, like npm run lists) */
const fs = require('fs'); const path = require('path');
(async () => {
  const r = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: { 'User-Agent': process.env.SEC_USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36', accept: 'application/json' } });
  if (!r.ok) throw new Error('SEC answered ' + r.status);
  const j = await r.json(); const rows = {};
  for (const x of Object.values(j)) { const t = String(x.ticker || '').toUpperCase(); if (!/^[A-Z][A-Z0-9.-]{0,6}$/.test(t) || !x.cik_str || rows[t]) continue; rows[t] = [Number(x.cik_str), String(x.title || '').slice(0, 60)]; }
  const out = { built: new Date().toISOString().slice(0, 10), source: 'https://www.sec.gov/files/company_tickers.json', licence: 'US government work, public domain', rows };
  fs.writeFileSync(path.join(__dirname, '..', 'extension', 'data', 'sec-tickers.json'), JSON.stringify(out));
  console.log(Object.keys(rows).length + ' tickers written');
})().catch((e) => { console.error(e.message); process.exit(1); });
