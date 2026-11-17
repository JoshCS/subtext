/* Context lookups in the real extension worker (headless; the harness aborts every outside request, so sources return nothing).
   Checks the guards around the lookup, not the data: private hosts, mutes, two triggers at once, Trends only on a click,
   a stale 'busy' after a restart, and that only the context field of the tab's state is written. */
const assert = require('assert');
const path = require('path');
const L = require('./ui/lib');
const OUT = path.join(__dirname, 'out', 'context-worker');
(async () => {
  const { context, sw, close } = await L.launch(OUT);
  const seen = []; context.on('request', (r) => { const u = r.url(); if (!u.startsWith('chrome-extension://') && !/citizens-for-truth-institute\.org|dealzone-shop\.test|theguardian\.com/.test(u)) seen.push(u); });
  try {
    // ---- a public page: the lookup runs, every outside request fails in this harness, and the result is "nothing found", not an error
    const { page } = await L.open(context, L.ARTICLE);
    const tab = await L.tabId(sw, L.ARTICLE);
    const before = await sw.evaluate((id) => getState(id).then((s) => ({ findings: s.report.findings.length, hasOutletFindings: Array.isArray(s.outletFindings) })), tab);
    // two triggers at once: one runs, the other is told it is busy
    const [a, b] = await sw.evaluate(([id, u]) => Promise.all([loadContext(id, u, 'auto'), loadContext(id, u, 'auto')]), [tab, L.ARTICLE]);
    assert.ok((a.ok && b.busy) || (b.ok && a.busy), 'two triggers: one lookup. ' + JSON.stringify([a, b]));
    let st = await sw.evaluate((id) => getState(id), tab);
    assert.strictEqual(st.context.status, 'done'); assert.strictEqual(st.context.trigger, 'auto');
    assert.deepStrictEqual([st.context.result.charts.length, st.context.result.other.length], [0, 0], 'nothing answered: no chart');
    assert.strictEqual(st.report.findings.length, before.findings, 'the report is untouched');
    assert.ok(seen.length > 0, 'requests were attempted');
    assert.ok(!seen.some((u) => /trends\.google/.test(u)), 'the automatic lookup never asks Google Trends');
    assert.ok(!seen.some((u) => u.includes(encodeURIComponent(L.ARTICLE)) || u.includes('the-truth-about-the-economy')), 'the page address is in no request');
    // a click adds Trends
    seen.length = 0;
    await sw.evaluate(([id, u]) => loadContext(id, u, 'click'), [tab, L.ARTICLE]);
    st = await sw.evaluate((id) => getState(id), tab);
    assert.strictEqual(st.context.trigger, 'click');
    // with "Include Google Trends" off, a click does not ask Trends either
    await sw.evaluate(() => handle({ type: 'saveSettings', settings: { contextTrends: false } }, {}));
    seen.length = 0;
    await sw.evaluate(([id, u]) => loadContext(id, u, 'click'), [tab, L.ARTICLE]);
    assert.ok(!seen.some((u) => /trends\.google/.test(u)), 'Trends is off in Settings: not asked');
    await sw.evaluate(() => handle({ type: 'saveSettings', settings: { contextTrends: true } }, {}));
    // a wrong route is refused
    const wrong = await sw.evaluate(([id]) => loadContext(id, 'https://citizens-for-truth-institute.org/other', 'click'), [tab]);
    assert.ok(/changed/.test(wrong.error || ''), 'another route: ' + JSON.stringify(wrong));
    // a 'busy' left in storage by a worker that stopped mid-lookup is cleared on restore
    st = await sw.evaluate(async (id) => { const s0 = await getState(id); const s = Object.assign({}, s0, { context: { route: s0.report.url, status: 'busy' } }); await chrome.storage.session.set({ ['tab:' + id]: s }); tabState.delete(id); return getState(id); }, tab).catch((e) => ({ context: String(e) }));
    assert.strictEqual(st.context, null, 'a stale busy does not hide the button');
    // the fec key never reaches a page
    await sw.evaluate(() => handle({ type: 'saveSettings', settings: { fecKey: 'TESTKEY123' } }, {}));
    const pageSettings = await page.evaluate(() => new Promise((res) => { try { chrome.runtime.sendMessage({ type: 'getSettings' }, res); } catch (e) { res(null); } })).catch(() => null);
    const local = await sw.evaluate(() => chrome.storage.local.get(null).then((x) => JSON.stringify(x)));
    assert.ok(!/TESTKEY123/.test(JSON.stringify(pageSettings || {})) && !/TESTKEY123/.test(local), 'the key is not in page-readable settings or chrome.storage.local');
    // muting the site: no lookup, no request, and a running one is stopped
    seen.length = 0;
    await sw.evaluate(() => handle({ type: 'muteSite', hostname: 'citizens-for-truth-institute.org' }, {}));
    const muted = await sw.evaluate(([id, u]) => loadContext(id, u, 'click').catch((e) => ({ error: String(e.message || e) })), [tab, L.ARTICLE]);
    assert.ok(muted.error, 'a muted site: ' + JSON.stringify(muted)); assert.strictEqual(seen.length, 0, 'and no request');
    await sw.evaluate(() => handle({ type: 'unmuteSite', hostname: 'citizens-for-truth-institute.org' }, {}));
    // ---- a private or test host is never looked up
    await L.open(context, L.SHOP);
    const shopTab = await L.tabId(sw, L.SHOP);
    seen.length = 0;
    const priv = await sw.evaluate(([id, u]) => loadContext(id, u, 'click'), [shopTab, L.SHOP]);
    assert.ok(/public websites/.test(priv.error || ''), 'a .test host: ' + JSON.stringify(priv)); assert.strictEqual(seen.length, 0, 'nothing about it leaves');
    console.log('Context worker: one lookup at a time, Trends only on a click and only when on, routes, stale busy, key storage, mute and private hosts passed.');
  } finally { await close(); }
})().catch((e) => { console.error(e); process.exit(1); });
