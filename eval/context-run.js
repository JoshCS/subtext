/* Runs the story context prototype over eval/real/context-cases.json and writes eval/out-context/<label>.json. Costs real money: every case makes a research request with web search.
   Pages come from an Internet Archive copy where one is listed, so the page text stays what it was. Records: ProPublica Nonprofit Explorer and LittleSis, by name.
   Usage: node eval/context-run.js <label> [id,id] [--model claude-sonnet-5-5] [--url <page url> ...] */
const fs = require('fs'); const path = require('path'); const C = require('../extension/context.js');
if (!process.env.SUBTEXT_ANTHROPIC_KEY_FILE) { console.error('Set SUBTEXT_ANTHROPIC_KEY_FILE to a file that holds an Anthropic key.'); process.exit(1); }
const KEY = fs.readFileSync(process.env.SUBTEXT_ANTHROPIC_KEY_FILE, 'utf8').trim(); const OUT = path.join(__dirname, 'out-context'); fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2); const label = args[0] || 'run'; const only = args[1] && !args[1].startsWith('--') ? args[1].split(',') : null; const modelArg = args.indexOf('--model'); const MODEL = modelArg >= 0 ? args[modelArg + 1] : 'claude-sonnet-5-5';
const PRICE = { 'claude-haiku-5-5': [0.1, 0.5], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20] }; let spend = 0; const CAP = +(process.env.CONTEXT_CAP || 25);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
const strip = (h) => String(h).replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&#x27;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&mdash;|&ndash;/g, '-').replace(/\s+/g, ' ').trim();
const pageCache = new Map();
async function open(url) {
  if (pageCache.has(url)) return pageCache.get(url);
  const tryGet = async (u) => { const r = await fetch(u, { headers: { 'user-agent': UA, accept: 'text/html,application/pdf,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(70000) }); if (!r.ok) return null; const ct = r.headers.get('content-type') || ''; if (/pdf/.test(ct)) return '__PDF__'; return strip(await r.text()); };
  let t = null; try { t = await tryGet(url); } catch (e) { /* try the archive */ }
  if (!t || t.length < 400) { try { const j = await (await fetch('https://archive.org/wayback/available?url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(15000) })).json(); const a = j.archived_snapshots && j.archived_snapshots.closest; if (a && a.available) t = await tryGet(a.url.replace(/\/web\/(\d+)\//, '/web/$1id_/')); } catch (e) { /* nothing */ } }
  pageCache.set(url, t || ''); return t || '';
}
async function call(body, tools) {
  const headers = { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2026-10-21' }; let messages = body.messages; let total = { input_tokens: 0, output_tokens: 0, searches: 0, fetches: 0 }; let last = null;
  for (let turn = 0; turn < 6; turn++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(Object.assign({}, body, { messages, tools }, tools ? {} : { tools: undefined })), signal: AbortSignal.timeout(400000) });
    const j = await r.json(); if (!r.ok) throw new Error('API ' + r.status + ': ' + JSON.stringify(j.error || j).slice(0, 300));
    const u = j.usage || {}; total.input_tokens += u.input_tokens || 0; total.output_tokens += u.output_tokens || 0; const s = u.server_tool_use || {}; total.searches += s.web_search_requests || 0; total.fetches += s.web_fetch_requests || 0; last = j;
    // what the fetch tool itself read counts as opened: a site that blocks this script is still checked against the page the model really saw, never against the model's own words
    for (const b of j.content || []) if (b.type === 'web_fetch_tool_result' && b.content && b.content.url && b.content.content && b.content.content.source) { const src = b.content.content.source; const raw = src.type === 'text' ? src.data : ''; if (raw && !pageCache.get(b.content.url)) pageCache.set(b.content.url, strip(raw)); }
    if (j.stop_reason !== 'pause_turn') break; messages = messages.concat([{ role: 'assistant', content: j.content }]);
  }
  const [i, o] = PRICE[body.model] || [2, 10]; const cost = (total.input_tokens * i + total.output_tokens * o) / 1e6 + total.searches * 0.01; spend += cost;
  if (last.stop_reason === 'refusal') throw new Error('refused'); if (last.stop_reason === 'max_tokens') throw new Error('cut off');
  const text = last.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { json: JSON.parse(text), cost, usage: total };
}
async function records(actors) {
  const out = [];
  for (const a of (actors || []).filter((x) => ['organisation', 'outlet', 'expert'].includes(x.kind)).slice(0, 4)) {
    try { const j = await (await fetch('https://projects.propublica.org/nonprofits/api/v2/search.json?q=' + encodeURIComponent(a.name), { headers: { 'user-agent': 'SubtextResearch/0.1' }, signal: AbortSignal.timeout(12000) })).json(); for (const o of (j.organizations || []).slice(0, 2)) out.push('ProPublica Nonprofit Explorer, search "' + a.name + '": ' + o.name + ', ' + o.city + ', ' + o.state + ', EIN ' + o.ein + ', https://projects.propublica.org/nonprofits/organizations/' + o.ein); } catch (e) { /* no record */ }
    try { const j = await (await fetch('https://littlesis.org/api/entities/search?q=' + encodeURIComponent(a.name), { headers: { 'user-agent': 'SubtextResearch/0.1' }, signal: AbortSignal.timeout(12000) })).json(); for (const e of (j.data || []).slice(0, 2)) out.push('LittleSis, search "' + a.name + '": ' + e.attributes.name + ': ' + String(e.attributes.blurb || '').slice(0, 120) + ', https://littlesis.org/entities/' + e.id); } catch (e) { /* no record */ }
  }
  return out.join('\n');
}
async function docsFor(x) { const urls = [...new Set((x.sources || []).map((d) => d.url).concat((x.instances || []).map((d) => d.url)))].slice(0, 5); const docs = []; for (const u of urls) { const t = await open(u); if (t && t !== '__PDF__') docs.push({ url: u, text: t }); } return docs; }
const askVerify = (x, pageText, docs) => call({ model: 'claude-sonnet-5-5', max_tokens: 3000, system: C.VERIFY_SYSTEM, output_config: { effort: 'low', format: { type: 'json_schema', schema: C.VERIFY_SCHEMA } }, messages: [{ role: 'user', content: C.verifyUser(x, pageText, docs) }] });
async function verifyLine(x, pageText) {
  const docs = await docsFor(x); let v = await askVerify(x, pageText, docs); let cost = v.cost;
  if (!C.verifyPass(v.json) && !v.json.already_on_page && (v.json.claims || []).some((c) => c.verdict === 'supported' || c.verdict === 'partly')) {
    const rev = await call({ model: 'claude-sonnet-5-5', max_tokens: 800, system: C.REVISE_SYSTEM, output_config: { effort: 'low', format: { type: 'json_schema', schema: C.REVISE_SCHEMA } }, messages: [{ role: 'user', content: C.reviseUser(x, v.json, docs) }] }); cost += rev.cost;
    if (rev.json.sentence && !C.BANNED.test(rev.json.sentence)) { x.first_sentence = x.sentence; x.sentence = rev.json.sentence; v = await askVerify(x, pageText, docs); cost += v.cost; }
  }
  return { json: v.json, cost };
}
async function runCase(k) {
  const url = k.archive_url ? k.archive_url.replace(/\/web\/(\d+)\//, '/web/$1id_/') : k.url; const r = { id: k.id, kind: k.kind, side: k.side, url: k.url };
  const cacheDir = path.join(__dirname, 'out-context', 'pages-' + (process.env.CONTEXT_SET || 'a').replace(/\W/g, '')); fs.mkdirSync(cacheDir, { recursive: true }); const cf = path.join(cacheDir, k.id + '.txt'); let text = fs.existsSync(cf) ? fs.readFileSync(cf, 'utf8') : '';
  for (let t = 0; !text && t < 4; t++) { pageCache.delete(url); text = await open(url); if (text.length < 300 || text === '__PDF__') { text = ''; await new Promise((z) => setTimeout(z, 6000 * (t + 1))); } }
  if (!text && k.url !== url) { pageCache.delete(k.url); text = await open(k.url); if (text === '__PDF__') text = ''; }
  if (text.length < 300) { r.error = 'no page text'; return r; } fs.writeFileSync(cf, text);
  const title = text.slice(0, 120); const page = { url: k.url, title, text };
  const ex = await call({ model: 'claude-haiku-5-5', max_tokens: 3000, system: C.EXTRACT_SYSTEM, output_config: { effort: 'low', format: { type: 'json_schema', schema: C.EXTRACT_SCHEMA } }, messages: [{ role: 'user', content: C.extractUser(page) }] });
  r.extract = ex.json; r.extract.actors = (ex.json.actors || []).filter((a) => C.quoteOn(text, a.quote)); const rec = await records(r.extract.actors); r.records = rec;
  // the plain search and fetch tools: in a side-by-side on three cases the filtering versions returned unusable results and the model stopped opening pages
  const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }, { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 3 }]; const checked = [], insights = []; let cost = ex.cost; const usage = { searches: 0, fetches: 0, input_tokens: 0, output_tokens: 0 };
  for (const check of C.checks(r.extract)) {
    let res = null; const ask = (nudge) => call({ model: MODEL, max_tokens: 6000, thinking: { type: 'adaptive' }, system: C.RESEARCH_SYSTEM, output_config: { effort: 'medium', format: { type: 'json_schema', schema: C.RESEARCH_SCHEMA } }, messages: [{ role: 'user', content: C.researchUser(page, r.extract, rec, check) + (nudge ? '\n\nA previous attempt answered without searching. Run the searches first.' : '') }] }, tools);
    res = await ask(false); cost += res.cost; if (!res.usage.searches) { const again = await ask(true); cost += again.cost; res = again; }
    for (const k of Object.keys(usage)) usage[k] += res.usage[k] || 0; checked.push(...(res.json.checked || []).map((c) => check.id + ': ' + c)); insights.push(...(res.json.insights || []).map((x) => Object.assign(x, { check: check.id })));
  }
  const res = { json: { checked, insights } }; r.cost = Math.round(cost * 1000) / 1000; r.usage = usage; r.checked = checked; r.candidates = insights;
  const ctx = { pageUrl: k.url, pageText: text, published: r.extract.published, verify: async (u, q) => { if (!u || !q || !/^https?:/.test(u)) return false; const t = await open(u); return !!t && t !== '__PDF__' && C.quoteOn(t, q); } };
  r.shown = []; r.dropped = [];
  for (const x of res.json.insights || []) {
    const g = await C.gateInsight(x, ctx); const row = Object.assign({}, x, { sources: g.sources.length && g.pass ? g.sources : x.sources, instances: g.instances.length ? g.instances : x.instances, gate: g.why });
    if (g.pass) { const v = await verifyLine(row, text); r.cost = Math.round((r.cost + v.cost) * 1000) / 1000; row.verify = v.json; if (!C.verifyPass(v.json)) { row.gate = row.gate.concat('second reader: ' + (v.json.already_on_page ? 'already on the page; ' : '') + (v.json.implies_motive ? 'implies a motive; ' : '') + (v.json.claims || []).filter((c) => c.verdict !== 'supported').map((c) => c.verdict + ': ' + c.claim).join(' | ').slice(0, 300)); r.dropped.push(row); continue; } r.shown.push(row); } else r.dropped.push(row);
  }
  // the held-out reading of the same run: what survives if nothing may rest on the exposé's own words
  const hidden = (k.hidden_terms || []).map((t) => t.toLowerCase()); const leaks = (x) => { const blob = JSON.stringify([x.sentence, x.actor, x.sources, x.instances]).toLowerCase(); return hidden.filter((t) => blob.includes(t)); };
  r.heldOut = r.shown.filter((x) => !leaks(x).length).map((x) => x.sentence); r.quiet = r.shown.length ? null : C.quietSentence(r.checked, r.extract);
  return r;
}
// re-check saved candidates with the current gate, with no new research: node eval/context-run.js <label> --regate <run.json> (pages the fetch tool read last time are gone, so a site that blocks this script fails)
async function regate(file, K) {
  const R = JSON.parse(fs.readFileSync(file, 'utf8')); const res = [];
  await Promise.all(Array.from({ length: 3 }, async () => { while (R.length) { const r = R.shift(); if (r.error) { res.push(r); continue; } const text = fs.readFileSync(path.join(__dirname, 'out-context', 'pages-' + (process.env.CONTEXT_SET || 'a').replace(/\W/g, ''), r.id + '.txt'), 'utf8'); const ctx = { pageUrl: r.url, pageText: text, published: r.extract.published, verify: async (u, q) => { if (!u || !q || !/^https?:/.test(u)) return false; const t = await open(u); return !!t && t !== '__PDF__' && C.quoteOn(t, q); } }; r.shown = []; r.dropped = []; r.cost = 0;
    for (const x0 of r.candidates || []) { const x = Object.assign({}, x0); const g = await C.gateInsight(x, ctx); const row = Object.assign({}, x, { gate: g.why }); if (g.pass) { const v = await verifyLine(row, text); r.cost += v.cost; row.verify = v.json; if (!C.verifyPass(v.json)) { row.gate = row.gate.concat('second reader: ' + (v.json.already_on_page ? 'already on the page; ' : '') + (v.json.implies_motive ? 'implies a motive; ' : '') + (v.json.claims || []).filter((c) => c.verdict !== 'supported').map((c) => c.verdict + ': ' + c.claim).join(' | ').slice(0, 300)); r.dropped.push(row); continue; } r.shown.push(row); } else r.dropped.push(row); }
    res.push(r); console.log(r.id, 'shown', r.shown.length, 'dropped', r.dropped.length); } }));
  fs.writeFileSync(path.join(OUT, label + '.json'), JSON.stringify(res, null, 1)); console.log('spend', spend.toFixed(2));
}
(async () => {
  if (args.includes('--regate')) return regate(args[args.indexOf('--regate') + 1]);
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'real', process.env.CONTEXT_SET || 'context-cases.json'), 'utf8')); const list = Array.isArray(cases) ? cases : cases.cases;
  const urls = args.filter((x, i) => args[i - 1] === '--url'); const q = urls.length ? urls.map((u, i) => ({ id: 'url' + (i + 1), kind: 'try', side: '', url: u, hidden_terms: [] })) : list.filter((k) => !only || only.includes(k.id)); const res = []; const f = path.join(OUT, label + '.json');
  await Promise.all(Array.from({ length: 3 }, async () => { while (q.length) { if (spend > CAP) { console.log('spend cap reached'); return; } const k = q.shift(); let r; try { r = await runCase(k); } catch (e) { r = { id: k.id, kind: k.kind, error: String(e.message).slice(0, 300) }; } res.push(r); fs.writeFileSync(f, JSON.stringify(res, null, 1)); console.log(k.id, k.kind, 'candidates', (r.candidates || []).length, 'shown', (r.shown || []).length, 'cost', r.cost, r.error || ''); } }));
  console.log('spend', spend.toFixed(2));
})();
