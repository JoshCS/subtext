/* Local saved ORIGINAL public responses; never synthetic evidence or extension results.
 * Refresh makes only the three fixed public requests below. Runtime defaults offline.
 * Cache lives under the existing ignored eval/out*/
const fs = require('fs');
const path = require('path');
const CACHE = path.resolve(__dirname, '..', 'eval', 'out-investigation-demo');
const SEC_URL = 'https://www.sec.gov/Archives/edgar/data/1318605/000119312516743920/d272397d425.htm';
const PROXY_URL = 'https://www.sec.gov/Archives/edgar/data/1318605/000119312516736377/d241192d424b3.htm';
const TRIAL_URL = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID%3A37952131%20AND%20SRC%3AMED&format=json&resultType=core&pageSize=5';
const PAGES = { 'https://solar.investigation.test/': 'solar.html', 'https://trial.investigation.test/': 'trial.html', 'https://offer.investigation.test/': 'offer.html',
  'https://post.investigation.test/': 'post.html' };
const SOURCES = [{url: SEC_URL, file: 'sec-original.html', contentType: 'text/html; charset=utf-8'}, {url: TRIAL_URL, file: 'europepmc-original.json', contentType: 'application/json; charset=utf-8'}, {url: PROXY_URL, file:'merger-proxy.html',contentType:'text/html; charset=utf-8'}];
async function refresh() {
  const fetched = [];
  for (const source of SOURCES) {
    const response = await fetch(source.url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Public record refresh failed: HTTP ${response.status} at ${source.url}`);
    const body = await response.text();
    if (source.file.endsWith('.json')) {
      const data = JSON.parse(body);
      if (!data.resultList?.result?.some(r => r.id === '37952131')) throw new Error('Europe PMC response did not contain SELECT PMID 37952131');
    } else if (source.url===PROXY_URL) {
      if (!/SpaceX/.test(body) || !/Ownership of Other SolarCity Securities/i.test(body)) throw new Error('SEC response did not contain the merger proxy.');
    } else if (!/Important Voting Information Regarding Tesla/i.test(body) || !/October 28/i.test(body)) throw new Error('SEC response did not contain the expected shareholder letter');
    fetched.push({source, body});
  }
  fs.mkdirSync(CACHE, { recursive: true });
  for (const {source, body} of fetched) fs.writeFileSync(path.join(CACHE, source.file), body);
  fs.writeFileSync(path.join(CACHE, 'provenance.json'), JSON.stringify({ savedAt: new Date().toISOString(), sources: SOURCES.map(({url,file}) => ({url,file})) }, null, 2) + '\n');
  console.log('Saved original public responses to local ignored cache:', CACHE);
}
function checkCache() {
  for (const {file} of SOURCES) if (!fs.existsSync(path.join(CACHE, file))) throw new Error('Saved public records missing. Run node scripts/investigation-demo.js --refresh once (three fixed public requests; no page data or credentials), then rerun the offline demo.');
}
function recordResponse(rawUrl) {
  const url = new URL(rawUrl);
  let source;
  if (url.origin+url.pathname === PROXY_URL && !url.search) source = SOURCES[2];
  else if (url.href === SEC_URL) source = SOURCES[0];
  else if (url.origin === 'https://www.ebi.ac.uk' && url.pathname === '/europepmc/webservices/rest/search' && url.searchParams.get('format') === 'json') {
    const q = url.searchParams.get('query') || '';
    if (/^EXT_ID:37952131 AND SRC:MED$/i.test(q) || /^DOI:"10\.1056\/nejmoa2307563"$/i.test(q)) source = SOURCES[1];
  }
  if (!source) return null;
  return { contentType: source.contentType, body: fs.readFileSync(path.join(CACHE, source.file)) };
}
async function routeDemo(route) {
  const req = route.request(); const url = req.url();
  if (url.startsWith('chrome-extension://') || url.startsWith('data:')) return route.continue();
  if (PAGES[url] && req.resourceType() === 'document') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'investigations', PAGES[url]), 'utf8') });
  if (url === 'https://pubmed.ncbi.nlm.nih.gov/37952131/' && req.resourceType()==='document') {
    const record=JSON.parse(fs.readFileSync(path.join(CACHE,'europepmc-original.json'),'utf8')).resultList.result[0];
    const esc=s=>String(s || '').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const abstract=record.abstractText.replace(/<h[1-6]>/gi,'\n\n').replace(/<\/h[1-6]>/gi,'\n').replace(/<\/?[a-z][^>]*>/gi,'');
    return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Saved study abstract</title><main style="max-width:48rem;margin:3rem auto;padding:1rem;font:16px/1.6 system-ui"><small>SUBTEXT OFFLINE DEMO · SAVED EUROPE PMC RECORD · PMID 37952131</small><h1>'+esc(record.title)+'</h1><p>'+esc(record.authorString)+'</p><div style="white-space:pre-line">'+esc(abstract)+'</div></main>'});
  }
  const record = recordResponse(url);
  if (record) return route.fulfill({ ...record, headers: { 'access-control-allow-origin': '*', 'x-subtext-demo': 'saved-original-public-response' } });
  return route.abort('blockedbyclient');
}
module.exports = { PAGES, SEC_URL, TRIAL_URL, SOURCES, CACHE, refresh, checkCache, recordResponse, routeDemo };
