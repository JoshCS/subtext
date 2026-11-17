const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const records = require('../extension/public-records');
const pubmed = 'https://pubmed.ncbi.nlm.nih.gov/37952131/';
const doi = 'https://doi.org/10.1056/NEJMoa2307563';
const sec = 'https://www.sec.gov/Archives/edgar/data/1318605/000119312516743920/d272397d425.htm';
const trial = 'https://clinicaltrials.gov/study/NCT03548935';
function response(value, type = 'application/json', status = 200) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers: { 'Content-Type': type } });
}
async function main() {
  for (const url of [pubmed, doi, sec, trial]) {
    const r = records.canonical(url + '?tracking=private#fragment');
    assert(r); assert(!/[?#]/.test(r.url)); assert(r.label && r.key && r.kind);
  }
  assert.equal(records.canonical(doi).key, 'doi:10.1056/nejmoa2307563');
  assert.equal(records.canonical('https://www.nejm.org/doi/full/10.1056/NEJMoa2307563?tracking=x').url, records.canonical(doi).url);
  for (const url of [
    'http://doi.org/10.1056/test', 'https://doi.org.evil.test/10.1056/test',
    'https://u:p@doi.org/10.1056/test', 'https://@doi.org/10.1056/test',
    'https://doi.org:444/10.1056/test', 'https://127.0.0.1/10.1056/test',
    'https://doi.org/10.1/test', 'https://doi.org/10.1056/a%22%20OR%20x',
    'https://doi.org/10.1056/../test', 'https://doi.org/10.1056/a%2f..%2fb',
    'https://doi.org/10.1056/a\\b', 'https://pubmed.ncbi.nlm.nih.gov/1/extra',
    'https://clinicaltrials.gov/study/NCT03548935/extra',
    sec.replace('000119312516743920', '123'), sec.replace('.htm', '.js'),
    sec.replace('/data/', '/data/../data/'), 'file:///etc/passwd', null, {},
  ]) assert.equal(records.canonical(url), null, String(url));
  let calls = [];
  const article = { resultList: { result: [{ id: '37952131', source: 'MED', doi: '10.1056/NEJMoa2307563', title: 'Cardiovascular outcomes', abstractText: '<h3>METHODS</h3><p>A randomized trial enrolled 17,604 patients.</p><h3>RESULTS</h3><p>The primary end point occurred in 6.5% and 8.0% (P<0.001). Adverse events occurred in 16.6% and 8.2%.</p>' }] } };
  const fetchArticle = async (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.redirect, 'error'); assert(options.signal instanceof AbortSignal);
    assert(url.startsWith('https://www.ebi.ac.uk/europepmc/webservices/rest/search?'));
    return response(article);
  };
  const a = await records.read({ url: pubmed + '?secret=x', key: 'http://localhost/', kind: 'sec' }, fetchArticle);
  assert.equal(a.url, pubmed); assert(a.passages.includes('METHODS')); assert(a.passages.join(' ').includes('17,604'));
  assert(decodeURIComponent(calls[0]).includes('EXT_ID:37952131 AND SRC:MED'));
  const b = await records.read(doi, fetchArticle);
  assert.equal(b.kind, 'doi'); assert(b.passages.join(' ').includes('6.5% and 8.0% (P<0.001)')); assert(b.passages.join(' ').includes('16.6% and 8.2%')); assert(decodeURIComponent(calls[1]).includes('DOI:"10.1056/nejmoa2307563"'));
  assert(calls.every(x => !x.includes('secret') && !x.includes('localhost')));
  const t = await records.read(trial, async (url) => {
    assert.equal(url, 'https://clinicaltrials.gov/api/v2/studies/NCT03548935');
    return response({ protocolSection: {
      identificationModule: { nctId: 'NCT03548935', briefTitle: 'SELECT trial' },
      sponsorCollaboratorsModule: { leadSponsor: { name: 'Sponsor name' } },
      designModule: { studyType: 'INTERVENTIONAL', designInfo: { allocation: 'RANDOMIZED', maskingInfo: { masking: 'QUADRUPLE' } }, enrollmentInfo: { count: 17604, type: 'ACTUAL' } },
      outcomesModule: { primaryOutcomes: [{ measure: 'Major adverse cardiovascular events', timeFrame: 'Up to 5 years' }] },
    } });
  });
  assert(t.passages.includes('Lead sponsor: Sponsor name'));
  assert(t.passages.includes('Allocation: RANDOMIZED'));
  assert(t.passages.includes('Enrollment: 17604 (ACTUAL)'));
  assert(t.passages.some(x => x.includes('Primary outcome: Major adverse')));
  const s = await records.read(sec, async (url) => {
    assert.equal(url, sec);
    return response('<html><head><title>Tesla &amp; SolarCity</title><style>HIDDEN CSS</style></head><body><h1>Transaction risks</h1><script>HIDDEN SCRIPT</script><ix:hidden>HIDDEN XBRL</ix:hidden><p>Powerwall 2.0 will accompany the solar roof.\nThe transaction is subject to shareholder approval &amp; closing conditions.</p></body></html>', 'text/html');
  });
  assert.equal(s.title, 'Tesla & SolarCity'); assert(s.passages.join(' ').includes('shareholder approval & closing'));
  assert(!s.passages.join(' ').includes('HIDDEN')); assert(s.passages.join(' ').includes('Powerwall 2.0'));
  let count = 0;
  await assert.rejects(records.read('https://evil.test/', () => { count++; })); assert.equal(count, 0);
  for (const mock of [
    () => response({}, 'application/json', 403),
    () => response('<p>Access denied</p>', 'text/html'),
    () => response('bad json'),
    () => response({ resultList: { result: [{ ...article.resultList.result[0], id: '1', doi: '10.1056/wrong' }] } }),
    () => ({ ok: true, redirected: true }),
    () => ({ ok: true, url: 'https://evil.test/' }),
    () => ({ ok: true, headers: new Headers({ 'Content-Type': 'application/json', 'Content-Length': '9999999' }), body: {} }),
    () => ({ ok: true, headers: new Headers({ 'Content-Type': 'application/json' }), body: {} }),
    () => response('x'.repeat(2 * 1024 * 1024 + 1)),
  ]) await assert.rejects(records.read(pubmed, mock));
  await assert.rejects(records.read(sec, () => response('<html><p>Your request originates from an undeclared automated tool.</p></html>', 'text/html')));
  await assert.rejects(records.read(trial, () => response({ protocolSection: { identificationModule: { nctId: 'NCT00000001' } } })));
  const oldTimer = global.setTimeout;
  let abortedSignal;
  try {
    global.setTimeout = (fn) => oldTimer(fn, 1);
    await assert.rejects(records.read(pubmed, (_, options) => { abortedSignal = options.signal; return new Promise(() => {}); }), /timed out/);
    assert(abortedSignal.aborted);
  } finally { global.setTimeout = oldTimer; }
  const browser = { URL };
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/public-records'), 'utf8'), browser);
  assert.equal(browser.SubtextRecords.canonical(pubmed).kind, 'pubmed');
  console.log('Public records: offline canonicalization, safe transport, parsing and rejection checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
