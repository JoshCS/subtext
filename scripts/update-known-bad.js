/* Builds extension/data/known-bad.json from lists other people keep, plus our manual additions, minus our removals.
   Run by hand or in release: npm run lists. Nothing here runs in the browser, and the browser only reads the built file, so no visited site leaves it.
   Sources and why: docs/RELIABILITY.md and extension/data/NOTICE-lists.md
   Options: --from <dir> reads downloaded copies (coi1.csv coi2.csv coi.html hg.txt) instead of fetching. */
const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const OUT = path.join(ROOT, 'extension', 'data', 'known-bad.json');
const URLS = { coi1: 'https://www.coi.gov.cz/userdata/files/dokumenty-ke-stazeni/open-data/rizikove.csv', coi2: 'https://www.coi.gov.cz/userdata/files/dokumenty-ke-stazeni/open-data/rizikove-seznam.csv', coiPage: 'https://coi.gov.cz/pro-spotrebitele/rizikove-e-shopy/', hagezi: 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/fake-onlydomains.txt' };
const fromDir = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : null;
async function get(url, file) { if (fromDir) return fs.readFileSync(path.join(fromDir, file)); const r = await fetch(url, { headers: { 'user-agent': 'subtext-list-builder' } }); if (!r.ok) throw new Error(url + ' ' + r.status); return Buffer.from(await r.arrayBuffer()); }
const domainRe = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const clean = (d) => String(d || '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
function isoFromCz(s) { const m = String(s).match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/); return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : null; }
(async () => {
  // France's financial markets authority (AMF) publishes its blacklists on data.gouv.fr; the file name carries a timestamp, so the API names the current one
  const amfUrl = fromDir ? null : await fetch('https://www.data.gouv.fr/api/1/datasets/641d5dab1d84b530f7720b08/', { headers: { 'user-agent': 'subtext-list-builder' } }).then((r) => r.json()).then((j) => (j.resources || []).find((x) => /csv/i.test(x.format || x.url)).url);
  const amf = await get(amfUrl, 'amf.csv');
  const [coi1, coi2, coiPage, hg, pf, esma] = await Promise.all([get(URLS.coi1, 'coi1.csv'), get(URLS.coi2, 'coi2.csv'), get(URLS.coiPage, 'coi.html'), get(URLS.hagezi, 'hg.txt'), get('https://malware-filter.gitlab.io/malware-filter/phishing-filter-domains.txt', 'pf.txt'), get('https://www.esma.europa.eu/sites/default/files/2024-12/NCASP.csv', 'esma.csv')]);
  const entries = new Map(); const add = (d, row) => { const k = clean(d); if (!domainRe.test(k)) return false; if (!entries.has(k)) entries.set(k, []); entries.get(k).push(row); return true; };

  // Czech Trade Inspection Authority: a regulator, with a reason per domain (CSV) and a date per entry (HTML page)
  // reasons are reproduced whole: the authority's licence allows no change of meaning
  const reasons = new Map(); for (const line of new TextDecoder('windows-1250').decode(coi2).split(/\r?\n/)) { const i = line.indexOf(';'); if (i > 0) reasons.set(clean(line.slice(0, i)), line.slice(i + 1).replace(/^'|'$/g, '').trim()); }
  const dates = new Map(); const html = coiPage.toString('utf8');
  for (const block of html.split('<article').slice(1)) { const dm = block.match(/<span>\s*([^<\s]+\.[a-z]{2,})\s*<\/span>/i); const dt = block.match(/\((\d{1,2}\.\s*\d{1,2}\.\s*\d{4})\)/); if (dm && dt) dates.set(clean(dm[1]), isoFromCz(dt[1])); }
  let coiN = 0, coiDated = 0; for (const d of coi1.toString('utf8').split(/\r?\n/)) { const k = clean(d); if (!k) continue; const date = dates.get(k) || null; if (date) coiDated++; if (add(k, { s: 'coi', d: date, r: reasons.get(k) || null })) coiN++; }

  // HaGeZi's Fake list: a filter list naming fake stores, scams and subscription traps; no per-entry evidence, so a hit is worded as a listing and carries its disclaimer
  const hgText = hg.toString('utf8'); const version = (hgText.match(/^# Version:\s*(.+)$/m) || [])[1] || 'unknown'; const modified = (hgText.match(/^# Last modified:\s*(.+)$/m) || [])[1] || null;
  let hgN = 0; for (const line of hgText.split(/\r?\n/)) { if (!line || line.startsWith('#')) continue; if (add(line, { s: 'hagezi' })) hgN++; }

  // phishing-filter: phishing sites from OpenPhish, IPThreat and PhishTank. Exact host only: many rows are single accounts on a hosting platform. Short-lived by nature, so it is refreshed at every build.
  const pfText = pf.toString('utf8'); const pfUpdated = (pfText.match(/^# Updated:\s*(\S+)/m) || [])[1] || null; let pfN = 0; for (const line of pfText.split(/\r?\n/)) { if (!line || line.startsWith('#')) continue; if (add(line, { s: 'phish' })) pfN++; }
  // ESMA's register of crypto-asset firms a national regulator has warned about, with the reason and date
  const csvRow = (l) => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (c === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (c === ',' && !q) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; };
  let esmaN = 0; const esmaLines = esma.toString('utf8').replace(/^\ufeff/, '').split(/\r?\n/); const head = csvRow(esmaLines[0]); const col = (n) => head.indexOf(n);
  for (const l of esmaLines.slice(1)) { if (!l.trim()) continue; const r = csvRow(l); for (const raw of String(r[col('ae_website')] || '').split(/[;,\s|]+/)) { const h = clean(raw.replace(/^https?:\/\//i, '').split('/')[0]); const dm = String(r[col('ae_decision_date')] || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); if (h && add(h, { s: 'esma', d: dm ? dm[3] + '-' + dm[2] + '-' + dm[1] : null, r: String(r[col('ae_reason')] || '').slice(0, 220), a: String(r[col('ae_competentAuthority')] || '').slice(0, 90) })) esmaN++; } }

  // AMF blacklists: websites and e-mail addresses the regulator warns about (unauthorised investment offers, impersonation), each with a category and the date it was listed.
  // An e-mail row gives its domain, except free-mail providers, which every honest person uses too.
  const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.fr', 'hotmail.com', 'hotmail.fr', 'outlook.com', 'outlook.fr', 'live.com', 'live.fr', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'gmx.com', 'gmx.de', 'gmx.fr', 'gmx.net', 'web.de', 'protonmail.com', 'proton.me', 'mail.com', 'mail.ru', 'yandex.com', 'yandex.ru', 'orange.fr', 'wanadoo.fr', 'free.fr', 'laposte.net', 'sfr.fr', 'neuf.fr', 'bbox.fr', 'tutanota.com', 'zoho.com', 'qq.com', '163.com', '126.com']);
  const AMF_CAT = (c) => { const k = String(c || ''); const t = { 'Usurpation': 'impersonating an authorised firm', 'Usurpation_AMF': 'impersonating the AMF', 'Forex': 'forex trading offered without authorisation', 'Options_binaires': 'binary options offered without authorisation', 'Crypto-actifs': 'crypto-asset services without registration', 'Produits_dérivés_sur_crypto-actifs': 'crypto derivatives offered without authorisation', 'Autre_acteur_non_autorisé': 'financial services without authorisation' }[k]; return t ? t + ' (AMF category: ' + k + ', translated)' : /^Biens_divers/.test(k) ? 'investment in goods offered without authorisation (AMF category: ' + k + ', translated)' : k || null; };
  let amfN = 0; const amfLines = amf.toString('utf8').replace(/^\ufeff/, '').split(/\r?\n/);
  for (const l of amfLines.slice(1)) { const m = l.match(/^"([^"]*)";"([^"]*)";"([^"]*)"/); if (!m) continue; let h = m[1].trim().toLowerCase(); const email = h.includes('@'); if (email && /^usurpation/i.test(m[2])) continue; /* an impersonator's address names the mail service or the firm impersonated, not the impersonator */ if (email) h = h.split('@').pop(); const bare = h.replace(/^https?:\/\//, ''); if (/\/[^/\s]/.test(bare)) continue; /* an account on a platform (t.me/name, calendly.com/name) is not the platform */ h = clean(bare.split('/')[0]); if (!h || FREEMAIL.has(h) || /(^|\.)amf-france\.org$/.test(h)) continue; if (add(h, { s: 'amf', d: /^\d{4}-\d{2}-\d{2}$/.test(m[3]) ? m[3] : null, r: AMF_CAT(m[2]) })) amfN++; }

  // our additions: only with someone else's published source
  const manual = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'lists', 'manual-list.json'), 'utf8')).entries; let manN = 0;
  for (const e of manual) { for (const f of ['domain', 'added', 'added_by', 'source_name', 'source_url', 'source_date']) if (!e[f]) throw new Error('manual entry ' + (e.domain || '?') + ' lacks ' + f); const expires = e.expires || new Date(Date.parse(e.added) + 180 * 864e5).toISOString().slice(0, 10); if (add(e.domain, { s: 'manual', d: e.source_date, n: e.source_name, u: e.source_url, r: e.note || null, x: expires })) manN++; }

  // A hosting platform's own domain must never be an entry: it would mark every store on it. The Czech file carries a few, such as myshopify.com.
  const PLATFORMS = ['myshopify.com', 'shopify.com', 'bigcartel.com', 'myshoplaza.com', 'shoplazza.com', 'webnode.cz', 'webnode.com', 'wixsite.com', 'wix.com', 'weebly.com', 'squarespace.com', 'square.site', 'etsy.com', 'amazon.com', 'ebay.com', 'aliexpress.com', 'github.io', 'gitlab.io', 'pages.dev', 'netlify.app', 'vercel.app', 'web.app', 'firebaseapp.com', 'herokuapp.com', 'blogspot.com', 'wordpress.com', 'substack.com', 'notion.site', 'webflow.io', 'framer.website', 'gumroad.com', 'sellfy.com', 'ecwid.com', 'jimdo.com', 'jimdosite.com', 'tilda.ws', 'carrd.co', 'business.site', 'mystrikingly.com', 'shopee.com', 'temu.com'];
  let dropped = 0; for (const p of PLATFORMS) if (entries.delete(p)) dropped++;
  // only rows that name one host exactly get parent-domain matching treatment from HaGeZi; a Czech row with listed hosts beneath it is a platform, whatever its name
  const keys = Array.from(entries.keys()); const parents = new Set(); for (const k of keys) { const parts = k.split('.'); for (let i = 1; i < parts.length - 1; i++) parents.add(parts.slice(i).join('.')); }
  for (const k of keys) if (parents.has(k) && entries.get(k).every((r) => r.s === 'coi')) { entries.delete(k); dropped++; }
  // our removals win over everything
  const allow = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'lists', 'allowlist.json'), 'utf8')).entries; let removed = 0;
  for (const e of allow) { for (const f of ['domain', 'added', 'added_by', 'reason']) if (!e[f]) throw new Error('allowlist entry ' + (e.domain || '?') + ' lacks ' + f); if (entries.delete(clean(e.domain))) removed++; }

  const data = { built: new Date().toISOString().slice(0, 10), sources: {
    coi: { name: 'the Czech Trade Inspection Authority', short: 'Czech Trade Inspection Authority', kind: 'regulator', url: 'https://coi.gov.cz/pro-spotrebitele/rizikove-e-shopy/', licence: 'ČOI open data licence, attribution required: https://www.coi.gov.cz/pro-spotrebitele/otevrena-data/licence-otevrenych-dat/', caveat: 'The authority says its list is a recommendation and not complete. Sites can be removed once they fix the problem.' },
    hagezi: { name: "HaGeZi's Fake filter list", short: 'HaGeZi Fake list', kind: 'filter_list', url: 'https://github.com/hagezi/dns-blocklists', version, modified, licence: 'GPL-3.0, redistributed as a separate data file', caveat: 'Its maintainers say a listing is a technical filtering decision, not a legal finding.' },
    phish: { name: 'the phishing-filter list', short: 'phishing-filter list', kind: 'filter_list', url: 'https://gitlab.com/malware-filter/phishing-filter', modified: pfUpdated, licence: 'CC BY-SA 4.0', exact: true, caveat: 'Built from reports to OpenPhish, IPThreat and PhishTank. Phishing sites change hands quickly, and a listing can be out of date.' },
    esma: { name: 'the EU markets authority, ESMA', short: 'ESMA', kind: 'regulator', url: 'https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica', licence: 'Reproduction authorised with the source acknowledged', exact: true, caveat: 'A national regulator warned that this firm offers crypto-asset services without authorisation in its country.' },
    amf: { name: "France's financial markets authority (AMF)", short: 'AMF (France)', kind: 'regulator', url: 'https://www.amf-france.org/fr/espace-epargnants/proteger-son-epargne/listes-noires-et-mises-en-garde', licence: 'Licence Ouverte 2.0 (data.gouv.fr), attribution required', exact: true, caveat: 'The AMF lists sites and addresses offering investments without authorisation in France, or impersonating authorised firms. A listing is a warning, not a court ruling.' },
    manual: { name: 'Subtext maintainers', short: 'Subtext maintainers', kind: 'manual', url: null, caveat: 'Added by hand, citing the source shown.' } },
    entries: Object.fromEntries(Array.from(entries.entries()).sort()) };
  fs.writeFileSync(OUT, JSON.stringify(data)); const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`known-bad.json: ${entries.size} domains, ${kb} KB. Czech authority ${coiN} (${coiDated} dated), HaGeZi ${hgN} (version ${version}), phishing-filter ${pfN}, ESMA ${esmaN}, AMF ${amfN}, manual ${manN}, removed by allowlist ${removed}, platform hosts dropped ${dropped}.`);
  if (coiN < 500 || hgN < 5000 || pfN < 3000 || esmaN < 50 || amfN < 1000) { console.error('A source shrank sharply; check before shipping.'); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
