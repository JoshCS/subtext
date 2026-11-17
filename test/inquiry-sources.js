const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const sources = require('../extension/inquiry-sources');

const site = 'https://publisher.example.com';
const page = site + '/features/the-article?session=private#selected-text';
const disclosure = site + '/about/editorial-guidelines/';
const paper = 'https://pubmed.ncbi.nlm.nih.gov/36331190/';
const filing = 'https://www.sec.gov/Archives/edgar/data/1562088/000156208824000008/duol-20231231.htm';
const oneMiB = 1024 * 1024;

function response(url, value, { type = 'application/json', status = 200, length, redirected = false } = {}) {
  const headers = new Headers({ 'Content-Type': type });
  if (length !== undefined) headers.set('Content-Length', String(length));
  const body = typeof value === 'string' || value instanceof ReadableStream ? value : JSON.stringify(value);
  const result = new Response(body, { status, headers });
  Object.defineProperties(result, { url: { value: url }, redirected: { value: redirected } });
  return result;
}

function checkRequest(options) {
  assert.equal(options.method, 'GET');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.equal(options.redirect, 'error');
  assert(options.signal instanceof AbortSignal);
  assert(!options.body);
}

async function main() {
  assert.deepEqual(sources.candidate(paper + '?tracking=private#fragment', page, ' Study record '),
    { url: paper, kind: 'record', label: 'Study record' });
  assert.deepEqual(sources.candidate('/about/editorial-guidelines/#funding', page, 'Editorial policy'),
    { url: disclosure, kind: 'disclosure', label: 'Editorial policy' });
  assert(sources.candidate('/how-we-make-money', page));
  assert(sources.candidate('/legal/terms-of-service.html', page));
  assert(sources.candidate('https://publisher.example.com/Press/', page));
  const shop = 'https://store.example.org';
  const shopPage = shop + '/products/annual-membership?session=private';
  const shopPolicy = shop + '/policies/cancellation-and-refund-policy';
  assert.equal(sources.candidate('/legal/universal-terms-of-service-agreement', page)?.kind, 'disclosure');
  assert.equal(sources.candidate('/legal/refund-policy#refunds', page)?.url, site + '/legal/refund-policy');
  assert.equal(sources.candidate('/subscription-and-cancellation-terms.html', shopPage)?.kind, 'disclosure');
  assert.equal(sources.candidate('/policies/cancellation-and-refund-policy', shopPage)?.url, shopPolicy);
  assert(sources.isTransactionPolicy(shopPolicy));
  assert(!sources.isTransactionPolicy(shop + '/legal/account'));
  assert(!sources.isTransactionPolicy(disclosure));
  for (const href of [
    '', '/account', '/features/about', '/about/account', '/about/private/editorial-guidelines',
    '/about.pdf', '/about?token=secret', '/about?', '/%61bout', '/content/../about',
    '/.//about', '/content/%2e%2e/about', '/about%2F', '/about\\', '/ about',
    'https://publisher.example.com:443/about', 'https:///publisher.example.com/about',
    'https://@publisher.example.com/about', 'https://u:p@publisher.example.com/about',
    'http://publisher.example.com/about', 'https://api.publisher.example.com/about',
    'https://publisher.example.com.evil.org/about', '//other.example.com/about',
    '//publisher.example.com@other.example.com/about', 'javascript:alert(1)', 'data:text/html,about',
    '/legal/refund-policy?account=private', '/legal/cancellation-policy-vip', '/legal/private/refund-policy',
    '/policies/about', '/private/refund-policy', '/legal/%72efund-policy', shopPolicy,
  ]) assert.equal(sources.candidate(href, page), null, href);
  for (const host of [
    'localhost', '127.1', '0x7f000001', '2130706433', '192.168.0.2', '8.8.8.8',
    '[::1]', '[::ffff:127.0.0.1]', 'docs.local', 'docs.internal', 'app.localhost',
    'docs.lan', 'docs.intranet', 'docs.test', 'docs.example', 'docs.example.com.',
  ]) assert.equal(sources.candidate('/about', 'https://' + host + '/story'), null, host);

  let calls = 0;
  const entry = sources.candidate(disclosure, page);
  const html = `<!DOCTYPE html><html><head>
    <title>Funding &amp; editorial standards</title><style>hidden stylesheet</style>
    <script>hidden head script</script></head><body><main>
    <!-- hidden comment --><h1>Editorial standards and advertiser disclosures</h1>
    <p>We may earn a commission when readers buy through links.</p>
    <p>Affiliates do not approve our editorial ratings &amp; recommendations.</p>
    <div hidden><p>Hidden evidence supplied with the hidden attribute.</p></div>
    <div aria-hidden="true"><p>Hidden evidence supplied with ARIA.</p></div>
    <section style="display : none !important"><p>Hidden evidence supplied with CSS.</p></section>
    <div style="visibility:&#104;idden"><p>Hidden evidence supplied with entities.</p></div>
    <p class="mobile sr-only">Hidden evidence supplied with a hidden class.</p>
    <details><summary>Closed details</summary><p>Hidden evidence in a closed panel.</p></details>
    <template><p>Hidden evidence supplied with a template.</p></template>
    <svg><text>Hidden evidence supplied with a drawing.</text></svg>
    <script>const hidden = "<p>Hidden evidence supplied with a script.</p>";</script>
    <style>p { color: red; } Hidden evidence supplied with a stylesheet.</style>
    <noscript>Hidden evidence supplied with noscript.</noscript>
    <p data-example="greater > less">We do not accept gifts for product placement.</p>
    </main></body></html>`;
  const readHtml = async (url, options) => {
    calls++;
    assert.equal(url, disclosure);
    checkRequest(options);
    assert.equal(options.headers.Accept, 'text/html');
    return response(url, html, { type: 'text/html; charset=utf-8' });
  };
  const doc = await sources.read(entry, { query: 'editorial commission', fetchImpl: readHtml });
  assert.equal(doc.title, 'Funding & editorial standards');
  assert.equal(doc.kind, 'disclosure');
  assert.equal(doc.url, disclosure);
  assert.deepEqual(doc.passages, [
    'Editorial standards and advertiser disclosures',
    'We may earn a commission when readers buy through links.',
    'Affiliates do not approve our editorial ratings & recommendations.',
    'We do not accept gifts for product placement.',
  ]);
  assert.deepEqual(await sources.read({ ...entry }, { pageUrl: page, fetchImpl: readHtml }), doc);
  await assert.rejects(sources.read({ ...entry }, { fetchImpl: readHtml }), /Unsupported/);
  await assert.rejects(sources.read(entry, { pageUrl: 'https://elsewhere.example.com/story', fetchImpl: readHtml }), /Unsupported/);
  await assert.rejects(sources.read({ ...entry, url: 'https://evil.org/about' }, { pageUrl: page, fetchImpl: readHtml }), /Unsupported/);
  await assert.rejects(sources.read({ ...entry, url: disclosure + '?secret=true' }, { pageUrl: page, fetchImpl: readHtml }), /Unsupported/);
  assert.equal(calls, 2);

  const policy = sources.candidate(shopPolicy, shopPage);
  const heading = 'Consumer plans only';
  const clause = 'Paid subscriptions are eligible for a pro-rated refund within 14 days. ' +
    'This paragraph contains the remainder of the condition. '.repeat(67) + 'Proof of purchase is required.';
  const exception = 'Except in California.';
  const alternate = 'California residents can request a refund within 30 days.';
  const filler = Array.from({ length: 30 }, (_, i) => '<p>Refund information for account types ' + i + '. ' +
    'This paragraph lists terms for an unrelated payment method. '.repeat(17) + '</p>');
  const oversized = 'A pro-rated refund never applies in this illustrative oversized section. ' + 'x'.repeat(4000);
  const policyHtml = '<main>' + filler.join('') + '<p>' + oversized + '</p>' +
    [heading, clause, exception, alternate].map(line => '<p>' + line + '</p>').join('') + '</main>';
  const policyDoc = await sources.read({ ...policy }, { pageUrl: shopPage, query: 'pro-rated refund', fetchImpl: (url, options) => {
    checkRequest(options);
    assert.equal(url, shopPolicy);
    return response(url, policyHtml, { type: 'text/html' });
  } });
  const { passages } = policyDoc;
  assert.deepEqual(passages.slice(-4), [heading, clause, exception, alternate]);
  assert(!passages.some(line => line.includes('oversized')));
  assert(passages.length <= 36);
  assert(passages.every(line => line.length <= 4000));
  assert(passages.reduce((total, line) => total + line.length, 0) <= 12000);
  await assert.rejects(sources.read({ ...policy }, { pageUrl: page, fetchImpl: () => assert.fail('cross-origin policy made a request') }), /Unsupported/);

  const sections = Array.from({ length: 12 }, (_, i) => [
    `Purchase category heading ${i}.`,
    `Limited restricted capped withdrawal for purchase category ${i}.`,
    `This is the first condition for purchase category ${i}.`,
    `This is the second condition for purchase category ${i}.`,
    `This starts an unrelated section after purchase category ${i}.`,
  ]).flat();
  const lastClause = 'A request for cancellation can be filed at any time.';
  const readPolicyLines = (query, lines) => sources.read(policy, {
    query,
    fetchImpl: url => response(url, lines.map(line => '<p>' + line + '</p>').join(''), { type: 'text/html' }),
  });
  const policyQuery = 'limited restricted capped withdrawal cancellation';
  const slotDoc = await readPolicyLines(policyQuery, [...sections.slice(0, 40), lastClause, exception, alternate]);
  assert(slotDoc.passages.length <= 36);
  assert(slotDoc.passages.includes(lastClause));
  assert.equal(slotDoc.passages[slotDoc.passages.indexOf(lastClause)+1],exception);
  const shortException = 'UK only.';
  const crowdedDoc = await readPolicyLines(policyQuery, [...sections, lastClause, shortException]);
  assert(crowdedDoc.passages.length <= 36);
  assert(crowdedDoc.passages.includes(lastClause + ' ' + shortException));

  for (const mock of [
    () => response(disclosure, html, { type: 'text/html', redirected: true }),
    () => response(site + '/about/', html, { type: 'text/html' }),
    () => response('', html, { type: 'text/html' }),
    () => response(disclosure, html, { type: 'application/pdf' }),
    () => response(disclosure, html, { type: 'text/html', status: 403 }),
    () => response(disclosure, html, { type: 'text/html', length: oneMiB + 1 }),
    () => response(disclosure, 'x'.repeat(oneMiB + 1), { type: 'text/html' }),
    () => response(disclosure, '<script>Hidden evidence is the only evidence.</script>', { type: 'text/html' }),
  ]) await assert.rejects(sources.read(entry, { fetchImpl: mock }));

  const articles = [
    { id: '43210000', source: 'MED', title: 'Effects of empagliflozin in chronic kidney disease', pubType: 'review', firstPublicationDate: '2025-12-01' },
    { id: '36331190', source: 'MED', title: 'Empagliflozin in Patients with Chronic Kidney Disease.', pubType: 'randomized controlled trial', firstPublicationDate: '2022-11-04', fullTextUrl: 'https://evil.org/steal' },
    { id: '36331190', source: 'MED', title: 'Duplicate of the primary record' },
    { id: 'https://example.com', source: 'MED', doi: 'https://evil.org/steal', title: 'Malformed record' },
    { id: 'PPR1234', source: 'PPR', doi: '10.1101/2024.09.03.12345', title: 'Other report on kidney disease', firstPublicationDate: '2024-09-03' },
    { id: '123', source: 'MED', title: 'Fourth record' },
  ];
  const paperQuery = 'Empagliflozin in Patients with Chronic Kidney Disease';
  const found = await sources.discover({ kind: 'paper', query: paperQuery, pageUrl: page, browsingProfile: 'do-not-send' }, async (url, options) => {
    checkRequest(options);
    assert.equal(options.headers.Accept, 'application/json');
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, 'https://www.ebi.ac.uk/europepmc/webservices/rest/search');
    assert.deepEqual([...u.searchParams.keys()], ['query', 'format', 'resultType', 'pageSize']);
    assert(u.searchParams.get('query').includes('TITLE:"' + paperQuery + '"'));
    assert(!url.includes('publisher') && !url.includes('session') && !url.includes('do-not-send'));
    return response(url, { resultList: { result: articles } });
  });
  assert.equal(found.length, 3);
  assert.equal(found[0].url, paper);
  assert.equal(found[0].kind, 'record');
  assert.equal(found[0].date, '2022-11-04');
  assert.equal(found[2].url, 'https://doi.org/10.1101/2024.09.03.12345');

  for (const query of ['https://publisher.example.com/path', 'publisher.example.com', 'trial PMID:36331190',
    'trial&mail=a@example.com', 'trial\nname', 'trial\tname', 'trial+name', 'foo"bar', '', 'a'.repeat(151)]) {
    await assert.rejects(sources.discover({ kind: 'paper', query }, () => { assert.fail('invalid query made a request'); }), /Unsupported public search terms/);
  }
  await assert.rejects(sources.discover({ kind: 'site', query: 'paper' }, () => { assert.fail('invalid kind made a request'); }), /Unsupported public search kind/);

  const hit = {
    _id: '0001562088-24-000008:duol-20231231.htm',
    _source: { adsh: '0001562088-24-000008', ciks: ['0001562088'], file_date: '2024-02-28',
      display_names: ['DUOLINGO, INC. (CIK 0001562088)'], form: '10-K', file_type: '10-K', url: 'https://evil.org/steal' },
  };
  const filings = await sources.discover({ kind: 'filing', query: 'Duolingo fiscal 2023' }, async (url, options) => {
    checkRequest(options);
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, 'https://efts.sec.gov/LATEST/search-index');
    assert.equal(u.searchParams.get('q'), '"Duolingo" "fiscal" "2023"');
    assert.equal(u.searchParams.get('size'), '12');
    return response(url, { hits: { hits: [
      { ...hit, _id: '0001562088-24-000008:../unsafe.htm' },
      { ...hit, _source: { ...hit._source, ciks: ['../1'] } },
      { ...hit, _source: { ...hit._source, file_type: 'EX-99' } },
      hit, hit,
    ] } });
  });
  assert.deepEqual(filings, [{ url: filing, kind: 'record', label: 'SEC filing', title: 'DUOLINGO, INC. · 10-K', date: '2024-02-28' }]);
  await assert.rejects(sources.discover({ kind: 'filing', query: 'Duolingo' }, url => response(url, '', { status: 403 })), /SEC search blocked/);
  await assert.rejects(sources.discover({ kind: 'paper', query: 'Trial' }, url => response(url, {})), /unreadable result/);
  await assert.rejects(sources.discover({ kind: 'paper', query: 'Trial' }, url => response(url, 'x'.repeat(oneMiB + 1))), /size limit/);
  assert.deepEqual(await sources.discover({ kind: 'paper', query: 'Trial' }, url => response(url, { resultList: { result: [] } })), []);

  const readPaper = await sources.read(found[0], { query: 'never send this query', fetchImpl: (url, options) => {
    checkRequest(options);
    assert.equal(new URL(url).searchParams.get('query'), 'EXT_ID:36331190 AND SRC:MED');
    assert(!url.includes('never'));
    return response(url, { resultList: { result: [{ ...articles[1], abstractText: '<p>We conducted a randomized, placebo-controlled trial.</p>' }] } });
  } });
  assert.deepEqual(readPaper, { title: articles[1].title, passages: ['We conducted a randomized, placebo-controlled trial.'], url: paper, kind: 'record' });
  const readFiling = await sources.read(filings[0], { query: 'paid subscribers', fetchImpl: (url, options) => {
    assert.equal(url, filing);
    checkRequest(options);
    const introductory = Array.from({ length: 425 }, (_, index) => '<p>Introductory company text and cautionary statements number ' + index + '.</p>');
    return response(url, '<head><title>Annual report</title></head>' + introductory.join('') + '<p>Paid subscribers reached 6.6 million for the year.</p>', { type: 'text/html' });
  } });
  assert(readFiling.passages.includes('Paid subscribers reached 6.6 million for the year.'));
  assert.equal(readFiling.passages.length, 28);
  await assert.rejects(sources.read(found[0], { fetchImpl: url => response(url, 'x'.repeat(oneMiB + 1)) }), /size limit/);
  await assert.rejects(sources.read({ kind: 'record', url: paper + '?private=true' }, { fetchImpl: () => { assert.fail('noncanonical URL made a request'); } }), /Unsupported/);

  for (const run of [
    (signal, fetchImpl) => sources.read(entry, { signal, fetchImpl }),
    (signal, fetchImpl) => sources.read(found[0], { signal, fetchImpl }),
    (signal, fetchImpl) => sources.discover({ kind: 'paper', query: 'Trial' }, fetchImpl, { signal }),
  ]) {
    const caller = new AbortController();
    let requestSignal, calls = 0;
    const fetchImpl = (_, options) => {
      calls++;
      requestSignal = options.signal;
      return new Promise(() => {});
    };
    const pending = run(caller.signal, fetchImpl);
    assert(requestSignal instanceof AbortSignal);
    assert(!requestSignal.aborted);
    caller.abort();
    await assert.rejects(pending, /cancelled/);
    assert(requestSignal.aborted);
    await assert.rejects(run(caller.signal, fetchImpl), /cancelled/);
    assert.equal(calls, 1);
  }

  const originalTimer = global.setTimeout;
  let aborted;
  try {
    global.setTimeout = (fn) => originalTimer(fn, 1);
    await assert.rejects(sources.read(entry, { fetchImpl: (_, options) => {
      aborted = options.signal;
      return new Promise(() => {});
    } }), /timed out/);
    assert(aborted.aborted);
  } finally { global.setTimeout = originalTimer; }

  const browser = { URL };
  for (const module of ['public-records', 'inquiry-sources']) {
    vm.runInNewContext(fs.readFileSync(require.resolve('../extension/' + module), 'utf8'), browser);
  }
  assert.equal(browser.SubtextInquirySources.candidate(paper).url, paper);
  console.log('Inquiry sources: allowlists, disclosure parsing, bounded fetch and public discovery checks passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
