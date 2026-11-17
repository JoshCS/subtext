/* Context from public data: what the page is about, which question a source may answer, series rules, budget, cookies.
   Responses are synthetic, in each source's real response shape (no recorded third-party content). The chart drawing is tested in test/context-chart.js. */
const assert = require('assert');
const X = require('../extension/context-data.js');

const NOW = new Date('2026-11-17T12:00:00Z');
const day = (n) => new Date(NOW.getTime() - n * 864e5);
const rss = (items) => '<rss><channel>' + items.map((i) => '<item><title>' + i.t + '</title><link>https://news.example/' + encodeURIComponent(i.t) + '</link><pubDate>' + i.d.toUTCString() + '</pubDate><source url="https://' + i.host + '">' + i.s + '</source></item>').join('') + '</channel></rss>';
const monthly = (n, base, spikeAt, spike) => ({ items: Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(2024, 10 + i, 1)); return { timestamp: d.toISOString().slice(0, 7).replace('-', '') + '0100', views: i === spikeAt ? spike : base + (i % 3) * 10 }; }) });
const daily = (n, base) => ({ items: Array.from({ length: n }, (_, i) => ({ timestamp: day(n - i).toISOString().slice(0, 10).replace(/-/g, '') + '00', views: base + i })) });
const trendsExplore = ")]}'\n" + JSON.stringify({ widgets: [{ id: 'TIMESERIES', token: 'tok', request: { time: '12m' } }] });
// 53 weekly points; the last one starts 2 days before NOW, so that week is still in progress
const trendsLine = ")]}',\n" + JSON.stringify({ default: { timelineData: Array.from({ length: 53 }, (_, i) => ({ time: String(Math.floor(day(2 + 7 * (52 - i)).getTime() / 1000)), value: [i === 20 ? 100 : i === 52 ? 3 : 20 + (i % 5)], hasData: [true] })) } });
// a Wikidata entity in the wbgetentities shape
const claim = (v) => [{ mainsnak: { datavalue: { value: v } } }];
const wd = (q, label, enwiki, claims, description) => ({ entities: { [q]: { labels: { en: { value: label } }, descriptions: description ? { en: { value: description } } : {}, sitelinks: enwiki ? { enwiki: { title: enwiki } } : {}, claims } } });
const HUMAN = { P31: claim({ id: 'Q5' }) };
const COMPANY = { P31: claim({ id: 'Q4830453' }), P856: claim('https://example.com'), P169: claim({ id: 'Q1' }), P414: claim({ id: 'Q82059' }), P5531: claim('0001045810'), P17: claim({ id: 'Q30' }), P571: claim({ time: '+1993-04-05T00:00:00Z' }) };
const NONPROFIT = { P31: claim({ id: 'Q163740' }), P856: claim('https://example.org'), P1297: claim('13-3871360'), P17: claim({ id: 'Q30' }) };
const TAXON = { P225: claim('Pisum sativum'), P31: claim({ id: 'Q16521' }) };
const PLACE = { P625: claim({ latitude: 42, longitude: -71 }), P1082: claim({ amount: '+650000' }), P856: claim('https://boston.gov'), P571: claim({ time: '+1630-00-00T00:00:00Z' }) };
const OUTLET = { P31: claim({ id: 'Q11032' }), P856: claim('https://www.example-news.com'), P571: claim({ time: '+1872-03-04T00:00:00Z' }), P17: claim({ id: 'Q30' }) };

function fakeIo(routes) {
  const calls = [];
  return { calls, get: async (url, opt) => { calls.push({ url, cookies: !!(opt && opt.cookies) }); for (const [re, body] of routes) if (re.test(decodeURIComponent(url))) return typeof body === 'function' ? body(url) : { status: 200, text: typeof body === 'string' ? body : JSON.stringify(body) }; return { status: 404, text: '' }; } };
}
const siteFacts = [
  [/web\.archive\.org\/cdx/, [['timestamp'], ['1998'], ['1999'], ['2000'], ['2016'], ['2026']]],
  [/tranco-list\.eu/, { ranks: [{ date: '2026-11-16', rank: 3740 }, { date: '2026-11-01', rank: 3800 }] }],
  [/dns\.google/, { Answer: [{ data: '"openai-domain-verification=abc"' }, { data: '"google-site-verification=x"' }, { data: '"tollbit-domain-verification=y"' }, { data: '"v=spf1 include:_spf.google.com ~all"' }] }],
];
const article = (over) => X.pageFacts(Object.assign({ url: 'https://www.example-news.com/2026/11/01/story/', siteName: 'Example News', pageKind: 'article', isArticle: true, entityQ: 'Q100' }, over));

(async () => {
  // ---- topic words: one ordinary word is never a subject
  const pasta = X.topicTerms({ title: 'A weeknight pasta with lemon and peas | Food | The Guardian', siteName: 'The Guardian', text: 'This is a simple pasta. Use frozen peas and a lemon. Add the peas. A note on peas: frozen peas are sweet. Fresh peas are lovely. Pasta again, pasta.' });
  assert.strictEqual(pasta.entity + pasta.topic + pasta.keyword, '', 'a recipe names no subject: ' + JSON.stringify(pasta));
  const econ = X.topicTerms({ title: 'Taxing Wealth Makes Sense, But It Won’t Fix Our Economy', siteName: 'TIME', text: 'The economy is slowing. Our economy needs more. An economy like this. Economy watchers say the economy.' });
  assert.strictEqual(econ.entity, '', 'a headline capital does not make "Economy" a name');
  const nv = X.topicTerms({ title: 'Nvidia spy scandal underlines China threat', siteName: 'Washington Examiner', text: 'Nvidia said on Monday. Shares of Nvidia fell. The chips Nvidia sells. Nvidia again.' });
  assert.strictEqual(nv.entity, 'Nvidia', 'a word the page always capitalises is a name');
  const kirk = X.topicTerms({ title: 'Jennifer Welch laughs at Charlie Kirk joke', siteName: 'Fox News', text: 'Welch said. Then Charlie Kirk was named. Fans of Charlie Kirk replied. Charlie Kirk again.' });
  assert.strictEqual(kirk.entity, 'Charlie Kirk');
  const tax = X.topicTerms({ title: 'Taxing billionaires in Calif. goes to the ballot - The Boston Globe', siteName: 'The Boston Globe', text: 'A billionaire tax would apply once. The billionaire tax measure. Supporters of the billionaire tax say', url: 'https://example.com/2026/11/01/billionaire-tax-ballot/' });
  assert.strictEqual(tax.title, 'Taxing billionaires in Calif. goes to the ballot'); assert.strictEqual(tax.topic, 'billionaire tax');
  assert.ok(!/fix a/i.test(X.topicTerms({ title: 'How to Fix a Running Toilet', siteName: 'Bob Vila', text: 'a running toilet wastes water; fix a running toilet; running toilet parts' }).topic), 'a fragment with a small word inside is not a phrase');

  const owners = X.topicTerms({ title: 'Boston sports political donations: How team owners gave ahead of midterms', siteName: 'The Boston Globe', siteNames: ['Boston Globe', 'bostonglobe'], article: true, text: 'The Red Sox owner gave nothing. Kraft Group executives gave. A Red Sox spokesman said. Employees of the Red Sox gave. The Kraft Group again. For the Red Sox, the cycle was quiet. Celtics staff gave.' });
  assert.strictEqual(X.topicTerms({ title: 'The 6 best robot vacuums in 2026', siteName: 'X', text: 'Dreame D10 Plus. The Dreame D10 Plus. Buy Dreame D10 Plus. Dreame D10 Plus again. robot vacuums, robot vacuums.' }).entity, '', 'on a guide, the most repeated product is not the subject');
  assert.strictEqual(owners.entity, 'Red Sox', 'the name the text returns to most, when the headline names none: ' + JSON.stringify(owners));
  assert.strictEqual(X.topicTerms({ title: 'Nvidia spy scandal', siteName: 'X', text: 'Nvidia said. Nvidia fell. Nvidia chips. Jensen Huang said. Jensen Huang again. Jensen Huang spoke. Jensen Huang left. Nvidia.' }).entity, 'Nvidia', 'a headline name outranks a name only in the text');

  // ---- what kind of thing: a species, a place and an idea are never subjects
  assert.strictEqual(X.entityFrom('Q1', { claims: TAXON }).kind, 'other', 'a species');
  assert.strictEqual(X.entityFrom('Q2', { claims: PLACE }).kind, 'other', 'a city, even with a website and a founding date');
  assert.strictEqual(X.entityFrom('Q3', { claims: HUMAN }).kind, 'person');
  assert.strictEqual(X.entityFrom('Q148', { claims: { P1082: claim({ amount: '+1400000000' }), P36: claim({ id: 'Q956' }), P2139: claim({ amount: '+1' }), P856: claim('https://gov.cn') } }).kind, 'other', 'a country, even with an economy and a website');
  const co = X.entityFrom('Q4', { claims: COMPANY }); assert.deepStrictEqual([co.kind, co.cik, co.country, co.founded], ['organization', '0001045810', 'US', '1993']);
  assert.strictEqual(X.entityFrom('Q5x', { claims: NONPROFIT }).ein, '133871360', 'tax id digits only');
  assert.strictEqual(X.entityFrom('Q6', { claims: {} }).kind, 'other', 'an item with no telling claims');

  const TICK = { NYT: [71691, 'NEW YORK TIMES CO'], BIRD: [1653909, 'Smartbird, Inc.'] };
  assert.strictEqual(X.cikFromTicker({ ticker: 'NYT', label: 'The New York Times Company' }, TICK), '71691', 'ticker and name both match');
  assert.strictEqual(X.cikFromTicker({ ticker: 'BIRD', label: 'Allbirds' }, TICK), '', 'same ticker, another name: no match');
  assert.strictEqual(X.cikFromTicker({ ticker: '', label: 'The New York Times Company' }, TICK), '');
  assert.strictEqual(X.pageFacts({ url: 'https://www.example.org/', title: 'Home', pageKind: 'article', isArticle: true }).group, 'organization', 'a home page is about the site even when it reads like an article');

  // ---- page groups
  assert.strictEqual(article({ title: 'x' }).group, 'news');
  assert.strictEqual(X.pageFacts({ url: 'https://www.example-news.com/', title: 'Home', pageKind: 'index', isArticle: true }).group, 'other', 'a front page is about the site, not one story');
  assert.strictEqual(X.pageFacts({ url: 'https://www.example.org/', title: 'Home', pageKind: 'index' }).group, 'organization');
  const shop = X.pageFacts({ url: 'https://shop.example.com/products/wool-runner', title: 'Wool Runner | Example', siteName: 'Example', pageKind: 'page', sells: true });
  assert.deepStrictEqual([shop.group, shop.shopHandle], ['shop', 'wool-runner']);
  assert.strictEqual(X.pageFacts({ url: 'https://x.com/r', title: 'Pasta', pageKind: 'recipe', isArticle: true }).group, 'evergreen');

  // ---- subject resolution
  const nvidiaPage = article({ title: 'Nvidia spy scandal underlines China threat', text: 'Nvidia said on Monday. Shares of Nvidia fell. The chips Nvidia sells. Nvidia again.' });
  let io = fakeIo([[/list=search.*srsearch=Nvidia/, { query: { search: [{ title: 'Nvidia' }] } }], [/wbgetentities.*titles=Nvidia/, wd('Q182477', 'Nvidia', 'Nvidia', COMPANY)]]);
  let subj = await X.resolveSubject(nvidiaPage, io);
  assert.deepStrictEqual([subj.label, subj.kind, subj.cik], ['Nvidia', 'organization', '0001045810']);
  // a recipe: nothing is asked at all
  const recipe = X.pageFacts({ url: 'https://www.example-news.com/food/pasta', title: 'A weeknight pasta with lemon and peas', siteName: 'Example News', text: 'frozen peas, peas, peas, pasta, pasta', pageKind: 'recipe', isArticle: true });
  io = fakeIo([]); assert.strictEqual(await X.resolveSubject(recipe, io), null); assert.strictEqual(io.calls.length, 0, 'no request for a page with no named subject');
  // a name that resolves to a place or a species is refused
  const boston = article({ title: 'Boston mayor on the budget', text: 'In Boston today. Boston officials. Across Boston, people. Boston again.' });
  io = fakeIo([[/list=search/, { query: { search: [{ title: 'Boston' }] } }], [/wbgetentities/, wd('Q100', 'Boston', 'Boston', PLACE)]]);
  assert.strictEqual(await X.resolveSubject(boston, io), null, 'a city is not a subject');
  // the first headline name is a country: the next one is tried
  const spy = article({ title: 'Nvidia spy scandal underlines China threat', text: 'China said. In China, officials. China again. China and Nvidia. Nvidia said. Nvidia fell. Nvidia chips. China.' });
  assert.deepStrictEqual(spy.terms.entities.slice().sort(), ['China', 'Nvidia']);
  io = fakeIo([[/list=search.*srsearch=China/, { query: { search: [{ title: 'China' }] } }], [/wbgetentities.*titles=China/, wd('Q148', 'People\'s Republic of China', 'China', PLACE)], [/list=search.*srsearch=Nvidia/, { query: { search: [{ title: 'Nvidia' }] } }], [/wbgetentities.*titles=Nvidia/, wd('Q182477', 'Nvidia', 'Nvidia', COMPANY)]]);
  assert.strictEqual((await X.resolveSubject(spy, io)).label, 'Nvidia');
  // the headline's first name leads; one word inside a longer name is not a name; one word must be the whole title
  const pep = article({ title: 'PepsiCo to cut about 1,000 North America jobs', text: 'PepsiCo said. PepsiCo North America. In North America, PepsiCo. North America again. PepsiCo.' });
  assert.deepStrictEqual(pep.terms.entities, ['PepsiCo', 'North America'], JSON.stringify(pep.terms.entities));
  const north = article({ title: 'North wins again', text: 'North said. North won. North again. North.' });
  io = fakeIo([[/list=search/, { query: { search: [{ title: 'North of North' }] } }], [/wbgetentities/, wd('Q8', 'North of North', 'North of North', { P577: claim({ time: '+2025' }) })]]);
  assert.strictEqual(await X.resolveSubject(north, io), null, '"North" is not "North of North"');
  assert.strictEqual(article({ title: 'Mortgage rates fall', text: 'Freddie Mac said rates fell.' }).countryHint, 'US');
  assert.strictEqual(article({ title: 'Rates', text: 'The Federal Reserve and the Bank of England both moved.' }).countryHint, '', 'two countries named: no hint');
  assert.ok(!X.candidates(Object.assign(X.pageFacts({ url: 'https://shop.example/p/gift-set', title: 'Christmas Coffee and Cake Gift Set', pageKind: 'page', isArticle: true }), { site: null, subject: null }), {}).some((c) => c.id === 'news_coverage'), 'prose on a product page is not a story');
  // a company's fuller name is the name; a job title is not part of one
  const marv = article({ title: 'Marvell announces $115 billion acquisition of Lumentum', text: 'On Monday Marvell said. Shares of Marvell rose. The deal gives Marvell more. At Marvell, staff.' });
  io = fakeIo([[/list=search/, { query: { search: [{ title: 'Marvel Comics' }, { title: 'Marvell Technology' }] } }], [/wbgetentities/, wd('Q1', 'Marvell Technology', 'Marvell Technology', COMPANY)]]);
  assert.strictEqual((await X.resolveSubject(marv, io)).label, 'Marvell Technology');
  const ceo = X.topicTerms({ title: 'Why did Nvidia CEO Jensen Huang resign, and who is Colette Kress?', siteName: 'Al Jazeera', article: true, text: 'On Monday Nvidia CEO Jensen Huang said he would go. Shares of Nvidia fell. The board thanked Jensen Huang. At Nvidia, staff were told. Then Jensen Huang left. Nvidia named Colette Kress. She, Colette Kress, said.' });
  assert.deepStrictEqual(ceo.entities, ['Nvidia', 'Jensen Huang', 'Colette Kress'], JSON.stringify(ceo.entities));
  assert.strictEqual(X.pageFacts({ url: 'https://shop.example/shop/gift-box/', title: 'Gift Box', pageKind: 'article', isArticle: true, productPage: true, published: '2026-10-01' }).group, 'shop', 'a page that marks itself a product is a shop page');
  // one word cannot pick among several things of that name, and part of a word is not the name
  const dems = article({ title: 'The mandate is clear. Democrats must act now', text: 'Democrats won. The Democrats said. Senate Democrats. Democrats in Israel and elsewhere. Democrats.' });
  io = fakeIo([[/list=search/, { query: { search: [{ title: 'The Democrats (Israel)' }, { title: 'Democratic Party (United States)' }] } }], [/wbgetentities/, wd('Q9', 'The Democrats', 'The Democrats (Israel)', COMPANY)]]);
  assert.strictEqual(await X.resolveSubject(dems, io), null, 'an ambiguous one-word name resolves to nothing');
  assert.ok(!io.calls.some((c) => /wbgetentities/.test(c.url)), 'and the wrong article is never fetched');
  // a phrase with no article of that exact name is not a subject (and a look-alike with another qualifier is never fetched)
  const mass = article({ title: 'Millionaires tax: levy brings in $3.1 billion for Mass.', text: 'The millionaires tax passed in Massachusetts. The millionaires tax again.' });
  io = fakeIo([[/prop=pageprops/, { query: { pages: { '-1': { title: 'Millionaires tax', missing: '' } } } }]]);
  assert.strictEqual(await X.resolveSubject(mass, io), null, 'no article of that exact name: no subject');
  // a repeated two-word phrase that is an article's exact title becomes a phrase subject
  const vac = X.pageFacts({ url: 'https://x.com/best-robot-vacuums', title: 'The best robot vacuums in 2026', siteName: 'X', text: 'robot vacuums clean. these robot vacuums. a robot vacuum that', pageKind: 'review' });
  io = fakeIo([[/prop=pageprops.*titles=robot vacuums\|robot vacuum/i, { query: { pages: { '-1': { title: 'Robot vacuums', missing: '' }, 5: { title: 'Robotic vacuum cleaner' } } } }], [/wbgetentities/, wd('Q7', 'robotic vacuum cleaner', 'Robotic vacuum cleaner', {})]]);
  subj = await X.resolveSubject(vac, io);
  assert.deepStrictEqual([subj.kind, subj.label, subj.enwiki], ['phrase', 'robot vacuums', 'Robotic vacuum cleaner']);
  io = fakeIo([[/prop=pageprops/, { query: { pages: { 5: { title: 'Robot vacuum', pageprops: { disambiguation: '' } } } } }]]);
  assert.strictEqual(await X.resolveSubject(vac, io), null, 'a disambiguation page is not a subject');

  // ---- which questions may be asked, in order
  const ids = (f, o) => X.candidates(f, o).map((c) => c.id + ':' + c.about);
  const withE = (f, site, subject) => Object.assign(f, { site, subject });
  const siteE = X.entityFrom('Q100', wd('Q100', 'Example News', 'Example News', OUTLET).entities.Q100);
  const nvE = X.entityFrom('Q182477', wd('Q182477', 'Nvidia', 'Nvidia', COMPANY).entities.Q182477);
  assert.deepStrictEqual(ids(withE(nvidiaPage, siteE, nvE), {}), ['news_coverage:page', 'subject_views:subject', 'site_views:site'], 'no Trends without the click');
  assert.deepStrictEqual(ids(withE(nvidiaPage, siteE, nvE), { trends: true }), ['news_coverage:page', 'subject_views:subject', 'subject_trends:subject', 'site_views:site', 'site_trends:site']);
  assert.deepStrictEqual(ids(withE(recipe, siteE, null), {}), ['site_views:site'], 'a recipe with no subject: only the labelled last resort');
  assert.deepStrictEqual(ids(withE(shop, nvE, nvE), { trends: true }), ['site_views:subject', 'site_trends:subject', 'site_discussion:subject'], 'on a shop the site is the subject');
  assert.deepStrictEqual(ids(withE(X.pageFacts({ url: 'https://www.agency.example/parks/plan-your-visit', title: 'Plan Your Visit', pageKind: 'page' }), nvE, nvE), {}).map((x) => x.split(':')[1]), ['site', 'site'], 'an inner page of a large site: what is shown is labelled as about the site');
  // records sources, once registered, come first when they apply; a registered source that throws in applies() is skipped
  X.register({ id: 'sec_financials', basis: 'records', scope: 'entity', label: 'l', question: 'q', applies: (e) => !!e.cik, sends: () => 's', run: async () => ({ chart: { title: 'Revenue', kind: 'bars', resolution: 'year', points: [{ t: '2020', v: 1 }], sentence: 'x' } }) });
  X.register({ id: 'fec_committee', basis: 'records', scope: 'entity', label: 'l', question: 'q', applies: () => { throw new Error('bad'); }, sends: () => 's', run: async () => null });
  assert.deepStrictEqual(ids(withE(shop, nvE, nvE), {}).slice(0, 2), ['sec_financials:subject', 'site_views:subject']);
  const earnings = article({ title: 'Nvidia revenue beats forecasts as profit doubles', text: 'Nvidia said. Nvidia revenue rose. Nvidia shares. Nvidia.' });
  assert.strictEqual(ids(withE(earnings, siteE, nvE), {})[0], 'sec_financials:subject', 'a page about the company\'s money: its filings lead');
  assert.strictEqual(ids(withE(nvidiaPage, siteE, nvE), {})[0], 'news_coverage:page', 'a page about something else: coverage leads, filings follow');
  assert.ok(!ids(withE(article({ title: 'x y z story' }), nvE, null), {}).includes('sec_financials:subject'));
  assert.ok(ids(withE(article({ title: 'A long story headline here' }), nvE, null), {}).includes('sec_financials:site'), 'the site\'s own filings are a labelled last resort');
  assert.throws(() => X.register({ id: 'x', basis: 'vibes', scope: 'page', label: 'l', question: 'q', applies() {}, sends() {}, run() {} }), /bad basis/);
  delete X.REGISTERED.sec_financials; delete X.REGISTERED.fec_committee;

  // ---- series rules
  const clean = X.cleanSeries([{ t: '2026-11', v: 212 }, { t: '2026-10', v: 8139 }, { t: '2026-09', v: null }, { t: '2026-08', v: '9000' }, { t: 'junk', v: 1 }], 'month', NOW);
  assert.deepStrictEqual(clean, [{ t: '2026-08', v: 9000 }, { t: '2026-09', v: null }, { t: '2026-10', v: 8139 }], 'unfinished month dropped; a missing value stays missing, never 0');
  assert.deepStrictEqual([3216, 999999.6, 1.25e6, 2.5e9, -93e6].map(X.util.money), ['$3,216', '$1,000,000', '$1.3 million', '$2.5 billion', '-$93.0 million']);
  assert.strictEqual(X.util.num(null), null); assert.strictEqual(X.util.num(''), null); assert.strictEqual(X.util.num('0'), 0);
  const wk = X.cleanSeries([{ t: '2026-11-15', v: 3 }, { t: '2026-11-08', v: 20 }, { t: '2026-11-01', v: 22 }], 'week', NOW);
  assert.deepStrictEqual(wk.map((p) => p.t), ['2026-11-01', '2026-11-08'], 'the week in progress is dropped');
  assert.deepStrictEqual(X.cleanSeries([{ t: '2026-11-17', v: 1 }, { t: '2026-11-16', v: 2 }], 'day', NOW).map((p) => p.t), ['2026-11-16'], 'today is dropped');
  assert.ok(!X.validSeries([{ v: 0 }, { v: null }, { v: 93 }].concat(Array(90).fill({ v: 0 }))), 'one non-zero point among 93 is not a series');
  const sm = X.summary([{ t: '2020', v: 5 }, { t: '2021', v: null }, { t: '2022', v: 9 }]); assert.deepStrictEqual([sm.first.t, sm.last.v, sm.count], ['2020', 9, 2]);
  assert.strictEqual(X.summary([{ t: '2020', v: null }]), null);

  // ---- a full run on a news page: coverage leads, subject attention follows, the site is not charted
  const items = []; for (let i = 0; i < 10; i++) items.push({ t: 'Story ' + i, d: day(1 + (i % 3)), s: 'Outlet ' + (i % 6), host: 'o' + (i % 6) + '.example' });
  items.push({ t: 'Old', d: new Date('2021-06-24T00:00:00Z'), s: 'Legacy', host: 'legacy.example' }, { t: 'Today', d: NOW, s: 'Fast', host: 'fast.example' });
  const routes = [[/wbgetentities.*ids=Q100/, wd('Q100', 'Example News', 'Example News', OUTLET)], [/list=search/, { query: { search: [{ title: 'Nvidia' }] } }], [/wbgetentities.*titles=Nvidia/, wd('Q182477', 'Nvidia', 'Nvidia', COMPANY)],
    [/news\.google\.com/, rss(items)], [/per-article.*Nvidia\/daily/, daily(90, 5000)], [/per-article.*Example_News\/monthly/, monthly(25, 10000, 17, 77163)]].concat(siteFacts);
  io = fakeIo(routes);
  let out = await X.run(article({ title: 'Nvidia spy scandal underlines China threat', text: nvidiaPage.text, published: '2026-11-10T08:00:00Z' }), io, { now: NOW });
  assert.deepStrictEqual(out.charts.map((c) => c.id + ':' + c.basis + ':' + c.about), ['news_coverage:coverage:page'], 'coverage leads');
  assert.deepStrictEqual(out.other.map((c) => c.id + ':' + c.about), ['subject_views:subject'], 'ordinary attention is kept aside and never leads; the site is not charted once the page has its own');
  assert.deepStrictEqual(out.subject, { label: 'Nvidia', kind: 'organization' });
  const nc = out.charts[0];
  assert.strictEqual(nc.points.length, 30); assert.strictEqual(nc.points[29].t, '2026-11-16', 'the window ends yesterday');
  assert.strictEqual(nc.points.reduce((a, p) => a + p.v, 0), 10, 'the 2021 item and today\'s item are outside the window');
  assert.ok(/Google News returned 10 articles/.test(nc.sentence) && /not that none were written/.test(nc.note), nc.sentence);
  const sv = out.other[0];
  assert.ok(/was viewed about/.test(sv.sentence) && !/readers of/i.test(sv.sentence) && /not unique readers/.test(sv.note), 'views, not readers');
  assert.deepStrictEqual(sv.mark, { t: '2026-11-10', label: 'page published' }); assert.strictEqual(sv.aboutLabel, 'Nvidia');
  assert.ok(out.facts.find((x) => x.id === 'subject' && /Nvidia/.test(x.text)) && out.facts.find((x) => x.id === 'entity' && /founded 1872/.test(x.text)));
  assert.ok(out.facts.find((x) => x.id === 'archive' && /from 1998 to 2026, with none from 2001 to 2015/.test(x.text)));
  assert.ok(out.facts.find((x) => x.id === 'dns_services' && /OpenAI and TollBit/.test(x.text)) && out.facts.find((x) => x.id === 'rank' && /3,740/.test(x.text)));
  assert.ok(io.calls.every((c) => !c.cookies) && !io.calls.some((c) => /trends\.google/.test(c.url)), 'no cookies and no Trends without the click');
  assert.ok(out.ran.find((r) => r.id === 'subject' && r.ok && /"Nvidia"/.test(r.sends)), 'the subject lookup is listed with what it sent');
  assert.ok(!io.calls.some((c) => c.url.includes('example-news.com/2026')), 'the page address is never sent');

  // ---- flat attention never leads: with no record, statistic or coverage there is no lead chart, and the views sit in `other`
  io = fakeIo([[/wbgetentities.*ids=Q100/, wd('Q100', 'Example News', 'Example News', OUTLET)], [/per-article.*Example_News\/monthly/, monthly(25, 10000, 17, 10020)]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://www.example-news.com/food/pasta', title: 'A weeknight pasta with lemon and peas', siteName: 'Example News', text: recipe.text, pageKind: 'recipe', isArticle: true, entityQ: 'Q100' }), io, { now: NOW });
  assert.deepStrictEqual([out.charts.length, out.other.map((c) => c.id + ':' + c.about).join()], [0, 'site_views:site'], 'steady views of the site: no lead');
  // ---- a person leads the headline: the company named beside him is the one with filings
  const huang = article({ title: 'Why did Nvidia CEO Jensen Huang resign?', text: 'On Monday Jensen Huang said he would go. Shares of Nvidia fell. The board thanked Jensen Huang for his work. At Nvidia, staff were told. Chips from Nvidia sell well. Then Jensen Huang left.' });
  assert.deepStrictEqual(huang.terms.entities, ['Nvidia', 'Jensen Huang']);
  const huang2 = article({ title: 'Jensen Huang resigns from Nvidia', text: huang.text });
  io = fakeIo([[/list=search.*srsearch=Jensen Huang/, { query: { search: [{ title: 'Jensen Huang' }] } }], [/wbgetentities.*titles=Jensen Huang/, wd('Q305177', 'Jensen Huang', 'Jensen Huang', Object.assign({ P108: claim({ id: 'Q182477' }) }, HUMAN), 'Taiwanese-American businessman, co-founder of Nvidia')], [/list=search.*srsearch=Nvidia/, { query: { search: [{ title: 'Nvidia' }] } }], [/wbgetentities.*titles=Nvidia/, wd('Q182477', 'Nvidia', 'Nvidia', COMPANY)]]);
  const hs = await X.resolveSubject(huang2, io);
  assert.deepStrictEqual([hs.label, huang2.secondary && huang2.secondary.label], ['Jensen Huang', 'Nvidia']);
  X.register({ id: 'sec_financials', basis: 'records', scope: 'entity', label: 'l', question: 'q', applies: (e) => !!e.cik, sends: () => 's', run: async () => null });
  assert.ok(ids(Object.assign(huang2, { site: siteE, subject: hs }), {}).includes('sec_financials:subject'), 'the company\'s filings are offered');
  delete X.REGISTERED.sec_financials;
  // two names in one headline are not a link: without one in Wikidata, the second name's filings are never offered
  const swift = article({ title: 'Taylor Swift thanks Ford workers after Detroit show', text: 'On stage Taylor Swift thanked them. Workers at Ford cheered. The singer Taylor Swift said. At Ford, shifts ended early. Then Taylor Swift left. Ford said.' });
  io = fakeIo([[/list=search.*srsearch=Taylor Swift/, { query: { search: [{ title: 'Taylor Swift' }] } }], [/wbgetentities.*titles=Taylor Swift/, wd('Q26876', 'Taylor Swift', 'Taylor Swift', HUMAN, 'American singer-songwriter')], [/list=search.*srsearch=Ford/, { query: { search: [{ title: 'Ford' }] } }], [/wbgetentities.*titles=Ford/, wd('Q44294', 'Ford Motor Company', 'Ford', COMPANY)]]);
  const sw1 = await X.resolveSubject(swift, io);
  assert.deepStrictEqual([sw1.label, swift.secondary], ['Taylor Swift', null], 'an unrelated company in the headline is not attached');
  // a surname the text spells out in full is that person, not the company of the same name
  const ford = article({ title: "Ford's pardon of Nixon, 50 years on", text: 'In 1974 Gerald Ford pardoned his predecessor. Critics said Ford acted too soon. Historians now say Gerald Ford was right. For Ford it cost an election. Aides to Gerald Ford recall. Ford said little.' });
  assert.ok(ford.terms.entities.includes('Gerald Ford') && !ford.terms.entities.includes('Ford'), JSON.stringify(ford.terms.entities));
  assert.deepStrictEqual(article({ title: 'Nvidia spy scandal', text: 'On Monday Nvidia Corporation said. Shares of Nvidia fell. A Nvidia Corporation filing. Chips from Nvidia. Nvidia.' }).terms.entities, ['Nvidia'], 'a company word does not make a different name');
  // many people share a name: the page must use a word of this person's description
  const obit = article({ title: 'James Brown, longtime bus driver, dies at 81', text: 'For decades James Brown drove the number 9 bus. Neighbours said James Brown never missed a shift. The family of James Brown asks for privacy. Mr Brown retired in 2010.' });
  io = fakeIo([[/list=search/, { query: { search: [{ title: 'James Brown' }] } }], [/wbgetentities/, wd('Q5950', 'James Brown', 'James Brown', HUMAN, 'American singer, songwriter and bandleader')]]);
  assert.strictEqual(await X.resolveSubject(obit, io), null, 'another person of the same name');
  assert.strictEqual(X.entityFrom('Q9', { claims: { P17: claim({ id: 'Q159' }), P856: claim('https://x.ru') } }).country, 'Q159', 'a country outside the table is known, and is not the US');
  // a senator described only as "American politician": the page's own political words confirm her; a bus driver's obituary does not
  const pel = article({ title: 'Mary Peltola leads in U.S. Senate race', text: 'On Friday Mary Peltola led. The campaign of Mary Peltola said. Votes for Mary Peltola rose. The Senate race is close. Ballots are still being counted.' });
  io = fakeIo([[/list=search/, { query: { search: [{ title: 'Mary Peltola' }] } }], [/wbgetentities/, wd('Q1', 'Mary Peltola', 'Mary Peltola', HUMAN, 'American politician (born 1973)')]]);
  assert.strictEqual((await X.resolveSubject(pel, io)).label, 'Mary Peltola');
  // a listed company with no SEC number or ticker in Wikidata: the stock-exchange claim and one exact name on the SEC's list, both needed
  const TICK3 = { ASAN: [1477720, 'Asana, Inc.'], ROOT: [1788882, 'Root, Inc.'], AAA: [1, 'Acme Corp'], AAB: [2, 'ACME INC'] };
  assert.strictEqual(X.cikFromName({ label: 'Asana', kind: 'organization', country: 'US', listed: true }, TICK3), '1477720');
  assert.strictEqual(X.cikFromName({ label: 'The Root', kind: 'organization', country: 'US', listed: false }, TICK3), '', 'a magazine is not the insurer of the same name');
  assert.strictEqual(X.cikFromName({ label: 'Acme', kind: 'organization', country: 'US', listed: true }, TICK3), '', 'two listed companies share the name');
  assert.strictEqual(X.cikFromName({ label: 'Asana', kind: 'organization', country: 'Q159', listed: true }, TICK3), '', 'not a US company');
  // exactly one filer cannot be established from the first of several pages; a city name inside another word is not the city
  assert.strictEqual(await X.filerByName(fakeIo([[/search\.json/, { num_pages: 13, organizations: [{ ein: 1, name: 'Hope Shelter Inc', city: 'Ada', state: 'OK' }] }]]), 'Hope Shelter'), null);
  X.register({ id: 'nonprofit_finances', basis: 'records', scope: 'entity', label: 'l', question: 'q', applies: (e) => !!e.ein, sends: () => 's', run: async (e) => ({ chart: { title: 'Revenue', kind: 'bars', resolution: 'year', points: [], sentence: 'x' } }) });
  io = fakeIo([[/sparql/, { results: { bindings: [] } }], [/search\.json/, { organizations: [{ ein: 731111111, name: 'Hope Shelter Inc', city: 'Ada', state: 'OK' }] }]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://hopeshelter.org/', title: 'Home', siteName: 'Hope Shelter', text: 'A shelter in Toronto, Canada. OK to call any time.', pageKind: 'index' }), io, { now: NOW });
  assert.strictEqual(out.charts.length, 0, '"Ada" inside "Canada" is not the filer\'s city');
  delete X.REGISTERED.nonprofit_finances;
  // a site's own articles are not coverage of its story
  const ownOnly = []; for (let i = 0; i < 10; i++) ownOnly.push({ t: 'Own ' + i, d: day(1 + (i % 3)), s: 'Example News', host: 'www.example-news.com' });
  const own = await X.REGISTERED.news_coverage.run(Object.assign({}, nvidiaPage), fakeIo([[/news\.google\.com/, rss(ownOnly)]]), NOW);
  assert.ok(!own.chart, 'no other outlet: no coverage chart');
  // the name scan stays fast on hostile text (house limit: 300 ms at 40,000 characters)
  { const t0 = Date.now(); X.topicTerms({ title: 'A story', siteName: 'X', article: true, text: 'A-'.repeat(30000) }); X.topicTerms({ title: 'A story', siteName: 'X', article: true, text: 'Aa Bb '.repeat(10000) }); assert.ok(Date.now() - t0 < 600, 'name scan took ' + (Date.now() - t0) + ' ms'); }

  // ---- a feed at its cap is not a curve: the outlets are listed, no chart
  const many = []; for (let i = 0; i < 95; i++) many.push({ t: 'S' + i, d: day(1 + (i % 4)), s: 'Outlet ' + (i % 40), host: 'h' + (i % 40) + '.example' });
  const capped = await X.REGISTERED.news_coverage.run(nvidiaPage, fakeIo([[/news\.google\.com/, rss(many)]]), NOW);
  assert.ok(!capped.chart && /Widely covered: Google News returned 95 or more/.test(capped.facts[0].text), 'near the feed\'s cap the daily counts show its order, not the coverage');
  // ---- a small nonprofit by its own name: only with the filer's city on the page
  const fb = { organizations: [{ ein: 232345678, name: 'Example County Food Bank', city: 'Exton', state: 'PA' }] };
  X.register({ id: 'nonprofit_finances', basis: 'records', scope: 'entity', label: 'l', question: 'q', applies: (e) => !!e.ein, sends: () => 's', run: async (e) => ({ chart: { title: 'Revenue', kind: 'bars', resolution: 'year', points: [], sentence: 'x ' + e.ein } }) });
  io = fakeIo([[/sparql/, { results: { bindings: [] } }], [/search\.json/, fb]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://examplefoodbank.org/', title: 'Home - Example County Food Bank', siteName: 'Example County Food Bank', text: 'Visit us at 650 Main Road, Exton, PA.', pageKind: 'index' }), io, { now: NOW });
  assert.strictEqual(out.charts[0] && out.charts[0].sentence, 'x 232345678', 'name and city both match');
  io = fakeIo([[/sparql/, { results: { bindings: [] } }], [/search\.json/, fb]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://examplefoodbank.org/', title: 'Home', siteName: 'Example County Food Bank', text: 'Serving families in Ohio.', pageKind: 'index' }), io, { now: NOW });
  assert.strictEqual(out.charts.length, 0, 'the same name in another town is not this organization');
  delete X.REGISTERED.nonprofit_finances;
  assert.strictEqual(X.topicTerms({ title: 'October jobs report: U.S. adds 1,000 jobs', siteName: 'X', article: true, text: 'October was strong. In October the U.S. added. October again. U.S. jobs. The U.S. economy. 1,000 jobs. 1,000 jobs.' }).entities.join(), '', 'months, numbers and country initials are not names');

  // ---- the pasta recipe: no subject, no topic chart. Only the site, labelled as the site; and nothing at all when the site is unknown
  io = fakeIo([[/wbgetentities.*ids=Q100/, wd('Q100', 'Example News', 'Example News', OUTLET)], [/per-article.*Example_News\/monthly/, monthly(25, 10000, 17, 77163)]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://www.example-news.com/food/pasta', title: 'A weeknight pasta with lemon and peas', siteName: 'Example News', text: recipe.text, pageKind: 'recipe', isArticle: true, entityQ: 'Q100' }), io, { now: NOW });
  assert.deepStrictEqual(out.charts.map((c) => c.id + ':' + c.about + ':' + c.aboutLabel), ['site_views:site:Example News']);
  assert.ok(!io.calls.some((c) => /Pea|pasta|lemon/i.test(decodeURIComponent(c.url))), 'no ingredient is ever looked up');
  assert.ok(/77k times, .* times the usual/.test(out.charts[0].sentence) && !out.charts[0].points.some((p) => p.t === '2026-11'), out.charts[0].sentence);
  assert.ok(!/usually means|in the news/.test(JSON.stringify(out.charts[0])), 'no unsupported explanation of a peak');
  io = fakeIo([[/sparql/, { results: { bindings: [] } }]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://tiny-blog.example/pasta', title: 'A weeknight pasta with lemon and peas', text: recipe.text, pageKind: 'recipe' }), io, { now: NOW });
  assert.deepStrictEqual([out.charts.length, out.subject], [0, null], 'nothing defensible: no chart');
  assert.ok(out.facts.length >= 2, 'the site facts still show');

  // ---- Trends: only with the click, cookies only there, one retry after a 429, the week in progress dropped
  let first = true;
  io = fakeIo(routes.filter((r) => !/news\\\.google|daily/.test(String(r[0]))).concat([[/trends\/api\/explore/, () => { if (first) { first = false; return { status: 429, text: '' }; } return { status: 200, text: trendsExplore }; }], [/trends\.google\.com\/trends\/\?geo/, ''], [/widgetdata\/multiline/, trendsLine]]));
  out = await X.run(article({ title: 'Nvidia spy scandal underlines China threat', text: nvidiaPage.text }), io, { now: NOW, trends: true });
  const tr = out.other.find((c) => c.id === 'subject_trends');
  assert.ok(tr && tr.cookies && /highest in the week of/.test(tr.sentence), 'Trends chart after a 429 retry');
  assert.strictEqual(tr.points.length, 52, 'the week in progress is not drawn'); assert.ok(!/stands at 3 /.test(tr.sentence), 'and is not called the latest week: ' + tr.sentence);
  assert.ok(io.calls.filter((c) => c.cookies).length >= 3 && io.calls.filter((c) => c.cookies).every((c) => /trends\.google\.com/.test(c.url)), 'cookies only on Trends requests');

  // ---- a peak month on a public company's site: its SEC filings that month are listed under the chart, when that source is present
  X.register({ id: 'sec_filings', basis: 'records', scope: 'entity', label: 'l', question: 'q', applies: (e) => !!e.cik, sends: () => 's', run: async (e, f, io2, now, o) => ({ chart: { kind: 'list', title: 't', sentence: 's', rows: [{ t: o.month + '-09', text: '8-K: change of chief executive', url: 'https://www.sec.gov/x' }] } }) });
  io = fakeIo([[/wbgetentities/, wd('Q182477', 'Nvidia', 'Nvidia', COMPANY)], [/monthly/, monthly(25, 5000, 17, 77163)]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://shop.example.com/products/wool-runner', title: 'Wool Runner', siteName: 'Example', sells: true, entityQ: 'Q182477' }), io, { now: NOW });
  const lead = out.charts.find((c) => c.id === 'site_views');
  assert.deepStrictEqual(lead.rows, [{ t: '2026-04-09', text: '8-K: change of chief executive', url: 'https://www.sec.gov/x' }]); assert.strictEqual(lead.rowsLabel, 'SEC filings around Apr 2026');
  delete X.REGISTERED.sec_filings;

  // ---- a nonprofit's own page names its legal entity: exactly one filer of exactly that name gives the tax ID; a near name does not
  const pp = { organizations: [{ ein: 454349842, name: 'Example Safety Support Fund Inc' }, { ein: 800000001, name: 'Example Safety Action Fund' }] };
  assert.strictEqual(await X.einByLegalName(fakeIo([[/search\.json/, pp]]), 'Example Safety Support Fund'), '454349842');
  assert.strictEqual(await X.einByLegalName(fakeIo([[/search\.json/, pp]]), 'Example Safety'), '', 'the shared part of two names matches neither');
  assert.strictEqual(await X.einByLegalName(fakeIo([[/search\.json/, { organizations: [pp.organizations[1], pp.organizations[1]] }]]), 'Example Safety Action Fund'), '', 'two filers of the same name: refused');
  io = fakeIo([[/search\.json/, pp]]); assert.strictEqual(await X.einByLegalName(io, 'Fund'), ''); assert.strictEqual(io.calls.length, 0, 'one word is not a legal name');
  X.register({ id: 'nonprofit_finances', basis: 'records', scope: 'entity', label: 'l', question: 'q', applies: (e) => !!e.ein, sends: (e) => 'tax id ' + e.ein, run: async (e) => ({ chart: { title: 'Revenue', kind: 'bars', resolution: 'year', points: [{ t: '2020', v: 1 }], sentence: 'x ' + e.ein } }) });
  io = fakeIo([[/sparql/, { results: { bindings: [] } }], [/search\.json/, pp]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://www.example.org/', title: 'Example Safety', pageKind: 'index', legalName: 'Example Safety Support Fund' }), io, { now: NOW });
  assert.deepStrictEqual(out.charts.map((c) => c.id + ':' + c.basis + ':' + c.sentence), ['nonprofit_finances:records:x 454349842'], 'records lead on the organization\'s own page');
  assert.ok(out.ran.find((r) => r.id === 'legal_name' && r.ok && /"Example Safety Support Fund"/.test(r.sends)));
  delete X.REGISTERED.nonprofit_finances;

  // ---- budget and failure isolation
  io = { get: async (url) => { if (/tranco/.test(url)) throw new Error('boom'); return { status: 500, text: '' }; } };
  out = await X.run(article({ title: 'Nvidia spy scandal underlines China threat', text: nvidiaPage.text }), io, { now: NOW, maxRequests: 4 });
  assert.ok(out.requests <= 4 && out.ran.some((r) => !r.ok), 'budget respected; failures listed, not thrown');
  assert.strictEqual(out.charts.length, 0);

  // ---- shop: the store's own files
  io = fakeIo([[/products\/wool-runner\.json/, { product: { created_at: '2018-11-12T14:25:43-08:00', variants: [{ price: '110.00', compare_at_price: null }] } }], [/products\.json/, { products: Array.from({ length: 30 }, (_, i) => ({ created_at: (i < 25 ? '2025' : '2021') + '-01-01' })) }]]);
  const r3 = await X.FACTS.shop_product.run(shop, io, NOW);
  assert.ok(/listed since Nov 2018, priced 110\.00 in the store's currency\. Of the 30 products in its catalog file, 25 were added in 2025\./.test(r3.text), r3.text);

  // ---- Hacker News by year: a year with no story is a real zero; the unfinished year is dropped
  io = fakeIo([[/hn\.algolia\.com/, { nbHits: 12, hits: Array.from({ length: 12 }, (_, i) => ({ created_at_i: Date.UTC(2015 + (i % 6) * 2, 3, 1) / 1000 })) }]]);
  const hn = await X.REGISTERED.site_discussion.run(shop, io, NOW);
  assert.ok(hn.chart.points.some((p) => p.v === 0) && hn.chart.points[hn.chart.points.length - 1].t === '2025', JSON.stringify(hn.chart.points));
  console.log('Context data: subject, question order, series rules, sources, budget and cookies passed.');
})().catch((e) => { console.error(e); process.exit(1); });
