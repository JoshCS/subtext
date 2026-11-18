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
  // the content script's scan marker comes before the worker's stored report: wait for the report itself, not for a fixed delay
  const scanned = async (url) => { const id = await L.tabId(sw, url); for (let i = 0; i < 60; i++) { if (await sw.evaluate((t) => getState(t).then((s) => !!(s && s.report)), id)) return id; await new Promise((r) => setTimeout(r, 500)); } throw new Error('no report for ' + url + ' after 30 s'); };
  try {
    // ---- a public page: the lookup runs, every outside request fails in this harness, and the result is "nothing found", not an error
    const { page } = await L.open(context, L.ARTICLE);
    const tab = await scanned(L.ARTICLE);
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
    const shopTab = await scanned(L.SHOP);
    seen.length = 0;
    const priv = await sw.evaluate(([id, u]) => loadContext(id, u, 'click'), [shopTab, L.SHOP]);
    assert.ok(/public websites/.test(priv.error || ''), 'a .test host: ' + JSON.stringify(priv)); assert.strictEqual(seen.length, 0, 'nothing about it leaves');
    // ---- the page facts the content script reads (tax IDs, status pages, footer text): what it takes, from where, and where each may go.
    // Synthetic pages served by this test. Every outside request is aborted unless a step below answers it with a synthetic response.
    const serve = (url, html) => context.route(url, (route) => (route.request().resourceType() === 'document' ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }) : route.abort()));
    const signals = async (url) => sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'contextSignals' }, { frameId: 0 }), await L.tabId(sw, url));
    const filler = '<p>' + 'Fresh produce arrives from local farms on Monday mornings. '.repeat(20) + '</p>';
    const ORG = 'https://www.example-pantry-fixture.org/';
    const ORG_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Home - Example Riverbend Pantry</title><meta property="og:site_name" content="Example Riverbend Pantry"></head><body>' +
      '<header><a href="https://help.example-pantry-fixture.org/">Help</a></header>' +
      '<main><h1>Example Riverbend Pantry</h1><p>We share food with our neighbours every week of the year. Volunteers sort and pack on Tuesdays.</p>' +
      '<p>Quote member number 123456789 at the desk. Your order reference is 98-7654321. Our old phone line was 55-5010099.</p>' +
      // main content, a comment and a post's own footer: a tax ID or a status link here is somebody's text, not the site's
      '<p>Applicant EIN: 45-1111111. A partner\'s Tax ID: 46-2222222.</p>' +
      '<p>A reader wrote: see <a href="https://status.members.example-pantry-fixture.org/">Status</a> and <a href="https://status.planted-fixture-host.com/x">Status</a>.</p>' +
      '<article><p>A post.</p><footer>Posted by a member. <a href="https://status.forum.example-pantry-fixture.org/">System status</a> EIN: 47-3333333</footer></article>' +
      '<nav><a href="https://status.inmain.example-pantry-fixture.org/">Status</a></nav>' + filler + '</main>' +
      '<footer><p>Example Riverbend Pantry, 12 Mill Lane, Zzyzxville, QQ 00000. ZEBRAFOOTERWORD.</p><p>We are a 501(c)(3) organization. Federal Tax ID# 12-3456789</p>' +
      '<a href="https://status.example-pantry-fixture.org/history">Uptime</a> <a href="http://plain.example-status-vendor.com/">Status</a> <a href="https://uptime.example-status-vendor.com/pantry?ref=footer">System status</a> ' +
      '<a href="https://example-pantry-fixture.statuspage-vendor-fixture.io/">Status</a> <a href="https://status.example-pantry-fixture.org.planted-fixture-host.com/">Status</a> ' +
      '<a href="https://uptime.example-pantry-fixture.org/now?ref=footer">Service status</a> <a href="https://example-pantry-fixture.org/status">Status</a> <a href="https://help.example-pantry-fixture.org/">Help</a> ' +
      '<a href="https://intranet.local/status">Status</a> <a href="https://shop.example-other-site.com/">Our status as a charity</a></footer></body></html>';
    await serve(ORG, ORG_HTML);
    const out = []; context.on('request', (r) => { const u = r.url(); if (!u.startsWith('chrome-extension://') && !u.startsWith('https://www.example-pantry-fixture.org/')) out.push(u); });
    const plainOut = () => out.map((u) => { try { return decodeURIComponent(u); } catch (e) { return u; } });
    await L.open(context, ORG);
    const orgTab = await scanned(ORG);
    const sig = await signals(ORG);
    assert.deepStrictEqual(sig.taxIds, ['12-3456789'], 'only the number beside a label in the page\'s own footer is read; main content and a post\'s footer are not: ' + JSON.stringify(sig.taxIds));
    assert.strictEqual(sig.taxIdNonprofit, true, 'the text beside it calls the organization a 501(c)(3)');
    assert.deepStrictEqual(sig.statusPages, ['https://status.example-pantry-fixture.org', 'https://uptime.example-pantry-fixture.org'], 'only https links in the page\'s own footer, header or navigation, to a host under the site\'s own domain: "status." or a link labelled Status. Not a vendor\'s host, a look-alike, the site\'s own host, or a link in main content or in a post: ' + JSON.stringify(sig.statusPages));
    assert.ok(/ZEBRAFOOTERWORD/.test(sig.footerText) && /Zzyzxville, QQ/.test(sig.footerText) && sig.footerText.length <= 4000 && !/ZEBRAFOOTERWORD/.test(sig.text), 'the footer text is read apart from the main text');
    // the worker checks again, whatever the content script sent: only hosts under the site's own domain
    const facts = await sw.evaluate((p) => { const f = SubtextContextData.pageFacts(Object.assign({ url: 'https://www.example-pantry-fixture.org/', registrable: MLCommon.registrableDomain('www.example-pantry-fixture.org') }, p)); return { taxIds: f.taxIds, statusPages: f.statusPages, registrable: f.registrable }; },
      { title: sig.title, taxIds: sig.taxIds, statusPages: sig.statusPages.concat(['https://uptime.example-status-vendor.com', 'https://status.planted-fixture-host.com', 'https://intranet.local']) });
    assert.deepStrictEqual(facts, { taxIds: ['123456789'], statusPages: ['https://status.example-pantry-fixture.org', 'https://uptime.example-pantry-fixture.org'], registrable: 'example-pantry-fixture.org' }, 'another host is dropped in the worker too');
    // ProPublica answers (synthetic): the filer has the name the page gives itself (og:site_name, title, footer). That confirms nothing:
    // the site's address is not that name, so the filings are not shown as this site's.
    const ppBody = (ein, name) => JSON.stringify({ organization: { id: ein, ein, name, city: 'Zzyzxville', state: 'QQ', subsection_code: 3 }, filings_with_data: [2024, 2023, 2022, 2021, 2020, 2019, 2018].map((y) => ({ ein, tax_prd: y * 100 + 12, tax_prd_yr: y, formtype: 0, totrevenue: 1e6 + (y - 2018) * 1e5, totfuncexpns: 9e5, totnetassetend: 1e5 })), filings_without_data: [], api_version: 2 });
    await context.route('https://projects.propublica.org/nonprofits/api/v2/organizations/123456789.json', (route) => route.fulfill({ contentType: 'application/json', body: ppBody(123456789, 'EXAMPLE RIVERBEND PANTRY INC') }));
    out.length = 0;
    const orgRun = await sw.evaluate(([id, u]) => loadContext(id, u, 'auto'), [orgTab, ORG]);
    assert.ok(orgRun.ok, 'the lookup ran: ' + JSON.stringify(orgRun));
    st = await sw.evaluate((id) => getState(id), orgTab);
    assert.ok(st.context.result.ran.find((r) => r.id === 'page_tax_id' && r.ok === false && r.sends === 'the tax ID printed on this page to ProPublica Nonprofit Explorer'), 'the tax ID lookup is listed with what it sent, and it did not confirm the site: ' + JSON.stringify(st.context.result.ran.filter((r) => r.id === 'page_tax_id')));
    assert.deepStrictEqual(st.context.result.charts.concat(st.context.result.other).map((c) => c.id), [], 'a filer named like the page names itself, on an address that is not that name: no chart');
    let plain = plainOut();
    const withId = plain.filter((u) => /12-?3456789/.test(u));
    assert.ok(withId.length >= 1 && withId.every((u) => u === 'https://projects.propublica.org/nonprofits/api/v2/organizations/123456789.json'), 'the tax ID goes to ProPublica and nowhere else: ' + JSON.stringify(withId));
    assert.ok(!plain.some((u) => /ZEBRAFOOTERWORD|Zzyzxville|Mill Lane|00000|member number|98-?7654321|55-?5010099|45-?1111111|46-?2222222|47-?3333333/i.test(u)), 'footer text, unlabelled numbers and IDs outside the footer are in no request');
    // the status hosts under the site's own domain are asked for their feed, each only at the fixed path; no other host is asked anything
    assert.deepStrictEqual(plain.filter((u) => /status\.|uptime\.|statuspage|planted/.test(u)), ['https://status.example-pantry-fixture.org/api/v2/incidents.json', 'https://uptime.example-pantry-fixture.org/api/v2/incidents.json'], 'only the site\'s own status hosts: ' + JSON.stringify(plain.filter((u) => /status|uptime|planted/.test(u))));
    assert.ok(!plain.some((u) => /example-status-vendor|statuspage-vendor-fixture|planted-fixture-host|intranet\.local|example-other-site|members\.example|forum\.example|inmain\.example/.test(u)), 'a vendor\'s host, a planted host, a private host and an unrelated link are never contacted');

    // ---- the label patterns, read from an element with the class "site-footer" (a page with no <footer>), and what is not a labelled tax ID.
    // A page that prints several IDs gets them all listed; the router then takes none.
    const LABELS = ORG + 'labels';
    const LABELS_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Labels</title></head><body><main><h1>Tax details</h1><p>EIN: 77-1234567</p><div class="card-footer">Tax ID 78-1234567</div>' +
      '<p>' + 'Words to make this a page with some text on it. '.repeat(20) + '</p></main><div class="site-footer">' +
      ['EIN: 11-1111111', 'Our Tax identification number is 22-2222222', 'Employer Identification Number (E.I.N.) 33-3333333', 'TAX ID 44-4444444', 'Taxpayer ID: 55-5555555', 'Tax-ID – EIN: 11-1111111',
        'In German, ein 66-6666666 is not a label', 'Tax ID for the 2024 filings 77-7777777', 'EIN ' + 'is printed further along this long line of words, '.repeat(2) + '88-8888888', 'SKU 12-1212121', 'Tax ID 99-99999990', 'Tax ID 1-23456789', 'Tax ID 131313131',
        'Tax exempt: No. Upload a certificate to claim tax-exempt status.'].map((t) => '<p>' + t + '</p>').join('') + '</div></body></html>';
    await serve(LABELS, LABELS_HTML);
    await L.open(context, LABELS);
    const lab = await signals(LABELS);
    assert.deepStrictEqual(lab.taxIds, ['11-1111111', '22-2222222', '33-3333333', '44-4444444', '55-5555555'], 'EIN, Tax ID, Tax identification number, Employer Identification Number and Taxpayer ID are labels; a lower-case "ein", a digit or a long gap between label and number, another label, a number of another shape, and anything in the main content are not: ' + JSON.stringify(lab.taxIds));
    assert.deepStrictEqual([lab.taxIdNonprofit, lab.statusPages], [false, []], '"tax exempt" on a billing form is not nonprofit wording; no status link on this page');

    // ---- an account page of a company's app: the reader's own company and its tax ID are in the main content. Nothing is read, nothing is sent.
    const BILLING = 'https://app.example-billing-fixture.com/settings/billing';
    await serve(BILLING, '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Billing | Example App</title><meta property="og:site_name" content="Example App"></head><body><main><h1>Billing details</h1>' +
      '<p>Company: Reader Widgets LLC</p><p>Tax ID: 12-3456789</p><p>Tax exempt: No. Upload a certificate to claim tax-exempt status.</p><p>Plan: Team, 14 seats</p>' +
      '<section class="card"><p>Invoice 2026-11</p><footer>Bill to EIN: 98-1111111, a 501(c)(3) nonprofit</footer></section><form><div id="footer">Tax ID 97-1111111</div></form>' + filler + '</main><footer><p>Example App Inc. Terms. Privacy.</p></footer></body></html>');
    await L.open(context, BILLING);
    const billTab = await scanned(BILLING);
    const bill = await signals(BILLING);
    assert.deepStrictEqual([bill.taxIds, bill.taxIdNonprofit], [[], false], 'an account page: a tax ID in the main content, in a card\'s footer or in a form is not read: ' + JSON.stringify(bill.taxIds));
    out.length = 0;
    assert.ok((await sw.evaluate(([id, u]) => loadContext(id, u, 'auto'), [billTab, BILLING])).ok);
    st = await sw.evaluate((id) => getState(id), billTab);
    plain = plainOut();
    assert.ok(!st.context.result.ran.some((r) => r.id === 'page_tax_id') && !plain.some((u) => /organizations\/\d|12-?3456789|98-?1111111|97-?1111111|Reader|Widgets/i.test(u)), 'no tax ID is sent and nothing about the reader\'s company leaves: ' + JSON.stringify(plain.filter((u) => /propublica/.test(u))));
    // ---- a .org grants portal that prints the applicant's ID in its main content: the same
    const PORTAL = 'https://grants.example-portal-fixture.org/applications/881';
    await serve(PORTAL, '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Application 881 | Example Foundation Grants</title><meta property="og:site_name" content="Example Foundation"></head><body><main><h1>Your application</h1>' +
      '<p>Applicant organization: Reader Arts Collective</p><p>Applicant EIN: 12-3456789</p><p>Status: submitted</p>' + filler + '</main><footer><p>Example Foundation. Terms. Privacy.</p></footer></body></html>');
    await L.open(context, PORTAL);
    const portalTab = await scanned(PORTAL);
    const portal = await signals(PORTAL);
    assert.deepStrictEqual(portal.taxIds, [], 'an applicant\'s tax ID on a .org portal is not read');
    out.length = 0;
    assert.ok((await sw.evaluate(([id, u]) => loadContext(id, u, 'auto'), [portalTab, PORTAL])).ok);
    st = await sw.evaluate((id) => getState(id), portalTab);
    assert.ok(!st.context.result.ran.some((r) => r.id === 'page_tax_id') && !plainOut().some((u) => /12-?3456789|Reader|Arts Collective/i.test(u)), 'the applicant\'s tax ID and name are in no request');

    // ---- a nonprofit whose address IS the filer's name, on a subdomain: the worker passes the registrable domain, the footer ID is read,
    // and the filings are shown with the line that says what is known
    const OWN = 'https://donate.examplefixtureriverpantry.org/';
    await serve(OWN, '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Give - Example Fixture River Pantry</title><meta property="og:site_name" content="River Pantry"></head><body><main><h1>Give</h1><p>Your gift feeds our neighbours.</p>' + filler +
      '</main><footer><p>Example Fixture River Pantry Inc is a 501(c)(3) nonprofit. EIN: 23-2345678</p></footer></body></html>');
    await context.route('https://projects.propublica.org/nonprofits/api/v2/organizations/232345678.json', (route) => route.fulfill({ contentType: 'application/json', body: ppBody(232345678, 'EXAMPLE FIXTURE RIVER PANTRY INC') }));
    await L.open(context, OWN);
    const ownTab = await scanned(OWN);
    assert.deepStrictEqual((await signals(OWN)).taxIds, ['23-2345678']);
    assert.ok((await sw.evaluate(([id, u]) => loadContext(id, u, 'auto'), [ownTab, OWN])).ok);
    st = await sw.evaluate((id) => getState(id), ownTab);
    const lead = st.context.result.charts[0] || {};
    assert.deepStrictEqual([lead.id, lead.title, lead.relation], ['nonprofit_finances', 'Revenue: EXAMPLE FIXTURE RIVER PANTRY INC', 'This page prints the tax ID 23-2345678. IRS filings under that ID are from EXAMPLE FIXTURE RIVER PANTRY INC.'], 'an address that equals the filer\'s name: ' + JSON.stringify(st.context.result.ran.filter((r) => /tax|nonprofit/.test(r.id))));
    assert.ok(/^The tax ID 23-2345678 was read from this page\./.test(lead.note), lead.note);

    // ---- contextIo, the one way a context request leaves the worker
    const FEEDHOST = 'https://status.example-io-fixture.com';
    await context.route(FEEDHOST + '/**', (route) => { const u = route.request().url();
      if (/\/moved\//.test(u)) return route.fulfill({ status: 302, headers: { location: 'https://elsewhere.example-io-fixture.net/landed' }, body: '' });
      if (/\/wide$/.test(u)) return route.fulfill({ contentType: 'text/plain; charset=utf-8', body: 'é'.repeat(2000000) }); // 4,000,000 bytes
      if (/\/big$/.test(u)) return route.fulfill({ contentType: 'text/plain; charset=utf-8', body: 'a'.repeat(5000000) });
      return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); });
    await context.route('https://elsewhere.example-io-fixture.net/**', (route) => route.fulfill({ contentType: 'application/json', body: '{"landed":true}' }));
    const ioGet = (url, opt) => sw.evaluate(([u, o]) => contextIo(false, { cancelled: false }).get(u, o).then((r) => ({ status: r.status, length: r.text.length, head: r.text.slice(0, 20), error: r.error ? String(r.error).slice(0, 80) : '' })), [url, opt || null]);
    assert.deepStrictEqual(await ioGet(FEEDHOST + '/small'), { status: 200, length: 11, head: '{"ok":true}', error: '' }, 'an ordinary answer is read whole');
    // (a) a source may refuse redirects: the request fails at the first host, and the address it points to is never requested
    out.length = 0;
    const refusedRedirect = await ioGet(FEEDHOST + '/moved/api/v2/incidents.json', { accept: 'application/json', redirect: 'error' });
    assert.deepStrictEqual([refusedRedirect.status, refusedRedirect.length], [0, 0], 'a redirect with redirect: "error" gives no answer: ' + JSON.stringify(refusedRedirect));
    assert.ok(!out.some((u) => /elsewhere\.example-io-fixture/.test(u)), 'and the host it points to is never asked: ' + JSON.stringify(out));
    out.length = 0; await ioGet(FEEDHOST + '/moved/x');
    assert.ok(out.some((u) => /elsewhere\.example-io-fixture/.test(u)), 'without the option the browser does follow it (so the check above can see a follow)');
    // (b) the body is read through a stream and the reading stops at 3,000,000 bytes
    const big = await ioGet(FEEDHOST + '/big');
    assert.deepStrictEqual([big.status, big.length], [200, 3000000], 'five million bytes: three million are kept');
    const wide = await ioGet(FEEDHOST + '/wide');
    assert.ok(wide.status === 200 && wide.length >= 1499999 && wide.length <= 1500001, 'the limit is in bytes: 4,000,000 bytes of a two-byte letter give 1,500,000 characters, got ' + wide.length);
    // the rest of a long answer is not pulled: a stream that counts its chunks, in place of the network
    const stream = await sw.evaluate(async () => {
      const real = self.fetch; let pulled = 0, cancelled = false, init = null;
      self.fetch = async (url, i) => { init = i; return new Response(new ReadableStream({ pull(c) { pulled++; if (pulled > 200) c.close(); else c.enqueue(new Uint8Array(65536).fill(97)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 }), { status: 200 }); };
      try { const r = await contextIo(false, { cancelled: false }).get('https://status.example-io-fixture.com/api/v2/incidents.json', { accept: 'application/json', redirect: 'error' }); return { pulled, cancelled, length: r.text.length, status: r.status, redirect: init && init.redirect, credentials: init && init.credentials, referrerPolicy: init && init.referrerPolicy }; }
      finally { self.fetch = real; }
    });
    assert.deepStrictEqual([stream.status, stream.length, stream.cancelled, stream.redirect, stream.credentials, stream.referrerPolicy], [200, 3000000, true, 'error', 'omit', 'no-referrer'], 'a 13 MB stream: ' + JSON.stringify(stream));
    assert.ok(stream.pulled <= 48, 'reading stopped near 3,000,000 bytes (46 chunks of 65,536): pulled ' + stream.pulled + ' of 200');
    const followed = await sw.evaluate(async () => { const real = self.fetch; let init = null; self.fetch = async (url, i) => { init = i; return new Response('{}', { status: 200 }); }; try { await contextIo(false, { cancelled: false }).get('https://www.wikidata.org/x', { redirect: 'manual' }); return init.redirect; } finally { self.fetch = real; } });
    assert.strictEqual(followed, 'follow', 'only "error" is passed on; any other source follows redirects, and its final address is checked');
    // (c) the final-address check stays for the sources that follow redirects
    const ended = await sw.evaluate(async () => { const real = self.fetch; self.fetch = async () => { const r = new Response('secret', { status: 200 }); Object.defineProperty(r, 'url', { value: 'https://intranet.local/x' }); return r; }; try { return await contextIo(false, { cancelled: false }).get('https://www.wikidata.org/x'); } finally { self.fetch = real; } });
    assert.deepStrictEqual([ended.status, ended.text], [0, ''], 'an answer that ended on a host that is not public https is not read');

    console.log('Context worker: one lookup at a time, Trends only on a click and only when on, routes, stale busy, key storage, mute and private hosts passed.');
    console.log('Context worker: labelled tax IDs are read from the page footer only; status links only from the footer, header or navigation and only under the site\'s own domain; no other host is asked; the tax ID goes only to ProPublica; a filer named only by the page gives no chart; an address that equals the filer\'s name gives one, with the relation line.');
    console.log('Context worker: contextIo refuses redirects on request, stops reading at 3,000,000 bytes and keeps the final-address check.');
  } finally { await close(); }
})().catch((e) => { console.error(e); process.exit(1); });
