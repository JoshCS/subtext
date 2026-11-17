/* Subtext context source: official_statistic (basis 'statistic', scope 'page').
   Answers "What does the official series say?" only when the page itself is about a named statistic: its name is in the
   headline, or it appears at least three times in the main text with a number near it. A page that mentions the economy in
   passing gets nothing. The country comes from the statistic's own qualifier on the page, else from the site's country; a
   wrong country is worse than no chart. The registry of series (what each measures, its limits) is data/stat-series.json.
   Requests: at most 2 (one, plus one retry or fallback). Only the series or indicator code and a country code are sent.
   Contract: docs/CONTEXT-CONTRACT.md */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./context-data.js'));
  else root.SubtextContextStats = factory(root.SubtextContextData);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (X) {
  'use strict';
  const U = X.util;
  const MAX_REQUESTS = 2;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MON3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const NAMES = { US: 'the United States', GB: 'the United Kingdom', EA: 'the euro area', CZ: 'Czechia', NL: 'the Netherlands', PH: 'the Philippines', KR: 'South Korea' };

  // ---------- registry ----------
  let REG = null; let compiled = null;
  function setRegistry(d) { REG = d && d.statistics && Array.isArray(d.series) ? d : null; compiled = null; return !!REG; }
  // Node: read the file now. Worker: fetch the bundled file once; the router should await `ready` before planning.
  let ready = Promise.resolve(false);
  if (typeof module === 'object' && module.exports) { try { ready = Promise.resolve(setRegistry(require('./data/stat-series.json'))); } catch (e) { /* tests inject */ } }
  else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL && typeof fetch === 'function') {
    ready = fetch(chrome.runtime.getURL('data/stat-series.json')).then((r) => r.json()).then(setRegistry).catch(() => false);
  }

  // ---------- text helpers ----------
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const B0 = '(?<![\\p{L}\\p{N}])'; const B1 = '(?![\\p{L}\\p{N}])';
  const phraseRe = (p) => new RegExp(B0 + esc(p).replace(/\s+/g, '[\\s-]+') + B1, 'giu');
  const normText = (s) => String(s || '').replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/ /g, ' ');
  // a number with a unit: "3.1%", "4.3 percent", "$3.12", "25 basis points". A bare year or day is not a number for this purpose.
  const UNIT_NUM = /(?:\$\s?\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?\s?(?:%|percent\b|per cent\b|percentage points?\b|basis points?\b|cents?\b))/gi;
  const PCT = /(-?\d+(?:\.\d+)?)\s?(?:%|percent\b|per cent\b)/gi;
  const DOLLAR = /\$\s?(\d[\d,]*(?:\.\d+)?)/g;

  function compile() {
    if (compiled) return compiled;
    if (!REG) return null;
    const stats = {};
    for (const [id, s] of Object.entries(REG.statistics)) {
      stats[id] = {
        id, label: s.label,
        names: (s.names || []).slice().sort((a, b) => b.length - a.length).map((n) => ({ n, re: phraseRe(n) })),
        exclude: (s.exclude || []).map(phraseRe),
        before: new Set((s.excludeBefore || []).map((w) => w.toLowerCase())),
        near: (s.near || []).map((w) => w.toLowerCase())
      };
    }
    // places: longest first, so "New Mexico" is not "Mexico" and "British Columbia" is not "British".
    // Capitalised names match case-sensitively ("US" is not "us"); lower-case ones ("eurozone") match any case.
    const places = [];
    for (const [cc, list] of Object.entries(REG.places || {})) for (const name of list) places.push({ cc, name });
    places.sort((a, b) => b.name.length - a.name.length);
    const alt = (arr) => arr.map((p) => esc(p.name).replace(/\s+/g, '\\s+')).join('|');
    const capPlaces = places.filter((p) => /\p{Lu}/u.test(p.name)); const lowPlaces = places.filter((p) => !/\p{Lu}/u.test(p.name));
    const placeRe = [capPlaces.length ? new RegExp(B0 + '(' + alt(capPlaces) + ')' + '(?![\\p{L}\\p{N}])', 'gu') : null, lowPlaces.length ? new RegExp(B0 + '(' + alt(lowPlaces) + ')' + B1, 'giu') : null].filter(Boolean);
    const lookup = new Map(); for (const p of places) { const k = p.name.replace(/\s+/g, ' '); if (!lookup.has(k)) lookup.set(k, p.cc); if (!lookup.has(k.toLowerCase())) lookup.set(k.toLowerCase(), p.cc); }
    const mk = (arr, flags, pre, post) => (arr.length ? new RegExp(pre + '(' + alt(arr) + ')' + post, flags) : null);
    const beforeRe = [mk(capPlaces, 'u', B0, "(?:'s|')?\\s+(?:[\\p{L}\\p{N}-]+\\s+){0,2}$"), mk(lowPlaces, 'iu', B0, "(?:'s)?\\s+(?:[\\p{L}\\p{N}-]+\\s+){0,2}$")].filter(Boolean);
    const afterRe = [mk(capPlaces, 'u', '^(?:\\s+rate)?\\s+(?:in|for|across)\\s+(?:the\\s+)?', '(?![\\p{L}\\p{N}])'), mk(lowPlaces, 'iu', '^(?:\\s+rate)?\\s+(?:in|for|across)\\s+(?:the\\s+)?', B1)].filter(Boolean);
    return (compiled = { stats, placeRe, beforeRe, afterRe, lookup });
  }

  // every occurrence of a statistic's names in s, longest name first, no overlaps; each says whether it is excluded and whether a number is near
  function occurrences(st, s) {
    const taken = []; const out = [];
    for (const { n, re } of st.names) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(s))) {
        const a = m.index, b = a + m[0].length;
        if (taken.some(([x, y]) => a < y && b > x)) continue;
        taken.push([a, b]);
        const off = Math.max(0, a - 60);
        const win = s.slice(off, Math.min(s.length, b + 80));
        let excluded = false;
        for (const ex of st.exclude) { ex.lastIndex = 0; let e; while ((e = ex.exec(win))) { const ea = off + e.index, eb = ea + e[0].length; if (ea < b && eb > a) { excluded = true; break; } } if (excluded) break; }
        // "CPI" and "HICP" are also a party, an advertising cost and a corruption index: they count only with a price word beside them
        if (/^(cpi|hicp)$/i.test(n) && !/inflation|consumer price|price index|\bprices\b/i.test(win)) excluded = true;
        const prev = (s.slice(Math.max(0, a - 30), a).toLowerCase().match(/([\p{L}\p{N}'-]+)\s*$/u) || [])[1] || ''; // "15-year", "youth", "state's"
        if (prev && (st.before.has(prev) || st.before.has(prev.replace(/'s$/, '')))) excluded = true;
        UNIT_NUM.lastIndex = 0;
        const numNear = UNIT_NUM.test(win);
        const wl = win.toLowerCase();
        const nearWord = !st.near.length || st.near.some((w) => wl.includes(w));
        out.push({ a, b, name: n, excluded, nearWord, counted: !excluded && numNear && nearWord });
      }
    }
    return out.sort((x, y) => x.a - y.a);
  }

  const placeCode = (C, name) => { const k = name.replace(/\s+/g, ' '); return C.lookup.get(k) || C.lookup.get(k.toLowerCase()) || ''; };
  /* A qualifier attached to the phrase: the place right before it ("US inflation", "Japan's annual inflation", at most two words
     between) or right after it ("inflation in Canada", "the jobless rate across the euro area"). A place merely nearby is not one. */
  function attached(C, s, occ) {
    const before = s.slice(Math.max(0, occ.a - 70), occ.a);
    for (const re of C.beforeRe) { const m = re.exec(before); if (m) return placeCode(C, m[1]); }
    const after = s.slice(occ.b, Math.min(s.length, occ.b + 70));
    for (const re of C.afterRe) { const m = re.exec(after); if (m) return placeCode(C, m[1]); }
    return '';
  }
  // every place within 45 characters before or 30 after the phrase
  function nearby(C, s, occ) {
    const from = Math.max(0, occ.a - 80), win = s.slice(from, Math.min(s.length, occ.b + 70)); const out = []; // read wider, keep names that start in range
    for (const re of C.placeRe) { re.lastIndex = 0; let m; while ((m = re.exec(win))) { const pa = from + m.index, pb = pa + m[0].length; if (pa < occ.b && pb > occ.a) continue; if (pb < occ.a - 45 || pa > occ.b + 30) continue; const cc = placeCode(C, m[1]); if (cc) out.push(cc); } }
    return out;
  }

  /* match(f) -> { id, statistic, country, where: 'headline' | 'text', count } or null. Pure. */
  function match(f, registry) {
    if (registry) setRegistry(registry);
    const C = compile(); if (!C || !f) return null;
    const title = normText(f.title || (f.terms && f.terms.title) || '');
    const text = normText(String(f.text || '').slice(0, 60000));
    UNIT_NUM.lastIndex = 0;
    const titleNum = UNIT_NUM.test(title);
    const cands = [];
    for (const st of Object.values(C.stats)) {
      const inTitle = occurrences(st, title).filter((o) => !o.excluded);
      const inText = occurrences(st, text).filter((o) => o.counted);
      // the headline names it, and either the headline gives a number with one of the statistic's own words, or the text uses it with a number
      const headline = inTitle.length > 0 && ((titleNum && inTitle.some((o) => o.nearWord)) || inText.length >= 1);
      if (!headline && inText.length < 3) continue;
      cands.push({ st, inTitle, inText, headline });
    }
    if (!cands.length) return null;
    const pool = cands.some((c) => c.headline) ? cands.filter((c) => c.headline) : cands;
    pool.sort((a, b) => b.inText.length - a.inText.length);
    if (pool.length > 1 && pool[0].inText.length === pool[1].inText.length) return null; // two statistics equally: no guess
    const c = pool[0];
    // the site's country, else the country whose statistical bodies the page itself names ("Freddie Mac said", "the Bank of England")
    const site = String((f.site && f.site.country) || f.countryHint || '').toUpperCase();
    // country: a qualifier attached to the phrase in the headline, then the ones attached in the text, then the site's country
    let cc = c.headline ? c.inTitle.map((o) => attached(C, title, o)).find(Boolean) || '' : '';
    if (!cc) {
      const votes = new Map();
      for (const o of c.inText) { const p = attached(C, text, o); if (p) votes.set(p, (votes.get(p) || 0) + 1); }
      const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
      if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null; // two places equally: no guess
      if (ranked.length) cc = ranked[0][0];
    }
    if (!cc) {
      // no attached qualifier: the site's country, unless another place stands next to the phrase ("after German carmaker shuts plant")
      const near = [].concat(...(c.headline ? c.inTitle : []).map((o) => nearby(C, title, o)), ...c.inText.map((o) => nearby(C, text, o)));
      if (near.some((p) => p !== site)) return null;
      cc = site;
    }
    if (!cc || cc.startsWith('_')) return null; // another country we have no series for, or a state or city
    const series = REG.series.find((s) => s.statistic === c.st.id && s.countries.includes(cc));
    if (!series) return null;
    return { id: series.id, statistic: c.st.id, country: cc, where: c.headline ? 'headline' : 'text', count: c.inText.length };
  }

  /* The number the page itself states for the statistic: linked to the phrase by a verb or preposition in the same sentence
     ("rose to 3.1%", "was 4.3%", "at $3.40"), and only when there is exactly one such number. "Inflation: 60% of Americans say" gives none. */
  const LINKED = /\b(?:was|is|at|to|hit|hits|hitting|reached|reaching|of|stood at|came in at)\s+(?:an?\s+(?:annual\s+|annualized\s+|annualised\s+)?(?:rate|pace)\s+of\s+)?(\$\s?\d[\d,]*(?:\.\d+)?|-?\d+(?:\.\d+)?\s?(?:%|percent\b|per cent\b))/gi;
  function pageNumber(f, m, entry) {
    const C = compile(); const st = C.stats[m.statistic];
    const vals = (s, occs) => {
      const set = new Map();
      for (const o of occs) {
        const w = s.slice(o.b, Math.min(s.length, o.b + 60)).split(/[.;!?:](?=\s|$)/)[0];
        LINKED.lastIndex = 0; let x;
        while ((x = LINKED.exec(w))) { const raw = x[1]; const isMoney = raw[0] === '$'; if (isMoney !== !!entry.money) continue; const k = raw.replace(/[\s,$]|percent|per cent|%/gi, ''); set.set(k, isMoney ? raw.replace(/\s/g, '') : k + '%'); }
      }
      return [...set.values()];
    };
    const title = normText(f.title || ''); const text = normText(String(f.text || '').slice(0, 60000));
    const t = vals(title, occurrences(st, title).filter((o) => !o.excluded));
    if (t.length) return t.length === 1 ? t[0] : null;
    const v = vals(text, occurrences(st, text).filter((o) => o.counted));
    return v.length === 1 ? v[0] : null;
  }

  // ---------- periods ----------
  const ym = (y, m) => y + '-' + String(m).padStart(2, '0');
  const addMonths = (t, n) => { const [y, m] = t.split('-').map(Number); const k = y * 12 + (m - 1) + n; return ym(Math.floor(k / 12), (k % 12) + 1); };
  const monthGrid = (from, to) => { const out = []; for (let t = from; t <= to; t = addMonths(t, 1)) out.push(t); return out; };
  function unfinished(t, resolution, now) {
    const today = now.toISOString().slice(0, 10);
    if (resolution === 'month') return t >= today.slice(0, 7);
    if (resolution === 'quarter') { const q = (s) => Number(s.slice(0, 4)) * 4 + Math.floor((Number(s.slice(5, 7)) - 1) / 3); return q(t) >= q(today); }
    if (resolution === 'year') return t >= today.slice(0, 4);
    return t > today;
  }
  const finished = (pts, resolution, now) => pts.filter((p) => p.t && !unfinished(p.t, resolution, now));
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  // trim missing values at both ends; keep the ones inside (drawn as gaps)
  const trim = (pts) => { let a = 0, b = pts.length; while (a < b && pts[a].v == null) a++; while (b > a && pts[b - 1].v == null) b--; return pts.slice(a, b); };

  // CPI-style index levels -> percent change from the same month a year earlier. A missing month on either side stays missing.
  function pct12(levels) {
    const by = new Map(levels.map((p) => [p.t, p.v]));
    return levels.map((p) => { const base = by.get(addMonths(p.t, -12)); return { t: p.t, v: p.v != null && base != null && base !== 0 ? r1((p.v / base - 1) * 100) : null }; });
  }

  // ---------- parsers (each returns points or null for malformed data) ----------
  function parseBls(text, code) {
    const j = U.json(text); if (!j || j.status !== 'REQUEST_SUCCEEDED') return null;
    const s = (((j.Results || {}).series) || []).find((x) => x.seriesID === code); if (!s || !Array.isArray(s.data) || !s.data.length) return null;
    const by = new Map();
    for (const d of s.data) { const m = /^M(0[1-9]|1[0-2])$/.exec(d.period || ''); if (!m || !/^\d{4}$/.test(d.year || '')) continue; by.set(ym(d.year, Number(m[1])), U.num(d.value)); }
    if (!by.size) return null;
    const ts = [...by.keys()].sort();
    return monthGrid(ts[0], ts[ts.length - 1]).map((t) => ({ t, v: by.has(t) ? by.get(t) : null }));
  }
  function parseOns(text) {
    const j = U.json(text); if (!j || !Array.isArray(j.months)) return null;
    const by = new Map();
    for (const m of j.months) {
      const d = /^(\d{4}) ([A-Z]{3})$/.exec(m.date || ''); if (!d) continue;
      let t = ym(d[1], MON3.indexOf(d[2]) + 1);
      if (MON3.indexOf(d[2]) < 0) continue;
      if (/^\d{4} [A-Z]{3}-[A-Z]{3}$/.test(m.label || '')) t = addMonths(t, 1); // a three-month average is dated by its middle month: date it by its last
      by.set(t, U.num(m.value));
    }
    if (!by.size) return null;
    const ts = [...by.keys()].sort();
    return { points: monthGrid(ts[0], ts[ts.length - 1]).map((t) => ({ t, v: by.has(t) ? by.get(t) : null })), threeMonth: j.months.some((m) => /-/.test(m.label || '')) };
  }
  function parseEurostat(text) {
    const j = U.json(text); if (!j || !j.dimension || !j.dimension.time || !j.value || !Array.isArray(j.size)) return null;
    if (j.size.some((n, i) => j.id[i] !== 'time' && n !== 1)) return null; // more than one series came back
    const idx = (j.dimension.time.category || {}).index || {};
    const pts = Object.entries(idx).filter(([t]) => /^\d{4}-\d{2}$/.test(t)).map(([t, i]) => ({ t, v: U.num(j.value[String(i)]) })).sort((a, b) => (a.t < b.t ? -1 : 1));
    return pts.length ? pts : null;
  }
  function parseWorldBank(text, iso2) {
    const j = U.json(text); if (!Array.isArray(j) || !Array.isArray(j[1])) return null;
    const rows = j[1].filter((r) => r && r.country && String(r.country.id).toUpperCase() === iso2 && /^\d{4}$/.test(r.date || ''));
    if (!rows.length) return null;
    const by = new Map(rows.map((r) => [r.date, r.value == null ? null : U.num(r.value)]));
    const ys = [...by.keys()].sort(); const out = [];
    for (let y = Number(ys[0]); y <= Number(ys[ys.length - 1]); y++) out.push({ t: String(y), v: by.has(String(y)) ? r1(by.get(String(y))) : null });
    return out;
  }
  function parseFred(text, code) {
    const lines = String(text || '').trim().split(/\r?\n/);
    if (lines.length < 2 || !new RegExp('^(observation_date|DATE),' + esc(code) + '$', 'i').test(lines[0].trim())) return null;
    const pts = [];
    for (const l of lines.slice(1)) { const [d, v] = l.split(','); if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) continue; pts.push({ t: d.slice(0, 7), v: v === '.' ? null : U.num(v) }); }
    return pts.length ? pts : null;
  }
  function parseFreddie(text) {
    const lines = String(text || '').trim().split(/\r?\n/); if (!/^date,pmms30/i.test(lines[0] || '')) return null;
    const pts = [];
    for (const l of lines.slice(1)) { const c = l.split(','); const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(c[0] || ''); if (!d) continue; pts.push({ t: d[3] + '-' + d[1].padStart(2, '0') + '-' + d[2].padStart(2, '0'), v: U.num(String(c[1] || '').trim()) }); }
    return pts.length ? pts.sort((a, b) => (a.t < b.t ? -1 : 1)) : null;
  }
  function parseNyFed(text) {
    const j = U.json(text); if (!j || !Array.isArray(j.refRates) || !j.refRates.length) return null;
    const days = j.refRates.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.effectiveDate || '')).sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));
    if (!days.length) return null;
    const by = new Map();
    for (const r of days) { const v = U.num(r.percentRate); if (v == null) continue; const k = r.effectiveDate.slice(0, 7); const x = by.get(k) || { s: 0, n: 0 }; x.s += v; x.n++; by.set(k, x); }
    const ks = [...by.keys()].sort(); if (!ks.length) return null;
    const last = days[days.length - 1];
    return { points: monthGrid(ks[0], ks[ks.length - 1]).map((t) => ({ t, v: by.has(t) ? Math.round((by.get(t).s / by.get(t).n) * 100) / 100 : null })), range: { from: U.num(last.targetRateFrom), to: U.num(last.targetRateTo), t: last.effectiveDate } };
  }

  // ---------- wording ----------
  const pc = (v) => (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(Math.abs(v * 10 - Math.round(v * 10)) > 1e-9 ? 2 : 1)) + '%';
  const fmtVal = (v, e) => (e.money ? (e.unit.includes('gallon') ? '$' + v.toFixed(2) : '$' + Math.round(v).toLocaleString('en-US')) : pc(v));
  function periodName(t, res) {
    if (res === 'year') return t;
    if (res === 'quarter') { const q = Math.floor((Number(t.slice(5, 7)) - 1) / 3); return 'the ' + ['first', 'second', 'third', 'fourth'][q] + ' quarter of ' + t.slice(0, 4); }
    if (res === 'week') return 'the week of ' + U.fmtT(t);
    return MONTHS[Number(t.slice(5, 7)) - 1] + ' ' + t.slice(0, 4);
  }
  const shortPeriod = (t, res) => (res === 'quarter' ? 'Q' + (Math.floor((Number(t.slice(5, 7)) - 1) / 3) + 1) + ' ' + t.slice(0, 4) : periodName(t, res));
  const countryName = (cc) => NAMES[cc] || ((REG.places || {})[cc] || [cc])[0];
  const subjectOf = (e, cc) => (e.countries.length > 1 ? e.subject + ' in ' + countryName(cc) : e.subject);
  const titleOf = (e, cc) => (e.countries.length > 1 ? e.title + ': ' + countryName(cc).replace(/^the /, '').replace(/^./, (c) => c.toUpperCase()) : e.title);
  function lead(e, cc, p, res, extra) {
    const subj = subjectOf(e, cc); const v = p.v; const per = periodName(p.t, res); const src = ' (' + (extra.short || e.short) + ')';
    const abs = pc(Math.abs(v));
    switch (e.wording) {
      case 'change': return subj + (v > 0 ? ' rose ' + abs : v < 0 ? ' fell ' + abs : ' were unchanged') + ' over the 12 months to ' + per + src + '.';
      case 'change_year': return subj + (v > 0 ? ' rose ' + abs : v < 0 ? ' fell ' + abs : ' were unchanged') + ' on average in ' + per + ' compared with the year before' + src + '.';
      case 'growth_quarter': return subj + (v > 0 ? ' grew at an annual rate of ' + abs : v < 0 ? ' shrank at an annual rate of ' + abs : ' was unchanged') + ' in ' + per + src + '.';
      case 'growth_year': return subj + (v > 0 ? ' grew ' + abs : v < 0 ? ' shrank ' + abs : ' was unchanged') + ' in ' + per + src + '.';
      case 'rate3m': return subj + ' was ' + fmtVal(v, e) + ' in the three months to ' + per + src + '.';
      case 'rate': if (res === 'week') return subj + ' was ' + fmtVal(v, e) + ' in ' + per + src + '.';
        return subj + (e.transform === 'monthly_mean' ? ' averaged ' : ' was ') + fmtVal(v, e) + ' in ' + per + src + '.';
      default: return subj + ' was ' + fmtVal(v, e) + (e.unit.includes('gallon') ? ' a gallon' : '') + ' in ' + per + src + '.';
    }
  }

  // ---------- run ----------
  const lagOf = (res) => (res === 'month' ? 12 : res === 'quarter' ? 4 : res === 'year' ? 1 : 52);
  const MIN_PTS = { month: 12, quarter: 8, year: 10, week: 26 };
  const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? U.enc(String(vars[k])) : ''));
  const WB_CODE = { EA: 'XC' };

  async function fetchSeries(e, cc, io, now, o) {
    const y = now.getUTCFullYear(); const today = now.toISOString().slice(0, 10);
    const get = async (url) => { const r = await io.get(url); return r && r.status === 200 ? String(r.text || '') : null; };
    const out = { short: e.short };
    if (e.source === 'bls') {
      // one request: the keyless allowance is small (25 queries a day documented for unregistered use), so no retry
      const pts = parseBls(await get(fill(e.endpoint, { code: e.code, startyear: y - 4, endyear: y })), e.code);
      if (!pts) return null;
      out.levels = pts; out.points = e.transform === 'pct12' ? pct12(pts) : pts; out.resolution = 'month';
    } else if (e.source === 'ons') {
      const r = parseOns(await get(e.endpoint)); if (!r) return null;
      out.points = r.points; out.resolution = 'month';
    } else if (e.source === 'eurostat') {
      const pts = parseEurostat(await get(fill(e.endpoint, { geo: (e.geoCodes || {})[cc] || cc, start: ym(y - 3, 1) }))); if (!pts) return null;
      out.points = pts; out.resolution = 'month';
    } else if (e.source === 'worldbank') {
      const iso = WB_CODE[cc] || cc;
      const url = (code) => fill(e.endpoint, { iso2: iso, code, start: y - 16, end: y - 1 });
      let text = await get(url(e.code));
      if (text == null) text = await get(url(e.code)); // the World Bank API often times out on the first try
      let pts = parseWorldBank(text, iso);
      if (e.fallbackCode && text != null && (!pts || trim(pts).filter((p) => p.v != null).length < MIN_PTS.year)) {
        const alt = parseWorldBank(await get(url(e.fallbackCode)), iso);
        if (alt) { pts = alt; out.short = e.fallbackShort; out.fallback = true; }
      }
      if (!pts) return null;
      out.points = pts; out.resolution = 'year';
    } else if (e.source === 'fred') {
      const res = e.frequency === 'quarterly' ? 'quarter' : e.frequency === 'annual' ? 'year' : 'month';
      const start = res === 'quarter' ? (y - 6) + '-01-01' : (y - 17) + '-01-01';
      const pts = parseFred(await get(fill(e.endpoint, { code: e.code, start })), e.code); if (!pts) return null;
      out.points = res === 'year' ? pts.map((p) => ({ t: p.t.slice(0, 4), v: p.v })) : pts; out.resolution = res;
    } else if (e.source === 'freddie') {
      const pts = parseFreddie(await get(e.endpoint)); if (!pts) return null;
      out.points = pts.filter((p) => p.t <= today); out.resolution = 'week';
    } else if (e.source === 'nyfed') {
      const start = addMonths(today.slice(0, 7), -37) + '-01';
      const r = parseNyFed(await get(fill(e.endpoint, { start, end: today }))); if (!r) return null;
      out.points = r.points; out.range = r.range; out.resolution = 'month';
    } else return null;
    return out;
  }

  function windowOf(pts, res) {
    if (res === 'month') return pts.slice(-36);
    if (res === 'week') return pts.slice(-156);
    if (res === 'quarter') return pts.slice(-20);
    return pts.slice(-15); // years: at least 10 when the series has them
  }
  const windowWords = (res, first) => (res === 'month' || res === 'week' ? 'in the last three years' : res === 'quarter' ? 'in the last five years' : 'since ' + first.t);

  function build(f, m, e, got, now) {
    const res = got.resolution;
    let base = trim(finished(got.points, res, now));
    if (got.levels && base.length) { // a computed change: keep the months whose index exists, even when the change cannot be computed
      const lastLevel = finished(got.levels, res, now).filter((p) => p.v != null).pop();
      if (lastLevel) base = finished(got.points, res, now).filter((p) => p.t >= base[0].t && p.t <= lastLevel.t);
    }
    let pts = windowOf(base, res);
    const known = pts.filter((p) => p.v != null);
    if (known.length < MIN_PTS[res]) return null;
    // the latest period: the last one with a value; say so when a later period exists without one
    const all = finished(got.points, res, now);
    const last = known[known.length - 1];
    let gapNote = '';
    if (got.levels) {
      const lastLevel = finished(got.levels, res, now).filter((p) => p.v != null).pop();
      if (lastLevel && lastLevel.t > last.t) gapNote = ' No 12-month figure for ' + periodName(lastLevel.t, res) + ': the index for ' + periodName(addMonths(lastLevel.t, -12), res) + ' is missing.';
    }
    let prior = null;
    if (res === 'week') { const target = new Date(Date.parse(last.t) - 364 * 864e5).toISOString().slice(0, 10); prior = all.filter((p) => p.t <= target).pop() || null; if (prior && (Date.parse(target) - Date.parse(prior.t)) > 7 * 864e5) prior = null; }
    else { const want = res === 'year' ? String(Number(last.t) - 1) : addMonths(last.t, -12); prior = all.find((p) => p.t === want) || null; } // quarters are dated by their first month
    let hi = known[0], lo = known[0];
    for (const p of known) { if (p.v > hi.v) hi = p; if (p.v < lo.v) lo = p; }
    const fv = (v) => fmtVal(v, e);
    let s = lead(e, m.country, last, res, got);
    if (got.range && got.range.from != null && got.range.to != null) s += ' The Federal Reserve\'s target range was ' + got.range.from.toFixed(2) + '% to ' + got.range.to.toFixed(2) + '% on ' + U.fmtT(got.range.t) + '.';
    s += gapNote;
    s += prior && prior.v != null ? ' A year earlier the figure was ' + fv(prior.v) + '.' : ' No figure is available for a year earlier.';
    s += ' The highest ' + windowWords(res, pts[0]) + ' was ' + fv(hi.v) + ' in ' + shortPeriod(hi.t, res) + '; the lowest was ' + fv(lo.v) + ' in ' + shortPeriod(lo.t, res) + '.';
    // a page published before the latest figure: also give the figure for the month before it was published, which is the one it reports
    if (res === 'month' && f.published && /^\d{4}-\d{2}/.test(f.published)) { const pm = addMonths(f.published.slice(0, 7), -1); const then = pm < last.t ? known.find((p) => p.t === pm) : null; if (then) s += ' For ' + periodName(pm, res) + ', the month before this page was published, the figure was ' + fv(then.v) + '.'; }
    if (got.fallback) s += ' The country\'s own estimate covers too few years, so this is the ILO\'s modelled estimate.';
    const cc = m.country;
    const chart = {
      id: 'official_statistic', basis: 'statistic', question: 'What does the official series say?',
      title: titleOf(e, cc), sentence: s, kind: res === 'year' || res === 'quarter' ? 'bars' : 'line', resolution: res,
      points: pts.map((p) => ({ t: p.t, v: p.v })), unit: e.unit,
      transient: e.source === 'fred' || undefined, // FRED's terms restrict storing its data: the worker keeps this chart in memory only
      note: e.note || e.limits, source: { name: e.short.replace(/, via FRED$/, '') + (e.source === 'fred' ? ' (via FRED)' : ''), url: e.page.replace('{iso2}', WB_CODE[cc] || cc) }
    };
    if (e.money) chart.nominal = !!e.nominal;
    if (f.published && /^\d{4}-\d{2}-\d{2}$/.test(f.published)) { // only inside the drawn window: the card cannot place a date beyond it
      const t = res === 'year' ? f.published.slice(0, 4) : res === 'week' ? f.published : f.published.slice(0, 7);
      const endT = res === 'quarter' ? addMonths(pts[pts.length - 1].t, 2) : pts[pts.length - 1].t;
      if (t >= pts[0].t && t <= endT) chart.mark = { t: res === 'quarter' ? addMonths(t, -((Number(t.slice(5, 7)) - 1) % 3)) : t, label: 'page published' };
    }
    const facts = [];
    const said = pageNumber(f, m, e);
    if (said != null) facts.push({ id: 'official_statistic_page', label: 'The page states', text: said + '.', links: [], note: 'Read from the page next to the words "' + REG.statistics[m.statistic].label + '"; Subtext does not compare it with the series.', source: { name: 'this page', url: String(f.url || '') } });
    return { chart, facts };
  }

  const cache = new WeakMap(); // one match per page facts object; nothing is stored across pages
  const matchOf = (f) => { if (!f || typeof f !== 'object') return null; const key = String((f.site && f.site.country) || '') + '|' + String(f.title || '').length + '|' + String(f.text || '').length; const c = cache.get(f); if (c && c.key === key) return c.m; const m = match(f); cache.set(f, { key, m }); return m; };
  const entryOf = (m) => (m && REG ? REG.series.find((s) => s.id === m.id) : null);
  function sendsOf(e, cc) {
    if (e.source === 'worldbank') return 'the indicator code ' + e.code + (e.fallbackCode ? ' (and ' + e.fallbackCode + ' if that series is short)' : '') + ' and the country code ' + (WB_CODE[cc] || cc) + ' to the World Bank';
    if (e.source === 'eurostat') return 'the dataset code ' + e.code + ' and the country code ' + ((e.geoCodes || {})[cc] || cc) + ' to Eurostat';
    if (e.source === 'freddie') return 'a request for the mortgage-rate history file to Freddie Mac (nothing about the page)';
    return 'the series code ' + e.code + ' to ' + e.agency;
  }

  const source = {
    id: 'official_statistic', basis: 'statistic', scope: 'page',
    label: 'Official statistic named by the page',
    question: 'What does the official series say?',
    applies: (f) => !!matchOf(f),
    sends: (f) => { const m = matchOf(f); const e = entryOf(m); return e ? sendsOf(e, m.country) : 'nothing'; },
    async run(f, io, now, o) {
      now = now || new Date();
      const m = matchOf(f); const e = entryOf(m); if (!e) return null;
      let used = 0;
      let limited = false; // the BLS answers 200 with a refusal once a reader's keyless daily allowance (about 25 requests) is used
      const capped = { get: async (url, opt) => { if (++used > MAX_REQUESTS) return { status: 0, text: '' }; try { const r = (await io.get(url, opt || {})) || { status: 0, text: '' }; if (/api\.bls\.gov/.test(url) && /daily threshold/i.test(String(r.text || '').slice(0, 600))) limited = true; return r; } catch (err) { return { status: 0, text: '' }; } } };
      try { const got = await fetchSeries(e, m.country, capped, now, o || {}); return got ? build(f, m, e, got, now) : limited ? { chart: null, facts: [], error: 'The Bureau of Labor Statistics limits requests without a key to about 25 a day, and today\'s are used. Try again tomorrow.' } : null; }
      catch (err) { return null; }
    }
  };
  if (X && X.register) X.register(source);
  return { source, match, setRegistry, ready, fetchSeries, build, registry: () => REG, pct12, parseBls, parseOns, parseEurostat, parseWorldBank, parseFred, parseFreddie, parseNyFed, MAX_REQUESTS };
});
