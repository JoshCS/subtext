/* Subtext: outside context for the page on screen (free public sources only).
   The router starts from what the page is about (its subject), then asks which source can answer a question about that subject:
   records first, then an official statistic the page names, then coverage of the story, then attention to the subject. It never
   calls every source, and it shows no chart when nothing defensible applies. Each source states what it sends; only the Google
   Trends call carries the reader's cookies.
   Pure functions plus an injected `io.get`, so the worker and the Node tests run the same code. Docs: docs/CONTEXT-DATA.md */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SubtextContextData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const X = {};
  const MIN_POINTS = 8; // a line needs at least this many non-zero points from one source in its stated window
  const MIN_YEARS = 6; // a yearly series (filings) needs this many years
  const MAX_REQUESTS = 18; // per run, all sources together

  // ---------- words ----------
  const STOP = new Set(('a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its just ' +
    'may more most no not now of on or our out over says said she so than that the their them then there these they this to up was we were ' +
    'what when where which who why will with would you your after ahead about against amid among before between during here just like near ' +
    'us way ways told tells inside behind found finds gets got make makes made take takes took gave give gives get one two three first last next year years week weeks day days today ' +
    'top best review reviews tested guide how-to vs versus according report reports update updated live latest watch video photos').split(/\s+/));
  const words = (s) => String(s || '').replace(/[“”"‘’'`]/g, "'").split(/[^\p{L}\p{N}'&.-]+/u).map((w) => w.replace(/'s$/i, '').replace(/^['.&-]+|['.&-]+$/g, '')).filter(Boolean); // Trump's -> Trump
  const isCap = (w) => /^\p{Lu}/u.test(w);
  // words a company adds to its own name: they do not make a different name
  const CORP_WORD = /^(inc|incorporated|corp|corporation|company|co|ltd|plc|llc|group|holding|technology|technologie|system|motor|industrie|international|enterprise|lab|software|media)$/;
  const ROLES = /^(ceo|cfo|coo|cto|president|chairman|chair|sen|rep|gov|mayor|dr|mr|mrs|ms|prof|judge|justice|senator|governor|secretary|minister|king|queen|prince|princess|pope|coach|founder|chief)$/i;
  // never a name on their own: months, weekdays, country abbreviations
  const NOT_NAMES = /^(january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|u\.?s\.?a?|u\.?k|e\.?u)$/i;
  // the page's headline without the site's name and section crumbs
  X.cleanTitle = function (title, siteName) {
    const parts = String(title || '').split(/\s+[|–—]\s+|\s+-\s+|\s+::\s+/).map((p) => p.trim()).filter(Boolean);
    const site = String(siteName || '').toLowerCase().replace(/^www\./, '').replace(/\.(com|org|net|co\.uk)$/, '');
    const keep = parts.filter((p, i) => {
      const l = p.toLowerCase();
      if (site && (l.includes(site) || site.includes(l))) return false;
      return !(i > 0 && i === parts.length - 1 && p.split(/\s+/).length <= 3); // a short last segment is the site or section
    });
    return (keep.length ? keep : parts).sort((a, b) => b.length - a.length)[0] || '';
  };
  /* Topic terms for the page, from what the content script already has: title, headings, main text, URL slug, tagged keywords.
     query: the headline for news search. keyword: one to three words for Trends. entity: a proper name the page repeats. */
  X.topicTerms = function (p) {
    const title = X.cleanTitle(p.title, p.siteName);
    const tw = words(title);
    const body = String(p.text || '').slice(0, 60000);
    const bodyLower = body.toLowerCase();
    const rx = (phrase) => phrase.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/s$/i, '') + "(?:s|es|'s)?").join('\\s+'); // singular and plural count alike
    const count = (phrase) => { if (!phrase) return 0; const re = new RegExp('(^|[^\\p{L}\\p{N}])' + rx(phrase) + '(?=$|[^\\p{L}\\p{N}])', 'giu'); return (bodyLower.match(re) || []).length; };
    const capsShare = tw.filter(isCap).length / Math.max(1, tw.length); // headline in title case: capitals say nothing
    const cands = new Map();
    const add = (ws, from) => {
      if (!ws.length || ws.length > 3) return; if (STOP.has(ws[0].toLowerCase()) || STOP.has(ws[ws.length - 1].toLowerCase())) return;
      // a small word inside a phrase only in a name ("Cost of Living", "Community of Businesses"), never in a fragment ("Fix a Running")
      if (ws.slice(1, -1).some((w) => STOP.has(w.toLowerCase()) && !(/^(of|and|&)$/i.test(w) && isCap(ws[0]) && isCap(ws[ws.length - 1])))) return;
      if (ws.some((w) => ROLES.test(w))) return; // "Nvidia CEO Jensen" is two names and a job, not one name
      if (ws.every((w) => /^\d+$/.test(w)) || /^\d/.test(ws[0]) || ws[0].length < 2 || ws.every((w) => NOT_NAMES.test(w)) || (ws.length === 1 && NOT_NAMES.test(ws[0]))) return; // "000 jobs", "s Senate", "October"
      const phrase = ws.join(' '); const key = phrase.toLowerCase(); if (key.length < 3) return;
      const n = count(key);
      // proper: in the body it is mostly written with capitals, mid-sentence
      let capsHits = 0; if (n) { const re = new RegExp('[^.!?\\s]\\s+' + rx(phrase).replace(/^/, '') + '(?=$|[^\\p{L}\\p{N}])', 'gu'); capsHits = (body.match(re) || []).filter((m) => isCap(m.trim().split(/\s+/).slice(-ws.length)[0] || '')).length; }
      let proper = ws.every(isCap) && (capsShare < 0.6 || capsHits >= 2);
      // one word is a name only if the page writes it with a capital nearly every time ("Nvidia"), not just in a headline ("Economy", "Tech")
      if (ws.length === 1 && proper) { const capAll = (body.match(new RegExp('(^|[^\\p{L}\\p{N}])' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "(?:'s|s)?(?=$|[^\\p{L}\\p{N}])", 'gu')) || []).length; if (capAll < 3 || (n - capAll) / Math.max(1, n) > 0.2) proper = false; }
      const prev = cands.get(key); const score = n * Math.pow(ws.length, 1.5) + (from === 'tag' ? 3 : 0) + (from === 'slug' ? 1 : 0);
      // the same phrase from the URL slug arrives in lower case: keep the capitalised form and its proper-name reading
      if (prev) { prev.score = Math.max(prev.score, score); prev.proper = prev.proper || proper; prev.inTitle = prev.inTitle || from !== 'body'; if (proper && !isCap(prev.phrase)) prev.phrase = phrase; }
      else cands.set(key, { phrase, n, proper, score, len: ws.length, inTitle: from !== 'body' });
    };
    for (let i = 0; i < tw.length; i++) for (let k = 1; k <= 3 && i + k <= tw.length; k++) add(tw.slice(i, i + k), 'title');
    for (const t of (p.keywords || []).slice(0, 12)) add(words(t), 'tag');
    const slug = String(p.url || '').split(/[?#]/)[0].split('/').filter(Boolean).pop() || '';
    if (/-/.test(slug)) { const sw = slug.replace(/\.\w+$/, '').split('-').filter((w) => !/^\d+$/.test(w)); for (let i = 0; i < sw.length; i++) for (let k = 2; k <= 3 && i + k <= sw.length; k++) add(sw.slice(i, i + k), 'slug'); }
    // names the text keeps returning to, even when the headline does not carry them ("How team owners gave": the teams are in the text)
    const bodyNames = new Map();
    // tokens are bounded and cannot start inside another token: without that, "A-A-A-…" made this quadratic
    for (const m of body.matchAll(/(?<![\p{L}\p{N}'’&-])(\p{Lu}[\p{L}\p{N}'’&-]{0,40}(?:\s+(?:of|and|for|the|&)\s+\p{Lu}[\p{L}\p{N}'’&-]{0,40}|\s+\p{Lu}[\p{L}\p{N}'’&-]{0,40}){1,2})(?![\p{L}\p{N}'’&-])/gu)) {
      const ws = words(m[1]); while (ws.length && STOP.has(ws[0].toLowerCase())) ws.shift();
      if (ws.length >= 2 && ws.length <= 3 && !ws.some((w) => ROLES.test(w) || NOT_NAMES.test(w))) { const k = ws.join(' '); bodyNames.set(k, (bodyNames.get(k) || 0) + 1); }
    }
    // only on articles: on a buying guide or a recipe the most repeated name is one product among many, or a shop button
    if (p.article) for (const [k] of [...bodyNames.entries()].filter((x) => x[1] >= 4).sort((a, b) => b[1] - a[1]).slice(0, 6)) add(k.split(' '), 'body');
    const ranked = [...cands.values()].filter((c) => c.n > 0 || c.score >= 3).sort((a, b) => b.score - a.score);
    const siteWords = new Set(words([p.siteName].concat(p.siteNames || []).join(' ')).map((w) => w.toLowerCase()));
    const notSite = (c) => !c.phrase.toLowerCase().split(' ').every((w) => siteWords.has(w));
    // a proper name the page repeats: a two- or three-word name first (Red Sox, Charlie Kirk), then a single one used at least three times
    const entity = ranked.find((c) => c.inTitle && c.proper && c.len >= 2 && c.n >= 2 && notSite(c)) || ranked.find((c) => c.inTitle && c.proper && c.len === 1 && c.n >= 3 && notSite(c))
      || ranked.find((c) => !c.inTitle && c.proper && c.n >= 4 && notSite(c)); // a headline name first; then the name the text repeats most
    // a topic is two or three ordinary words the page repeats (billionaire tax, robot vacuums). One ordinary word is never a topic (pea, laptop, economy).
    const topic = ranked.find((c) => c.inTitle && !c.proper && c.len >= 2 && c.n >= 2 && notSite(c)) || null;
    const keyword = (entity && topic ? (entity.score >= topic.score ? entity : topic) : entity || topic);
    // the headline's other names, in order, for when the first turns out to be a place or an idea ("Nvidia spy scandal underlines China threat")
    // in the order the headline gives them: the grammatical subject usually comes first ("PepsiCo to cut about 1,000 North America jobs").
    // A one-word name inside a longer one ("North" in "North America") is not a name of its own.
    const titleLower = ' ' + title.toLowerCase() + ' '; const posOf = (c) => { const i = titleLower.indexOf(c.phrase.toLowerCase()); return i < 0 ? 1e6 : i; };
    const named = ranked.filter((c) => c.inTitle && c.proper && notSite(c) && (c.len >= 2 ? c.n >= 2 : c.n >= 3));
    /* A one-word name the text also writes in full is that fuller name: "Ford" in a story about Gerald Ford is not the car maker.
       The fuller form is used unless it only adds a company word ("Nvidia Corporation"). */
    const fuller = (word) => { const w = word.toLowerCase(); const hit = [...bodyNames.entries()].filter(([k, n]) => n >= 2 && k.toLowerCase().split(' ').includes(w) && k.toLowerCase().split(' ').some((x) => x !== w && !CORP_WORD.test(x.replace(/s$/, '')))).sort((a, b) => b[1] - a[1])[0]; return hit ? hit[0] : word; };
    const entities = [...new Set(named.filter((c) => !(c.len === 1 && named.some((d) => d.len > 1 && d.phrase.toLowerCase().split(' ').includes(c.phrase.toLowerCase())))).sort((a, b) => posOf(a) - posOf(b)).concat(entity && !entity.inTitle ? [entity] : []).slice(0, 3).map((c) => (c.len === 1 ? fuller(c.phrase) : c.phrase)))];
    return { title, query: title.replace(/[“”"]/g, '').split(/\s+/).slice(0, 14).join(' '), keyword: keyword ? keyword.phrase : '', entity: entity ? entity.phrase : '', entities, topic: topic ? topic.phrase : '', candidates: ranked.slice(0, 6).map((c) => c.phrase) };
  };

  // ---------- series rules ----------
  // a missing value stays missing: Number(null) is 0, and a filing year with no figure must never read as $0
  const num = (v) => { if (v == null || v === '' || typeof v === 'boolean') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  /* points: [{t: 'YYYY-MM-DD' | 'YYYY-MM' | 'YYYY', v: number | null}] -> sorted, numbers coerced, the unfinished current period and
     anything in the future dropped. A missing value stays in the list as v: null (the chart draws a gap); it is never turned into 0. */
  X.cleanSeries = function (points, resolution, now) {
    const d = now || new Date(); const today = d.toISOString().slice(0, 10);
    const weekAgo = new Date(d.getTime() - 7 * 864e5).toISOString().slice(0, 10);
    // finished: a day before today; a week that started at least 7 days ago; a month or year before the current one
    const done = (t) => (resolution === 'month' ? t < today.slice(0, 7) : resolution === 'year' ? t < today.slice(0, 4) : resolution === 'week' ? t <= weekAgo : resolution === 'day' ? t < today : t <= today);
    return (points || []).map((p) => ({ t: String(p.t), v: num(p.v) })).filter((p) => /^\d{4}(-\d{2}){0,2}$/.test(p.t) && done(p.t)).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  };
  X.validSeries = function (points, min) { return (points || []).filter((p) => p.v != null && p.v > 0).length >= (min || MIN_POINTS); };
  const fmtN = (n) => (n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n)));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  X.fmtT = function (t) { const [y, m, d] = String(t).split('-'); if (d) return Number(d) + ' ' + MONTHS[Number(m) - 1] + ' ' + y; if (m) return MONTHS[Number(m) - 1] + ' ' + y; return y; };
  const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
  /* first, last, peak, low, median and total over the periods that have a value; null when none has. */
  X.summary = function (points) {
    const ps = (points || []).filter((p) => p.v != null); if (!ps.length) return null;
    const vs = ps.map((p) => p.v); let peak = ps[0], low = ps[0];
    for (const p of ps) { if (p.v > peak.v) peak = p; if (p.v < low.v) low = p; }
    return { first: ps[0], last: ps[ps.length - 1], peak, low, median: median(vs), total: vs.reduce((a, b) => a + b, 0), count: ps.length };
  };

  // ---------- helpers for sources ----------
  const json = (s) => { try { return JSON.parse(String(s || '').replace(/^\)\]\}',?\s*/, '')); } catch (e) { return null; } };
  const strip = (s) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  const enc = encodeURIComponent;
  const iso = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (now, n) => new Date(now.getTime() - n * 864e5);
  const ymd = (s) => s.replace(/-/g, '');
  const domainVariants = (d) => [`https://www.${d}/`, `https://${d}/`, `http://www.${d}/`, `http://${d}/`, `https://www.${d}`, `https://${d}`, `http://www.${d}`, `http://${d}`];
  const money = (v) => (v < 0 ? '-' : '') + '$' + (Math.abs(v) >= 1e9 ? (Math.abs(v) / 1e9).toFixed(1) + ' billion' : Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(1) + ' million' : Math.round(Math.abs(v)).toLocaleString('en-US'));
  const wikiUrl = (title) => 'https://en.wikipedia.org/wiki/' + enc(String(title).replace(/ /g, '_'));

  /* Sources register here, the built-in ones below and the ones kept in their own files (context-*.js). Contract: docs/CONTEXT-CONTRACT.md */
  X.util = { json, strip, enc, num, iso, daysAgo, fmtN, fmtT: X.fmtT, money, cleanSeries: X.cleanSeries, validSeries: X.validSeries, summary: X.summary, MIN_POINTS, MIN_YEARS };
  X.REGISTERED = {};
  X.register = function (src) {
    for (const k of ['id', 'basis', 'scope', 'label', 'question']) if (typeof src[k] !== 'string' || !src[k]) throw new Error('source needs ' + k);
    if (!['records', 'statistic', 'coverage', 'topic', 'site'].includes(src.basis)) throw new Error('bad basis');
    if (!['entity', 'page'].includes(src.scope)) throw new Error('bad scope');
    for (const k of ['applies', 'sends', 'run']) if (typeof src[k] !== 'function') throw new Error('source needs ' + k + '()');
    X.REGISTERED[src.id] = src; return src;
  };

  // ---------- entities: who the site is, and what the page is about ----------
  const COUNTRY = { Q30: 'US', Q145: 'GB', Q16: 'CA', Q408: 'AU', Q183: 'DE', Q142: 'FR', Q27: 'IE', Q668: 'IN', Q17: 'JP', Q38: 'IT', Q29: 'ES', Q55: 'NL', Q34: 'SE', Q20: 'NO', Q35: 'DK', Q39: 'CH', Q664: 'NZ', Q96: 'MX', Q155: 'BR', Q258: 'ZA', Q148: 'CN', Q884: 'KR', Q40: 'AT', Q31: 'BE', Q33: 'FI', Q45: 'PT', Q36: 'PL', Q801: 'IL', Q334: 'SG' };
  /* What kind of thing a Wikidata item is, read from the claims it carries. A place, a species, a food, a holiday or an idea is
     'other': it is never a page's subject (Wikipedia traffic for "Pea" says nothing about a pasta recipe). */
  X.entityFrom = function (q, e) {
    const C = (e && e.claims) || {};
    const vals = (p) => (C[p] || []).map((s) => ((s.mainsnak || {}).datavalue || {}).value).filter((v) => v != null);
    const ids = (p) => vals(p).map((v) => v && v.id).filter(Boolean);
    const str = (p) => { const v = vals(p)[0]; return typeof v === 'string' ? v : ''; };
    const has = (p) => (C[p] || []).length > 0;
    const inception = (vals('P571')[0] || {}).time || '';
    const person = ids('P31').includes('Q5');
    // chief executive, stock exchange, industry, employees, revenue, tax id, SEC number, founder: only an organization carries these
    const orgSignals = has('P169') || has('P414') || has('P452') || has('P1128') || has('P2139') || has('P1297') || has('P5531') || has('P112');
    // a population, a capital or a continent marks a place whatever else the item carries (a country has a head of government and a GDP)
    const place = !person && (has('P1082') || has('P36') || has('P30') || (has('P625') && has('P131') && !orgSignals));
    const kind = person ? 'person' : has('P225') || place ? 'other'
      : (has('P176') || has('P178')) && !orgSignals ? 'product'
      : orgSignals ? 'organization'
      : has('P585') || has('P580') || has('P1346') || has('P726') || has('P991') ? 'event'
      : has('P856') || has('P159') ? 'organization'
      : has('P577') || has('P50') || has('P57') || has('P123') || has('P86') ? 'work' : 'other';
    const tick = ((((((C.P414 || [])[0] || {}).qualifiers || {}).P249 || [])[0] || {}).datavalue || {}).value || str('P249');
    return { q, label: (((e.labels || {}).en || {}).value) || '', enwiki: (((e.sitelinks || {}).enwiki || {}).title) || '', founded: /^\+\d{4}/.test(inception) ? inception.slice(1, 5) : '',
      country: COUNTRY[ids('P17')[0]] || COUNTRY[ids('P27')[0]] || COUNTRY[ids('P495')[0]] || ids('P17')[0] || ids('P27')[0] || '', // a country outside the table keeps its Wikidata id: it is known, and it is not the US
      listed: has('P414'), description: (((e.descriptions || {}).en || {}).value) || '', links: ids('P108').concat(ids('P169'), ids('P112'), ids('P488'), ids('P127'), ids('P749'), ids('P355'), ids('P39'), ids('P54')).slice(0, 40), ein: str('P1297').replace(/\D/g, ''), cik: str('P5531').replace(/\D/g, ''), ticker: typeof tick === 'string' ? tick : '', kind, instanceOf: ids('P31').slice(0, 8) };
  };
  async function fetchEntity(io, by) {
    const r = await io.get('https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=labels|descriptions|sitelinks|claims&languages=en&sitefilter=enwiki&' + (by.q ? 'ids=' + enc(by.q) : 'sites=enwiki&titles=' + enc(by.title)));
    const ents = (json(r.text) || {}).entities || {}; const q = Object.keys(ents).find((k) => /^Q\d+$/.test(k) && !('missing' in ents[k]));
    if (!q) return null; const e = X.entityFrom(q, ents[q]); if (!e.enwiki && by.title) e.enwiki = by.title; return e;
  }
  // the site's entity: the bundled Wikidata id first (data/owners.json), then one exact-website lookup
  async function siteEntity(f, io) {
    let q = f.entityQ || '';
    if (!q && f.domain) {
      const sparql = 'SELECT ?item WHERE { VALUES ?u { ' + domainVariants(f.domain).map((v) => '<' + v + '>').join(' ') + ' } ?item wdt:P856 ?u ; wikibase:sitelinks ?n . FILTER NOT EXISTS { ?item wdt:P31 wd:Q5 } } ORDER BY DESC(?n) LIMIT 1'; // a company's address also sits on its founder's item and on its products: never a person, and the item described in the most languages
      const r = await io.get('https://query.wikidata.org/sparql?format=json&query=' + enc(sparql), { accept: 'application/sparql-results+json' });
      const b = ((json(r.text) || {}).results || {}).bindings || [];
      q = b.length ? String(b[0].item.value).split('/').pop() : '';
    }
    return /^Q\d+$/.test(q) ? fetchEntity(io, { q }) : null;
  }
  /* A company whose Wikidata item gives a ticker but no SEC number: take the number from the SEC's own ticker list (bundled,
     data/sec-tickers.json) only when the ticker AND the company's name both match. A ticker alone is reused across exchanges. */
  const nameKey = (n) => String(n || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !/^(the|inc|incorporated|corp|corporation|company|co|ltd|plc|llc|group|holdings|and|com)$/.test(w)).join(' ');
  X.cikFromTicker = function (e, rows) {
    const row = e && e.ticker && rows && rows[String(e.ticker).toUpperCase()];
    return row && nameKey(row[1]) && nameKey(row[1]) === nameKey(e.label) ? String(row[0]) : '';
  };
  /* No ticker in Wikidata either: the SEC number is accepted only when Wikidata says the company is listed on a stock exchange (P414)
     AND exactly one company on the SEC's list has exactly its name. Either alone is not enough: "The Root" is a magazine, and
     Root, Inc. is an insurer. */
  const byName = new WeakMap();
  X.cikFromName = function (e, rows) {
    if (!e || !rows || !e.listed || e.kind !== 'organization' || (e.country && e.country !== 'US')) return '';
    if (!byName.has(rows)) { const m = new Map(); for (const t of Object.keys(rows)) { const k = nameKey(rows[t][1]); if (!k) continue; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(rows[t][0]); } byName.set(rows, m); }
    const key = nameKey(e.label); const hit = byName.get(rows).get(key);
    return hit && hit.size === 1 && key.length >= 4 ? String([...hit][0]) : '';
  };
  /* A US nonprofit whose own page names its legal entity ("Everytown for Gun Safety Support Fund") but whose Wikidata item has no
     tax ID: ask ProPublica for that exact legal name. Accepted only when exactly one filer carries exactly that name; a near name
     ("... Action Fund") is a different legal entity and is refused. Returns the tax ID as nine digits, or ''. */
  const legalKey = (n) => String(n || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(inc|incorporated)\b/g, ' ').replace(/^\s*the\s+/, '').replace(/\s+/g, ' ').trim();
  X.filerByName = async function (io, name) {
    const key = legalKey(name); if (key.split(' ').length < 2) return null;
    const r = await io.get('https://projects.propublica.org/nonprofits/api/v2/search.json?q=' + enc(String(name).slice(0, 90)));
    const j = json(r.text) || {}; if (num(j.num_pages) > 1) return null; // more results than one page shows: "exactly one" cannot be established
    const hits = (j.organizations || []).filter((o) => legalKey(o.name) === key);
    return hits.length === 1 && num(hits[0].ein) ? { ein: String(hits[0].ein).padStart(9, '0'), name: String(hits[0].name || ''), city: String(hits[0].city || ''), state: String(hits[0].state || '') } : null;
  };
  X.einByLegalName = async function (io, name) { const h = await X.filerByName(io, name); return h ? h.ein : ''; };
  const SUBJECT_KINDS = new Set(['person', 'organization', 'event', 'work', 'product']);
  const CORP = /^(inc|incorporated|corp|corporation|company|co|ltd|plc|llc|group|holdings)$/;
  // words a company adds to its name; singular forms, as compared
  const COMPANY_WORDS = /^(technology|technologie|system|motor|industrie|international|enterprise|lab|software|media|entertainment|communication|pharmaceutical|airline|bank|financial|food|brand|store|network|semiconductor|energy|health|global|worldwide|platform|studio|record|foundation|institute|university|association|society)$/;
  /* What the page is about: a person, organization, event, work or product the page names and repeats, confirmed against Wikipedia and
     Wikidata; or a two- or three-word phrase the page repeats that is the exact title of a Wikipedia article ("robot vacuum").
     One ordinary word is never a subject, and neither is a place or a thing that grows. Returns an Entity, a phrase subject, or null. */
  X.resolveSubject = async function (f, io) {
    const T = f.terms || {}; const pageText = ((T.title || '') + ' ' + (f.text || '')).toLowerCase().replace(/[’']/g, "'");
    const pageWords = new Set(pageText.split(/[^\p{L}\p{N}]+/u).map((w) => w.replace(/s$/, '')));
    const sing = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/s$/, '');
    // every word of an article's title, a bracketed qualifier too, must be on the page: "Millionaires tax (Washington state)" is not a Massachusetts story
    const onPage = (h) => h.toLowerCase().replace(/[()]/g, ' ').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !STOP.has(w) && !CORP.test(w) && !COMPANY_WORDS.test(w.replace(/s$/, ''))).every((w) => pageWords.has(w.replace(/s$/, '')));
    const fits = (h, phrase) => {
      const l = h.toLowerCase().replace(/[’']/g, "'"); if (/^lists? of |\(disambiguation\)/.test(l) || !onPage(h)) return false;
      const base = l.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
      // a title with a bracketed qualifier is one of several things of that name ("The Democrats (Israel)"): one word cannot pick among them
      if (/\(/.test(l) && phrase.trim().split(/\s+/).length < 2) return false;
      // the name itself, or a fuller name that contains it word for word ("Boston Red Sox" for "Red Sox"; not "Democratic Party" for "Democrats")
      const tw = base.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(sing); const pw = phrase.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(sing);
      // one word must be the whole title ("Nvidia"), corporate suffix aside: "North" is not "North of North"
      if (pw.length === 1) return tw[0 + (tw[0] === 'the' ? 1 : 0)] === pw[0] && tw.filter((w) => !CORP.test(w) && !COMPANY_WORDS.test(w) && w !== 'the').join(' ') === pw[0]; // "Marvell Technology" for "Marvell"
      return pw.length > 0 && pw.every((w) => tw.includes(w));
    };
    const DEMONYM = /^(american|british|canadian|australian|english|french|german|italian|spanish|indian|chinese|japanese|irish|scottish|mexican|russian|former|born|known|since|from|first|second|united|states|state|national)$/;
    // a description says "politician" where the page says "Senate race": a few occupations are recognised by the words a page about them uses
    const HINTS = [[/politician|senator|governor|congress|minister|mayor|president/, /^(senate|senator|congres|election|governor|campaign|candidate|representative|mayor|president|minister|parliament|ballot|vote|voter|democrat|republican|legislature)$/], [/business|executive|entrepreneur|investor|billionaire|founder/, /^(ceo|chief|company|founder|executive|busines|investor|board|share|firm|billionaire)$/], [/actor|actress|director|filmmaker/, /^(film|movie|serie|role|starring|cast|director|drama|episode)$/], [/singer|musician|rapper|songwriter|band/, /^(album|song|music|tour|band|concert|single|record)$/], [/player|athlete|footballer|coach/, /^(game|season|team|league|coach|player|score|match|club)$/], [/author|writer|journalist|novelist/, /^(book|novel|author|writer|column|essay|memoir)$/]];
    const describedOnPage = (e) => { const d = String(e.description || '').toLowerCase(); if (d.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 5 && !DEMONYM.test(w) && !/^\d+$/.test(w)).some((w) => pageWords.has(w.replace(/s$/, '')))) return true; return HINTS.some(([desc, words]) => desc.test(d) && [...pageWords].some((w) => words.test(w))); };
    /* The headline's names in order. The first that is a person, organization, event, work or product is the subject. When that is not
       an organization and the page is an article, the next name is still looked up: "Why did Nvidia CEO Jensen Huang resign" is about a
       person, and the company he ran is the one with filings. That second entity is kept in f.secondary. */
    let first = null; f.secondary = null;
    for (const name of (T.entities && T.entities.length ? T.entities : [T.entity]).filter(Boolean).slice(0, 3)) {
      const r = await io.get('https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=5&srsearch=' + enc(name));
      const hit = (((json(r.text) || {}).query || {}).search || []).map((h) => h.title).find((h) => fits(h, name));
      if (!hit) continue;
      const e = await fetchEntity(io, { title: hit }); if (!e || !SUBJECT_KINDS.has(e.kind)) continue;
      // many people share a name: the page must also use a word of this person's Wikidata description ("singer", "senator", "Nvidia")
      if (e.kind === 'person' && !describedOnPage(e)) continue;
      if (!first) { first = e; if (e.kind === 'organization' || f.group !== 'news') return e; continue; }
      // only when Wikidata itself links the two (employer, chief executive, founder, chair, owner, position): two names in one headline are not a link
      if (e.kind === 'organization' && e.q !== first.q && ((first.links || []).includes(e.q) || (e.links || []).includes(first.q))) { f.secondary = e; break; }
    }
    if (first) return first;
    if (T.topic && T.topic.split(' ').length >= 2) {
      // the phrase as the page writes it and its singular ("robot vacuums", "robot vacuum"), in one request; redirects followed
      const forms = [...new Set([T.topic, T.topic.replace(/ies$/i, 'y'), T.topic.replace(/s$/i, '')])];
      const r = await io.get('https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=pageprops&ppprop=disambiguation&titles=' + enc(forms.join('|')));
      const pg = Object.values(((json(r.text) || {}).query || {}).pages || {}).find((x) => x && !('missing' in x) && !('invalid' in x));
      if (pg && !('missing' in pg) && !(pg.pageprops && 'disambiguation' in pg.pageprops) && pg.title) {
        const e = await fetchEntity(io, { title: pg.title });
        if (e && SUBJECT_KINDS.has(e.kind)) return e;
        return { q: e ? e.q : '', label: T.topic, enwiki: pg.title, founded: '', country: '', ein: '', cik: '', ticker: '', kind: 'phrase' };
      }
    }
    return null;
  };
  // the page is about money: its headline says so, or its text returns to it
  X.moneySignal = function (f) {
    const re = /\b(revenue|earnings|profits?|loss(?:es)?|sales|layoffs?|funding|funded|donors?|budget|grants?|fundrais\w+|quarter(?:ly)?|shares|stock|valuation|acquisition|acquire[sd]?|merger|bankrupt\w*|ipo)\b/gi;
    return re.test((f.terms && f.terms.title) || f.title || '') || (String(f.text || '').match(re) || []).length >= 3;
  };

  async function pageviews(io, article, from, to, granularity) {
    const url = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/' + enc(article.replace(/ /g, '_')) + '/' + granularity + '/' + from + '/' + to;
    const r = await io.get(url); const items = (json(r.text) || {}).items || [];
    return items.map((i) => ({ t: granularity === 'daily' ? i.timestamp.slice(0, 4) + '-' + i.timestamp.slice(4, 6) + '-' + i.timestamp.slice(6, 8) : i.timestamp.slice(0, 4) + '-' + i.timestamp.slice(4, 6), v: i.views }));
  }
  // Google Trends, interest over 12 months. The only request that carries the reader's own cookies (Trends refuses without them).
  async function trendsSeries(io, keyword) {
    const req = { comparisonItem: [{ keyword, geo: '', time: 'today 12-m' }], category: 0, property: '' };
    const explore = 'https://trends.google.com/trends/api/explore?hl=en-US&tz=0&req=' + enc(JSON.stringify(req));
    let r = await io.get(explore, { cookies: true });
    if (r.status === 429) { await io.get('https://trends.google.com/trends/?geo=', { cookies: true }); r = await io.get(explore, { cookies: true }); }
    const ex = json(r.text); const w = ex && (ex.widgets || []).find((x) => x.id === 'TIMESERIES');
    if (!w) return [];
    const m = await io.get('https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=0&req=' + enc(JSON.stringify(w.request)) + '&token=' + enc(w.token), { cookies: true });
    const tl = ((json(m.text) || {}).default || {}).timelineData || [];
    return tl.map((x) => ({ t: new Date(Number(x.time) * 1000).toISOString().slice(0, 10), v: x.hasData && x.hasData[0] === false ? null : (x.value || [])[0] }));
  }
  const trendsUrl = (k) => 'https://trends.google.com/trends/explore?date=today%2012-m&q=' + enc(k);
  function trendsChart(points, keyword, now) {
    const clean = X.cleanSeries(points, 'week', now); // the week in progress is dropped: a partial week always reads low
    if (!X.validSeries(clean)) return null;
    const s = X.summary(clean);
    return { title: 'Google searches: ' + keyword, kind: 'line', resolution: 'week', points: clean, unit: 'index (100 = busiest week)',
      sentence: 'Google searches for "' + keyword + '" over the last 12 months were highest in the week of ' + X.fmtT(s.peak.t) + '. The last full week, from ' + X.fmtT(s.last.t) + ', stands at ' + s.last.v + ' on a scale where the highest week is 100.',
      note: 'Relative search interest worldwide, not a count of searches.', source: { name: 'Google Trends', url: trendsUrl(keyword) } };
  }

  // ---------- built-in sources ----------
  X.register({
    id: 'news_coverage', basis: 'coverage', scope: 'page', label: 'News coverage of this story', question: 'How widely is this story covered?',
    // a real article: the scan classed it as one, or it carries a publication date. A product page that reads like prose is not a story.
    applies: (f) => f.group === 'news' && (f.articleKind || !!f.published) && String((f.terms || {}).query || '').split(' ').length >= 3,
    sends: () => 'the headline words to Google News',
    async run(f, io, now) {
      const r = await io.get('https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q=' + enc(f.terms.query));
      const items = [...String(r.text).matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
        const x = m[1]; const date = new Date(strip((x.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]));
        return { link: strip((x.match(/<link>([\s\S]*?)<\/link>/) || [])[1]), source: strip((x.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]), sourceUrl: ((x.match(/<source url="([^"]+)"/) || [])[1] || ''), date };
      }).filter((i) => !isNaN(i.date));
      // 30 complete days ending yesterday: today is unfinished, and the feed is a ranked sample that mixes in old items
      const byDay = new Map(); for (let d = 30; d >= 1; d--) byDay.set(iso(daysAgo(now, d)), 0);
      const inWin = items.filter((i) => byDay.has(iso(i.date)));
      for (const i of inWin) byDay.set(iso(i.date), byDay.get(iso(i.date)) + 1);
      const points = [...byDay.entries()].map(([t, v]) => ({ t, v }));
      const own = String(f.siteName || '').toLowerCase();
      const outlets = [...new Map(inWin.filter((i) => i.source && !(own && i.source.toLowerCase().includes(own)) && !(i.sourceUrl && f.domain && i.sourceUrl.includes(f.domain))).map((i) => [i.source, i])).values()];
      const out = {}; const s = X.summary(points);
      // eight single articles on separate days are not a story's coverage curve. And the feed returns at most about 100 items, newest
      // first: near that cap the older days are cut off, so the daily counts would show the feed's order, not the coverage
      if (inWin.length >= MIN_POINTS && s.peak.v >= 3 && items.length < 90 && outlets.length >= 2) { // and other outlets must be among them: a site's own articles are not coverage of its story
        out.chart = { title: 'Articles on this story, last 30 days', kind: 'bars', resolution: 'day', points, unit: 'articles',
          sentence: 'Google News returned ' + inWin.length + ' articles on this story' + (outlets.length ? ' from at least ' + outlets.length + ' other outlet' + (outlets.length === 1 ? '' : 's') : '') + ' in the 30 days to ' + X.fmtT(s.last.t) + '. The most on one day was ' + s.peak.v + ', on ' + X.fmtT(s.peak.t) + '.',
          note: 'A sample: what Google News returned for the headline, not a count of all coverage. A day with no bar means none were returned, not that none were written.', source: { name: 'Google News', url: 'https://news.google.com/search?q=' + enc(f.terms.query) } };
      }
      if (outlets.length) out.facts = [{ id: 'news_outlets', label: 'Also covering this story', text: (items.length >= 90 ? 'Widely covered: Google News returned ' + items.length + ' or more articles. Among the outlets: ' : '') + outlets.slice(0, 5).map((o) => o.source).join(', ') + (outlets.length > 5 ? ' and ' + (outlets.length - 5) + ' more' : '') + '.', links: outlets.slice(0, 5).map((o) => ({ text: o.source, url: o.link })), source: { name: 'Google News', url: 'https://news.google.com/search?q=' + enc(f.terms.query) } }];
      return out;
    }
  });
  X.register({
    id: 'subject_views', basis: 'topic', scope: 'entity', label: 'Wikipedia views of the subject', question: 'How much attention does the subject get?',
    applies: (e) => !!e.enwiki, sends: (e) => 'the article title "' + e.enwiki + '" to Wikipedia',
    async run(e, f, io, now) {
      const points = X.cleanSeries(await pageviews(io, e.enwiki, ymd(iso(daysAgo(now, 90))), ymd(iso(daysAgo(now, 1))), 'daily'), 'day', now);
      if (!X.validSeries(points)) return null; const s = X.summary(points);
      if (s.median < 30) return null; // an article almost nobody opens says nothing about attention
      return { chart: { title: 'Wikipedia views: ' + e.enwiki, kind: 'line', resolution: 'day', points, unit: 'views a day', mark: f.published && f.published >= points[0].t ? { t: f.published, label: 'page published' } : undefined,
        sentence: 'The Wikipedia article "' + e.enwiki + '" was viewed about ' + fmtN(s.median) + ' times on a typical day over the last 90 days. ' + (s.median > 0 && s.peak.v / s.median >= 5 ? 'On ' + X.fmtT(s.peak.t) + ' it was viewed ' + fmtN(s.peak.v) + ' times, ' + Math.round(s.peak.v / s.median) + ' times the usual.' : 'The most was ' + fmtN(s.peak.v) + ', on ' + X.fmtT(s.peak.t) + '.'),
        notable: s.median > 0 && s.peak.v / s.median >= 5, // one day far above the usual is itself a fact about the subject
        note: 'Page views, not unique readers. Attention to the subject, not to this page.', source: { name: 'Wikimedia pageviews', url: 'https://pageviews.wmcloud.org/?project=en.wikipedia.org&pages=' + enc(e.enwiki.replace(/ /g, '_')) } } };
    }
  });
  const trendWord = (e) => { const k = String(e.label || '').replace(/\s*\([^)]*\)/g, '').trim(); return k && k.split(/\s+/).length <= 4 ? k : ''; };
  X.register({
    id: 'subject_trends', basis: 'topic', scope: 'entity', cookies: true, label: 'Google searches for the subject', question: 'How much do people search for the subject?',
    applies: (e) => !!trendWord(e), sends: (e) => 'the words "' + trendWord(e) + '" to Google Trends, with your Google cookies',
    async run(e, f, io, now) { const c = trendsChart(await trendsSeries(io, trendWord(e)), trendWord(e), now); return c ? { chart: c } : null; }
  });
  X.register({
    id: 'site_views', basis: 'site', scope: 'entity', label: 'Wikipedia views of this site or its company', question: 'How much attention does this site get?',
    applies: (e) => !!e.enwiki, sends: (e) => 'the article title "' + e.enwiki + '" to Wikipedia',
    async run(e, f, io, now, o) {
      const points = X.cleanSeries(await pageviews(io, e.enwiki, ymd(iso(daysAgo(now, 760))).slice(0, 6) + '0100', ymd(iso(now)).slice(0, 6) + '0100', 'monthly'), 'month', now);
      if (!X.validSeries(points)) return null;
      const s = X.summary(points); const ratio = s.median ? s.peak.v / s.median : 0;
      const chart = { title: 'Wikipedia views: ' + e.enwiki, kind: 'line', resolution: 'month', points, unit: 'views a month',
        sentence: 'The Wikipedia article "' + e.enwiki + '" was viewed about ' + fmtN(s.median) + ' times in a typical month over the last two years. ' + (ratio >= 2 ? 'In ' + X.fmtT(s.peak.t) + ' it was viewed ' + fmtN(s.peak.v) + ' times, ' + ratio.toFixed(ratio >= 10 ? 0 : 1).replace(/\.0$/, '') + ' times the usual.' : 'The most was ' + fmtN(s.peak.v) + ', in ' + X.fmtT(s.peak.t) + '.'),
        note: 'Page views, not unique readers.', source: { name: 'Wikimedia pageviews', url: 'https://pageviews.wmcloud.org/?project=en.wikipedia.org&range=last-year&pages=' + enc(e.enwiki.replace(/ /g, '_')) } };
      // a month far above the usual: list what the company filed with the SEC that month, when it files there. Dated records, no claim of cause.
      const filings = X.REGISTERED.sec_filings;
      chart.notable = ratio >= 5;
      if (ratio >= 3 && e.cik && filings) { try { const r = await filings.run(e, f, io, now, Object.assign({}, o, { month: s.peak.t })); const rows = r && r.chart && r.chart.rows; if (rows && rows.length) { chart.rows = rows.slice(0, 6); chart.rowsLabel = 'SEC filings around ' + X.fmtT(s.peak.t); chart.notable = true; } } catch (err) { /* the chart stands without the list */ } }
      return { chart };
    }
  });
  X.register({
    id: 'site_trends', basis: 'site', scope: 'entity', cookies: true, label: 'Google searches for this site or brand', question: 'How much do people search for this site?',
    applies: (e, f) => !!(f.brand || trendWord(e)), sends: (e, f) => 'the name "' + (f.brand || trendWord(e)) + '" to Google Trends, with your Google cookies',
    async run(e, f, io, now) { const k = f.brand || trendWord(e); const c = trendsChart(await trendsSeries(io, k), k, now); return c ? { chart: c } : null; }
  });
  X.register({
    id: 'site_discussion', basis: 'site', scope: 'page', label: 'Hacker News stories linking this site', question: 'How often is this site discussed?',
    applies: (f) => !!f.domain, sends: () => 'the domain to Hacker News search (Algolia)',
    async run(f, io, now) {
      const r = await io.get('https://hn.algolia.com/api/v1/search_by_date?tags=story&restrictSearchableAttributes=url&hitsPerPage=1000&attributesToRetrieve=created_at_i&query=' + enc(f.domain));
      const j = json(r.text) || {}; const hits = j.hits || [];
      const byYear = new Map(); for (const h of hits) { const ts = num(h.created_at_i); if (ts == null) continue; const y = new Date(ts * 1000).getUTCFullYear(); byYear.set(y, (byYear.get(y) || 0) + 1); }
      const nbHits = num(j.nbHits) || hits.length; const out = {};
      if (nbHits) out.facts = [{ id: 'discussion', label: 'Discussed on Hacker News', text: nbHits.toLocaleString('en-US') + (nbHits === 1 ? ' story links' : ' stories link') + ' to this site.', links: [{ text: 'Hacker News search', url: 'https://hn.algolia.com/?type=story&query=' + enc(f.domain) }], source: { name: 'Hacker News (Algolia)', url: 'https://hn.algolia.com/' } }];
      if (hits.length && hits.length < 1000) { // 1,000 is the cap: beyond it the earliest years would be cut off. A year with no story is a real zero here.
        const first = Math.min(...byYear.keys()); const points = []; for (let y = first; y <= now.getUTCFullYear(); y++) points.push({ t: String(y), v: byYear.get(y) || 0 });
        const clean = X.cleanSeries(points, 'year', now);
        if (X.validSeries(clean, MIN_YEARS)) { const s = X.summary(clean); out.chart = { title: 'Hacker News stories linking ' + f.domain, kind: 'bars', resolution: 'year', points: clean, unit: 'stories', sentence: s.total + ' Hacker News stories linked to ' + f.domain + ' from ' + clean[0].t + ' to ' + s.last.t + '. The most in one year was ' + s.peak.v + ', in ' + s.peak.t + '.', note: 'One technology forum; a quiet year says little about the site.', source: { name: 'Hacker News (Algolia)', url: 'https://hn.algolia.com/?type=story&query=' + enc(f.domain) } }; }
      }
      return out;
    }
  });

  // ---------- facts: one request each, about the site ----------
  const F = {};
  F.shop_product = {
    label: 'The store\'s own product files', when: (f) => !!f.shopHandle, sends: () => 'nothing new: these are the store\'s own public files',
    async run(f, io) {
      const p = (json((await io.get(f.origin + '/products/' + enc(f.shopHandle) + '.json')).text) || {}).product;
      if (!p || !p.created_at) return null;
      const all = (json((await io.get(f.origin + '/products.json?limit=250')).text) || {}).products || [];
      const years = new Map(); for (const x of all) { const y = String(x.created_at || '').slice(0, 4); if (/^\d{4}$/.test(y)) years.set(y, (years.get(y) || 0) + 1); }
      const top = [...years.entries()].sort((a, b) => b[1] - a[1])[0];
      const price = [...new Set((p.variants || []).map((v) => v.price).filter(Boolean))];
      const was = [...new Set((p.variants || []).map((v) => v.compare_at_price).filter((x) => x && Number(x) > 0))];
      return { id: 'shop_product', label: 'Store records', text: 'This product has been listed since ' + X.fmtT(String(p.created_at).slice(0, 7)) + (price.length === 1 ? ', priced ' + price[0] + (was.length === 1 ? ' (marked down from ' + was[0] + ')' : '') + ' in the store\'s currency' : '') + '.' + (top && all.length >= 20 ? ' Of the ' + all.length + ' products in its catalog file, ' + top[1] + ' were added in ' + top[0] + '.' : ''), note: 'From the store\'s own public product files.', links: [{ text: 'product file', url: f.origin + '/products/' + f.shopHandle + '.json' }], source: { name: 'the store', url: f.origin } };
    }
  };
  F.archive_presence = {
    label: 'Copies in the Internet Archive', when: (f) => !!f.domain, sends: () => 'the domain to the Internet Archive',
    async run(f, io) {
      const r = await io.get('https://web.archive.org/cdx/search/cdx?output=json&collapse=timestamp:4&fl=timestamp&url=' + enc(f.domain));
      const rows = (json(r.text) || []).slice(1).map((x) => String(x[0]).slice(0, 4)).filter((y) => /^\d{4}$/.test(y));
      if (!rows.length) return null;
      let gap = null; for (let i = 1; i < rows.length; i++) { const g = Number(rows[i]) - Number(rows[i - 1]); if (g >= 5 && (!gap || g > gap.len)) gap = { from: Number(rows[i - 1]) + 1, to: Number(rows[i]) - 1, len: g }; }
      return { id: 'archive', label: 'In the Internet Archive', text: 'Copies of this address from ' + rows[0] + ' to ' + rows[rows.length - 1] + (gap ? ', with none from ' + gap.from + ' to ' + gap.to : '') + '.', links: [{ text: 'Internet Archive', url: 'https://web.archive.org/web/*/' + f.domain }], source: { name: 'Internet Archive', url: 'https://web.archive.org/' } };
    }
  };
  F.rank = {
    label: 'Popularity rank', when: (f) => !!f.domain, sends: () => 'the domain to Tranco',
    async run(f, io) {
      const j = json((await io.get('https://tranco-list.eu/api/ranks/domain/' + enc(f.domain))).text) || {};
      const ranks = (j.ranks || []).filter((x) => num(x.rank)); if (!ranks.length) return null;
      const latest = ranks.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      return { id: 'rank', label: 'Popularity', text: 'Ranked ' + Number(latest.rank).toLocaleString('en-US') + ' among the world\'s websites (Tranco list, ' + X.fmtT(latest.date) + ').', links: [{ text: 'Tranco', url: 'https://tranco-list.eu/query' }], source: { name: 'Tranco', url: 'https://tranco-list.eu/' } };
    }
  };
  const VERIFY = { 'google-site': 'Google Search Console', 'facebook-domain': 'Meta', 'openai-domain': 'OpenAI', 'tollbit-domain': 'TollBit (AI content licensing)', 'apple-domain': 'Apple', 'atlassian-domain': 'Atlassian', '1password-site': '1Password', 'miro': 'Miro', 'rippling-domain': 'Rippling', 'cursor-domain': 'Cursor', 'brave-ledger': 'Brave Creators', 'docusign': 'DocuSign', 'adobe-idp-site': 'Adobe', 'stripe-verification': 'Stripe', 'hubspot-developer': 'HubSpot', 'zoom-domain': 'Zoom', 'slack-domain': 'Slack', 'anthropic-domain': 'Anthropic', 'perplexity-domain': 'Perplexity', 'pinterest-site': 'Pinterest', 'yandex-verification': 'Yandex', 'shopify-verification': 'Shopify', 'klaviyo-site': 'Klaviyo', 'mailchimp': 'Mailchimp', 'ms': 'Microsoft 365', 'notion-domain': 'Notion', 'canva-site': 'Canva', 'twilio-domain': 'Twilio', 'webex-domain': 'Webex' };
  F.dns_services = {
    label: 'Services the domain has verified with', when: (f) => !!f.domain, sends: () => 'the domain to Google Public DNS',
    async run(f, io) {
      const ans = ((json((await io.get('https://dns.google/resolve?type=TXT&name=' + enc(f.domain))).text) || {}).Answer || []).map((a) => String(a.data || '').replace(/"/g, ''));
      const names = new Set();
      for (const t of ans) { if (!/^[a-z0-9-]+[=:]/i.test(t) || /^v=/i.test(t)) continue; const key = t.split(/[=:]/)[0].toLowerCase().replace(/-verification$/, ''); const hit = Object.keys(VERIFY).find((k) => key === k || key.startsWith(k)); if (hit) names.add(VERIFY[hit]); }
      if (!names.size) return null;
      const list = [...names]; const ai = list.filter((n) => /OpenAI|TollBit|Anthropic|Perplexity/.test(n));
      return { id: 'dns_services', label: 'Verified with', text: 'Its DNS records verify accounts with ' + [ai.join(' and '), list.filter((n) => !ai.includes(n)).slice(0, 5).join(', ')].filter(Boolean).join(', and ') + '.', note: 'A verification record shows an account exists, not what it is used for.', links: [], source: { name: 'Google Public DNS', url: 'https://dns.google/query?type=TXT&name=' + enc(f.domain) } };
    }
  };
  X.FACTS = F;
  const entityFact = (e, id, label) => ({ id, label, text: (e.label || e.enwiki || 'Listed') + (e.founded ? ', founded ' + e.founded : '') + '.', links: (e.q ? [{ text: 'Wikidata', url: 'https://www.wikidata.org/wiki/' + e.q }] : []).concat(e.enwiki ? [{ text: 'Wikipedia', url: wikiUrl(e.enwiki) }] : []), source: { name: 'Wikidata', url: e.q ? 'https://www.wikidata.org/wiki/' + e.q : wikiUrl(e.enwiki) } });

  /* ---------- the router ----------
     1. Who is the site (its entity), and what is the page about (its subject)?
     2. Which questions about that subject can a source answer? In order: records, an official statistic the page names, coverage of
        the story, attention to the subject. Attention to the site is the last resort on an article, and is labelled as such.
     3. Run them in that order; the first that returns a defensible chart leads. If none does, there is no chart. */
  const SITE_IS_SUBJECT = new Set(['shop', 'organization', 'other']); // the page is about the site itself, or sells for it
  const EVERGREEN = ['recipe', 'guide', 'review', 'listicle'];
  /* Page facts from the report the content script already made. */
  X.pageFacts = function (p) {
    let u = null; try { u = new URL(p.url); } catch (e) { /* no url */ }
    const host = u ? u.hostname.toLowerCase() : String(p.hostname || '');
    const domain = String(p.domain || host).replace(/^www\./, '');
    const kind = p.pageKind || 'page';
    const handle = u && /\/products\/([a-z0-9][a-z0-9-]{1,120})\/?$/i.exec(u.pathname);
    const sells = !!p.sells || !!handle || !!p.productPage; // the page marks itself as a product (og:type or schema.org Product)
    const brand = String(p.entityLabel || p.siteName || '').replace(/\.(com|org|net|co\.uk)$/i, '').trim();
    // a front page or section index is about the site, not about one story
    const root = !!u && u.pathname.replace(/\/+$/, '') === '';
    const group = sells ? 'shop' : !root && EVERGREEN.includes(kind) ? 'evergreen' : !root && (kind === 'article' || (p.isArticle && kind !== 'index')) ? 'news' : (kind === 'donation' || p.nonprofit || /\.org$/.test(domain)) ? 'organization' : 'other';
    const terms = X.topicTerms({ title: p.title, siteName: p.siteName || brand, siteNames: [p.entityLabel, p.outletName, domain.split('.')[0]].filter(Boolean), text: p.text, url: p.url, keywords: p.keywords, article: group === 'news' });
    const published = /^\d{4}-\d{2}-\d{2}/.test(String(p.published || '')) ? String(p.published).slice(0, 10) : '';
    // the country whose statistical bodies the page names, when exactly one family is named
    const body = String(p.text || '').slice(0, 60000); const hints = [];
    if (/\b(Freddie Mac|Fannie Mae|Federal Reserve|Bureau of Labor Statistics|Labor Department|Commerce Department|Census Bureau|Treasury Department)\b/.test(body)) hints.push('US');
    if (/\b(Office for National Statistics|Bank of England)\b/.test(body)) hints.push('GB');
    if (/\b(European Central Bank|Eurostat)\b|\beuro ?zone\b|\beuro area\b/i.test(body)) hints.push('EA');
    const countryHint = hints.length === 1 ? hints[0] : '';
    return { url: p.url, title: terms.title, text: String(p.text || '').slice(0, 60000), published, origin: u ? u.origin : '', domain, siteName: p.siteName || brand, brand, group, isArticle: group === 'news', articleKind: kind === 'article', countryHint, entityQ: p.entityQ || '', legalName: String(p.legalName || '').replace(/\s+/g, ' ').trim().slice(0, 90), address: String(p.address || '').slice(0, 200), root, shopHandle: handle ? handle[1] : '', terms, site: null, subject: null };
  };
  const RECORDS = ['fec_committee', 'fec_employer', 'nonprofit_finances', 'sec_financials'];
  /* The ordered list of (source, target) to try. Needs f.site and f.subject. */
  X.candidates = function (f, o) {
    o = o || {}; const R = X.REGISTERED; const out = []; const seen = new Set();
    const add = (id, target, about) => {
      const s = R[id]; if (!s || (s.cookies && !o.trends)) return;
      if (s.scope === 'entity' && !target) return;
      const key = id + '|' + (s.scope === 'entity' ? target.q || target.label : '');
      if (seen.has(key)) return;
      let ok = false; try { ok = s.scope === 'entity' ? !!s.applies(target, f, o) : !!s.applies(f, o); } catch (e) { ok = false; }
      if (ok) { seen.add(key); out.push({ id, target: s.scope === 'entity' ? target : null, about }); }
    };
    const subj = f.subject, site = f.site; const real = subj && subj.kind !== 'phrase' ? subj : null;
    add('official_statistic', null, 'page');
    if (SITE_IS_SUBJECT.has(f.group)) {
      // a shop, an organization's own pages and a front page are about the site. An inner page of a large site ("Plan your visit" on an
      // agency's site) may be about something else: what is shown is still about the site, and is labelled so
      const about = f.group === 'other' && !f.root ? 'site' : 'subject';
      for (const id of RECORDS) add(id, site, about);
      add('sec_filings', site, about); add('site_views', site, about); add('site_trends', site, about); add('site_discussion', null, about);
      return out;
    }
    const money = X.moneySignal(f); const second = f.secondary || null; // an organization the headline also names, when the subject is a person or an event
    add('fec_committee', real, 'subject'); add('fec_employer', real, 'subject'); // these check for themselves that the page is about political money
    if (money) { add('nonprofit_finances', real, 'subject'); add('sec_financials', real, 'subject'); add('nonprofit_finances', second, 'subject'); add('sec_financials', second, 'subject'); }
    add('news_coverage', null, 'page');
    if (f.group === 'evergreen') { add('subject_trends', subj, 'subject'); add('subject_views', subj, 'subject'); }
    add('nonprofit_finances', real, 'subject'); add('sec_financials', real, 'subject'); add('nonprofit_finances', second, 'subject'); add('sec_financials', second, 'subject'); add('sec_filings', real, 'subject');
    add('subject_views', subj, 'subject'); add('subject_trends', subj, 'subject');
    // last resort on an article: something about the site, labelled as about the site
    const siteOnly = site && !(subj && subj.q && subj.q === site.q) ? site : null;
    add('nonprofit_finances', siteOnly, 'site'); add('sec_financials', siteOnly, 'site'); add('site_views', siteOnly, 'site'); add('site_trends', siteOnly, 'site');
    return out;
  };
  /* Run it. io.get(url, {cookies, accept}) -> {status, text}. Stops at the request budget. Never throws: a failed source is listed. */
  X.run = async function (f, io, o) {
    o = o || {}; const now = o.now || new Date(); const max = o.maxRequests || MAX_REQUESTS;
    let used = 0; const ran = []; const charts = []; const facts = [];
    const guarded = { get: async (url, opt) => { if (++used > max) throw new Error('request budget used'); return io.get(url, opt || {}); } };
    const err = (e) => String((e && e.message) || e).slice(0, 140);
    try { f.site = await siteEntity(f, guarded); ran.push({ id: 'site', label: 'Who runs this site', ok: !!f.site, sends: f.entityQ ? 'the site\'s Wikidata id to Wikidata' : 'the domain to Wikidata' }); }
    catch (e) { f.site = null; ran.push({ id: 'site', label: 'Who runs this site', ok: false, error: err(e), sends: 'the domain to Wikidata' }); }
    if (SITE_IS_SUBJECT.has(f.group)) {
      // the page names its own legal entity and no tax ID is known yet: one exact-name lookup among US nonprofit filers
      /* No tax ID known yet for an organization's own page: one exact-name lookup among US nonprofit filers.
         The legal name the page itself prints is taken as it is. The site's plain name ("Chester County Food Bank") is accepted only
         when the filer's city also appears on the page: a name alone could be another town's organization. */
      if (f.group !== 'shop' && !(f.site && (f.site.ein || f.site.cik)) && X.REGISTERED.nonprofit_finances) {
        const viaLegal = !!f.legalName; const name = f.legalName || (f.group === 'organization' ? f.siteName : '');
        if (name) {
          const sends = 'the name "' + name + '" to ProPublica Nonprofit Explorer';
          try {
            let hit = await X.filerByName(guarded, name);
            // the filer's city and state together, as an address writes them ("Exton, PA"): a city name alone hides inside other words
            if (hit && !viaLegal && !(hit.city && hit.state && new RegExp('(^|[^\\p{L}])' + hit.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[,\\s]+' + hit.state + '(?![\\p{L}])', 'iu').test(f.text + ' ' + (f.address || '')))) hit = null;
            if (hit) f.site = Object.assign(f.site || { q: '', label: name, enwiki: '', founded: '', country: 'US', cik: '', ticker: '', kind: 'organization' }, { ein: hit.ein });
            ran.push({ id: 'legal_name', label: 'Tax ID for the name on the page', ok: !!hit, sends });
          } catch (e) { ran.push({ id: 'legal_name', label: 'Tax ID for the name on the page', ok: false, error: err(e), sends }); }
        }
      }
      f.subject = f.site;
    }
    else {
      const asked = ((f.terms.entities || []).length ? f.terms.entities.slice(0, 3) : [f.terms.entity]).concat(f.terms.topic && f.terms.topic.split(' ').length >= 2 ? f.terms.topic : '').filter(Boolean);
      if (asked.length) {
        try { f.subject = await X.resolveSubject(f, guarded); ran.push({ id: 'subject', label: 'What the page is about', ok: !!f.subject, sends: 'the words ' + asked.map((a) => '"' + a + '"').join(' and ') + ' to Wikipedia and Wikidata' }); }
        catch (e) { f.subject = null; ran.push({ id: 'subject', label: 'What the page is about', ok: false, error: err(e), sends: 'the words ' + asked.map((a) => '"' + a + '"').join(' and ') + ' to Wikipedia and Wikidata' }); }
      }
    }
    for (const e of [f.site, f.subject]) if (e && !e.cik && e.ticker && o.secTickers) e.cik = X.cikFromTicker(e, o.secTickers);
    if (f.secondary && !f.secondary.cik && f.secondary.ticker && o.secTickers) f.secondary.cik = X.cikFromTicker(f.secondary, o.secTickers);
    for (const e of [f.site, f.subject, f.secondary]) if (e && !e.cik && !e.ein && o.secTickers) e.cik = X.cikFromName(e, o.secTickers);
    const pushFacts = (r) => { for (const x of [].concat((r && r.facts) || [], (r && r.fact) || [])) if (x && x.id) facts.push(x); };
    /* What may lead: records, an official statistic, real coverage, or attention with a clear spike. Ordinary attention (views and
       searches that say nothing in particular) never leads: on unseen pages no such chart told a reader anything about the page.
       It is kept in `other`, which the card folds away. */
    const other = []; const ATTENTION = new Set(['topic', 'site']);
    for (const c of X.candidates(f, o)) {
      const src = X.REGISTERED[c.id]; const attention = ATTENTION.has(src.basis);
      if (charts.length >= (o.maxCharts || 2) && !attention) continue;
      if (attention && (other.length >= 2 || (charts.length >= (o.maxCharts || 2)))) continue;
      if (c.about === 'site' && SITE_IS_SUBJECT.has(f.group) === false && charts.length) break; // the last resort on an article is not needed once something about the page was found
      const sends = src.scope === 'entity' ? src.sends(c.target, f) : src.sends(f);
      try {
        const r = src.scope === 'entity' ? await src.run(c.target, f, guarded, now, o) : await src.run(f, guarded, now, o);
        if (r && r.chart) { const chart = Object.assign({}, r.chart, { id: c.id, basis: src.basis, question: src.question, about: c.about, aboutLabel: c.target ? c.target.label || c.target.enwiki : c.about === 'page' ? '' : (f.site && f.site.label) || f.siteName, sends, cookies: !!src.cookies }); (attention && !chart.notable ? other : charts).push(chart); }
        pushFacts(r);
        ran.push({ id: c.id, label: src.label, ok: !!(r && (r.chart || r.fact || (r.facts || []).length)), chart: !!(r && r.chart), error: r && r.error ? String(r.error).slice(0, 140) : undefined, sends });
      } catch (e) { ran.push({ id: c.id, label: src.label, ok: false, error: err(e), sends }); }
    }
    if (f.subject && f.subject.kind !== 'phrase' && !(f.site && f.subject.q === f.site.q)) facts.push(entityFact(f.subject, 'subject', 'This page is about'));
    if (f.site) facts.push(entityFact(f.site, 'entity', 'This site'));
    for (const id of Object.keys(F)) {
      const src = F[id]; if (!src.when(f, o)) continue;
      try { const r = await src.run(f, guarded, now); if (r) facts.push(r); ran.push({ id, label: src.label, ok: !!r, sends: src.sends(f) }); }
      catch (e) { ran.push({ id, label: src.label, ok: false, error: err(e), sends: src.sends(f) }); }
    }
    const seen = new Set();
    return { group: f.group, subject: f.subject ? { label: f.subject.label || f.subject.enwiki, kind: f.subject.kind } : null, terms: f.terms, charts, other, facts: facts.filter((x) => !seen.has(x.id) && seen.add(x.id)), ran, requests: Math.min(used, max), at: now.toISOString() };
  };
  return X;
});
