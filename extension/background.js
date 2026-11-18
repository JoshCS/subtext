/* Subtext — background service worker.
   Per-tab reports, outlet ownership lookup, toolbar badge, cross-origin fetch relay, optional ToS;DR lookup,
   and the optional AI deep analysis (Claude or ChatGPT, user's own key) via the shared ai.js module. */
importScripts('common.js', 'context-data.js', 'context-nonprofit.js', 'context-sec.js', 'context-stats.js', 'context-fec.js', 'context-status.js', 'context-parks.js', 'ai.js', 'claim-context.js', 'public-records.js', 'investigate.js', 'inquiry-sources.js', 'investigation-guides.js', 'inquiry.js', 'evidence-book.js');

const tabState = new Map();
// A route is the URL without its fragment, unless the fragment is the route (#/orders, #!/orders). content/engine.js keeps the same rule.
function routeOf(u) { const s = String(u || ''), i = s.indexOf('#'); if (i < 0) return s; const frag = s.slice(i + 1); return frag.startsWith('/') || frag.startsWith('!') ? s : s.slice(0, i); }
const sameRoute = (a, b) => routeOf(a) === routeOf(b);
let outletsPromise = null, rulesPromise = null;
// bundled files are fetched once per worker life; a failed or half-written read is retried on the next call instead of being cached
// owner-interests.json (sourced: each owner's other businesses, governments and causes) is merged into the records by outlet name; a missing file
// only means no topic matches beyond names and wealth taxes
function loadOutlets() { if (!outletsPromise) outletsPromise = Promise.all([fetch(chrome.runtime.getURL('data/outlets.json')).then((r) => r.json()), fetch(chrome.runtime.getURL('data/owner-interests.json')).then((r) => r.json()).catch(() => null)]).then(([d, i]) => MLCommon.mergeInterests(d, i)).catch((e) => { outletsPromise = null; throw e; }); return outletsPromise; }
function loadRules() { if (!rulesPromise) rulesPromise = fetch(chrome.runtime.getURL('rules/text-rules.json')).then((r) => r.json()).catch((e) => { rulesPromise = null; throw e; }); return rulesPromise; }
// which rules may flag (rules/reliability.json), for the dataset findings that do not pass through engine.js. Loaded before any message is handled; until then only the evidence rule applies.
let tierData = null, tiersPromise = null;
function loadTiers() { if (!tiersPromise) tiersPromise = fetch(chrome.runtime.getURL('rules/reliability.json')).then((r) => r.json()).then((j) => { tierData = (j && j.tiers) || {}; return tierData; }).catch((e) => { tiersPromise = null; throw e; }); return tiersPromise; }
// API keys live in the extension's own IndexedDB, which only extension pages and this worker can open. chrome.storage.local is readable by the
// content scripts that run inside every page, so a key there could be read by code in a page's renderer. Keys written there by an older
// version or a test harness are moved on the next read.
const KEY_FIELDS = ['anthropicKey', 'openaiKey', 'apiKey', 'fecKey'];
function keyDb() { return new Promise((res, rej) => { const r = indexedDB.open('subtext-keys', 1); r.onupgradeneeded = () => r.result.createObjectStore('keys'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function keyGet() { try { const db = await keyDb(); return await new Promise((res) => { const q = db.transaction('keys').objectStore('keys').get('keys'); q.onsuccess = () => res(q.result || {}); q.onerror = () => res({}); }); } catch (e) { return {}; } }
async function keyPut(k) { const db = await keyDb(); await new Promise((res, rej) => { const tx = db.transaction('keys', 'readwrite'); tx.objectStore('keys').put({ anthropicKey: k.anthropicKey || '', openaiKey: k.openaiKey || '', fecKey: k.fecKey || '' }, 'keys'); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }
async function getSettings() {
  const r = await chrome.storage.local.get('settings'); const raw = Object.assign({}, r.settings || {});
  if (KEY_FIELDS.some((k) => raw[k])) {
    const keys = await keyGet(); if (raw.apiKey && !raw.anthropicKey) raw.anthropicKey = raw.apiKey; // migrate v0.1 key
    for (const k of ['anthropicKey', 'openaiKey', 'fecKey']) if (raw[k]) keys[k] = raw[k];
    await keyPut(keys); const clean = Object.assign({}, raw); for (const k of KEY_FIELDS) delete clean[k]; await chrome.storage.local.set({ settings: clean });
  }
  const keys = await keyGet();
  const s = Object.assign({}, MLCommon.DEFAULT_SETTINGS, raw); for (const k of KEY_FIELDS) delete s[k];
  s.anthropicKey = keys.anthropicKey || ''; s.openaiKey = keys.openaiKey || ''; s.fecKey = keys.fecKey || '';
  if (s.model && !s.anthropicModel) s.anthropicModel = s.model;
  return s;
}
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.settings && ch.settings.newValue && KEY_FIELDS.some((k) => ch.settings.newValue[k])) getSettings().catch(() => {}); }); // move a key the moment it lands
// a message from inside a web page (a content script) versus one from an extension page (popup, settings, casebook) or the worker itself
const fromPage = (sender) => !!(sender && sender.tab && !String(sender.url || '').startsWith(chrome.runtime.getURL('')));

// ---- outlet lookup --------------------------------------------------------
function candidates(hostname) { const h = (hostname || '').toLowerCase().replace(/^www\./, ''); const parts = h.split('.'); const out = []; for (let i = 0; i < parts.length - 1; i++) out.push(parts.slice(i).join('.')); return out; }
// Known-bad sites: a local list built from what others keep (scripts/update-known-bad.js). The lookup happens here; no visited site leaves the browser.
let knownBadData = null;
async function loadKnownBad() { if (!knownBadData) { try { knownBadData = await (await fetch(chrome.runtime.getURL('data/known-bad.json'))).json(); } catch (e) { knownBadData = { sources: {}, entries: {} }; } } return knownBadData; }
async function knownBadFindings(hostname) {
  const data = await loadKnownBad(); const hit = MLCommon.knownBadLookup(data, hostname, Date.now()); if (!hit) return [];
  return [MLCommon.knownBadFinding(data, hit)];
}
// Owners: a table built at release from Wikidata (scripts/build-owners.py). The lookup happens here; no visited site leaves the browser.
let ownersData = null;
async function loadOwners() { if (!ownersData) { try { ownersData = await (await fetch(chrome.runtime.getURL('data/owners.json'))).json(); } catch (e) { ownersData = { rows: {} }; } } return ownersData; }
// Public tracker lists (AdGuard companies database, EasyPrivacy; data/tracker-lists.json, built by scripts/build-tracker-lists.py): the outside domains the page
// contacted that the hand-kept list does not name. A vendor fact from the page's own requests: nothing is sent anywhere.
let trackerListsP = null; const loadTrackerLists = () => trackerListsP || (trackerListsP = fetch(chrome.runtime.getURL('data/tracker-lists.json')).then((r) => r.json()).catch(() => ({ domains: {} })));
async function trackerListFindings(meta) {
  const doms = (meta && meta.unnamedThirdParty) || []; if (!doms.length) return [];
  const d = (await loadTrackerLists()).domains || {}; const hits = []; for (const x of doms) { const r = d[x]; if (r) hits.push({ domain: x, company: r[0], cat: r[1], src: r[2] }); }
  if (!hits.length) return [];
  const byCo = new Map(); for (const h of hits) { const k = h.company || h.domain; if (!byCo.has(k)) byCo.set(k, h); }
  const cos = Array.from(byCo.keys()); const cats = {}; for (const h of hits) cats[h.cat] = (cats[h.cat] || 0) + 1;
  const catText = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, n]) => n + ' ' + c).join(', ');
  return [{ id: 'tracker.public_lists', category: 'surveillance', name: cos.length + ' more outside companies named by public tracker lists', label: 'More trackers', severity: 1, confidence: 0.85, biases: ['data_capture'], source: 'dataset',
    why: 'Also contacted, and named on public tracker lists: ' + (cos.length > 3 ? cos.slice(0, 3).join(', ') + ' and ' + (cos.length - 3) + ' more.' : cos.length > 1 ? cos.slice(0, -1).join(', ') + ' and ' + cos[cos.length - 1] + '.' : cos[0] + '.'),
    explain: 'This page contacted ' + hits.length + ' more outside domains that public tracker lists name (' + catText + '). Companies: ' + cos.slice(0, 20).join(', ') + (cos.length > 20 ? ' and ' + (cos.length - 20) + ' more' : '') + '. Each one receives your IP address and learns you were here. Sources: the AdGuard companies database and EasyPrivacy (The EasyList authors), both openly licensed; Subtext\'s own list did not name these.',
    tip: 'A content blocker using EasyPrivacy stops most of these.', evidence: hits.slice(0, 6).map((h) => ({ quote: h.domain + (h.company ? ' (' + h.company + ')' : ''), elId: null })), count: cos.length, meta: { companies: cos, categories: cats, lists: Array.from(new Set(hits.map((h) => h.src === 'a' ? 'AdGuard companies database' : 'EasyPrivacy'))) } }];
}
const pageTextCache = new Map(); // url -> { t, v }: a page read in the last five minutes
let operatorsP = null; const loadOperators = () => operatorsP || (operatorsP = fetch(chrome.runtime.getURL('data/operators.json')).then((r) => r.json()).catch(() => ({ domains: {} })));
async function lookupOperator(hostname) { const d = await loadOperators(); const h = String(hostname || '').toLowerCase().replace(/^www\./, ''); for (const c of Array.from(new Set([h, MLCommon.registrableDomain(h)]))) { /* the site itself only: a blog on a platform is not run by the platform */ const row = d.domains && d.domains[c]; if (row) return { name: row[0], count: row[1], built: d.built, matched: c }; } return null; }
let buyoutsP = null; const loadBuyouts = () => buyoutsP || (buyoutsP = fetch(chrome.runtime.getURL('data/buyouts.json')).then((r) => r.json()).catch(() => ({ domains: {} })));
async function lookupBuyout(hostname) { const d = await loadBuyouts(); const h = String(hostname || '').toLowerCase().replace(/^www\./, ''); for (const c of Array.from(new Set([h, MLCommon.registrableDomain(h)]))) { const row = d.domains && d.domains[c]; if (row) return { firm: row[0], year: row[1], ref: row[2], q: row[3], built: d.built }; } return null; }
async function lookupOwner(hostname) { const d = await loadOwners(); for (const c of candidates(hostname)) { const row = d.rows && d.rows[c]; if (row) return { row: Object.assign({ as_of: d.built }, row), matched: c }; } return null; }
// The site's own ads.txt: the request goes to the registrable domain of the site already being visited, then to www. plus that domain, with no cookies and no referrer. Cached 7 days per domain. A setting turns it off.
// judged on the raw hostname: the registrable-domain step turns 10.0.0.1 into 0.1, which a browser reads as a different address
const isPublicHost = (h) => !!h && h.includes('.') && !h.includes(':') && !h.startsWith('[') && !/(^|\.)\d+$/.test(h) && !/^0x/i.test(h) && !/\.(local|localhost|internal|test|invalid|lan|home|corp|intranet)$/.test(h);
const adsTxtPending = new Map();
function adsTxtFor(hostname) { // one request per domain at a time: a slow site must not collect a new request on every rescan
  const raw = String(hostname || '').toLowerCase().replace(/\.$/, ''); if (!isPublicHost(raw)) return Promise.resolve(null);
  const d = MLCommon.registrableDomain(raw.replace(/^www\./, '')); if (!isPublicHost(d)) return Promise.resolve(null);
  if (adsTxtPending.has(d)) return Promise.resolve(null);
  const p = adsTxtFetch(d).finally(() => adsTxtPending.delete(d)); adsTxtPending.set(d, p); return p;
}
async function adsTxtFetch(d) {
  const key = 'adstxt:' + d;
  try { const c = await chrome.storage.local.get(key); if (c[key] && Date.now() - c[key].ts < 7 * 86400e3) return c[key].value; } catch (e) { /* ignore */ }
  let value = null;
  for (const host of [d, 'www.' + d]) {
    try {
      const r = await fetch('https://' + host + '/ads.txt', { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { accept: 'text/plain,*/*;q=0.1' } });
      if (r.ok && MLCommon.registrableDomain(new URL(r.url).hostname.replace(/^www\./, '')) === d) { const reader = r.body.getReader(); const dec = new TextDecoder(); let txt = '', got = 0; for (;;) { const { done, value: chunk } = await reader.read(); if (done) break; got += chunk.length; txt += dec.decode(chunk, { stream: true }); if (got > 512 * 1024) { reader.cancel().catch(() => {}); break; } } value = MLCommon.parseAdsTxt(txt); if (value) break; }
    } catch (e) { /* no file, blocked, or slow: nothing to say */ }
  }
  try { await chrome.storage.local.set({ [key]: { ts: Date.now(), value } }); } catch (e) { /* ignore */ }
  return value;
}
const orNull = (p, ms) => Promise.race([p.catch(() => null), new Promise((res) => setTimeout(() => res(null), ms))]);
async function lookupOutlet(hostname) {
  const data = await loadOutlets();
  for (const c of candidates(hostname)) { const entry = data.outlets.find((o) => o.domains.includes(c)); if (entry) return { entry, matched: c, kinds: data.ownerKinds }; }
  return null;
}
function outletFindings(found, mentions) {
  if (!found) return [];
  const { entry, kinds } = found; const primary = entry.owners[0]; const kind = kinds[primary.kind] || { name: primary.kind, severity: 1, why: '' };
  // the owner is a warning only when this item touches the owner's interests (report.meta.ownerLinks: named, or its subject); otherwise a quiet fact
  const sev = entry.type === 'satire' ? 0 : (mentions && mentions.length ? kind.severity : 0);
  const out = [{
    id: 'source.ownership', category: 'source_funding', source: 'dataset', severity: sev, confidence: entry.confidence === 'high' ? 0.9 : 0.65, count: 1,
    name: (entry.type === 'satire' ? 'Satire site: ' : 'Owned by: ') + primary.name.split(';')[0].split(' (')[0].slice(0, 70),
    label: entry.type === 'satire' ? 'Satire' : kind.name.replace(/^Owned by an? /i, '').replace(/^Owned by /i, '').split(' / ')[0].split(/\s+/).slice(0, 3).join(' ').replace(/^./, (c) => c.toUpperCase()),
    why: entry.type === 'satire' ? 'Everything here is fictional on purpose.' : (() => { const s = kind.why.split('. ')[0].replace(/\.$/, ''); if (s.length <= 110) return s + '.'; const cut = s.slice(0, 100).replace(/\s+\S*$/, '').replace(/[\s,;]+(?:and|or|but|the|a|an|of|to|through|directly)$/i, ''); return cut + '…'; })(),
    biases: ['authority_bias'], explain: kind.name + '. ' + kind.why + (entry.notes ? ' ' + entry.notes : ''),
    tip: 'Open the Source card for the ownership chain, funding model and links to independent raters.',
    evidence: entry.owners.map((o) => ({ quote: o.name, elId: null })), meta: { outlet: entry.name, kind: primary.kind }
  }];
  if (['far-left', 'far-right', 'state'].includes(entry.lean)) out.push({
    id: 'source.lean_extreme', category: 'source_funding', source: 'dataset', severity: entry.lean === 'state' ? 3 : 2, confidence: 0.7, count: 1,
    evidence: [{ quote: entry.lean === 'state' ? 'Classified as state-controlled in the Subtext outlet dataset' : 'Rated ' + entry.lean + ' in the Subtext outlet dataset', url: (entry.sources || [])[0] || null, elId: null }],
    name: entry.lean === 'state' ? 'State-controlled media' : 'Commonly rated ' + entry.lean + ' by third-party raters',
    label: entry.lean === 'state' ? 'State media' : 'Strongly partisan', why: entry.lean === 'state' ? 'Editorial line set by a government.' : 'Raters place this outlet at the edge of the spectrum.',
    biases: ['tribalism', 'in_group_bias'],
    explain: entry.lean === 'state' ? 'Third-party raters and governments classify this outlet as controlled by a state. Treat its output as official messaging.' : 'Multiple media-bias raters place this outlet at the ' + entry.lean.replace('-', ' ') + ' end of the spectrum, where story selection and framing are strongly shaped by a political project. The label describes the outlet\'s editorial pattern, not the truth of any individual article.',
    tip: 'Find the same story from an outlet on the other side and one in the centre, then compare what each leaves out.', meta: { lean: entry.lean }
  });
  return out;
}

// ---- badge & state ------------------------------------------------------------
// what the reader is shown: mutes and category switches apply to dataset and AI findings too; an AI result for another page never shows
function visibleState(st, s) {
  if (!st) return st; const off = new Set((s && s.disabledRules) || []), cats = new Set((s && s.disabledCategories) || []); const keep = (f) => !off.has(f.id) && !cats.has(f.category);
  const ai = st.ai && st.report && !sameRoute(st.ai.url, st.report.url) ? null : st.ai;
  // the rules engine.js applies to page findings: only a rule with tier `flag` may flag, and a flag must show something the reader can check. AI findings are quote-verified in ai.js.
  const quoted = (f) => (f.evidence || []).some((x) => String((x && x.quote) || '').trim());
  const quiet = (f, extra) => Object.assign({}, f, { severity: 0, meta: Object.assign({}, f.meta, extra) });
  const gate = (f) => {
    const tier = !tierData ? 'flag' : tierData[f.id] || (/\.negated$/.test(f.id) ? 'note' : 'hold');
    if (tier === 'note') return quiet(f, { tier: 'note', judgedSeverity: f.severity });
    if (tier !== 'flag') return s && s.showUnproven ? quiet(f, { tier: 'hold', unproven: true }) : null;
    return f.severity > 0 && !quoted(f) ? quiet(f, { tier: 'note', noEvidence: true, judgedSeverity: f.severity }) : f;
  };
  return Object.assign({}, st, { outletFindings: (st.outletFindings || []).filter(keep).map(gate).filter(Boolean), ai: ai ? Object.assign({}, ai, { findings: (ai.findings || []).filter(keep) }) : ai });
}
function siteMuted(host, s) { const h = String(host || '').replace(/^www\./, ''); return ((s && s.disabledSites) || []).some((x) => h === x || h.endsWith('.' + x)); }
function compositeFindings(st) { return ((st.report && st.report.findings) || []).concat(st.outletFindings || [], (st.ai && st.ai.findings) || []); }
async function setBadge(tabId, st) {
  try {
    const all = compositeFindings(visibleState(st, await getSettings())); const g = MLCommon.glance(all, st.report && st.report.meta);
    await chrome.action.setBadgeText({ tabId, text: g.count ? String(g.count) : '' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: g.color });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ tabId, color: '#fff' });
    await chrome.action.setTitle({ tabId, title: 'Subtext: ' + g.meta });
  } catch (e) { /* tab gone */ }
}
async function persist(tabId) {
  let st = tabState.get(tabId); if (!st) return;
  // a context result with a chart whose source restricts storing its data (FRED) stays in memory only: after a worker restart the reader asks again
  if (st.context && st.context.result && (st.context.result.charts || []).some((c) => c.transient)) st = Object.assign({}, st, { context: null });
  try { if (chrome.storage.session) await chrome.storage.session.set({ ['tab:' + tabId]: st }); } catch (e) { /* ignore */ }
}
async function getState(tabId) {
  if (tabState.has(tabId)) return tabState.get(tabId);
  try { if (chrome.storage.session) { const r = await chrome.storage.session.get('tab:' + tabId); if (r['tab:' + tabId]) { delete r['tab:' + tabId].aiProgress; if (r['tab:' + tabId].context && r['tab:' + tabId].context.status === 'busy' && !contextJobs.has(tabId)) r['tab:' + tabId].context = null; /* the worker restarted mid-lookup: the reader may ask again */ tabState.set(tabId, r['tab:' + tabId]); return r['tab:' + tabId]; } } } catch (e) { /* ignore */ }
  return null;
}

// ---- helpers for the AI layer ---------------------------------------------------
function b64(buf) { let s = ''; const bytes = new Uint8Array(buf); const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)); return btoa(s); }
async function chartBlockFor(asset) {
  try {
    if (asset.type === 'svg') return { type: 'svg', markup: asset.markup, caption: asset.caption };
    if (asset.type === 'canvas' && asset.dataUrl) { const m = asset.dataUrl.match(/^data:(image\/\w+);base64,(.+)$/); if (m) return { type: 'image', media_type: m[1], data: m[2], caption: asset.caption }; }
    if (asset.type === 'img' && asset.src) {
      const r = await fetch(asset.src, { credentials: 'omit' }); if (!r.ok) return { type: 'text', text: 'image could not be fetched' };
      const ct = (r.headers.get('content-type') || '').split(';')[0].trim();
      if (!/^image\/(png|jpeg|gif|webp)$/.test(ct)) return { type: 'text', text: 'unsupported image type' }; // the header is the server's text and this line sits outside the fence
      const buf = await r.arrayBuffer(); if (buf.byteLength > 4.5 * 1024 * 1024) return { type: 'text', text: 'image too large' };
      return { type: 'image', media_type: ct, data: b64(buf), alt: asset.alt, caption: asset.caption };
    }
  } catch (e) { /* fallthrough */ }
  return { type: 'text', text: 'not available' };
}
// A click names a record the tab is displaying, not a URL supplied to a fetch relay.
function attached(investigation, citations) {
  return investigation && (citations || []).some(c => c.key === investigation.key && c.decision===investigation.decision && c.passage === (investigation.anchor || investigation.passage) && (c.passage===investigation.passage || c.nearby?.includes(investigation.passage)) && c.url === investigation.url) ? investigation : null;
}
const investigating = new Map();
async function compareRecord(tabId, key, route) {
  if (!Number.isInteger(tabId) || typeof key !== 'string') throw new Error('No citation selected.');
  const readTab = () => chrome.tabs.sendMessage(tabId, {type:'getCitations'}, {frameId:0});
  const page = await readTab();
  const target = page && page.citations.find(c=>c.key===key);
  const settings = await getSettings();
  if (!target || !sameRoute(page.url, route) || siteMuted(new URL(page.url).hostname,settings)) throw new Error('That citation is no longer on this page.');
  const pending = investigating.get(tabId);
  if (pending) throw new Error('A record is already being read. Try again in a moment.');
  const request = {}; investigating.set(tabId,request);
  try {
    const doc = await SubtextRecords.read(target);
    const result = SubtextInvestigate.compare(target, doc);
    if (result.basis==='merger-pitch') result.stake = SubtextClaims.stakeFor(doc.url);
    const [live, currentSettings] = await Promise.all([readTab(), getSettings()]);
    const state = await getState(tabId);
    if (!state || !state.report || !sameRoute(page.url, live.url) || !sameRoute(page.url,state.report.url) ||
      siteMuted(new URL(live.url).hostname,currentSettings) || !attached(result,live.citations)) throw new Error('This page or its citation changed while the record was loading.');
    state.investigation = result;
    state.ai = null; // the reader chose new evidence; an older AI lead describes a different packet
    tabState.set(tabId,state); await persist(tabId);
    try { chrome.tabs.sendMessage(tabId,{type:'stateChanged',state:visibleState(state,currentSettings)},()=>void chrome.runtime.lastError); } catch (_) { /* closed */ }
    return {ok:true};
  } finally { if (investigating.get(tabId)===request) investigating.delete(tabId); }
}
// ---- context from public data (context-data.js) -----------------------------------------
// On the reader's click, or on every page when they turn on "Load context automatically". The router picks the few free sources that
// fit this page; each request sends only what its source line says, with no Referer. Only Google Trends is sent with the reader's
// cookies (Trends refuses requests without them), only after a click, and only while "Google Trends" is on in Settings.
const contextJobs = new Map(); const contextTimers = new Set(); let secTickers; // the SEC's ticker list, read once from the bundled file
const CONTEXT_MAX_BYTES = 3000000; // of one answer; the rest is not read
// the body through a stream reader: reading stops at `max` bytes and the rest of the answer is cancelled, never held in memory
async function readCapped(r, max) {
  if (!r.body) return '';
  const reader = r.body.getReader(); const dec = new TextDecoder(); let text = '', got = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    const room = max - got; const part = value.length > room ? value.subarray(0, room) : value;
    got += part.length; text += dec.decode(part, { stream: true });
    if (got >= max) { reader.cancel().catch(() => {}); break; }
  }
  return text;
}
function contextIo(allowCookies, job) {
  return { get: async (url, opt) => {
    opt = opt || {};
    if (!/^https:\/\//.test(url)) return { status: 0, text: '' };
    if (job.cancelled) throw new Error('stopped'); // the tab was muted, closed or moved on: no further request leaves
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 12000); job.abort = () => ac.abort();
    try {
      // a source may refuse redirects (`redirect: 'error'`, the status source): the request then fails at the first host and the address it points to is never asked
      const r = await fetch(url, { credentials: opt.cookies && allowCookies ? 'include' : 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: opt.redirect === 'error' ? 'error' : 'follow', signal: ac.signal, headers: opt.accept ? { accept: opt.accept } : {} });
      // for the sources that follow redirects: one may end somewhere else, and an answer from a host that is not public https is not read
      let end = null; try { end = new URL(r.url || url); } catch (e) { /* keep null */ }
      if (!end || end.protocol !== 'https:' || !isPublicHost(end.hostname.toLowerCase())) { if (r.body) r.body.cancel().catch(() => {}); return { status: 0, text: '', error: 'redirected to a host that is not public https' }; }
      return { status: r.status, text: await readCapped(r, CONTEXT_MAX_BYTES) };
    } catch (e) { return { status: 0, text: '', error: String(e) }; } finally { clearTimeout(to); }
  } };
}
function stopContext(tabId) { const job = contextJobs.get(tabId); if (job) { job.cancelled = true; if (job.abort) job.abort(); contextJobs.delete(tabId); } }
async function loadContext(tabId, route, trigger) {
  if (!Number.isInteger(tabId)) throw new Error('No tab.');
  // a click replaces a running automatic lookup (it adds Google Trends); anything else already running is left to finish
  const running = contextJobs.get(tabId);
  if (running) { if (trigger === 'click' && running.trigger === 'auto') stopContext(tabId); else return { ok: true, busy: true }; }
  const job = { route: '', trigger, cancelled: false }; contextJobs.set(tabId, job); // claimed before the first await: two triggers cannot both start
  const mine = () => contextJobs.get(tabId) === job && !job.cancelled;
  let settings;
  const push = (s) => { try { chrome.tabs.sendMessage(tabId, { type: 'stateChanged', state: visibleState(s, settings) }, () => void chrome.runtime.lastError); } catch (_) { /* closed */ } };
  // state is re-read after every wait and only its `context` field is set: a scan or an AI result stored meanwhile is never overwritten
  const setContext = async (ctx) => { const cur = await getState(tabId); if (!mine() || !cur || !cur.report || !sameRoute(cur.report.url, job.route)) return false; cur.context = ctx; tabState.set(tabId, cur); await persist(tabId); push(cur); return true; };
  try {
    settings = await getSettings();
    const st = await getState(tabId);
    if (!st || !st.report) throw new Error('This page has not been scanned yet.');
    if (route && !sameRoute(st.report.url, route)) throw new Error('The page changed.');
    job.route = st.report.url; const host = new URL(job.route).hostname;
    if (siteMuted(host, settings)) throw new Error('Subtext is off for this site.');
    // a private or intranet address: nothing about it goes to any outside service
    if (!isPublicHost(host.toLowerCase()) || !/^https?:$/.test(new URL(job.route).protocol)) throw new Error('Context is only looked up for public websites.');
    const page = await chrome.tabs.sendMessage(tabId, { type: 'contextSignals' }, { frameId: 0 }).catch(() => null);
    if (!page || page.error || !sameRoute(page.url, job.route)) throw new Error('Could not read this page.');
    if (!(await setContext({ route: job.route, status: 'busy' }))) return { ok: false, stale: true };
    const meta = st.report.meta || {}; const row = st.owner && st.owner.row; const outlet = st.outlet && st.outlet.entry;
    const facts = SubtextContextData.pageFacts({ url: job.route, title: page.title, published: page.published, siteName: page.siteName || (outlet && outlet.name) || (row && row.site) || '', text: page.text, keywords: page.keywords, pageKind: meta.pageKind, isArticle: meta.isArticle, sells: !!(meta.commerce && meta.commerce.sells), productPage: !!page.productPage, entityQ: (row && row.q) || '', entityLabel: (outlet && outlet.name) || (row && row.site) || page.siteName || '', outletName: (outlet && outlet.name) || '', legalName: (() => { const P = st.report.provenance || {}; return P.entity || P.orgSchema || (P.copyrightEntity ? P.copyright : '') || ''; })(), address: (st.report.provenance && st.report.provenance.address) || '', registrable: MLCommon.registrableDomain(host.toLowerCase().replace(/^www\./, '')) /* worked out here, never taken from the page: status hosts and the tax-ID name check are held to it */, taxIds: page.taxIds, taxIdNonprofit: page.taxIdNonprofit === true, statusPages: page.statusPages, footerText: page.footerText, nonprofit: !!(row && /nonprofit|charity|foundation/i.test(row.kind || '')) });
    const trends = trigger === 'click' && settings.contextTrends !== false;
    await SubtextContextStats.ready; // the statistics registry (a bundled file) is read once
    if (secTickers === undefined) { try { secTickers = (await (await fetch(chrome.runtime.getURL('data/sec-tickers.json'))).json()).rows || null; } catch (e) { secTickers = null; } }
    const result = await SubtextContextData.run(facts, contextIo(trends, job), { trends, secTickers, keys: { fec: String(settings.fecKey || '').trim() } });
    // the page or the mute may have changed while the requests ran
    const now = await getSettings(); let live = null; try { live = await chrome.tabs.get(tabId); } catch (_) { /* closed */ }
    if (!mine() || !live || !sameRoute(live.url, job.route) || siteMuted(host, now)) return { ok: false, stale: true };
    return (await setContext({ route: job.route, status: 'done', trigger, result })) ? { ok: true } : { ok: false, stale: true };
  } catch (e) {
    if (job.route && mine()) await setContext({ route: job.route, status: 'error', error: String(e.message || e).slice(0, 140) });
    return { error: String(e.message || e) };
  } finally { if (contextJobs.get(tabId) === job) contextJobs.delete(tabId); }
}
const inquiryJobs = new Map();
// Whether the page an inquiry read is still the page on screen. Title, headings, controls, credits and measured buttons must be unchanged:
// they carry the claim being examined. Body lines may churn a little, because shops rotate "Maria from Texas just bought…" notices and
// countdowns tick; at most 1 in 10 body lines may disappear or appear. A rewritten headline or article still counts as a change.
const clockless = s => s.replace(/\b\d{1,2}(?::\d{2}){1,2}\b/g,'#:#').replace(/\b\d+\s?(d|h|m|s|days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/gi,'# $1');
async function sha(text){ return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join(''); }
// the product's own knowledge about a tab, in the shape MLCommon.productObservations reads (the same shape eval/inquiry-real.js saves)
function productOf(st, settings) {
  const vis = visibleState(st, settings); const F = MLCommon.oneFactEach(((vis.report && vis.report.findings) || []).concat(vis.outletFindings || []));
  const e = st.outlet && st.outlet.entry;
  return { outlet: e ? { name: e.name, owners: e.owners, funding: e.funding, funders: e.funders, sources: e.sources, confidence: e.confidence, interests: e.interests, wealthy: e.wealthy, ultimateOwner: e.ultimateOwner } : null, ownerLinks: (st.report.meta && st.report.meta.ownerLinks) || [], paidItem: (st.report.meta && st.report.meta.paidItem) || null, wire: (st.report.meta && st.report.meta.wire) || null, operator: st.operator || null,
    adsTxt: st.adsTxt ? { owner: st.adsTxt.owner, managerName: st.adsTxt.managerName, systems: st.adsTxt.systems } : null,
    findings: F.map((f) => ({ id: f.id, label: f.label || f.name, why: f.why, severity: f.severity, quote: ((f.evidence || [])[0] || {}).quote || '' })), asks: (st.report.meta && st.report.meta.asks) || null };
}
async function inquirySnapshot(page,maxChars) {
  const packet=SubtextInquiry.makePacket(page,{maxChars}); const head=[], body=[], controls=[];
  // Buttons are compared with tolerance, like body text: a video player adds and removes its own ("Watch More", "Keep Watching 9")
  // while a reader waits, and an exact match aborted every investigation on a local news page (16 Nov 2026). Digits are dropped so a
  // countdown or cart count is the same control. Title, headings, credits and layout must still match exactly.
  for (const f of packet.facts) {
    if (f.label==='Page text') { body.push((await sha(clockless(f.source+'|'+f.label+'|'+f.quote))).slice(0,16)); continue; }
    if (f.label==='Page control') { controls.push((await sha(clockless(String(f.quote).replace(/\s*\d+\s*/g,' ').trim()))).slice(0,16)); continue; }
    head.push(clockless(f.source+'|'+f.label+'|'+f.quote));
  }
  return {head:await sha(head.join('\n')),body,controls,maxChars};
}
async function samePage(snap,page,exact) {
  if (!snap || !page) return false; const now=await inquirySnapshot(page,snap.maxChars);
  if (now.head!==snap.head) return false;
  if (exact) return now.body.join()===snap.body.join() && now.controls.join()===(snap.controls||[]).join(); // a saved casebook observation must be exactly what was checked
  // at most max(floor, 10%) items may come or go, and at least half of the original ones must remain (a page whose only button is
  // replaced has changed)
  const within=(was,is,floor)=>{ const live=new Set(is), kept=was.filter(h=>live.has(h)).length, slack=Math.max(floor,Math.ceil(was.length*0.1)); return was.length-kept<=slack && is.length-kept<=slack && (!was.length || kept>=Math.ceil(was.length/2)); };
  return within(snap.body,now.body,3) && within(snap.controls||[],now.controls,1);
}
function announceInquiry(tabId, state, settings) {
  const visible = visibleState(state, settings);
  try { chrome.tabs.sendMessage(tabId, {type:'stateChanged',state:visible}, () => void chrome.runtime.lastError); } catch (_) { /* closed */ }
  try { chrome.runtime.sendMessage({type:'ml:state',tabId,state:visible}, () => void chrome.runtime.lastError); } catch (_) { /* no popup */ }
}
async function investigatePage(tabId, settings) {
  if (!Number.isInteger(tabId)) throw new Error('No page selected.');
  if (inquiryJobs.has(tabId)) throw new Error('An investigation is already running on this page.');
  const provider = settings.aiProvider === 'openai' ? 'openai' : 'anthropic';
  const key = provider === 'openai' ? settings.openaiKey : settings.anthropicKey;
  if (!key) throw new Error('Add a ' + SubtextAI.PROVIDERS[provider].name + ' API key in Subtext settings first.');
  const controller = new AbortController();
  const job = {controller}; inquiryJobs.set(tabId,job);
  const deadline = setTimeout(() => controller.abort(), 240000);
  const extract = () => chrome.tabs.sendMessage(tabId,{type:'extractForLLM'},{frameId:0});
  const maxChars = settings.maxCharsToAI || 40000;
  // Compare the actual model packet, not only the URL: an article can change in place.

  let page, snapshot;
  const ensureCurrent = async () => {
    if (controller.signal.aborted || inquiryJobs.get(tabId)!==job) throw new Error('Investigation cancelled.');
    const [live,s] = await Promise.all([extract(),getSettings()]);
    if (!live || live.error || siteMuted(live.hostname,s) || !sameRoute(live.url,page.url) || !(await samePage(snapshot,live))) {
      controller.abort(); throw new Error('The page changed during the investigation. Run it again on the current page.');
    }
    return s;
  };
  try {
    page = await extract();
    if (!page || page.error) throw new Error((page?.error || 'Could not read this page.')+' Nothing was sent.');
    if (siteMuted(page.hostname,await getSettings())) throw new Error('Subtext is muted on this site. Nothing was sent.');
    if ((page.mainText || '').trim().length < 40) throw new Error('There is too little visible text to investigate. Nothing was sent.');
    snapshot = await inquirySnapshot(page,maxChars);
    const st = await getState(tabId);
    if (!st?.report || !sameRoute(st.report.url,page.url)) throw new Error('The page is still loading. Try again in a moment.');
    const scoped = MLCommon.outletContext(st.outlet && st.outlet.entry,page.url);
    const excerpt = SubtextAI.readingInput(page,{maxChars});
    const records = [scoped.ownership, scoped.policy, ...SubtextClaims.forPage({url:page.url,title:excerpt.title,mainText:excerpt.text})].filter(Boolean);
    const observations = MLCommon.productObservations(productOf(st, settings));
    const model = provider === 'openai' ? settings.openaiModel : settings.anthropicModel;
    const result = await SubtextInquiry.run({page,maxChars,records,observations,signal:controller.signal,
      request: async spec => {
        await ensureCurrent();
        return SubtextAI.analyze({...spec,provider,model,key,schemaName:'subtext_'+spec.stage,
          maxTokens:provider==='openai' ? Math.max(spec.maxTokens,6000) : spec.maxTokens});
      },
      read: async (link,opts) => {
        await ensureCurrent();
        const allowed = SubtextInquirySources.candidate(link.url,page.url,link.label);
        if (!allowed) throw new Error('This source is not supported.');
        return SubtextInquirySources.read(allowed,{...opts,pageUrl:page.url,signal:controller.signal});
      },
      discover: async query => { await ensureCurrent(); return SubtextInquirySources.discover(query,undefined,{signal:controller.signal}); },
      // story context: one web-search request (Claude only), on unless turned off in Settings; the search provider sees queries built from the page
      ...(provider==='anthropic' && settings.aiContextSearch!==false ? {contextSearch: async input => { await ensureCurrent(); return SubtextAI.contextSearch({...input,item:{...input.item,outlet:st.outlet && st.outlet.entry ? st.outlet.entry.name : ''},provider,model,key}); }} : {}),
      onProgress: async progress => {
        const s = await ensureCurrent(), cur = await getState(tabId);
        if (!cur?.report || !sameRoute(cur.report.url,page.url)) throw new Error('The page changed.');
        cur.aiProgress=progress; tabState.set(tabId,cur); announceInquiry(tabId,cur,s);
      }
    });
    const currentSettings = await ensureCurrent(), cur = await getState(tabId);
    if (!cur?.report || !sameRoute(cur.report.url,page.url)) throw new Error('The page changed.');
    const usage = result.stages.reduce((sum,s)=>({input:sum.input+(s.usage.input||0),output:sum.output+(s.usage.output||0)}),{input:0,output:0});
    const ai = {reading:result.reading,records,inquiry:{...result,reading:undefined},snapshot,findings:[],provider,
      model:result.stages.at(-1)?.model || model,usage,cost:Math.round(result.stages.reduce((n,s)=>n+s.cost,0)*10000)/10000,ts:Date.now(),url:page.url};
    cur.ai=ai; delete cur.aiProgress; tabState.set(tabId,cur); await persist(tabId);
    announceInquiry(tabId,cur,currentSettings); return ai;
  } finally {
    clearTimeout(deadline);
    if (inquiryJobs.get(tabId)===job) {
      inquiryJobs.delete(tabId);
      const cur=await getState(tabId);
      if (cur?.aiProgress) {delete cur.aiProgress; await persist(tabId); announceInquiry(tabId,cur,await getSettings());}
    }
  }
}
async function deepAnalyze(tabId) {
  const settings=await getSettings();
  return settings.aiInvestigation!==false ? investigatePage(tabId,settings) : singlePassAnalyze(tabId);
}
async function singlePassAnalyze(tabId) {
  const settings = await getSettings();
  const provider = settings.aiProvider === 'openai' ? 'openai' : 'anthropic';
  const key = provider === 'openai' ? settings.openaiKey : settings.anthropicKey;
  if (!key) throw new Error('No ' + SubtextAI.PROVIDERS[provider].name + ' API key configured. Open Subtext settings to add one.');
  const modelId = provider === 'openai' ? settings.openaiModel : settings.anthropicModel;
  const rules = await loadRules();
  const page = await chrome.tabs.sendMessage(tabId, { type: 'extractForLLM' });
  if (!page || page.error) throw new Error('Could not read the page: ' + ((page && page.error) || 'no content script on this tab'));
  if (siteMuted(page.hostname, settings)) throw new Error('Subtext is muted on this site. Nothing was sent.');
  if ((page.mainText || '').length < 200) throw new Error('This page shows too little text to analyse (it may be a block page or an app shell). Nothing was sent.');
  const st = {...((await getState(tabId)) || {})};
  const charts = []; for (const a of (page.charts || []).slice(0, 4)) charts.push(await chartBlockFor(a));
  const outletLine = st.outlet ? ('Known outlet: ' + st.outlet.entry.name + ' — ' + st.outlet.entry.owners.map((o) => o.name).join('; ')) : 'Outlet ownership: unknown to our dataset.';
  { const of = MLCommon.ownerFacts(st, page.hostname, true); const a = st.adsTxt; page.signals = Object.assign({}, page.signals, { owner: of && of.text ? of.text + (of.via ? ' (' + of.via + ')' : '') : null, adsTxt: a && a.records ? a.records + ' ad-selling records, ' + a.direct + ' direct' + (a.managerName ? ', ads sold by ' + a.managerName : '') + '; says the site sells ad space, not that this page shows ads' : null }); }
  const scoped = MLCommon.outletContext(st.outlet && st.outlet.entry, page.url);
  const maxChars = settings.maxCharsToAI || 40000;
  const excerpt = SubtextAI.readingInput(page, { maxChars });
  const records = [scoped.ownership, scoped.policy, ...SubtextClaims.forPage({ url: page.url, title: excerpt.title, mainText: excerpt.text })].filter(Boolean);
  const documentRead = attached(st.investigation, page.citations);
  if (documentRead?.stake) records.push(documentRead.stake);
  const packetOpts = { maxChars, charts, outletLine, records, documentRead };
  const blocks = SubtextAI.buildUserBlocks(page, packetOpts);
  const playbook = await fetch(chrome.runtime.getURL('data/category-playbook.json')).then((r) => r.json()).catch(() => null);
  const res = await SubtextAI.analyze({ provider, model: modelId, key, system: SubtextAI.systemPrompt(rules.categories, playbook), blocks });
  let findings = SubtextAI.toFindings(res.parsed, page.charts || [], SubtextAI.pageTextOf(page));
  const typeEntry = ((playbook && playbook.categories) || []).find((c) => c.category === res.parsed.business_type) || null;
  const reading = SubtextAI.screenReading(res.parsed.reading, page, packetOpts);
  const ai = { reading, records, compared: documentRead ? {key:documentRead.key,passage:documentRead.passage} : null, businessType: typeEntry ? { name: typeEntry.category, earns: typeEntry.how_it_earns, insider: typeEntry.insider_point, sources: (typeEntry.sources || []).slice(0, 3).map((x) => x.url) } : null, dropped: res.parsed.droppedUnverified || 0, pressure: res.parsed.overall_pressure, findings, provider, model: res.model, usage: res.usage, cost: res.cost, ts: Date.now(), url: page.url };
  if (settings.aiWebCheck) { // opt-in: a second request with the provider's web-search tool; the search provider sees the domain. Cached 30 days per site.
    const domain = MLCommon.registrableDomain(page.hostname); const ckey = 'webcheck:' + provider + ':' + domain;
    try {
      let w = null; try { const c = await chrome.storage.local.get(ckey); if (c[ckey] && Date.now() - c[ckey].ts < 30 * 86400e3) w = Object.assign({ cached: true }, c[ckey].result); } catch (e) { /* ignore */ }
      if (!w) { w = await SubtextAI.webCheck({ provider, model: modelId, key, domain, outlet: st.outlet ? st.outlet.entry.name : null }); try { await chrome.storage.local.set({ [ckey]: { ts: Date.now(), result: { parsed: w.parsed, searches: w.searches, cost: w.cost, model: w.model, domain } } }); } catch (e) { /* ignore */ } }
      ai.web = { summary: w.parsed.summary, found: !!w.parsed.found, items: (w.parsed.items || []).slice(0, 8), funding: (w.parsed.funding || []).slice(0, 6), practices: (w.parsed.practices || []).slice(0, 6), searches: w.searches, cost: w.cached ? 0 : w.cost, cached: !!w.cached, confidence: w.parsed.confidence };
      ai.findings = findings = findings.concat(SubtextAI.webToFindings(w)); ai.cost = Math.round((ai.cost + ai.web.cost) * 10000) / 10000;
    } catch (e) { ai.webError = String(e && e.message || e); }
  }
  const cur = (await getState(tabId)) || {}; if (!cur.report || !sameRoute(cur.report.url, page.url)) return ai; // the tab moved on while the model was answering: this result describes another page
  if ((cur.investigation?.key || '') !== (st.investigation?.key || '') || (cur.investigation?.passage || '') !== (st.investigation?.passage || '')) return ai;
  cur.ai = ai; tabState.set(tabId, cur); await persist(tabId); await setBadge(tabId, cur);
  try { chrome.tabs.sendMessage(tabId, { type: 'stateChanged', state: visibleState(cur, settings) }, () => void chrome.runtime.lastError); } catch (e) { /* tab gone */ }
  return ai;
}

// ---- ToS;DR (opt-in: sends the hostname to tosdr.org) ------------------------------
async function tosdr(hostname) {
  const s = await getSettings(); if (!s.tosdrLookup || siteMuted(hostname, s)) return null; // a lookup can arrive after the reader muted the site
  const host = (hostname || '').replace(/^www\./, '');
  const key = 'tosdr:' + host;
  try { const c = await chrome.storage.local.get(key); if (c[key] && Date.now() - c[key].ts < 7 * 86400e3) return c[key].finding; } catch (e) { /* ignore */ }
  let finding = null;
  try {
    const r = await fetch('https://api.tosdr.org/search/v5/?query=' + encodeURIComponent(host), { credentials: 'omit' });
    if (r.ok) {
      const j = await r.json(); const services = (j && j.parameters && j.parameters.services) || j.services || [];
      const svc = services.find((s) => (s.urls || []).some((u) => String(u).replace(/^www\./, '') === host)) || services[0];
      const letter = svc && svc.rating && (svc.rating.letter || svc.rating.human);
      if (svc && letter && /^[A-E]$/i.test(letter)) {
        const L = letter.toUpperCase(); const sev = { A: 0, B: 0, C: 1, D: 2, E: 3 }[L];
        finding = { id: 'incentives.tosdr_grade', category: 'incentives', source: 'dataset', severity: sev, confidence: 0.8, count: 1, name: 'Terms of Service; Didn\'t Read grade: ' + L, label: 'Terms grade ' + L, why: { A: 'Terms treat users fairly.', B: 'Terms are mostly fair.', C: 'Terms are okay but have real concerns.', D: 'Terms are bad for users.', E: 'Terms raise very serious concerns.' }[L], biases: ['default_effect'], explain: 'ToS;DR is a community project that reads terms of service and privacy policies and grades them from A (best) to E (worst). ' + (svc.name || host) + ' is graded ' + L + '.', tip: 'Open tosdr.org for the specific points behind the grade.', evidence: [{ quote: 'https://tosdr.org/en/service/' + svc.id, elId: null }], meta: { serviceId: svc.id } };
      }
    }
  } catch (e) { /* offline or blocked */ }
  try { await chrome.storage.local.set({ [key]: { ts: Date.now(), finding } }); } catch (e) { /* ignore */ }
  return finding;
}

// ---- RDAP (opt-in): the domain's public registration record. The registry's RDAP server comes from IANA's bootstrap
//      file (data.iana.org, cached 7 days); TLDs without one fall back to rdap.org. Only the registrable domain is sent.
let domConfigPromise = null, bootstrapPromise = null;
function loadDomConfig() { if (!domConfigPromise) domConfigPromise = fetch(chrome.runtime.getURL('rules/dom-config.json')).then((r) => r.json()).catch((e) => { domConfigPromise = null; throw e; }); return domConfigPromise; }
async function rdapFetch(url) { const r = await fetch(url, { credentials: 'omit', headers: { accept: 'application/rdap+json, application/json' }, signal: AbortSignal.timeout(10000) }); if (r.status === 404) return { notFound: true }; if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
async function rdapBase(tld) {
  if (!bootstrapPromise) bootstrapPromise = (async () => {
    try { const c = await chrome.storage.local.get('rdap:bootstrap'); if (c['rdap:bootstrap'] && Date.now() - c['rdap:bootstrap'].ts < 7 * 86400e3) return c['rdap:bootstrap'].services; } catch (e) { /* ignore */ }
    const j = await (await fetch('https://data.iana.org/rdap/dns.json', { credentials: 'omit', signal: AbortSignal.timeout(10000) })).json();
    try { await chrome.storage.local.set({ 'rdap:bootstrap': { ts: Date.now(), services: j.services } }); } catch (e) { /* ignore */ }
    return j.services;
  })().catch(() => { bootstrapPromise = null; return []; });
  const services = await bootstrapPromise;
  for (const [tlds, urls] of services) if (tlds.includes(tld)) return (urls.find((u) => u.startsWith('https://')) || urls[0]).replace(/\/?$/, '/');
  return null;
}
async function rdap(domain) {
  const d = String(domain || '').toLowerCase().replace(/[^a-z0-9.-]/g, ''); if (!d || !d.includes('.')) return { record: null };
  const key = 'rdap:' + d;
  try { const c = await chrome.storage.local.get(key); if (c[key] && Date.now() - c[key].ts < 7 * 86400e3) return { record: c[key].record, cached: true }; } catch (e) { /* ignore */ }
  let record = null;
  try {
    const cfg = await loadDomConfig(); const PRIV = new RegExp(cfg.provenance.privacyProxyPattern, 'i');
    const base = await rdapBase(d.split('.').pop());
    let j = await rdapFetch((base || 'https://rdap.org/') + 'domain/' + encodeURIComponent(d));
    if (j && !j.notFound) {
      record = MLCommon.parseRdap(j, PRIV);
      if (!record.registrantRole) { // thin registry: the registrar's server holds the registrant
        const rel = (j.links || []).find((l) => String(l.rel).toLowerCase() === 'related' && /^https:\/\//.test(l.href || '') && /rdap/i.test(l.href + ' ' + (l.type || '')));
        if (rel) { try { const j2 = await rdapFetch(rel.href); if (j2 && !j2.notFound) { const r2 = MLCommon.parseRdap(j2, PRIV); record = Object.assign({}, record, { registrant: r2.registrant, registrantRole: r2.registrantRole, redacted: r2.redacted, registrar: record.registrar || r2.registrar, registered: record.registered || r2.registered, ageDays: record.ageDays != null ? record.ageDays : r2.ageDays }); } } catch (e) { /* registrar server down: keep the registry record */ } }
      }
      if (!record.registrantRole && !record.registrant) { record.redacted = false; record.registrantUnknown = true; } // registrant not published or the registrar's server could not be read: "could not check", not "hidden"
      record.source = base ? new URL(base).hostname : 'rdap.org'; record.domain = d;
    } else record = { domain: d, notFound: true };
  } catch (e) { return { record: null, error: String(e && e.message || e) }; }
  try { await chrome.storage.local.set({ [key]: { ts: Date.now(), record } }); } catch (e) { /* ignore */ }
  return { record };
}

// ---- messaging -----------------------------------------------------------------------
const resourceCache = new Map();
let nextPrune = 0;
async function forgetTab(tabId) { stopContext(tabId); inquiryJobs.get(tabId)?.controller.abort(); inquiryJobs.delete(tabId); tabState.delete(tabId); announceInquiry(tabId,null,{}); try { if (chrome.storage.session) await chrome.storage.session.remove('tab:' + tabId); } catch (e) { /* ignore */ } try { await chrome.action.setBadgeText({ tabId, text: '' }); } catch (e) { /* tab gone */ } }
// per-site caches and timer state are a browsing trace: nothing older than 30 days is kept
async function pruneLocal() {
  try {
    const all = await chrome.storage.local.get(null); const old = Date.now() - 30 * 86400e3; const drop = [];
    for (const [k, v] of Object.entries(all)) if (/^(timer|rdap|tosdr|webcheck|adstxt):/.test(k) && k !== 'rdap:bootstrap' && (!v || !v.ts || v.ts < old)) drop.push(k);
    if (drop.length) await chrome.storage.local.remove(drop);
  } catch (e) { /* ignore */ }
}
async function saveAndBroadcast(partial) {
  const cur = await getSettings(); const next = Object.assign({}, cur, partial); delete next.apiKey; delete next.model;
  await keyPut({ anthropicKey: next.anthropicKey, openaiKey: next.openaiKey, fecKey: next.fecKey }); const stored = Object.assign({}, next); for (const k of KEY_FIELDS) delete stored[k];
  await chrome.storage.local.set({ settings: stored });
  const pub = Object.assign({}, next); delete pub.anthropicKey; delete pub.openaiKey; delete pub.fecKey; // API keys never go to a tab
  const tabs = await chrome.tabs.query({}); for (const t of tabs) { try { chrome.tabs.sendMessage(t.id, { type: 'settingsChanged', settings: pub }, () => void chrome.runtime.lastError); } catch (e) { /* ignore */ } }
  return { ok: true };
}
function tabOf(msg, sender) { if (fromPage(sender)) return sender.tab.id; /* a page may only ask about its own tab */ return msg.tabId != null ? msg.tabId : sender && sender.tab ? sender.tab.id : null; }
// The notebook is extension-origin IndexedDB. Content scripts can open its UI,
// but cannot enumerate, read, delete or compare saved material from other pages.
let caseStore;
const caseJobs=new Map();
const notebook=()=>caseStore || (caseStore=SubtextEvidenceBook.createStore(indexedDB));
function extensionPage(sender,path) {
  try {const u=new URL(sender.url);return sender.id===chrome.runtime.id && u.protocol==='chrome-extension:' && u.host===chrome.runtime.id && u.pathname===path && (sender.frameId==null || sender.frameId===0);}
  catch(_){return false;}
}
function requireCasebook(sender) {
  if(!extensionPage(sender,'/casebook/casebook.html'))throw new Error('Open the Subtext casebook to manage saved evidence.');
}
async function captureCase(id,tabId,label) {
  if(!Number.isInteger(tabId))throw new Error('Open the casebook from the page you want to save.');
  const extract=()=>chrome.tabs.sendMessage(tabId,{type:'extractForLLM'},{frameId:0});
  const [page,settings]=await Promise.all([extract(),getSettings()]);
  const tab=await chrome.tabs.get(tabId);
  if(!page || page.error || !sameRoute(page.url,tab.url))throw new Error(page?.error || 'The page changed. Open it again and retry.');
  if(siteMuted(new URL(page.url).hostname,settings))throw new Error('Subtext is muted on this site.');
  if((page.mainText || '').trim().length<40)throw new Error('There is too little visible text to save.');
  const digest=await inquirySnapshot(page,12000);
  const packet=SubtextInquiry.makePacket(page,{maxChars:12000,links:[]});
  const [live,latest]=await Promise.all([extract(),getSettings()]);
  const liveTab=await chrome.tabs.get(tabId);
  if(!live || live.error || !sameRoute(live.url,page.url) || !sameRoute(liveTab.url,page.url) || siteMuted(new URL(page.url).hostname,latest) || !(await samePage(digest,live,true)))throw new Error('The page changed while saving. Retry on the current page.');
  return notebook().capture(id,SubtextEvidenceBook.snapshotFromPacket(packet,{title:String(page.title || page.hostname || new URL(page.url).hostname).slice(0,200),url:page.url,observedAt:new Date().toISOString(),label}));
}
async function compareCase(id,snapshotIds) {
  if(caseJobs.has(id))throw new Error('This case is already being analyzed.');
  const saved=await notebook().get(id);
  if(!Array.isArray(snapshotIds) || snapshotIds.length<2 || snapshotIds.length>3 || new Set(snapshotIds).size!==snapshotIds.length)throw new Error('Select two or three saved steps.');
  const selected=snapshotIds.map(key=>saved.snapshots.find(s=>s.id===key));
  if(selected.some(s=>!s))throw new Error('A selected step no longer exists.');
  const settings=await getSettings(),provider=settings.aiProvider==='openai'?'openai':'anthropic';
  const key=provider==='openai'?settings.openaiKey:settings.anthropicKey;
  if(!key)throw new Error('Add an AI API key in Subtext settings first.');
  const model=provider==='openai'?settings.openaiModel:settings.anthropicModel;
  const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),240000);
  if(caseJobs.has(id)){clearTimeout(deadline);throw new Error('This case is already being analyzed.');}
  controller.caseHosts=selected.map(s=>new URL(s.url).hostname);
  caseJobs.set(id,controller);
  const current=selected.at(-1),history=selected.slice(0,-1);
  const ensure=async()=>{
    if(controller.signal.aborted)throw new Error('Case analysis cancelled.');
    const [fresh,s]=await Promise.all([notebook().get(id),getSettings()]);
    if(fresh.revision!==saved.revision) {controller.abort();throw new Error('The case changed. Select its current steps and try again.');}
    if(selected.some(x=>siteMuted(new URL(x.url).hostname,s))) {controller.abort();throw new Error('Subtext is muted on a selected site.');}
  };
  try {
    await ensure();
    const result=await SubtextInquiry.run({
      page:{url:current.url,title:current.title},
      savedComparison:true,currentCapture:current,history,maxChars:settings.maxCharsToAI || 40000,links:[],signal:controller.signal,
      request:async spec=>{await ensure();return SubtextAI.analyze({...spec,provider,model,key,schemaName:'subtext_'+spec.stage,maxTokens:provider==='openai'?Math.max(spec.maxTokens,6000):spec.maxTokens});}
    });
    await ensure();
    const full=await notebook().saveAnalysis(id,snapshotIds,{reading:result.reading,status:result.status},saved.revision);
    return full.analysis;
  } finally {clearTimeout(deadline);caseJobs.delete(id);}
}
async function handle(msg, sender) {
  if(/^case(?:List|Create|Get|Capture|RemoveStep|Delete|Compare)$/.test(msg.type)) {
    requireCasebook(sender);
    let data;
    switch(msg.type) {
      case 'caseList': data=await notebook().list();break;
      case 'caseCreate': data=await notebook().create(msg.title);break;
      case 'caseGet': data=await notebook().get(msg.id);break;
      case 'caseCapture': data=await captureCase(msg.id,msg.sourceTabId,msg.label);break;
      case 'caseRemoveStep': caseJobs.get(msg.id)?.abort();data=await notebook().removeStep(msg.id,msg.snapshotId);break;
      case 'caseDelete': caseJobs.get(msg.id)?.abort();await notebook().delete(msg.id);data={deleted:true};break;
      case 'caseCompare': data=await compareCase(msg.id,msg.snapshotIds);break;
    }
    return {data};
  }
  if(msg.type==='openCasebook') {
    let tabId;
    if(extensionPage(sender,'/popup/popup.html'))tabId=msg.tabId;
    else if(sender.id===chrome.runtime.id && sender.frameId===0 && sender.tab && /^https?:\/\//.test(sender.url || ''))tabId=sender.tab.id;
    else throw new Error('Open the casebook from a Subtext report.');
    if(!Number.isInteger(tabId))throw new Error('No source page selected.');
    // "Save this page" saves on arrival (save=1); one casebook tab is reused rather than opening another on every click
    const url=chrome.runtime.getURL('casebook/casebook.html')+'?sourceTab='+tabId+'&save=1';
    const open=(await chrome.tabs.query({url:chrome.runtime.getURL('casebook/casebook.html')+'*'}))[0];
    if(open){await chrome.tabs.update(open.id,{url,active:true});try{await chrome.windows.update(open.windowId,{focused:true});}catch(_){/* no window focus in tests */}}
    else await chrome.tabs.create({url});
    return {ok:true};
  }
  await loadTiers().catch(() => {});
  switch (msg.type) {
    case 'findings': {
      const tabId = sender.tab && sender.tab.id; if (tabId == null) return { ok: false };
      const s = await getSettings(); if (siteMuted(msg.hostname, s)) { await forgetTab(tabId); return { ok: false, muted: true }; }
      if (Date.now() > nextPrune) { nextPrune = Date.now() + 6 * 3600e3; pruneLocal(); } // a browser left open for weeks still forgets old per-site entries
      const prev = (await getState(tabId)) || {};
      let outlet = null; try { outlet = await lookupOutlet(msg.hostname); } catch (e) { outlet = null; } // a dataset read error must not drop the whole report
      const listed = await knownBadFindings(msg.hostname).catch(() => []);
      const owner = outlet ? null : await lookupOwner(msg.hostname).catch(() => null);
      const operator = outlet ? null : await lookupOperator(msg.hostname).catch(() => null);
      const buyout = await lookupBuyout(msg.hostname).catch(() => null);
      // on load, but a slow site must not hold up the report: the file arrives with the next scan if it misses this one
      const adsTxt = s.adsTxtLookup ? await orNull(adsTxtFor(msg.hostname), 2500) : null;
      const listedTrackers = await trackerListFindings(msg.meta).catch(() => []);
      let latest = tabState.get(tabId) || prev;
      const priorAI=latest.ai;let staleInquiry=false;
      if (priorAI?.inquiry && sameRoute(priorAI.url,msg.url)) {
        try {
          const current=await chrome.tabs.sendMessage(tabId,{type:'extractForLLM'},{frameId:0});
          if (!current || (!current.error && !sameRoute(current.url,msg.url))) return {ok:false,stale:true}; /* an extraction error now (a paywall, a dialog) clears the old reading below instead of freezing it */
          staleInquiry=!current || current.error || !priorAI.snapshot || !priorAI.snapshot.head || !(await samePage(priorAI.snapshot,current));
        } catch (_) {staleInquiry=true;}
        const remaining=tabState.get(tabId);if (!remaining) return {ok:false,stale:true};
        latest=remaining;
        if (latest.ai!==priorAI) staleInquiry=false;
      }
      // Dataset/source work can finish after a navigation or mute. It must not
      // recreate the old report after forgetTab has invalidated it.
      const activeSettings=await getSettings();
      let liveTab;try{liveTab=await chrome.tabs.get(tabId);}catch(_){return {ok:false,stale:true};}
      if (!sameRoute(liveTab.url,msg.url) || siteMuted(msg.hostname,activeSettings)) return {ok:false,stale:true};
      const investigation = latest.report && sameRoute(latest.report.url,msg.url) ? attached(latest.investigation,msg.meta && msg.meta.citations) : null;
      const st = { report: msg, investigation, outlet, owner, operator, buyout, adsTxt, outletFindings: listed.concat(outletFindings(outlet, msg.meta && (msg.meta.ownerLinks || msg.meta.ownerMentions)), listedTrackers), ai: latest.ai && sameRoute(latest.ai.url, msg.url) && (!latest.ai.compared || (latest.ai.compared.key===investigation?.key && latest.ai.compared.passage===investigation?.passage)) ? latest.ai : null, context: latest.context && sameRoute(latest.context.route, msg.url) ? latest.context : null, tabId };
      if (inquiryJobs.has(tabId) && sameRoute(latest.report?.url,msg.url)) st.aiProgress=latest.aiProgress;
      if (staleInquiry) st.ai=null;
      tabState.set(tabId, st); await persist(tabId); await setBadge(tabId, st);
      if (staleInquiry) announceInquiry(tabId,st,s);
      if (s.contextAuto && !st.context && !contextJobs.has(tabId) && !contextTimers.has(tabId + '|' + routeOf(msg.url)) && !msg.meta?.errorPage) { const tk = tabId + '|' + routeOf(msg.url); contextTimers.add(tk); setTimeout(() => { contextTimers.delete(tk); loadContext(tabId, msg.url, 'auto').catch(() => {}); }, 4000); } // a few seconds after the first scan: footers, legal names and late text have arrived by then // the reader's setting: context on every page, Trends excluded (it needs a click)
      return { ok: true, state: visibleState(st, s) };
    }
    case 'getState': {
      const st = await getState(tabOf(msg, sender)); const settings = await getSettings();
      const provider = settings.aiProvider === 'openai' ? 'openai' : 'anthropic';
      const mdl = (SubtextAI.PROVIDERS[provider].models.find((m) => m.id === (provider === 'openai' ? settings.openaiModel : settings.anthropicModel)) || {}), inquiry=settings.aiInvestigation!==false;
      const est = (((inquiry?41000:12000) * (mdl.inPrice || 0) + (inquiry?2500:2500) * (mdl.outPrice || 0)) / 1e6) + (!inquiry && settings.aiWebCheck ? 0.04 : 0); // measured on 43 fresh pages with Sonnet 5.5 (16 Nov 2026): about 41,000 tokens in, 2,500 out (thinking included). The background search, when the planner runs it (1 page in 43), adds about 5 cents and is not in this figure
      return { aiEstimate: est ? (est < 0.01 ? est.toFixed(3) : est.toFixed(2)) : '', state: visibleState(st, settings), settings: { aiProvider: provider, aiInvestigation:inquiry, model: provider === 'openai' ? settings.openaiModel : settings.anthropicModel, showBadge: settings.showBadge }, hasKey: !!(provider === 'openai' ? settings.openaiKey : settings.anthropicKey) };
    }
    case 'compareRecord': return await compareRecord(sender.tab && sender.tab.id != null && !String(sender.url || '').startsWith(chrome.runtime.getURL('')) ? sender.tab.id : tabOf(msg,sender), msg.key, msg.route);
    case 'deepAnalyze': return { ai: await deepAnalyze(tabOf(msg, sender)) };
    case 'loadContext': return await loadContext(sender.tab && sender.tab.id != null && !String(sender.url || '').startsWith(chrome.runtime.getURL('')) ? sender.tab.id : tabOf(msg, sender), msg.route, 'click');
    case 'cancelInquiry': { const job = inquiryJobs.get(tabOf(msg, sender)); if (job) job.controller.abort(); return { ok: !!job }; } // the reader stops a paid run; the calls already made are still billed
    case 'openOptions': await chrome.runtime.openOptionsPage(); return { ok: true };
    case 'lookupOutlet': return { outlet: await lookupOutlet(msg.hostname) };
    case 'fetchText': { // policy pages for the content script; same registrable domain as the tab that asked, nothing else, never for a muted site. No cookies and no Referer: the site learns its policy was read, not which page the reader is on.
      try { const u = new URL(msg.url), from = new URL(sender.tab.url); if (!/^https?:$/.test(u.protocol) || MLCommon.registrableDomain(u.hostname) !== MLCommon.registrableDomain(from.hostname)) return { error: 'other site' }; if (siteMuted(from.hostname, await getSettings())) return { error: 'muted' }; } catch (e) { return { error: 'bad url' }; }
      const key = (sender.tab ? sender.tab.id : '') + ' ' + msg.url + (msg.any ? ' any' : ''); /* per tab: two checks on one page share a request; a new page load reads afresh */ const hit = pageTextCache.get(key); if (hit && Date.now() - hit.t < 60000) return await hit.p; /* the policy scan and the seller check may ask for the same page at once: one request */
      const p = (async () => { try { const r = await fetch(msg.url, { credentials: 'omit', referrerPolicy: 'no-referrer' }); if (!r.ok) return { error: 'HTTP ' + r.status }; const ct = r.headers.get('content-type') || ''; if (!(msg.any ? /text\/html|text\/plain|application\/xml|text\/xml|application\/xhtml/ : /text\/html|text\/plain/).test(ct)) return { error: 'not text' }; /* a sitemap is XML */ return { text: (await r.text()).slice(0, 1500000) }; } catch (e) { return { error: String(e) }; } })(); if (pageTextCache.size > 40) pageTextCache.delete(pageTextCache.keys().next().value); pageTextCache.set(key, { t: Date.now(), p }); return await p;
    }
    case 'feedback': { // "Not accurate": kept on this device only; exported by hand from Settings
      const r = await chrome.storage.local.get('feedback'); const list = (r.feedback || []).slice(-499);
      list.push({ ts: Date.now(), ruleId: String(msg.ruleId || '').slice(0, 80), label: String(msg.label || '').slice(0, 60), host: String(msg.host || '').slice(0, 120), quote: String(msg.quote || '').slice(0, 240) });
      await chrome.storage.local.set({ feedback: list }); return { ok: true, count: list.length };
    }
    case 'getFeedback': { const r = await chrome.storage.local.get('feedback'); return { feedback: r.feedback || [] }; }
    case 'clearFeedback': await chrome.storage.local.remove('feedback'); return { ok: true };
    case 'muteRule': case 'unmuteRule': {
      const cur = await getSettings(); const set = new Set(cur.disabledRules || []); if (msg.type === 'muteRule') set.add(msg.ruleId); else set.delete(msg.ruleId);
      return await saveAndBroadcast({ disabledRules: Array.from(set) });
    }
    case 'muteSite': case 'unmuteSite': {
      if (fromPage(sender)) { let own = ''; try { own = new URL(sender.tab.url).hostname; } catch (e) { /* ignore */ } if (msg.type === 'unmuteSite' || String(msg.hostname || '').replace(/^www\./, '') !== own.replace(/^www\./, '')) return { error: 'a page may only mute its own site' }; }
      const cur = await getSettings(); const site = String(msg.hostname || '').replace(/^www\./, ''); const set = new Set(cur.disabledSites || []); if (msg.type === 'muteSite') set.add(site); else set.delete(site);
      const res = await saveAndBroadcast({ disabledSites: Array.from(set) });
      if (msg.type === 'muteSite') { for(const job of caseJobs.values())if(job.caseHosts.some(h=>siteMuted(h,{disabledSites:[site]})))job.abort(); const tabs = await chrome.tabs.query({}); for (const t of tabs) { let h = ''; try { h = new URL(t.url).hostname; } catch (e) { continue; } if (siteMuted(h, { disabledSites: [site] })) await forgetTab(t.id); } }
      return res;
    }
    case 'getResource': { const p = String(msg.path || ''); if (!/^(rules|data)\/[\w-]+\.json$/.test(p)) return { error: 'bad path' }; if (!resourceCache.has(p)) { try { resourceCache.set(p, await (await fetch(chrome.runtime.getURL(p))).json()); } catch (e) { return { error: 'not available' }; } } return { data: resourceCache.get(p) }; } // a data file left out of this copy is not an error
    case 'tosdr': return { finding: await tosdr(msg.hostname) };
    case 'rdap': { let from = null; try { from = new URL(sender.tab.url).hostname; } catch (e) { /* asked from the settings or a test */ } if (from && siteMuted(from, await getSettings())) return { record: null }; return await rdap(msg.domain); }
    case 'getSettings': { const st = await getSettings(); if (fromPage(sender)) { delete st.anthropicKey; delete st.openaiKey; delete st.fecKey; } return st; }
    case 'saveSettings': if (fromPage(sender)) return { error: 'settings change only from Subtext\'s own pages' }; return await saveAndBroadcast(msg.settings || {});
    case 'testStateByUrl': if (fromPage(sender)) return { state: null }; { for (const [, st] of tabState) if (st.report && st.report.url === msg.url) return { state: st }; return { state: null }; }
    default: return { error: 'unknown message ' + msg.type };
  }
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;
  handle(msg, sender).then(sendResponse).catch((e) => sendResponse({ error: e && e.message ? e.message : String(e) }));
  return true;
});
// A new document starts clean. So does a new route of a single-page app, where the document stays: Chrome reports both as a changed url, and the page is told so it can scan
// again. A jump to an anchor (a new fragment, the same route) keeps the report.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) { if (info.status === 'loading') await forgetTab(tabId); return; }
  const st = await getState(tabId);
  if (st && st.report && st.report.url !== info.url && sameRoute(st.report.url, info.url)) return;
  await forgetTab(tabId);
  try { chrome.tabs.sendMessage(tabId, { type: 'urlChanged', url: info.url }, () => void chrome.runtime.lastError); } catch (e) { /* no content script here */ }
});
// The toolbar icon opens the report panel on the page. Where no panel can open (browser pages, the web store, a muted site, a page loaded before install) it opens the small report window instead.
async function toolbarClick(tab) {
  let r = null; try { r = await chrome.tabs.sendMessage(tab.id, { type: 'togglePanel' }); } catch (e) { r = null; }
  if (r && !r.muted) return r;
  await chrome.windows.create({ url: chrome.runtime.getURL('popup/popup.html?tabId=' + tab.id), type: 'popup', width: 420, height: 620 });
  return { window: true };
}
if (chrome.action && chrome.action.onClicked) chrome.action.onClicked.addListener(toolbarClick);
if (chrome.commands) chrome.commands.onCommand.addListener(async (cmd) => { if (cmd !== 'toggle-panel') return; const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (tab) chrome.tabs.sendMessage(tab.id, { type: 'togglePanel' }, () => void chrome.runtime.lastError); });
chrome.tabs.onRemoved.addListener(tabId => { void forgetTab(tabId); });
chrome.runtime.onStartup.addListener(pruneLocal);
chrome.runtime.onInstalled.addListener(async (d) => { pruneLocal(); if (d.reason === 'install') { const s = await getSettings(); await chrome.storage.local.set({ settings: s }); } });
